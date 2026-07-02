# Puppeteer's official image ships Chrome + all the system libs it needs, and sets
# PUPPETEER_EXECUTABLE_PATH — so we don't download Chromium ourselves.
FROM ghcr.io/puppeteer/puppeteer:23.3.0

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV NODE_ENV=production

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./

CMD ["node", "server.js"]
