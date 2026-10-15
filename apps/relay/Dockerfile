# syntax=docker/dockerfile:1
# Relay image (Bun WebSocket service). Build context: repository root.
#   docker build -f apps/relay/Dockerfile -t soulwick-relay .
# Rooms live in memory: run exactly one replica per environment. Configuration comes from the
# platform at runtime (see apps/relay/.env.example); the relay has no database.
FROM oven/bun:1.3.14 AS build
WORKDIR /app
# Manifests first, so the install layer stays cached until dependencies change.
# Every workspace's package.json is needed for the frozen lockfile; add new workspaces here.
COPY package.json bun.lock bunfig.toml ./
COPY apps/admin/package.json apps/admin/
COPY apps/api/package.json apps/api/
COPY apps/relay/package.json apps/relay/
COPY apps/web/package.json apps/web/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
RUN bun install --frozen-lockfile --ignore-scripts --production --filter @soulwick/relay
COPY packages/contracts packages/contracts
COPY apps/relay/package.json apps/relay/
COPY apps/relay/src apps/relay/src

FROM oven/bun:1.3.14 AS runtime
WORKDIR /app
# IPv4 inside the container: Docker networks often have IPv6 disabled, binding "::" would fail.
ENV NODE_ENV=production RELAY_PORT=8790 RELAY_HOST=0.0.0.0
COPY --from=build /app/package.json /app/bunfig.toml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/contracts ./packages/contracts
COPY --from=build /app/apps/relay ./apps/relay
USER bun
EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:' + (process.env.RELAY_PORT ?? 8790) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
# exec form: bun gets SIGTERM directly and closes rooms with `shutdown` before exiting.
CMD ["bun", "apps/relay/src/index.ts"]
