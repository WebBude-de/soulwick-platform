import {
  ADMIN_PLAYER_RECENT_RUNS,
  AdminDeletePlayerRequest,
  type AdminPlayerDetail,
  type AdminPlayerListItem,
  AdminSearchQuery,
  type BanRelayResult,
  BanRequest,
  type BanResponse,
  RenamePlayerRequest,
  Uuid,
} from "@soulwick/contracts";
import type { Prisma } from "@soulwick/db";
import { Hono } from "hono";
import { ApiError, notFound } from "../../lib/errors.ts";
import { createLogger } from "../../lib/logger.ts";
import { createRelayClient } from "../../lib/relay-client.ts";
import { hmacSecret } from "../../lib/secrets.ts";
import {
  iso,
  isoOrNull,
  parseBody,
  parseOptionalBody,
  parseParam,
  parseQuery,
} from "../../lib/validate.ts";
import { requireRole } from "../../middleware/auth.ts";
import { adminDeletePlayer } from "../../services/account-deletion.ts";
import { listAdminRuns } from "../../services/admin-runs.ts";
import { writeAudit } from "../../services/audit.ts";
import { activeBanWhere, isBanActive } from "../../services/bans.ts";
import { findMembership } from "../../services/guilds.ts";
import { hasDeviceIdentity, steamIdOf } from "../../services/identities.ts";
import type { AppEnv, Deps } from "../../types.ts";
import { registerPlayerNoteRoutes } from "./player-notes.ts";

/** SteamID64 values are 17 digits today; keep a little slack for the admin search. */
const STEAM_ID_PATTERN = /^\d{5,20}$/;

/** Everything the list item needs in one query: identities, active bans, current guild. */
const listInclude = (at: Date) =>
  ({
    identities: { select: { provider: true, providerUserId: true } },
    bans: { where: activeBanWhere(at), select: { id: true } },
    guildMembership: {
      include: { guild: { select: { tag: true, disbandedAt: true } } },
    },
  }) satisfies Prisma.PlayerInclude;

type ListRow = Prisma.PlayerGetPayload<{
  include: ReturnType<typeof listInclude>;
}>;

const toListItem = (r: ListRow): AdminPlayerListItem => ({
  id: r.id,
  name: r.name,
  steamId: steamIdOf(r.identities),
  hasDeviceId: hasDeviceIdentity(r.identities),
  createdAt: iso(r.createdAt),
  lastSeenAt: iso(r.lastSeenAt),
  banned: r.bans.length > 0,
  guildTag:
    r.guildMembership && r.guildMembership.guild.disbandedAt === null
      ? r.guildMembership.guild.tag
      : null,
});

