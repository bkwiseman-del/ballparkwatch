#!/usr/bin/env python3
# GStreamer WHEP recorder (RE-ENCODE). Pulls the Cloudflare WHEP feed with whepsrc and writes
# an mp4. The video is DECODED and RE-ENCODED with x264enc (not copied), and the audio is
# transcoded opus→AAC. whepsrc exposes dynamic pads after negotiation, so we link them in a
# pad-added handler. SIGINT/SIGTERM → EOS so the mp4 is finalized.
#
# WHY RE-ENCODE INSTEAD OF COPY (this was the whole replay-spinner saga):
#   In WebRTC, H.264 SPS/PPS parameter sets are delivered IN-BAND, prepended to each IDR
#   keyframe — never in the receive caps (webrtcbin's receive caps carry no
#   sprop-parameter-sets). A raw copy (rtph264depay ! h264parse ! mp4mux) therefore depends on
#   a complete IDR surviving into the file to build the mp4 `avcC` box. It kept failing: with
#   NACK disabled, large IDRs (spread across many FU-A RTP packets) lost a packet over the
#   TURN-over-TCP relay, could never be reassembled or retransmitted, and h264parse never got
#   codec_data → no avcC → undecodable video → spinner.
#   Production WebRTC recorders (LiveKit Egress, Jibri) all RE-ENCODE for exactly this reason;
#   nobody ships raw-copy WebRTC→mp4. x264enc emits self-contained SPS/PPS on its own cadence,
#   so the output ALWAYS has a valid avcC regardless of Cloudflare's parameter-set behavior.
#   We also keep NACK ON (only FEC was the crash source) so the first IDR reassembles and
#   decoding can start at all.
#
#   python3 record.py <whep_url> <out.mp4>
import signal
import sys

import gi

gi.require_version("Gst", "1.0")
gi.require_version("GstVideo", "1.0")
from gi.repository import GLib, Gst, GstVideo  # noqa: E402


def log(*a):
    print("[py]", *a, flush=True)


VIDEO_CAPS = (
    "application/x-rtp,media=video,encoding-name=H264,clock-rate=90000,payload=103,"
    "packetization-mode=(string)1,profile-level-id=(string)42e01f"
)


