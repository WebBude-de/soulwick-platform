import {
  AccountDeletionConfirmRequest,
  type AccountDeletionConfirmResponse,
  AccountDeletionVerifyRequest,
  type AccountDeletionVerifyResponse,
} from "@soulwick/contracts";
import { Hono } from "hono";
import { createLogger } from "../lib/logger.ts";
import { rateLimit } from "../lib/rate-limit.ts";
import { hmacSecret } from "../lib/secrets.ts";
import { iso, parseBody } from "../lib/validate.ts";
import {
  confirmAccountDeletion,
  verifyDeletionCode,
} from "../services/account-deletion.ts";
import type { AppEnv, Deps } from "../types.ts";

const HOUR_MS = 3_600_000;

/**
 * Public account deletion of the website (Google Play requirement, KONZEPT_ONLINE.md §3.7,
 * P-026). No login: `verify` checks player name + one-time code from the game and returns a
 * short-lived confirmation token, `confirm` deletes the account. `verify` has its own strict
 * rate limit per IP; wrong codes additionally burn the code of the named player.
 */
export function accountDeletionRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();
  const logger = createLogger(deps.config.LOG_LEVEL);
  const now = () => deps.now?.() ?? new Date();

  app.post(
    "/verify",
    rateLimit({
      limit: deps.config.DELETION_REQUESTS_PER_HOUR,
      windowMs: HOUR_MS,
      trustProxy: deps.config.TRUST_PROXY,
      name: "account-deletion-verify",
    }),
    async (c) => {
      const body = await parseBody(c, AccountDeletionVerifyRequest);
      const result = await verifyDeletionCode(deps.db, {
        playerName: body.playerName,
        code: body.code,
        secret: hmacSecret(deps.config),
        now: now(),
      });
      const response: AccountDeletionVerifyResponse = {
        token: result.token,
        expiresAt: iso(result.expiresAt),
        account: result.account,
      };
      return c.json(response);
    }
  );

  app.post("/confirm", async (c) => {
    const body = await parseBody(c, AccountDeletionConfirmRequest);
    const at = now();
    const result = await confirmAccountDeletion(deps.db, {
      token: body.token,
      secret: hmacSecret(deps.config),
      now: at,
    });
    // No player id or name in the log; a banned account is noted (deleted anyway, privacy).
    logger.info("account_deleted", {
      channel: "web_code",
      wasBanned: result.wasBanned,
      guildDisbanded: result.guilds?.some((g) => g.disbanded) ?? false,
    });
    const response: AccountDeletionConfirmResponse = {
      deleted: true,
      deletedAt: iso(at),
    };
    return c.json(response);
  });

  return app;
}