export function adminPlayerRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();
  const now = () => deps.now?.() ?? new Date();
  const relay = createRelayClient(deps.config, deps.fetch);
  const logger = createLogger(deps.config.LOG_LEVEL);

  /**
   * Best effort (P-024): a fresh ban closes the player's relay connections right away. Failures
   * are only logged; the relay still rejects the player at the next hello/create/join once its
   * status cache (30 s) has expired.
   */
  async function kickBannedFromRelay(
    playerId: string
  ): Promise<BanRelayResult> {
    if (!relay.configured) {
      return "not_configured";
    }
    try {
      const result = await relay.banPlayer(playerId);
      return result.connections > 0 ? "disconnected" : "not_connected";
    } catch (err) {
      logger.error("relay_ban_kick_failed", {
        playerId,
        error: err instanceof ApiError ? err.message : String(err),
      });
      return "unavailable";
    }
  }

  async function loadPlayer(id: string) {
    const p = await deps.db.player.findUnique({ where: { id } });
    if (!p) {
      throw notFound("Player");
    }
    return p;
  }

  /** Search by name (substring), player id or Steam id. */
  app.get("/", async (c) => {
    const q = parseQuery(c, AdminSearchQuery);
    let where: Prisma.PlayerWhereInput = {};
    if (q.q) {
      const conditions: Prisma.PlayerWhereInput[] = [
        { name: { contains: q.q, mode: "insensitive" } },
      ];
      if (Uuid.safeParse(q.q).success) {
        conditions.push({ id: q.q });
      }
      if (STEAM_ID_PATTERN.test(q.q)) {
        conditions.push({
          identities: { some: { provider: "steam", providerUserId: q.q } },
        });
      }
      where = { OR: conditions };
    }
    const rows = await deps.db.player.findMany({
      where,
      include: listInclude(now()),
      orderBy: { lastSeenAt: "desc" },
      take: q.limit,
      skip: q.offset,
    });
    const total = await deps.db.player.count({ where });
    return c.json({ items: rows.map(toListItem), total });
  });

  app.get("/:id", async (c) => {
    const id = parseParam(c, "id", Uuid);
    const at = now();
    const row = await deps.db.player.findUnique({
      where: { id },
      include: listInclude(at),
    });
    if (!row) {
      throw notFound("Player");
    }

    const banRows = await deps.db.ban.findMany({
      where: { playerId: id },
      include: {
        createdByAdmin: { select: { email: true } },
        revokedByAdmin: { select: { email: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    const membership = await findMembership(deps.db, id);
    const recent = await listAdminRuns(
      deps.db,
      { participants: { some: { playerId: id } } },
      ADMIN_PLAYER_RECENT_RUNS,
      0
    );
    const noteCount = await deps.db.playerNote.count({
      where: { playerId: id },
    });

    const detail: AdminPlayerDetail = {
      ...toListItem(row),
      guild: membership
        ? {
            id: membership.guildId,
            name: membership.name,
            tag: membership.tag,
            role: membership.role,
          }
        : null,
      bans: banRows.map((b) => ({
        id: b.id,
        reason: b.reason,
        createdAt: iso(b.createdAt),
        expiresAt: isoOrNull(b.expiresAt),
        revokedAt: isoOrNull(b.revokedAt),
        createdBy: b.createdByAdmin?.email ?? null,
        revokedBy: b.revokedByAdmin?.email ?? null,
        active: isBanActive(b, at),
      })),
      recentRuns: recent.items,
      runsTotal: recent.total,
      noteCount,
    };
    return c.json(detail);
  });

  registerPlayerNoteRoutes(app, deps);

  /** Ban with reason; durationDays null = permanent. Moderators and admins. */
  app.post("/:id/bans", requireRole("moderator"), async (c) => {
    const id = parseParam(c, "id", Uuid);
    const body = await parseBody(c, BanRequest);
    await loadPlayer(id);
    const at = now();
    const expiresAt =
      body.durationDays === null
        ? null
        : new Date(at.getTime() + body.durationDays * 86_400_000);
    const admin = c.get("admin");
    const ban = await deps.db.$transaction(async (tx) => {
      const created = await tx.ban.create({
        data: {
          playerId: id,
          reason: body.reason,
          createdByAdminId: admin.id,
          createdAt: at,
          expiresAt,
        },
      });
      await writeAudit(tx, {
        adminId: admin.id,
        action: "player.ban",
        targetType: "player",
        targetId: id,
        details: {
          banId: created.id,
          reason: body.reason,
          durationDays: body.durationDays,
        },
      });
      return created;
    });
    const response: BanResponse = {
      id: ban.id,
      expiresAt: isoOrNull(ban.expiresAt),
      relay: await kickBannedFromRelay(id),
    };
    return c.json(response, 201);
  });

  /** Revokes all active bans of the player. */
  app.post("/:id/unban", requireRole("moderator"), async (c) => {
    const id = parseParam(c, "id", Uuid);
    await loadPlayer(id);
    const admin = c.get("admin");
    const at = now();
    const revoked = await deps.db.$transaction(async (tx) => {
      const active = await tx.ban.findMany({
        where: { playerId: id, ...activeBanWhere(at) },
        select: { id: true },
      });
      if (active.length === 0) {
        throw new ApiError(409, "not_banned", "Player has no active ban");
      }
      const ids = active.map((b) => b.id);
      await tx.ban.updateMany({
        where: { id: { in: ids } },
        data: { revokedAt: at, revokedBy: admin.id },
      });
      await writeAudit(tx, {
        adminId: admin.id,
        action: "player.unban",
        targetType: "player",
        targetId: id,
        details: { banIds: ids },
      });
      return ids.length;
    });
    return c.json({ revoked });
  });

  app.patch("/:id", requireRole("moderator"), async (c) => {
    const id = parseParam(c, "id", Uuid);
    const { name } = await parseBody(c, RenamePlayerRequest);
    const player = await loadPlayer(id);
    const admin = c.get("admin");
    await deps.db.$transaction(async (tx) => {
      await tx.player.update({ where: { id }, data: { name } });
      await writeAudit(tx, {
        adminId: admin.id,
        action: "player.rename",
        targetType: "player",
        targetId: id,
        details: { from: player.name, to: name },
      });
    });
    return c.json({ id, name });
  });

  /**
   * Deletes the account like DELETE /me, also for banned players (P-108). Admins only; writes the
   * audit entry and the deletion log (channel `admin`, P-026).
   */
  app.delete("/:id", requireRole("admin"), async (c) => {
    const id = parseParam(c, "id", Uuid);
    const body = await parseOptionalBody(c, AdminDeletePlayerRequest);
    const result = await adminDeletePlayer(deps.db, {
      playerId: id,
      adminId: c.get("admin").id,
      note: body.note,
      secret: hmacSecret(deps.config),
      now: now(),
    });
    logger.info("account_deleted", {
      channel: "admin",
      wasBanned: result.wasBanned,
      guildDisbanded: result.guild?.disbanded ?? false,
    });
    return c.json(result);
  });

  return app;
}