def main(whep_url: str, out_path: str) -> int:
    Gst.init(None)
    pipeline = Gst.Pipeline.new("rec")

    src = Gst.ElementFactory.make("whepsrc", "w")
    src.set_property("whep-endpoint", whep_url)
    src.set_property("stun-server", "stun://stun.l.google.com:19302")
    src.set_property(
        "turn-server",
        "turn://openrelayproject:openrelayproject@openrelay.metered.ca:443?transport=tcp",
    )
    src.set_property("video-caps", Gst.Caps.from_string(VIDEO_CAPS))

    mux = Gst.ElementFactory.make("mp4mux", "mux")
    # moov at end (default). faststart=true can fail depending on sink seekability; the file
    # still plays, and we can optimize progressive playback later.
    sink = Gst.ElementFactory.make("filesink", "sink")
    sink.set_property("location", out_path)

    for e in (src, mux, sink):
        pipeline.add(e)
    mux.link(sink)

    def link_chain(pad, elements):
        prev = None
        for e in elements:
            pipeline.add(e)
        pad.link(elements[0].get_static_pad("sink"))
        for e in elements:
            if prev is not None:
                prev.link(e)
            prev = e
        prev.link(mux)  # request a mux sink pad
        for e in elements:
            e.sync_state_with_parent()

    linked = set()
    frame_counter = [None]  # holds the video-frame counter list once the video branch links

    def try_link(pad):
        if pad in linked:
            return
        caps = pad.get_current_caps()
        if not caps or caps.get_size() == 0:
            return  # caps not negotiated yet
        media = caps.get_structure(0).get_string("media")  # robust: 'video' / 'audio'
        if media == "video":
            linked.add(pad)
            log("VIDEO IN CAPS:", caps.to_string())
            depay = Gst.ElementFactory.make("rtph264depay")
            depay.set_property("request-keyframe", True)  # ask for a new IDR on packet loss
            depay.set_property("wait-for-keyframe", True)  # don't emit partial pre-IDR garbage
            parse_in = Gst.ElementFactory.make("h264parse")
            dec = Gst.ElementFactory.make("avdec_h264")
            conv = Gst.ElementFactory.make("videoconvert")
            enc = Gst.ElementFactory.make("x264enc")
            # zerolatency + veryfast keeps CPU sane on the Railway box; 2-second GOP
            # (key-int-max=60 @30fps) makes replay seeking snappy. x264enc emits its own
            # SPS/PPS, so the mp4 avcC is always valid.
            enc.set_property("tune", "zerolatency")
            enc.set_property("speed-preset", "veryfast")
            enc.set_property("bitrate", 2500)  # kbps
            enc.set_property("key-int-max", 60)
            parse_out = Gst.ElementFactory.make("h264parse")
            parse_out.set_property("config-interval", -1)  # SPS/PPS before every IDR (robust seek)
            # Count encoded video frames so we can tell (loudly) if video never flowed.
            vframes = [0]

            def count_frame(_pad, _info):
                vframes[0] += 1
                if vframes[0] == 1:
                    log("FIRST ENCODED VIDEO FRAME — avcC will be valid")
                return Gst.PadProbeReturn.OK

            enc.get_static_pad("src").add_probe(Gst.PadProbeType.BUFFER, count_frame)
            frame_counter[0] = vframes  # expose to EOS handler for the fail-loud check
            link_chain(pad, [Gst.ElementFactory.make("queue"), depay, parse_in, dec, conv, enc, parse_out])
            log("linked video (H.264 re-encode)")
            # Nudge Cloudflare for an early IDR so decoding starts fast (upstream ForceKeyUnit
            # → webrtcbin PLI). With NACK on, the IDR reassembles; a few early requests suffice.
            sinkpad = depay.get_static_pad("sink")
            kf_count = [0]

            def request_keyframe():
                ev = GstVideo.video_event_new_upstream_force_key_unit(Gst.CLOCK_TIME_NONE, True, 1)
                sinkpad.send_event(ev)
                kf_count[0] += 1
                if kf_count[0] == 1:
                    log("requested keyframe (PLI)")
                return kf_count[0] < 4  # ~first 9s, then stop

            request_keyframe()
            GLib.timeout_add_seconds(3, request_keyframe)
        elif media == "audio":
            linked.add(pad)
            log("link audio", caps.to_string()[:80])
            link_chain(
                pad,
                [
                    Gst.ElementFactory.make("queue"),
                    Gst.ElementFactory.make("rtpopusdepay"),
                    Gst.ElementFactory.make("opusdec"),
                    Gst.ElementFactory.make("audioconvert"),
                    Gst.ElementFactory.make("audioresample"),
                    Gst.ElementFactory.make("avenc_aac"),
                    Gst.ElementFactory.make("aacparse"),
                ],
            )
            log("linked audio (AAC)")

    def on_pad(_src, pad):
        log("pad-added", pad.get_name())
        # Caps are just 'application/x-rtp' at pad-added — the media type appears once
        # negotiated, so link when the pad's caps are actually set.
        pad.connect("notify::caps", lambda p, _ps: try_link(p))
        try_link(pad)

    src.connect("pad-added", on_pad)

    # whepsrc's internal webrtcbin errors on Cloudflare's stream ("Internal data stream
    # error" from nicesrc) — the prime suspect is FEC/NACK receive setup. Reach into the
    # nested webrtcbin and turn FEC + NACK off on each transceiver as it's created.
    def on_new_transceiver(_webrtc, trans):
        try:
            trans.set_property("fec-type", 0)  # GST_WEBRTC_FEC_TYPE_NONE — FEC was the crash source
            trans.set_property("do-nack", True)  # KEEP NACK: retransmits lost IDR packets so
            log("transceiver: fec off, nack on")  # keyframes reassemble (else no SPS/PPS ever)
        except Exception as e:  # noqa
            log("transceiver cfg failed:", repr(e))

    def on_deep_element(_bin, _sub, element):
        f = element.get_factory()
        if f and f.get_name() == "webrtcbin":
            log("found webrtcbin — disabling fec/nack")
            element.connect("on-new-transceiver", on_new_transceiver)

    src.connect("deep-element-added", on_deep_element)

    loop = GLib.MainLoop()
    bus = pipeline.get_bus()
    bus.add_signal_watch()

    def on_msg(_bus, msg):
        if msg.type == Gst.MessageType.EOS:
            n = frame_counter[0][0] if frame_counter[0] else 0
            if n == 0:
                log("WARNING: EOS with ZERO encoded video frames — feed never delivered a "
                    "decodable keyframe (mp4 will have no usable video)")
            else:
                log(f"EOS — {n} video frames encoded")
            loop.quit()
        elif msg.type == Gst.MessageType.ERROR:
            err, dbg = msg.parse_error()
            log("ERROR", err.message, "|", (dbg or "")[:200])
            loop.quit()

    bus.connect("message", on_msg)

    # Use GLib's signal source, NOT signal.signal — a Python signal handler does not fire
    # while GLib.MainLoop.run() is blocking in C, so SIGINT/SIGTERM (sent on game-final)
    # would never send EOS and the mp4 would never be finalized (then get SIGKILL'd).
    def stop():
        log("stopping -> EOS")
        pipeline.send_event(Gst.Event.new_eos())
        return GLib.SOURCE_REMOVE

    GLib.unix_signal_add(GLib.PRIORITY_HIGH, signal.SIGINT, stop)
    GLib.unix_signal_add(GLib.PRIORITY_HIGH, signal.SIGTERM, stop)

    pipeline.set_state(Gst.State.PLAYING)
    log("recording ->", out_path)
    loop.run()
    pipeline.set_state(Gst.State.NULL)
    log("done")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
