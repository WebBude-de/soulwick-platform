import {
  ACCOUNT_STATE_MAX_BODY_BYTES,
  AddLoginRequest,
  type AddLoginResponse,
  AddXpRequest,
  type DeletionCodeResponse,
  type IdentityList,
  IdentityProvider,
  LinkAccountRequest,
  type LinkAccountResponse,
  type LinkCodeResponse,
  MAX_GUILDS_PER_PLAYER,
  type MyGuildList,
  PutAccountStateRequest,
  SetPasswordLoginRequest,
  UpdateProfileRequest,
} from "@soulwick/contracts";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
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
import { getAccountState, putAccountState } from "../services/account-state.ts";
import { sendRevocationsSoon } from "../services/apple.ts";
import { listMyGuilds, toPlayerSelf } from "../services/guilds.ts";
import {
  listIdentitySummaries,
  unlinkProvider,
} from "../services/identities.ts";
import { addLogin, setPasswordLogin } from "../services/logins.ts";
import { updateProfile } from "../services/profile.ts";
import { proveLogin } from "../services/prove-login.ts";
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
    sendRevocationsSoon(deps);
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

  /**
   * Account state (D-194, KF3b): talents, equipped spells and seen flags of the account, with
   * level, danger level and rank. See AccountState / PutAccountStateRequest.
   */
  app.get("/state", async (c) =>
    c.json(await getAccountState(deps.db, c.get("player")))
  );

  app.put(
    "/state",
    bodyLimit({
      maxSize: ACCOUNT_STATE_MAX_BODY_BYTES,
      onError: (c) =>
        c.json(
          {
            error: "payload_too_large",
            message: `The request body must be at most ${ACCOUNT_STATE_MAX_BODY_BYTES} bytes`,
          },
          413
        ),
    }),
    async (c) => {
      const body = await parseBody(c, PutAccountStateRequest);
      return c.json(
        await putAccountState(deps.db, {
          playerId: c.get("player").id,
          body,
          now: now(),
        })
      );
    }
  );

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
    const { revocations } = await unlinkProvider(deps.db, player.id, provider);
    if (revocations > 0) {
      sendRevocationsSoon(deps);
    }
    const body: IdentityList = {
      items: await listIdentitySummaries(deps.db, player.id),
    };
    return c.json(body);
  });

  // --- adding logins (KF5, P-036 (2)) ------------------------------------------------------------

  /** Adds or changes the password login of the own account; the session is the proof. */
  app.put("/logins/password", async (c) => {
    const body = await parseBody(c, SetPasswordLoginRequest);
    const player = c.get("player");
    await setPasswordLogin(deps.db, {
      playerId: player.id,
      username: body.username,
      password: body.password,
      now: now(),
    });
    const response: IdentityList = {
      items: await listIdentitySummaries(deps.db, player.id),
    };
    return c.json(response);
  });

  /**
   * Proves a further login inside the game and adds it (Steam ticket, Play Games, Apple, Game
   * Center, the device id of a guest account); an account that already has it is merged by
   * D-122/D-188 (409 `account_has_progress` until `confirmMerge`). See AddLoginRequest.
   */
  app.post(
    "/logins",
    rateLimit({
      limit: deps.config.LOGIN_ATTEMPTS_PER_MINUTE,
      trustProxy: deps.config.TRUST_PROXY,
      name: "me-logins",
    }),
    async (c) => {
      const body = await parseBody(c, AddLoginRequest);
      const caller = c.get("player");
      const login = await proveLogin(deps, body, logger);
      const result = await addLogin(deps.db, {
        playerId: caller.id,
        login,
        confirmMerge: body.confirmMerge,
        now: now(),
      });
      logger.info("login_added", {
        provider: login.provider,
        merged: result.merged,
        removedPlayerId: result.removedPlayerId ?? undefined,
      });
      const session = await issuePlayerSession(deps, result.remaining);
      const response: AddLoginResponse = {
        ...session,
        merged: result.merged,
        removedPlayerId: result.removedPlayerId,
        identities: await listIdentitySummaries(deps.db, result.remaining.id),
      };
      return c.json(response);
    }
  );

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
