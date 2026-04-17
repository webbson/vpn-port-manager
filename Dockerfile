FROM node:22-slim AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src/ ./src/
RUN pnpm build

FROM node:22-slim AS runner

RUN apt-get update \
  && apt-get install -y --no-install-recommends gosu \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/dist ./dist
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

RUN mkdir -p /data && chown -R node:node /app /data

ENV NODE_ENV=production
ENV NODE_TLS_REJECT_UNAUTHORIZED=0
ENV PORT=3000

EXPOSE 3000
VOLUME ["/data"]

ARG BUILD_VERSION=dev
ARG BUILD_REVISION=unknown
LABEL org.opencontainers.image.title="vpn-port-manager" \
      org.opencontainers.image.description="VPN port manager for UniFi UDM-Pro (Azire VPN)" \
      org.opencontainers.image.source="https://github.com/webbson/vpn-port-manager" \
      org.opencontainers.image.url="https://github.com/webbson/vpn-port-manager" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${BUILD_VERSION}" \
      org.opencontainers.image.revision="${BUILD_REVISION}"

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
