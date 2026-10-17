# syntax=docker/dockerfile:1
# web image (Next.js standalone). Build context: repository root.
#   docker build -f apps/web/Dockerfile -t soulwick-web .
# Dependencies come from the Bun lockfile (same as locally); Next.js builds and runs on Node.
# The build does not need the API; pages that show API data render on request.
FROM node:24-slim AS build
COPY --from=oven/bun:1.3.14 /usr/local/bin/bun /usr/local/bin/bun
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
# Every workspace's package.json is needed for the frozen lockfile; add new workspaces here.
COPY package.json bun.lock bunfig.toml ./
COPY apps/admin/package.json apps/admin/
COPY apps/api/package.json apps/api/
COPY apps/relay/package.json apps/relay/
COPY apps/web/package.json apps/web/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
RUN bun install --frozen-lockfile --ignore-scripts --filter @soulwick/web
COPY packages/contracts packages/contracts
COPY apps/web apps/web
# The news pages are built ahead of time and show the live switch in the header. Build them in
# the safe pre-release state (no links to pages that may be off); the running server rebuilds
# them in the background with its own LIVE_FEATURES and GAME_URL within five minutes.
ARG LIVE_FEATURES=false
ENV LIVE_FEATURES=$LIVE_FEATURES
RUN cd apps/web && node ../../node_modules/next/dist/bin/next build

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "apps/web/server.js"]
