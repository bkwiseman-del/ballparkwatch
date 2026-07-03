#!/usr/bin/env python3
# aiortc WHEP recorder: connect to a Cloudflare WHEP endpoint, receive the audio+video
# tracks, and record them to a file. Runs until SIGINT/SIGTERM (the Node manager stops it
# when the game goes final / the feed ends), then finalizes the file.
#
# aiortc is a full Python WebRTC stack — it handles ICE (STUN/TURN), SDP, RTP and recording
# directly, avoiding the gst-launch dynamic-pad / webrtcbin-FEC issues that left the file empty.
#
#   python3 record.py <whep_url> <out_path.mp4>
import argparse
import asyncio
import signal
import sys

import aiohttp
from aiortc import RTCConfiguration, RTCIceServer, RTCPeerConnection, RTCSessionDescription
from aiortc.contrib.media import MediaRecorder


def log(*a):
    print("[py]", *a, flush=True)


async def run(whep_url: str, out_path: str) -> int:
    config = RTCConfiguration(
        iceServers=[
            RTCIceServer(urls=["stun:stun.l.google.com:19302"]),
            # TURN over TCP:443 carries the media even where the host blocks WebRTC UDP.
            RTCIceServer(
                urls=["turn:openrelay.metered.ca:443?transport=tcp"],
                username="openrelayproject",
                credential="openrelayproject",
            ),
        ]
    )
    pc = RTCPeerConnection(configuration=config)
    recorder = MediaRecorder(out_path)
    got_track = asyncio.Event()

    @pc.on("track")
    def on_track(track):
        log("track", track.kind)
        recorder.addTrack(track)
        got_track.set()

    @pc.on("connectionstatechange")
    async def on_conn():
        log("connection", pc.connectionState)

    # We RECEIVE both media.
    pc.addTransceiver("video", direction="recvonly")
    pc.addTransceiver("audio", direction="recvonly")

    offer = await pc.createOffer()
    await pc.setLocalDescription(offer)  # aiortc gathers ICE before this resolves

    async with aiohttp.ClientSession() as sess:
        async with sess.post(
            whep_url, data=pc.localDescription.sdp, headers={"Content-Type": "application/sdp"}
        ) as resp:
            if resp.status not in (200, 201):
                log("WHEP POST failed", resp.status, (await resp.text())[:300])
                return 2
            answer_sdp = await resp.text()
    await pc.setRemoteDescription(RTCSessionDescription(sdp=answer_sdp, type="answer"))

    await recorder.start()
    log("recording ->", out_path)

    stop = asyncio.Event()
    loop = asyncio.get_event_loop()
    for s in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(s, stop.set)
    await stop.wait()

    log("stopping")
    await recorder.stop()
    await pc.close()
    log("done")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("whep")
    ap.add_argument("out")
    args = ap.parse_args()
    try:
        sys.exit(asyncio.run(run(args.whep, args.out)))
    except Exception as e:  # noqa
        log("fatal", repr(e))
        sys.exit(1)
