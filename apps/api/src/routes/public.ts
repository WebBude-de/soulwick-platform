import {
  API_VERSION,
  GuildTag,
  type PublicConfig,
  type PublicGuild,
} from "@soulwick/contracts";
import { Hono } from "hono";
import { notFound } from "../lib/errors.ts";
import { iso, parseParam } from "../lib/validate.ts";
import { activeBanWhere } from "../services/bans.ts";
import { memberCount } from "../services/guilds.ts";
import type { AppEnv, Deps } from "../types.ts";

/** Unauthenticated read-only endpoints for the public website. */
export function publicRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();

  /**
   * Environment facts for game builds (P16): version gate, protocol and relay URL; plus the
   * support address the website shows for account deletion without the game (P-026); whether the
   * guest login is open (P-028).
   */
  app.get("/config", (c) => {
    const {
      GUEST_AUTH_ENABLED,
      MIN_GAME_VERSION,
      PROTOCOL_VERSION,
      RELAY_PUBLIC_URL,
      SUPPORT_EMAIL,
    } = deps.config;
    const body: PublicConfig = {
      apiVersion: API_VERSION,
      minGameVersion: MIN_GAME_VERSION || null,
      protocolVersion: PROTOCOL_VERSION,
      relayUrl: RELAY_PUBLIC_URL || null,
      supportEmail: SUPPORT_EMAIL || null,
      guestAuth: GUEST_AUTH_ENABLED,
    };
    c.header("Cache-Control", "public, max-age=60");
    return c.json(body);
  });

  app.get("/guilds/:tag", async (c) => {
    const tag = parseParam(c, "tag", GuildTag);
    const guild = await deps.db.guild.findFirst({
      where: { tag, disbandedAt: null },
    });
    if (!guild) {
      throw notFound("Guild");
    }

    const now = deps.now?.() ?? new Date();
    // Best unflagged guild run without a currently banned participant.
    const best = await deps.db.run.findFirst({
      where: {
        guildId: guild.id,
        mode: "guild",
        flagged: false,
        participants: {
          none: { player: { bans: { some: activeBanWhere(now) } } },
        },
      },
      orderBy: [
        { roomReached: "desc" },
        { durationSeconds: "asc" },
        { createdAt: "asc" },
      ],
      select: { roomReached: true, durationSeconds: true, createdAt: true },
    });

    const body: PublicGuild = {
      name: guild.name,
      tag: guild.tag,
      memberCount: await memberCount(deps.db, guild.id),
      createdAt: iso(guild.createdAt),
      bestRun: best
        ? {
            roomReached: best.roomReached,
            durationSeconds: best.durationSeconds,
            achievedAt: iso(best.createdAt),
          }
        : null,
    };
    c.header("Cache-Control", "public, max-age=60");
    return c.json(body);
  });

  return app;
}
