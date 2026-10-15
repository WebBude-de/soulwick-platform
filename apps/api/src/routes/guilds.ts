import {
  CreateGuildRequest,
  JoinGuildRequest,
  PatchGuildProgressRequest,
  type RotateInviteCodeResponse,
  SetGuildRoleRequest,
  Uuid,
  type VersionConflictResponse,
} from "@soulwick/contracts";
import { Hono } from "hono";
import { parseBody, parseParam } from "../lib/validate.ts";
import { requirePlayer } from "../middleware/auth.ts";
import {
  createGuild,
  emptyProgress,
  getProgress,
  guildDetailFor,
  joinGuild,
  kickMember,
  leaveGuild,
  patchProgress,
  requireMember,
  rotateInviteCode,
  setMemberRole,
} from "../services/guilds.ts";
import type { AppEnv, Deps } from "../types.ts";

/**
 * Player guild routes (D-147, P-031); contract and error codes in packages/contracts/src/guild.ts.
 * `GET /me/guilds` lives in routes/me.ts.
 */
export function guildRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();
  const now = () => deps.now?.() ?? new Date();
  app.use("*", requirePlayer(deps));

  /** Create a guild; the caller becomes founder (counts towards the guild limit). */
  app.post("/", async (c) => {
    const player = c.get("player");
    const body = await parseBody(c, CreateGuildRequest);
    const guildId = await createGuild(deps.db, player.id, body);
    return c.json(await guildDetailFor(deps.db, guildId, player.id), 201);
  });

  /** Join by invite code. */
  app.post("/join", async (c) => {
    const player = c.get("player");
    const { inviteCode } = await parseBody(c, JoinGuildRequest);
    const guildId = await joinGuild(deps.db, player.id, inviteCode);
    return c.json(await guildDetailFor(deps.db, guildId, player.id));
  });

  app.get("/:id", async (c) => {
    const id = parseParam(c, "id", Uuid);
    return c.json(await guildDetailFor(deps.db, id, c.get("player").id));
  });

  app.post("/:id/leave", async (c) => {
    const id = parseParam(c, "id", Uuid);
    return c.json(await leaveGuild(deps.db, id, c.get("player").id, now()));
  });

  app.delete("/:id/members/:playerId", async (c) => {
    const id = parseParam(c, "id", Uuid);
    const targetId = parseParam(c, "playerId", Uuid);
    const player = c.get("player");
    await kickMember(deps.db, id, player.id, targetId, now());
    return c.json(await guildDetailFor(deps.db, id, player.id));
  });

  app.patch("/:id/members/:playerId", async (c) => {
    const id = parseParam(c, "id", Uuid);
    const targetId = parseParam(c, "playerId", Uuid);
    const body = await parseBody(c, SetGuildRoleRequest);
    const player = c.get("player");
    await setMemberRole(deps.db, id, player.id, targetId, body);
    return c.json(await guildDetailFor(deps.db, id, player.id));
  });

  app.post("/:id/invite-code", async (c) => {
    const id = parseParam(c, "id", Uuid);
    const body: RotateInviteCodeResponse = {
      inviteCode: await rotateInviteCode(deps.db, id, c.get("player").id),
    };
    return c.json(body);
  });

  app.get("/:id/progress", async (c) => {
    const id = parseParam(c, "id", Uuid);
    await requireMember(deps.db, id, c.get("player").id);
    return c.json((await getProgress(deps.db, id)) ?? emptyProgress());
  });

  /**
   * Any member may update treasury/forge levels. Optimistic concurrency: the update only applies
   * if `version` matches, so two simultaneous purchases cannot spend the same gold twice.
   */
  app.patch("/:id/progress", async (c) => {
    const id = parseParam(c, "id", Uuid);
    await requireMember(deps.db, id, c.get("player").id);
    const body = await parseBody(c, PatchGuildProgressRequest);
    const result = await patchProgress(deps.db, id, body);
    if ("conflict" in result) {
      const conflict: VersionConflictResponse = {
        error: "version_conflict",
        current: result.conflict,
      };
      return c.json(conflict, 409);
    }
    return c.json(result.progress);
  });

  return app;
}
