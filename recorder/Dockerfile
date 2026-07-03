# GStreamer-based WHEP recorder (replaces headless Chrome).
#
# Records the WHEP feed with a native GStreamer pipeline (whepsrc) — no browser, no re-encode.
# whepsrc wraps the core C `webrtcbin` element, which Alpine does NOT package. restreamio's
# GStreamer image is purpose-built for streaming and includes the full WebRTC stack + the
# Rust plugins (gst-plugins-rs / webrtchttp), so both `webrtcbin` and `whepsrc` are present.
FROM restreamio/gstreamer:latest-prod

# Node 20 for the recorder-manager (waits for go-live, runs the pipeline, uploads).
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

# Fail the build unless the WebRTC + WHEP elements actually load.
RUN gst-inspect-1.0 webrtcbin >/dev/null \
 && (gst-inspect-1.0 whepsrc >/dev/null || gst-inspect-1.0 whepclientsrc >/dev/null) \
 && echo "webrtc + whep OK"

ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./

ENTRYPOINT []
CMD ["node", "server.js"]
