# Image dùng chung cho backend API + workers
FROM node:20-bullseye-slim

WORKDIR /app

# Cài system dependency cho xử lý media (ffmpeg bao gồm cả ffprobe)
RUN apt-get update \
    && apt-get install -y ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Cài dependency Node.js
COPY package.json package-lock.json ./
RUN npm ci

# Copy source
COPY . .

ENV NODE_ENV=production

# Backend server lắng nghe cổng 3000 (DOWNLOAD_PORT)
EXPOSE 3000

# Mặc định container này chạy server API
# Các worker sẽ override command trong docker-compose
CMD ["node", "src/server.mjs"]
