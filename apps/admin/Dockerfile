# syntax=docker/dockerfile:1
# admin image (Next.js standalone). Build context: repository root.
#   docker build -f apps/admin/Dockerfile -t soulwick-admin .
# Dependencies come from the Bun lockfile (same as locally); Next.js builds and runs on Node.
# The build does not need the API; all pages render on request.
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
RUN bun install --frozen-lockfile --ignore-scripts --filter @soulwick/admin
COPY packages/contracts packages/contracts
COPY apps/admin apps/admin
RUN cd apps/admin && node ../../node_modules/next/dist/bin/next build

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3001 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/apps/admin/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/admin/.next/static ./apps/admin/.next/static
COPY --from=build --chown=node:node /app/apps/admin/public ./apps/admin/public
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/login').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "apps/admin/server.js"]
