# Multi-stage Dockerfile for UPI Transaction Flow Simulator
# Builder compiles the Vite React SPA. Runner serves it from Express + SQLite + gRPC.

# ---------------------------------------------------------------------------
# Stage 1: frontend production build
# ---------------------------------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2: production runtime (non-root, signal-aware, SQLite on /app/data)
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runner

WORKDIR /app

RUN apk add --no-cache dumb-init su-exec wget \
  && mkdir -p /app/data /tmp \
  && chown -R node:node /app /tmp

ENV NODE_ENV=production \
    PORT=3000 \
    SQLITE_DB_PATH=/app/data/upi_simulator.db \
    TMPDIR=/tmp \
    HOME=/tmp \
    npm_config_cache=/tmp/.npm

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
  && chown -R node:node /app

COPY --from=builder --chown=node:node /app/dist ./dist
COPY --chown=node:node server.ts ./server.ts
COPY --chown=node:node src/server ./src/server
COPY --chown=node:node protos ./protos
COPY --chown=node:node tsconfig.json ./tsconfig.json
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
  && chown node:node /usr/local/bin/docker-entrypoint.sh

USER node

VOLUME ["/app/data"]

EXPOSE 3000 50051

# wget is installed in this image; /health is the real Express health route.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/health || exit 1

# Entrypoint starts as root only so named volumes can be chowned, then drops to node.
# Kubernetes runAsUser: 1000 skips the privilege drop and runs as node directly.
ENTRYPOINT ["/usr/bin/dumb-init", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "--experimental-sqlite", "--import", "tsx", "server.ts"]
