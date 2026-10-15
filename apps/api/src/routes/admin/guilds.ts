import {
  type AdminGuildDetail,
  type AdminGuildListItem,
  AdminGuildSearchQuery,
  RenameGuildRequest,
  TransferGuildRequest,
  type TransferGuildResponse,
  Uuid,
} from "@soulwick/contracts";
import type { Prisma } from "@soulwick/db";
import { Hono } from "hono";
import {
  ApiError,
  isUniqueViolation,
  notFound,
  withCause,
} from "../../lib/errors.ts";
import { generateInviteCode } from "../../lib/invite-code.ts";
import {
  iso,
  isoOrNull,
  parseBody,
  parseParam,
  parseQuery,
} from "../../lib/validate.ts";
import { requireRole } from "../../middleware/auth.ts";
import { writeAudit } from "../../services/audit.ts";
import {
  disbandGuild,
  getProgress,
  listMembers,
  removeMember,
  transferFounder,
} from "../../services/guilds.ts";
import type { AppEnv, Deps } from "../../types.ts";

const listInclude = {
  founder: { select: { name: true } },
  _count: { select: { members: true } },
} satisfies Prisma.GuildInclude;

type Row = Prisma.GuildGetPayload<{ include: typeof listInclude }>;

const toListItem = (r: Row): AdminGuildListItem => ({
  id: r.id,
  name: r.name,
  tag: r.tag,
  memberCount: r._count.members,
  founderName: r.founder?.name ?? null,
  createdAt: iso(r.createdAt),
  disbandedAt: isoOrNull(r.disbandedAt),
});

export function adminGuildRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();
  const now = () => deps.now?.() ?? new Date();

  async function loadActiveGuild(id: string) {
    const g = await deps.db.guild.findUnique({ where: { id } });
    if (!g) {
      throw notFound("Guild");
    }
    if (g.disbandedAt) {
      throw new ApiError(409, "guild_disbanded", "Guild is disbanded");
    }
    return g;
  }

  app.get("/", async (c) => {
    const q = parseQuery(c, AdminGuildSearchQuery);
    const search: Prisma.GuildWhereInput[] = [];
    if (q.q) {
      search.push({ name: { contains: q.q, mode: "insensitive" } });
      search.push({ tag: q.q.toUpperCase() });
      if (Uuid.safeParse(q.q).success) {
        search.push({ id: q.q });
      }
    }
    const status = q.status ?? (q.includeDisbanded ? "all" : "active");
    const where: Prisma.GuildWhereInput = {
      ...(status === "active" ? { disbandedAt: null } : {}),
      ...(status === "disbanded" ? { disbandedAt: { not: null } } : {}),
      ...(search.length > 0 ? { OR: search } : {}),
    };
    const rows = await deps.db.guild.findMany({
      where,
      include: listInclude,
      orderBy: { createdAt: "desc" },
      take: q.limit,
      skip: q.offset,
    });
    const total = await deps.db.guild.count({ where });
    return c.json({ items: rows.map(toListItem), total });
  });

  app.get("/:id", async (c) => {
    const id = parseParam(c, "id", Uuid);
    const row = await deps.db.guild.findUnique({
      where: { id },
      include: listInclude,
    });
    if (!row) {
      throw notFound("Guild");
    }
    const detail: AdminGuildDetail = {
      ...toListItem(row),
      inviteCode: row.inviteCode,
      founderId: row.founderId,
      members: await listMembers(deps.db, id),
      progress: await getProgress(deps.db, id),
    };
    return c.json(detail);
  });

  app.patch("/:id", requireRole("moderator"), async (c) => {
    const id = parseParam(c, "id", Uuid);
    const body = await parseBody(c, RenameGuildRequest);
    const guild = await loadActiveGuild(id);
    const admin = c.get("admin");
    try {
      await deps.db.$transaction(async (tx) => {
        await tx.guild.update({
          where: { id },
          data: {
            ...(body.name ? { name: body.name } : {}),
            ...(body.tag ? { tag: body.tag } : {}),
          },
        });
        await writeAudit(tx, {
          adminId: admin.id,
          action: "guild.rename",
          targetType: "guild",
          targetId: id,
          details: { from: { name: guild.name, tag: guild.tag }, to: body },
        });
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw withCause(
          new ApiError(409, "guild_name_taken", "Name or tag already taken"),
          err
        );
      }
      throw err;
    }
    return c.json({
      id,
      name: body.name ?? guild.name,
      tag: body.tag ?? guild.tag,
    });
  });

  app.delete("/:id/members/:playerId", requireRole("moderator"), async (c) => {
    const id = parseParam(c, "id", Uuid);
    const playerId = parseParam(c, "playerId", Uuid);
    await loadActiveGuild(id);
    const admin = c.get("admin");
    const result = await deps.db.$transaction(async (tx) => {
      const r = await removeMember(tx, id, playerId, now());
      if (!r.removed) {
        throw new ApiError(
          404,
          "not_a_member",
          "Player is not a member of this guild"
        );
      }
      await writeAudit(tx, {
        adminId: admin.id,
        action: "guild.remove_member",
        targetType: "guild",
        targetId: id,
        details: {
          playerId,
          newFounderId: r.newFounderId,
          disbanded: r.disbanded,
        },
      });
      return r;
    });
    return c.json(result);
  });

  /** Makes a member the founder; the previous founder becomes officer (P-023). */
  app.post("/:id/transfer", requireRole("moderator"), async (c) => {
    const id = parseParam(c, "id", Uuid);
    const { playerId, reason } = await parseBody(c, TransferGuildRequest);
    await loadActiveGuild(id);
    const admin = c.get("admin");
    const result = await deps.db.$transaction(async (tx) => {
      const r = await transferFounder(tx, id, playerId);
      if (!r.ok) {
        throw r.reason === "not_a_member"
          ? new ApiError(
              404,
              "not_a_member",
              "Player is not a member of this guild"
            )
          : new ApiError(409, "already_founder", "Player is already founder");
      }
      await writeAudit(tx, {
        adminId: admin.id,
        action: "guild.transfer",
        targetType: "guild",
        targetId: id,
        details: { from: r.previousFounderId, to: playerId, reason },
      });
      return r;
    });
    const body: TransferGuildResponse = {
      id,
      founderId: playerId,
      previousFounderId: result.previousFounderId,
    };
    return c.json(body);
  });

  app.post("/:id/invite-code", requireRole("moderator"), async (c) => {
    const id = parseParam(c, "id", Uuid);
    await loadActiveGuild(id);
    const admin = c.get("admin");
    const inviteCode = generateInviteCode();
    await deps.db.$transaction(async (tx) => {
      await tx.guild.update({ where: { id }, data: { inviteCode } });
      await writeAudit(tx, {
        adminId: admin.id,
        action: "guild.reset_invite_code",
        targetType: "guild",
        targetId: id,
      });
    });
    return c.json({ inviteCode });
  });

  /** Admin only. Members are removed, name and tag become free again; runs stay. */
  app.post("/:id/disband", requireRole("admin"), async (c) => {
    const id = parseParam(c, "id", Uuid);
    const guild = await loadActiveGuild(id);
    const admin = c.get("admin");
    await deps.db.$transaction(async (tx) => {
      await disbandGuild(tx, id, now());
      await writeAudit(tx, {
        adminId: admin.id,
        action: "guild.disband",
        targetType: "guild",
        targetId: id,
        details: { name: guild.name, tag: guild.tag },
      });
    });
    return c.body(null, 204);
  });

  return app;
}
