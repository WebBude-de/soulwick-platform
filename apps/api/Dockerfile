# syntax=docker/dockerfile:1
# API image (Hono on Bun). Build context: repository root.
#   docker build -f apps/api/Dockerfile -t soulwick-api .
# On start the container applies pending Prisma migrations (prisma migrate deploy) and then
# serves the API. Configuration comes from the platform at runtime (see apps/api/.env.example).
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
# The API and its workspace packages, including the Prisma CLI (devDependency of @soulwick/db)
# that applies the migrations on start.
RUN bun install --frozen-lockfile --ignore-scripts --filter @soulwick/api --filter @soulwick/db
COPY packages/config packages/config
COPY packages/contracts packages/contracts
COPY packages/db packages/db
COPY apps/api apps/api
# prisma.config.ts reads DATABASE_URL; neither step connects. The diff run makes the CLI fetch its
# schema engine now (install ran with --ignore-scripts), so `migrate deploy` needs no download later.
RUN cd packages/db \
 && DATABASE_URL="postgresql://build:build@localhost:5432/build" bunx prisma generate \
 && DATABASE_URL="postgresql://build:build@localhost:5432/build" bunx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script > /dev/null

FROM oven/bun:1.3.14 AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8787
COPY --from=build /app/package.json /app/bunfig.toml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api ./apps/api
USER bun
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:' + (process.env.PORT ?? 8787) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
# Apply pending migrations, then start (exec: bun gets the stop signal directly).
CMD ["sh", "-c", "cd packages/db && bunx prisma migrate deploy && cd /app && exec bun apps/api/src/index.ts"]
