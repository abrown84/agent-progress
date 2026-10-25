# Agent Progress API + static web dashboard
FROM node:22-bookworm-slim AS build

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Root frontend (web build)
COPY package.json package-lock.json ./
RUN npm ci

COPY index.html notification.html web.html vite.config.ts vite.config.web.ts \
     tsconfig.json tsconfig.node.json tailwind.config.js postcss.config.js ./
COPY src ./src
COPY web-public ./web-public
RUN npm run build:web && test -f dist-web/index.html

# Server
WORKDIR /app/server
COPY server/package.json ./
COPY server/tsconfig.json ./
COPY server/src ./src
COPY server/scripts ./scripts
RUN npm install && npm run build

FROM node:22-bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/server

COPY server/package.json ./
RUN npm install --omit=dev

COPY --from=build /app/server/src ./src
COPY --from=build /app/server/scripts ./scripts
COPY --from=build /app/server/tsconfig.json ./
COPY --from=build /app/server/package.json ./
COPY --from=build /app/dist-web /app/dist-web

ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0 \
    DATABASE_PATH=/data/agent-progress.db \
    PUBLIC_WEB_DIR=/app/dist-web \
    ALLOW_SIGNUPS=false

VOLUME ["/data"]
EXPOSE 8787

CMD ["node", "--import", "tsx", "src/index.ts"]
