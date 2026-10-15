import {
  BUG_REPORT_MAX_BODY_BYTES,
  BUG_REPORT_MAX_IMAGE_BYTES,
  CreateBugReportRequest,
  type CreateBugReportResponse,
} from "@soulwick/contracts";
import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { clientIp } from "../lib/client-ip.ts";
import { ApiError } from "../lib/errors.ts";
import { decodeImage } from "../lib/image.ts";
import { fixedWindowCounter } from "../lib/rate-limit.ts";
import { parseBody } from "../lib/validate.ts";
import { requirePlayer } from "../middleware/auth.ts";
import { createBugReport } from "../services/bug-reports.ts";
import type { AppEnv, Deps } from "../types.ts";

const HOUR_MS = 3_600_000;

/**
 * Bug reports from the game (P-033): `POST /bug-reports` for every signed-in player, guest
 * accounts included; banned players get 403 `banned` from `requirePlayer`.
 */
export function bugReportRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();
  const now = () => deps.now?.() ?? new Date();

  const perPlayer = fixedWindowCounter({
    limit: deps.config.BUG_REPORTS_PER_HOUR,
    windowMs: HOUR_MS,
  });
  const perIp = fixedWindowCounter({
    limit: deps.config.BUG_REPORTS_PER_IP_PER_HOUR,
    windowMs: HOUR_MS,
  });

  /**
   * Counts every authenticated attempt (also rejected ones), before the body is read, so a
   * flood of oversized or broken uploads is cut off as well.
   */
  const uploadLimit: MiddlewareHandler<AppEnv> = async (c, next) => {
    const playerKey = c.get("player").id;
    const ipKey = clientIp(c, deps.config.TRUST_PROXY);
    const retryAfter = Math.max(
      perPlayer.blockedFor(playerKey) ?? 0,
      perIp.blockedFor(ipKey) ?? 0
    );
    if (retryAfter > 0) {
      c.header("Retry-After", String(retryAfter));
      throw new ApiError(429, "rate_limited", "Too many bug reports");
    }
    perPlayer.hit(playerKey);
    perIp.hit(ipKey);
    await next();
  };

  app.post(
    "/",
    requirePlayer(deps),
    uploadLimit,
    // Only this route accepts bodies of this size (the screenshot as base64).
    bodyLimit({
      maxSize: BUG_REPORT_MAX_BODY_BYTES,
      onError: (c) =>
        c.json(
          {
            error: "payload_too_large",
            message: `The request body must be at most ${BUG_REPORT_MAX_BODY_BYTES} bytes`,
          },
          413
        ),
    }),
    async (c) => {
      const body = await parseBody(c, CreateBugReportRequest);
      const image = decodeImage(body.image, BUG_REPORT_MAX_IMAGE_BYTES);
      const created = await createBugReport(deps.db, {
        playerId: c.get("player").id,
        body,
        image,
        now: now(),
      });
      const response: CreateBugReportResponse = { id: created.id };
      return c.json(response, 201);
    }
  );

  return app;
}
