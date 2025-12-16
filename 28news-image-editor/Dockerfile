# Multi-stage build cho Next.js frontend
FROM node:20-bullseye-slim AS builder

WORKDIR /app

# Cài dependency
COPY package.json package-lock.json ./
RUN npm ci

# Copy source và build
COPY . .
ENV NODE_ENV=production
RUN npm run build

# Runtime image
FROM node:20-bullseye-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

# Copy các file cần thiết từ builder
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/app ./app
COPY --from=builder /app/components ./components
COPY --from=builder /app/lib ./lib

EXPOSE 3001

CMD ["npm", "run", "start"]
