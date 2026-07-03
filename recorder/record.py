#!/usr/bin/env python3
# GStreamer WHEP recorder (COPY). Pulls the Cloudflare WHEP feed with whepsrc and writes an
# mp4: the H.264 video is COPIED (no decode/encode → no black frames, full quality, plays in
# Safari), and only the audio is transcoded opus→AAC (mp4-friendly). whepsrc exposes dynamic
# pads after negotiation, so we link them in a pad-added handler (what plain gst-launch could
# not do reliably). SIGINT/SIGTERM → EOS so the mp4 is finalized.
#
#   python3 record.py <whep_url> <out.mp4>
import signal
import sys

import gi

gi.require_version("Gst", "1.0")
from gi.repository import GLib, Gst  # noqa: E402


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

    def try_link(pad):
        if pad in linked:
            return
        caps = pad.get_current_caps()
        if not caps or caps.get_size() == 0:
            return  # caps not negotiated yet
        media = caps.get_structure(0).get_string("media")  # robust: 'video' / 'audio'
        if media == "video":
            linked.add(pad)
            log("link video", caps.to_string()[:80])
            depay = Gst.ElementFactory.make("rtph264depay")
            parse = Gst.ElementFactory.make("h264parse")
            parse.set_property("config-interval", -1)
            link_chain(pad, [Gst.ElementFactory.make("queue"), depay, parse])
            log("linked video (H.264 copy)")
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

    loop = GLib.MainLoop()
    bus = pipeline.get_bus()
    bus.add_signal_watch()

    def on_msg(_bus, msg):
        if msg.type == Gst.MessageType.EOS:
            log("EOS")
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
