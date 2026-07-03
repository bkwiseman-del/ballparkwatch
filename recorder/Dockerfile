# Bandbox WHEP recorder — GStreamer COPY pipeline (Python/GI), no re-encode of video.
#
# aiortc re-encoded the video and it came out black (broken H.264 decode) + VP8/webm doesn't
# play on Safari. This copies the original H.264 straight to mp4 (no decode → no black, full
# quality, Safari-friendly) and only transcodes audio opus→AAC. whepsrc (gst-plugins-rs
# webrtchttp) isn't prepackaged with webrtcbin anywhere, so build it from source on Ubuntu
# (which provides webrtcbin via gstreamer1.0-plugins-bad + nice).
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git pkg-config build-essential libssl-dev \
      gstreamer1.0-tools \
      gstreamer1.0-plugins-base gstreamer1.0-plugins-good \
      gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly gstreamer1.0-libav \
      gstreamer1.0-nice libnice10 \
      libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev libgstreamer-plugins-bad1.0-dev \
      python3 python3-gi gir1.2-gstreamer-1.0 gir1.2-gst-plugins-base-1.0 \
 && rm -rf /var/lib/apt/lists/*

# Build the webrtchttp plugin (whepsrc) from source against apt's GStreamer 1.24.
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
ENV PATH="/root/.cargo/bin:${PATH}"
RUN git clone --depth 1 --branch 0.13 https://gitlab.freedesktop.org/gstreamer/gst-plugins-rs.git /gst-rs \
 && cd /gst-rs \
 && cargo build --release -p gst-plugin-webrtchttp \
 && cp target/release/libgstwebrtchttp.so /usr/lib/x86_64-linux-gnu/gstreamer-1.0/ \
 && rm -rf /gst-rs /root/.cargo/registry /root/.cargo/git

# Fail the build unless the elements we need actually load.
RUN gst-inspect-1.0 webrtcbin >/dev/null && gst-inspect-1.0 whepsrc >/dev/null \
 && gst-inspect-1.0 rtph264depay >/dev/null && gst-inspect-1.0 avenc_aac >/dev/null \
 && echo "gst elements OK"

# Node 20 for the recorder-manager.
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js record.py ./

CMD ["node", "server.js"]
