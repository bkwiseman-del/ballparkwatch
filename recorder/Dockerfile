# GStreamer-based WHEP recorder (replaces the headless-Chrome recorder).
#
# Headless Chrome + MediaRecorder proved unreliable for server-side WebRTC capture (rAF
# throttling, canvas freezes, WHEP going silent with no recovery). The production way to
# record a WHEP feed is a native GStreamer pipeline (whepsrc) that COPIES the stream to a
# file — no browser, no re-encode. Cloudflare Stream's WHEP is GStreamer-compatible.
#
# whepsrc lives in gst-plugins-rs (webrtchttp), which Alpine ships prebuilt in the community
# repo (no Rust build needed).
FROM alpine:edge

RUN apk add --no-cache \
      nodejs npm ca-certificates \
      gstreamer gstreamer-tools \
      gst-plugins-base gst-plugins-good gst-plugins-bad \
      gst-plugins-rs \
  && gst-inspect-1.0 whepsrc >/dev/null 2>&1 \
     && echo "whepsrc OK" \
     || (echo "whepsrc NOT FOUND — trying webrtchttp subpackage"; apk add --no-cache gst-plugins-rs-webrtchttp && gst-inspect-1.0 whepsrc)

ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./

CMD ["node", "server.js"]
