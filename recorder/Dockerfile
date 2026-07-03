# GStreamer WHEP recorder. Records the WHEP feed with a native pipeline (whepsrc) — no
# browser, no re-encode. whepsrc wraps the core `webrtcbin` element.
#
# No prepackaged image has BOTH webrtcbin and whepsrc: Alpine ships whepsrc but not
# webrtcbin; restreamio ships webrtcbin but not whepsrc. So: start from Ubuntu (apt provides
# webrtcbin via gstreamer1.0-plugins-bad + gstreamer1.0-nice) and build the one missing WHEP
# plugin (gst-plugins-rs / webrtchttp) from source against that same GStreamer version.
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git pkg-config build-essential libssl-dev \
      cargo \
      gstreamer1.0-tools \
      gstreamer1.0-plugins-base gstreamer1.0-plugins-good \
      gstreamer1.0-plugins-bad gstreamer1.0-libav \
      gstreamer1.0-nice libnice10 \
      libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev libgstreamer-plugins-bad1.0-dev \
 && rm -rf /var/lib/apt/lists/*

# Build only the webrtchttp plugin (provides whepsrc). Ubuntu 24.04 ships GStreamer 1.24, so
# use the matching gst-plugins-rs release branch.
RUN cargo install cargo-c --locked \
 && git clone --depth 1 --branch 0.13 https://gitlab.freedesktop.org/gstreamer/gst-plugins-rs.git /gst-rs \
 && cd /gst-rs \
 && /root/.cargo/bin/cargo cinstall -p gst-plugin-webrtchttp --prefix=/usr --libdir=/usr/lib/x86_64-linux-gnu \
 && rm -rf /gst-rs /root/.cargo/registry /root/.cargo/git

# Fail the build unless both elements actually load.
RUN gst-inspect-1.0 webrtcbin >/dev/null && gst-inspect-1.0 whepsrc >/dev/null && echo "webrtcbin + whepsrc OK"

# Node 20 for the recorder-manager.
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./

CMD ["node", "server.js"]
