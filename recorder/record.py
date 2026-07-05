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
import os
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

    # ICE servers from the environment (the manager mints Cloudflare TURN creds per run).
    # Fall back to Google STUN + the free openrelay TURN if not provided.
    stun = os.environ.get("RECORDER_STUN") or "stun://stun.l.google.com:19302"
    turn = os.environ.get("RECORDER_TURN") or (
        "turn://openrelayproject:openrelayproject@openrelay.metered.ca:443?transport=tcp"
    )
    log("ICE stun:", stun, "| turn host:", turn.split("@")[-1] if "@" in turn else turn)

    src = Gst.ElementFactory.make("whepsrc", "w")
    src.set_property("whep-endpoint", whep_url)
    src.set_property("stun-server", stun)
    src.set_property("turn-server", turn)
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
    rtp_counter = [None]  # holds the raw-video-RTP-in counter (arrives before keyframe filtering)
    wb = [None]  # the nested webrtcbin, so we can send PLIs on its real src pad (not the ghost)

    def find_webrtcbin():
        # whepsrc creates its webrtcbin at construction — BEFORE we can connect
        # deep-element-added — so that signal never fires. Walk the whepsrc bin to find it.
        if wb[0] is not None:
            return wb[0]
        if not isinstance(src, Gst.Bin):
            return None
        it = src.iterate_recurse()
        while True:
            res, el = it.next()
            if res != Gst.IteratorResult.OK:
                break
            f = el.get_factory()
            if f and f.get_name() == "webrtcbin":
                wb[0] = el
                log("found webrtcbin via bin-walk")
                return el
        return None

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
            # Count RAW video RTP packets arriving at the depay (before wait-for-keyframe drops
            # pre-IDR data). Disambiguates "no video received at all" from "video received but
            # no keyframe": if this stays 0, the feed isn't sending us video; if it climbs but
            # frames stay 0, it's purely a missing-keyframe problem.
            rtp_in = [0]

            def count_rtp(_pad, _info):
                rtp_in[0] += 1
                return Gst.PadProbeReturn.OK

            depay.get_static_pad("sink").add_probe(Gst.PadProbeType.BUFFER, count_rtp)
            rtp_counter[0] = rtp_in
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
                    # Pipeline running-time at the first encoded frame = length of the leading
                    # audio-only (black) gap. (The encoder buffer PTS was unreliable — gave
                    # absurd values — so use the clock instead.) The manager trims this with
                    # ffmpeg so the replay opens on real video.
                    clk = pipeline.get_clock()
                    rt = (clk.get_time() - pipeline.get_base_time()) if clk else 0
                    ms = max(0, rt // 1_000_000)
                    log("FIRST ENCODED VIDEO FRAME — avcC will be valid")
                    log(f"VIDEO_START_MS={ms}")
                return Gst.PadProbeReturn.OK

            enc.get_static_pad("src").add_probe(Gst.PadProbeType.BUFFER, count_frame)
            frame_counter[0] = vframes  # expose to EOS handler for the fail-loud check
            link_chain(pad, [Gst.ElementFactory.make("queue"), depay, parse_in, dec, conv, enc, parse_out])
            log("linked video (H.264 re-encode)")
            # Cloudflare only emits an IDR keyframe when it receives an RTCP PLI, and
            # avdec_h264 decodes NOTHING until it gets that first IDR (→ zero encoded frames →
            # black replay). To request a keyframe you send an upstream force-key-unit event
            # on webrtcbin's SRC pad — which here is whepsrc's video src pad (`pad`); webrtcbin
            # converts it to a PLI/FIR to Cloudflare. (Sending it on the depay SINK pad, as we
            # did before, is the wrong direction — GStreamer drops it: "custom-upstream event
            # in wrong direction" — and no PLI ever goes out. THAT was the black-video bug.)
            kf_count = [0]

            def pad_is_video(p):
                caps = p.get_current_caps()
                if not caps or caps.get_size() == 0:
                    return None  # unknown yet
                st = caps.get_structure(0)
                media = st.get_string("media") or ""
                enc = st.get_string("encoding-name") or ""
                return media == "video" or "H264" in enc.upper()

            def send_pli_everywhere():
                # Send the upstream force-key-unit on webrtcbin's REAL src pads (bypassing
                # whepsrc's ghost pad, which swallows the event). CRITICAL: audio links first,
                # so the first src pad is usually AUDIO — a PLI there does nothing. Target the
                # VIDEO pad specifically; only that triggers Cloudflare to send an IDR. Send to
                # unknown-caps pads too (belt), and count video hits separately.
                sent = 0
                vsent = 0
                w = find_webrtcbin()
                if w is not None:
                    it = w.iterate_src_pads()
                    while True:
                        res, p = it.next()
                        if res != Gst.IteratorResult.OK:
                            break
                        isv = pad_is_video(p)
                        if isv is False:
                            continue  # skip the audio pad — PLI there is useless
                        # Send BOTH a PLI (all_headers=False) and a FIR (all_headers=True) —
                        # Cloudflare advertised rtcp-fb-nack-pli AND rtcp-fb-ccm-fir; cover both.
                        ok = False
                        for allh in (False, True):
                            ev = GstVideo.video_event_new_upstream_force_key_unit(Gst.CLOCK_TIME_NONE, allh, 0)
                            if p.send_event(ev):
                                ok = True
                        if ok:
                            sent += 1
                            if isv:
                                vsent += 1
                # Belt-and-suspenders: the whepsrc ghost video pad too.
                pad.send_event(GstVideo.video_event_new_upstream_force_key_unit(Gst.CLOCK_TIME_NONE, False, 0))
                return sent, vsent

            logged_v = [False]

            def request_keyframe():
                sent, vsent = send_pli_everywhere()
                kf_count[0] += 1
                if kf_count[0] == 1 or (vsent > 0 and not logged_v[0]):
                    log(f"PLI #{kf_count[0]}: sent={sent} video-pad-hits={vsent}")
                    if vsent > 0:
                        logged_v[0] = True
                if vframes[0] > 0:
                    log(f"keyframe landed after {kf_count[0]} PLIs — video decoding, stop asking")
                    return False  # first IDR arrived; decoding started
                return kf_count[0] < 60  # keep asking every 1s for ~60s

            request_keyframe()
            GLib.timeout_add_seconds(1, request_keyframe)
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
            log("found webrtcbin — fec off/nack on, PLI target set")
            wb[0] = element  # so request_keyframe can send PLIs on its real src pad
            element.connect("on-new-transceiver", on_new_transceiver)

    src.connect("deep-element-added", on_deep_element)

    loop = GLib.MainLoop()
    bus = pipeline.get_bus()
    bus.add_signal_watch()

    finalizing = [False]

    def finalize_partial():
        # The source (webrtcbin transport) died mid-recording. Push EOS straight into the
        # muxer's sink pads so mp4mux writes its moov and the partial clip is PLAYABLE — going
        # straight to NULL instead leaves an mp4 with no moov (unplayable, spinner). We still
        # keep everything captured up to the drop.
        try:
            it = mux.iterate_sink_pads()
            while True:
                res, p = it.next()
                if res != Gst.IteratorResult.OK:
                    break
                p.send_event(Gst.Event.new_eos())
        except Exception as e:  # noqa
            log("finalize_partial err", repr(e))

    def on_msg(_bus, msg):
        if msg.type == Gst.MessageType.EOS:
            n = frame_counter[0][0] if frame_counter[0] else 0
            rtp = rtp_counter[0][0] if rtp_counter[0] else 0
            if n == 0:
                log(f"WARNING: EOS with ZERO encoded video frames (raw video RTP in={rtp}). "
                    + ("Video IS arriving but no keyframe → PLI/keyframe problem."
                       if rtp > 0 else "NO video RTP arriving at all → feed/receive problem."))
            else:
                log(f"EOS — {n} video frames encoded (raw video RTP in={rtp})")
            loop.quit()
        elif msg.type == Gst.MessageType.ERROR:
            err, dbg = msg.parse_error()
            log("ERROR", err.message, "|", (dbg or "")[:200])
            n = frame_counter[0][0] if frame_counter[0] else 0
            if n > 0 and not finalizing[0]:
                # Salvage: finalize the partial mp4 so what we captured is playable.
                finalizing[0] = True
                log(f"error mid-recording with {n} frames — finalizing partial clip")
                finalize_partial()
                GLib.timeout_add_seconds(10, lambda: (loop.quit(), False)[1])  # safety net
            else:
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
