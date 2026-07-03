# Bandbox WHEP recorder — aiortc (Python WebRTC) capture + Node manager.
#
# Records the Cloudflare WHEP feed with aiortc, a full Python WebRTC stack that receives the
# track and writes it to a file directly. This replaces the GStreamer whepsrc approach, which
# connected fine but wouldn't hand the received media to a file (gst-launch dynamic-pad /
# webrtcbin-FEC issues left the recording empty).
FROM node:20-bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip build-essential python3-dev pkg-config \
      libopus0 libvpx7 libsrtp2-1 ca-certificates \
 && pip3 install --no-cache-dir --break-system-packages aiortc aiohttp \
 && python3 -c "import aiortc, aiohttp; print('aiortc OK', aiortc.__version__)" \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js record.py ./

CMD ["node", "server.js"]
