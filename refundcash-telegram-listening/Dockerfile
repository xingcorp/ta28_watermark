# Image dùng chung cho backend API + workers
FROM node:20-bullseye-slim

WORKDIR /app

# Cài dependency
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
