import {
  AddXpRequest,
  type DeletionCodeResponse,
  type IdentityList,
  IdentityProvider,
  LinkAccountRequest,
  type LinkAccountResponse,
  type LinkCodeResponse,
  MAX_GUILDS_PER_PLAYER,
  type MyGuildList,
  UpdateProfileRequest,
} from "@soulwick/contracts";
import { Hono } from "hono";
import { ApiError } from "../lib/errors.ts";
import { createLogger } from "../lib/logger.ts";
import { rateLimit } from "../lib/rate-limit.ts";
import { hmacSecret } from "../lib/secrets.ts";
import { iso, parseBody, parseParam } from "../lib/validate.ts";
import { requirePlayer } from "../middleware/auth.ts";
import {
  createDeletionCode,
  deleteOwnAccount,
} from "../services/account-deletion.ts";
import { createLinkCode, redeemLinkCode } from "../services/account-link.ts";
import { listMyGuilds, toPlayerSelf } from "../services/guilds.ts";
import {
  listIdentitySummaries,
  unlinkProvider,
} from "../services/identities.ts";
import { updateProfile } from "../services/profile.ts";
import { issuePlayerSession } from "../services/sessions.ts";
import { addXp } from "../services/xp.ts";
import type { AppEnv, Deps } from "../types.ts";
import { worldRoutes } from "./worlds.ts";

export function meRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();
  const logger = createLogger(deps.config.LOG_LEVEL);
  const now = () => deps.now?.() ?? new Date();
  app.use("*", requirePlayer(deps));

  app.get("/", async (c) =>
    c.json(await toPlayerSelf(deps.db, c.get("player")))
  );

  /** Account profile (P-034, D-152): display name and character; see UpdateProfileRequest. */
  app.patch("/", async (c) => {
    const body = await parseBody(c, UpdateProfileRequest);
    try {
      const player = await updateProfile(deps.db, {
        playerId: c.get("player").id,
        name: body.name,
        appearance: body.appearance,
        now: now(),
      });
      return c.json(await toPlayerSelf(deps.db, player));
    } catch (err) {
      if (err instanceof ApiError && err.code === "name_change_limited") {
        c.header("Retry-After", String(err.extra?.retryAfter ?? ""));
      }
      throw err;
    }
  });

  /**
   * Deletes the account (privacy); see `deletePlayerAccount` for what goes and what stays. Writes
   * the deletion log with channel `in_game` (P-026).
   */
  app.delete("/", async (c) => {
    const result = await deleteOwnAccount(deps.db, {
      playerId: c.get("player").id,
      secret: hmacSecret(deps.config),
      now: now(),
    });
    logger.info("account_deleted", {
      channel: "in_game",
      wasBanned: result.wasBanned,
      guildDisbanded: result.guilds?.some((g) => g.disbanded) ?? false,
    });
    return c.body(null, 204);
  });

  /**
   * Account XP (D-188, KF3): uploads finished runs of the own player; each run id counts once.
   * See AddXpRequest / AddXpResponse.
   */
  app.post("/xp", async (c) => {
    const body = await parseBody(c, AddXpRequest);
    const result = await addXp(deps.db, {
      playerId: c.get("player").id,
      entries: body.entries,
      config: deps.config,
      now: now(),
    });
    return c.json(result);
  });

  /** Cloud worlds (D-188, KF8, P-038): routes/worlds.ts. */
  app.route("/worlds", worldRoutes(deps));

  /** Own active guilds for the online menu (D-147), oldest membership first. */
  app.get("/guilds", async (c) => {
    const body: MyGuildList = {
      items: await listMyGuilds(deps.db, c.get("player").id),
      maxGuilds: MAX_GUILDS_PER_PLAYER,
    };
    return c.json(body);
  });

  // --- identities and linking (D-121, D-122, KONZEPT_ONLINE.md §3.5) ---------------------------

  app.get("/identities", async (c) => {
    const body: IdentityList = {
      items: await listIdentitySummaries(deps.db, c.get("player").id),
    };
    return c.json(body);
  });

  /** Unlinks all identities of one provider; 409 `last_identity` if none would be left. */
  app.delete("/identities/:provider", async (c) => {
    const provider = parseParam(c, "provider", IdentityProvider);
    const player = c.get("player");
    await unlinkProvider(deps.db, player.id, provider);
    const body: IdentityList = {
      items: await listIdentitySummaries(deps.db, player.id),
    };
    return c.json(body);
  });

  app.post("/link-code", async (c) => {
    const { code, expiresAt } = await createLinkCode(
      deps.db,
      c.get("player").id,
      hmacSecret(deps.config),
      now()
    );
    const body: LinkCodeResponse = { code, expiresAt: iso(expiresAt) };
    return c.json(body, 201);
  });

  app.post(
    "/link",
    rateLimit({
      // Codes have 31^6 values; guessing must stay slow.
      limit: deps.config.LINK_ATTEMPTS_PER_MINUTE,
      trustProxy: deps.config.TRUST_PROXY,
      name: "me-link",
    }),
    async (c) => {
      const body = await parseBody(c, LinkAccountRequest);
      const caller = c.get("player");
      const at = now();
      const result = await redeemLinkCode(deps.db, {
        callerId: caller.id,
        code: body.code,
        confirmMerge: body.confirmMerge,
        secret: hmacSecret(deps.config),
        now: at,
      });
      logger.info("account_linked", {
        remainingPlayerId: result.remaining.id,
        removedPlayerId: result.removedPlayerId,
        removedCaller: result.removedCaller,
        merged: result.merged,
        guilds: result.guilds,
        worlds: result.worlds,
      });
      const session = await issuePlayerSession(deps, result.remaining);
      const response: LinkAccountResponse = {
        ...session,
        merged: result.merged,
        removedPlayerId: result.removedPlayerId,
        identities: await listIdentitySummaries(deps.db, result.remaining.id),
      };
      return c.json(response);
    }
  );

  /**
   * One-time code for the website deletion (KONZEPT_ONLINE.md §3.7, P-026); shown once in the
   * game's account panel. A new code replaces the previous one.
   */
  app.post("/deletion-code", async (c) => {
    const { code, expiresAt } = await createDeletionCode(
      deps.db,
      c.get("player").id,
      hmacSecret(deps.config),
      now()
    );
    const body: DeletionCodeResponse = { code, expiresAt: iso(expiresAt) };
    return c.json(body, 201);
  });

  return app;
}
