import {
  CreateGuildRequest,
  type ForgeLevels,
  JoinGuildRequest,
  MAX_GUILD_MEMBERS,
  PatchGuildProgressRequest,
  Uuid,
} from "@soulwick/contracts";
import { Hono } from "hono";
import {
  ApiError,
  isRecordNotFound,
  isUniqueViolation,
  withCause,
} from "../lib/errors.ts";
import { generateInviteCode } from "../lib/invite-code.ts";
import { parseBody, parseParam } from "../lib/validate.ts";
import { requirePlayer } from "../middleware/auth.ts";
import {
  emptyProgress,
  findMembership,
  getProgress,
  loadOwnGuild,
  removeMember,
} from "../services/guilds.ts";
import type { AppEnv, Deps } from "../types.ts";

const notInGuild = () =>
  new ApiError(404, "not_in_guild", "You are not in a guild");
const alreadyInGuild = () =>
  new ApiError(409, "already_in_guild", "You are already in a guild");

export function guildRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();
  const now = () => deps.now?.() ?? new Date();
  app.use("*", requirePlayer(deps));

  async function requireMembership(playerId: string) {
    const m = await findMembership(deps.db, playerId);
    if (!m) {
      throw notInGuild();
    }
    return m;
  }

  async function ownGuildResponse(guildId: string) {
    const guild = await loadOwnGuild(deps.db, guildId);
    if (!guild) {
      throw notInGuild();
    }
    return guild;
  }

  /**
   * Prisma does not know the two partial indexes on guilds (see packages/db/prisma/schema.prisma),
   * so after a unique violation we look up which of name, tag or membership collided.
   */
  async function guildCreateConflict(
    err: unknown,
    body: { name: string; tag: string }
  ): Promise<ApiError> {
    if (isUniqueViolation(err, "player_id")) {
      return alreadyInGuild();
    }
    const nameTaken = await deps.db.guild.findFirst({
      where: {
        disbandedAt: null,
        name: { equals: body.name, mode: "insensitive" },
      },
      select: { id: true },
    });
    if (nameTaken) {
      return withCause(
        new ApiError(409, "guild_name_taken", "Guild name is already taken"),
        err
      );
    }
    return withCause(
      new ApiError(409, "guild_tag_taken", "Guild tag is already taken"),
      err
    );
  }

  /** Create a guild; the caller becomes founder. */
  app.post("/", async (c) => {
    const player = c.get("player");
    const body = await parseBody(c, CreateGuildRequest);
    if (await findMembership(deps.db, player.id)) {
      throw alreadyInGuild();
    }

    let guildId: string;
    try {
      const created = await deps.db.guild.create({
        data: {
          name: body.name,
          tag: body.tag,
          inviteCode: generateInviteCode(),
          founderId: player.id,
          members: { create: { playerId: player.id, role: "founder" } },
          progress: { create: {} },
        },
        select: { id: true },
      });
      guildId = created.id;
    } catch (err) {
      if (!isUniqueViolation(err)) {
        throw err;
      }
      throw await guildCreateConflict(err, body);
    }
    return c.json(await ownGuildResponse(guildId), 201);
  });

  /** Join by invite code (max. one guild per player, max. 30 members). */
  app.post("/join", async (c) => {
    const player = c.get("player");
    const { inviteCode } = await parseBody(c, JoinGuildRequest);
    if (await findMembership(deps.db, player.id)) {
      throw alreadyInGuild();
    }

    let guildId: string;
    try {
      guildId = await deps.db.$transaction(async (tx) => {
        // Row lock serialises concurrent joins so the member cap cannot be exceeded.
        const rows = await tx.$queryRaw<
          { id: string }[]
        >`select id from guilds where invite_code = ${inviteCode} and disbanded_at is null for update`;
        const g = rows[0];
        if (!g) {
          throw new ApiError(
            404,
            "invalid_invite_code",
            "Invite code not found"
          );
        }
        const count = await tx.guildMember.count({ where: { guildId: g.id } });
        if (count >= MAX_GUILD_MEMBERS) {
          throw new ApiError(
            409,
            "guild_full",
            `Guild already has ${MAX_GUILD_MEMBERS} members`
          );
        }
        await tx.guildMember.create({
          data: { guildId: g.id, playerId: player.id, role: "member" },
        });
        return g.id;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw alreadyInGuild();
      }
      throw err;
    }
    return c.json(await ownGuildResponse(guildId));
  });

  app.post("/leave", async (c) => {
    const player = c.get("player");
    const m = await requireMembership(player.id);
    await deps.db.$transaction((tx) =>
      removeMember(tx, m.guildId, player.id, now())
    );
    return c.body(null, 204);
  });

  app.get("/me", async (c) => {
    const m = await requireMembership(c.get("player").id);
    return c.json(await ownGuildResponse(m.guildId));
  });

  /** Founder only: remove a member. */
  app.delete("/me/members/:playerId", async (c) => {
    const player = c.get("player");
    const targetId = parseParam(c, "playerId", Uuid);
    const m = await requireMembership(player.id);
    if (m.role !== "founder") {
      throw new ApiError(
        403,
        "forbidden",
        "Only the founder can remove members"
      );
    }
    if (targetId === player.id) {
      throw new ApiError(400, "cannot_kick_self", "Use /guilds/leave instead");
    }
    const result = await deps.db.$transaction((tx) =>
      removeMember(tx, m.guildId, targetId, now())
    );
    if (!result.removed) {
      throw new ApiError(
        404,
        "not_a_member",
        "Player is not a member of your guild"
      );
    }
    return c.json(await ownGuildResponse(m.guildId));
  });

  /** Founder only: new invite code; the old one stops working. */
  app.post("/me/invite-code", async (c) => {
    const m = await requireMembership(c.get("player").id);
    if (m.role !== "founder") {
      throw new ApiError(
        403,
        "forbidden",
        "Only the founder can rotate the code"
      );
    }
    const inviteCode = generateInviteCode();
    await deps.db.guild.update({
      where: { id: m.guildId },
      data: { inviteCode },
    });
    return c.json({ inviteCode });
  });

  app.get("/me/progress", async (c) => {
    const m = await requireMembership(c.get("player").id);
    return c.json((await getProgress(deps.db, m.guildId)) ?? emptyProgress());
  });

  /**
   * Any member may update treasury/forge levels. Optimistic concurrency: the update only applies
   * if `version` matches, so two simultaneous purchases cannot spend the same gold twice.
   */
  app.patch("/me/progress", async (c) => {
    const m = await requireMembership(c.get("player").id);
    const body = await parseBody(c, PatchGuildProgressRequest);
    try {
      const updated = await deps.db.guildProgress.update({
        where: { guildId: m.guildId, version: body.version },
        data: {
          ...(body.treasury === undefined ? {} : { treasury: body.treasury }),
          ...(body.forgeLevels === undefined
            ? {}
            : { forgeLevels: body.forgeLevels }),
          version: { increment: 1 },
        },
      });
      return c.json({
        treasury: updated.treasury,
        forgeLevels: updated.forgeLevels as ForgeLevels,
        version: updated.version,
      });
    } catch (err) {
      if (!isRecordNotFound(err)) {
        throw err;
      }
      const current =
        (await getProgress(deps.db, m.guildId)) ?? emptyProgress();
      return c.json({ error: "version_conflict" as const, current }, 409);
    }
  });

  return app;
}
