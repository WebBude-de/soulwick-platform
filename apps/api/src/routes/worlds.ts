import {
  DeleteWorldQuery,
  type DeleteWorldResponse,
  PutWorldRequest,
  RestoreWorldRequest,
  Uuid,
  WORLD_MAX_BODY_BYTES,
  type WorldBackupList,
  WorldId,
} from "@soulwick/contracts";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { ApiError } from "../lib/errors.ts";
import { fixedWindowCounter } from "../lib/rate-limit.ts";
import {
  parseBody,
  parseOptionalBody,
  parseParam,
  parseQuery,
} from "../lib/validate.ts";
import {
  deleteWorld,
  getBackup,
  getWorld,
  listBackups,
  listWorlds,
  putWorld,
  restoreBackup,
  unarchiveWorld,
} from "../services/worlds.ts";
import type { AppEnv, Deps } from "../types.ts";

const HOUR_MS = 3_600_000;
/** `"12"`, `W/"12"` or a bare `12`. */
const REVISION_TAG = /^(?:W\/)?"?\d{1,9}"?$/;
const NON_DIGITS = /\D/g;

const etag = (revision: number) => `"${revision}"`;

const invalidRevision = (message: string) =>
  new ApiError(400, "invalid_revision", message);

/** Revision from `If-Match` (or 0 from `If-None-Match: *`); undefined = no header. */
function headerRevision(c: Context): number | undefined {
  const ifMatch = c.req.header("if-match");
  if (ifMatch !== undefined) {
    const tag = ifMatch.trim();
    if (!REVISION_TAG.test(tag)) {
      throw invalidRevision('If-Match must be "<revision>"');
    }
    return Number(tag.replace(NON_DIGITS, ""));
  }
  return c.req.header("if-none-match")?.trim() === "*" ? 0 : undefined;
}

/**
 * Cloud worlds (D-188, KF8, P-038), mounted under /me/worlds behind `requirePlayer` (me.ts).
 * Contract and status codes: packages/contracts/src/world.ts. Writes are limited per account
 * (WORLD_WRITES_PER_HOUR); reads only by the global limit per IP.
 */
export function worldRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();
  const now = () => deps.now?.() ?? new Date();

  const writes = fixedWindowCounter({
    limit: deps.config.WORLD_WRITES_PER_HOUR,
    windowMs: HOUR_MS,
  });
  /** Counts every write attempt of the account before the body is read. */
  const writeLimit: MiddlewareHandler<AppEnv> = async (c, next) => {
    const key = c.get("player").id;
    const retryAfter = writes.blockedFor(key);
    if (retryAfter !== null) {
      c.header("Retry-After", String(retryAfter));
      throw new ApiError(429, "rate_limited", "Too many world uploads");
    }
    writes.hit(key);
    await next();
  };

  app.get("/", async (c) =>
    c.json(await listWorlds(deps.db, c.get("player").id, now()))
  );

  app.get("/:worldId", async (c) => {
    const worldId = parseParam(c, "worldId", WorldId);
    const world = await getWorld(deps.db, c.get("player").id, worldId, now());
    c.header("ETag", etag(world.revision));
    return c.json(world);
  });

  app.put(
    "/:worldId",
    writeLimit,
    bodyLimit({
      maxSize: WORLD_MAX_BODY_BYTES,
      onError: (c) =>
        c.json(
          {
            error: "payload_too_large",
            message: `The request body must be at most ${WORLD_MAX_BODY_BYTES} bytes`,
          },
          413
        ),
    }),
    async (c) => {
      const worldId = parseParam(c, "worldId", WorldId);
      const fromHeader = headerRevision(c);
      const body = await parseBody(c, PutWorldRequest);
      if (
        fromHeader !== undefined &&
        body.baseRevision !== undefined &&
        fromHeader !== body.baseRevision
      ) {
        throw invalidRevision("If-Match and baseRevision differ");
      }
      const baseRevision = fromHeader ?? body.baseRevision;
      if (baseRevision === undefined) {
        throw new ApiError(
          400,
          "revision_required",
          "Send baseRevision or If-Match (0 / If-None-Match: * for a new world)"
        );
      }
      const { created, response } = await putWorld(deps.db, {
        playerId: c.get("player").id,
        worldId,
        baseRevision,
        state: body,
        discarded: body.discarded,
        resolvedMerges: body.resolvedMerges,
        now: now(),
      });
      c.header("ETag", etag(response.world.revision));
      return c.json(response, created ? 201 : 200);
    }
  );

  app.delete("/:worldId", writeLimit, async (c) => {
    const worldId = parseParam(c, "worldId", WorldId);
    const { permanent } = parseQuery(c, DeleteWorldQuery);
    const world = await deleteWorld(deps.db, {
      playerId: c.get("player").id,
      worldId,
      ifRevision: headerRevision(c) ?? null,
      permanent,
      now: now(),
    });
    if (!world) {
      return c.body(null, 204);
    }
    const body: DeleteWorldResponse = { world };
    return c.json(body);
  });

  app.post("/:worldId/unarchive", writeLimit, async (c) => {
    const worldId = parseParam(c, "worldId", WorldId);
    const body = await parseOptionalBody(c, RestoreWorldRequest);
    const result = await unarchiveWorld(deps.db, {
      playerId: c.get("player").id,
      worldId,
      archiveWorldId: body.archiveWorldId,
      now: now(),
    });
    c.header("ETag", etag(result.world.revision));
    return c.json(result);
  });

  app.get("/:worldId/backups", async (c) => {
    const worldId = parseParam(c, "worldId", WorldId);
    const body: WorldBackupList = {
      items: await listBackups(deps.db, c.get("player").id, worldId, now()),
    };
    return c.json(body);
  });

  app.get("/:worldId/backups/:backupId", async (c) =>
    c.json(
      await getBackup(deps.db, {
        playerId: c.get("player").id,
        worldId: parseParam(c, "worldId", WorldId),
        backupId: parseParam(c, "backupId", Uuid),
        now: now(),
      })
    )
  );

  app.post("/:worldId/backups/:backupId/restore", writeLimit, async (c) => {
    const worldId = parseParam(c, "worldId", WorldId);
    const backupId = parseParam(c, "backupId", Uuid);
    const body = await parseOptionalBody(c, RestoreWorldRequest);
    const result = await restoreBackup(deps.db, {
      playerId: c.get("player").id,
      worldId,
      backupId,
      archiveWorldId: body.archiveWorldId,
      now: now(),
    });
    c.header("ETag", etag(result.world.revision));
    return c.json(result);
  });

  return app;
}
