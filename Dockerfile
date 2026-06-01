FROM node:22-bookworm-slim AS builder

WORKDIR /app
COPY package*.json ./
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN npm ci

COPY . .
RUN npm run build

# --- runtime ---
FROM node:22-bookworm-slim

# Shared libraries for headless Chrome + tar to extract Puppeteer's browser download
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        chromium \
        fonts-liberation \
        tar \
        libasound2 \
        libatk-bridge2.0-0 \
        libatk1.0-0 \
        libcups2 \
        libdbus-1-3 \
        libdrm2 \
        libgbm1 \
        libgtk-3-0 \
        libnspr4 \
        libnss3 \
        libx11-xcb1 \
        libxcomposite1 \
        libxdamage1 \
        libxfixes3 \
        libxkbcommon0 \
        libxrandr2 \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/* /tmp/*

WORKDIR /app
COPY package*.json ./
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN npm ci --omit=dev \
    && npm cache clean --force \
    && rm -rf /tmp/*

COPY --from=builder /app/dist ./dist

EXPOSE 3000
CMD ["node", "dist/index.js"]
