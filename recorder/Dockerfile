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

# whepsrc (gst-plugins-rs-webrtchttp) wraps the core C webrtcbin element, which lives in
# gst-plugins-bad and needs libnice (ICE) to load — without it, whepsrc panics with
# "Failed to find element factory 'webrtcbin'". Pull libnice + its GStreamer plugin, then
# fail the build if whepsrc or webrtcbin can't actually be inspected.
RUN apk add --no-cache \
      nodejs npm ca-certificates \
      gstreamer gstreamer-tools \
      gst-plugins-base gst-plugins-good gst-plugins-bad \
      gst-plugins-rs-webrtchttp \
      libnice libnice-gstreamer \
  && gst-inspect-1.0 webrtcbin >/dev/null \
  && gst-inspect-1.0 whepsrc >/dev/null \
  && echo "whepsrc + webrtcbin OK"

ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./

CMD ["node", "server.js"]
