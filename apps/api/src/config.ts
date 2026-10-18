import {
  BUG_REPORT_RETENTION_DAYS_DEFAULT,
  PROTOCOL_VERSION,
  RELAY_WS_PATH,
} from "@soulwick/contracts";
import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0", ""])
  .default("false")
  .transform((v) => v === "true" || v === "1");

const csv = z
  .string()
  .default("")
  .transform((v) =>
    v
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  );

const TRAILING_SLASHES = /\/+$/;
/** Numeric game versions ("1.0", "1.0.0", "1.0.0.4"), optionally with a "-beta.1" suffix. */
const COMPARABLE_VERSION = /^\d+(\.\d+){1,3}([-+][0-9A-Za-z.-]+)?$/;
const WEBSOCKET_URL = /^wss?:\/\//;

/** Relay URL for the game: without a path, the relay's WebSocket path (/v1) is appended. */
function relayUrlWithPath(raw: string): string {
  if (!raw) {
    return "";
  }
  const url = new URL(raw);
  if (url.pathname === "/" || url.pathname === "") {
    url.pathname = RELAY_WS_PATH;
  }
  return url.toString().replace(TRAILING_SLASHES, "");
}

const ConfigSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3101),
    DATABASE_URL: z.string().default(""),

    /**
     * Better Auth (P-027): signs session tokens, encrypts the JWT signing keys, and the keys of
     * the link and deletion codes are derived from it (lib/secrets.ts). Per environment.
     */
    BETTER_AUTH_SECRET: z
      .string()
      .min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
    /** Public base URL of this API (issuer of the player JWTs), e.g. https://api.playsoulwick.com. */
    BETTER_AUTH_URL: z
      .url()
      .default("http://localhost:3101")
      .transform((v) => v.replace(TRAILING_SLASHES, "")),
    /** Lifetime of a player session (login token), fixed from the login. */
    PLAYER_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(30),
    /** Lifetime of an admin session, fixed from the login. */
    ADMIN_TOKEN_TTL_HOURS: z.coerce.number().int().min(1).default(8),

    DEV_AUTH_ENABLED: bool,
    DEV_AUTH_KEY: z.string().default(""),

    /**
     * Guest login per device POST /auth/device (P-028): the way in for players without Steam or
     * Google Play; linked to a store account later via link code. false = 403 guest_auth_disabled.
     */
    GUEST_AUTH_ENABLED: z
      .enum(["true", "false", "1", "0"])
      .default("true")
      .transform((v) => v === "true" || v === "1"),
    /** TESTWERT: POST /auth/device per IP and minute. */
    GUEST_LOGINS_PER_MINUTE: z.coerce.number().int().min(1).default(10),
    /** TESTWERT: new guest accounts per IP and hour (logins of known devices do not count). */
    GUEST_ACCOUNTS_PER_HOUR: z.coerce.number().int().min(1).default(20),

    /** Publisher Web API key (partner.steam-api.com); empty = /auth/steam answers 501. */
    STEAM_WEB_API_KEY: z.string().trim().default(""),
    STEAM_APP_ID: z.string().trim().default(""),
    /** Identity string the game passes to GetAuthTicketForWebApi (KONZEPT_ONLINE.md §3.2). */
    STEAM_TICKET_IDENTITY: z.string().trim().default("soulwick"),

    /** Web OAuth client of the Google Cloud project linked to Play Games Services; empty = 501. */
    GOOGLE_PLAY_CLIENT_ID: z.string().trim().default(""),
    GOOGLE_PLAY_CLIENT_SECRET: z.string().trim().default(""),

    /** TESTWERT: timeout per call to Steam or Google during a login. */
    EXTERNAL_AUTH_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(60_000)
      .default(8000),

    CORS_ORIGINS: csv,
    /** TESTWERT: requests per IP and minute. */
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(120),
    /** TESTWERT: POST /me/link attempts per IP and minute (link codes must not be guessable). */
    LINK_ATTEMPTS_PER_MINUTE: z.coerce.number().int().min(1).default(10),
    /** TESTWERT: POST /account-deletion/verify per IP and hour (public deletion page, P-026). */
    DELETION_REQUESTS_PER_HOUR: z.coerce.number().int().min(1).default(5),
    /** TESTWERT: POST /bug-reports per player and hour (P-033). */
    BUG_REPORTS_PER_HOUR: z.coerce.number().int().min(1).default(10),
    /** TESTWERT: POST /bug-reports per IP and hour (several players can share one IP). */
    BUG_REPORTS_PER_IP_PER_HOUR: z.coerce.number().int().min(1).default(20),
    /** TESTWERT: bug reports are deleted this many days after they were sent (P-033). */
    BUG_REPORT_RETENTION_DAYS: z.coerce
      .number()
      .int()
      .min(1)
      .max(3650)
      .default(BUG_REPORT_RETENTION_DAYS_DEFAULT),
    /**
     * TESTWERT: writes to cloud worlds (PUT, DELETE, restore, unarchive under /me/worlds) per
     * account and hour (D-188, P-038). The game syncs at most every 5 minutes in the village.
     */
    WORLD_WRITES_PER_HOUR: z.coerce.number().int().min(1).default(120),
    /** Behind Dokploy/Traefik the client IP comes from X-Forwarded-For. */
    TRUST_PROXY: z
      .enum(["true", "false", "1", "0"])
      .default("true")
      .transform((v) => v === "true" || v === "1"),

    /** TESTWERT: runs faster than this per room are flagged. */
    MIN_SECONDS_PER_ROOM: z.coerce.number().min(0).default(8),
    /** Comma-separated list; empty = version check disabled. */
    KNOWN_GAME_VERSIONS: csv,
    /**
     * Oldest game version that may use the online features (GET /health, GET /public/config);
     * empty = no lower bound. Per environment (P16).
     */
    MIN_GAME_VERSION: z
      .string()
      .trim()
      .default("")
      .refine((v) => v === "" || COMPARABLE_VERSION.test(v), {
        message: "MIN_GAME_VERSION must look like 1.0.0 (or be empty)",
      }),
    /** Network protocol version of this environment; same value as PROTOCOL_VERSION of the relay. */
    PROTOCOL_VERSION: z.coerce.number().int().min(0).default(PROTOCOL_VERSION),
    /**
     * Public WebSocket URL of the relay of this environment, e.g. wss://play.playsoulwick.com
     * (without a path, /v1 is appended). Empty = GET /public/config reports no relay.
     */
    RELAY_PUBLIC_URL: z
      .string()
      .trim()
      .default("")
      .refine((v) => v === "" || (WEBSOCKET_URL.test(v) && URL.canParse(v)), {
        message: "RELAY_PUBLIC_URL must be a ws:// or wss:// URL (or empty)",
      })
      .transform(relayUrlWithPath),

    /**
     * Support address the website shows for account deletion without access to the game
     * (GET /public/config `supportEmail`, P-026). Empty = not shown.
     */
    SUPPORT_EMAIL: z.union([z.literal(""), z.email()]).default(""),

    LOG_LEVEL: z.enum(["info", "error", "silent"]).default("info"),

    /**
     * Shared key of the relay (apps/relay) for GET /internal/relay/...; header `x-relay-key`.
     * Empty = internal relay endpoint disabled (404).
     */
    RELAY_INTERNAL_KEY: z.string().trim().default(""),
    /**
     * Internal base URL of the relay of this environment (e.g. http://soulwick-relay:8790) for the
     * admin panel's live rooms and kicking banned players (P-024). Needs RELAY_INTERNAL_KEY.
     * Empty = those features answer 501 relay_not_configured, bans skip the relay.
     */
    RELAY_INTERNAL_URL: z
      .union([z.literal(""), z.url()])
      .default("")
      .transform((v) => v.replace(TRAILING_SLASHES, "")),
    /** TESTWERT: timeout per call to the relay's internal endpoints. */
    RELAY_INTERNAL_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(60_000)
      .default(3000),

    /**
     * eRecht24 Rechtstexte-API v2 (P-025, like DapItUp): project API key and plugin key. Both
     * are needed; while one is empty, GET /legal/:type answers status "missing".
     */
    ERECHT24_API_KEY: z.string().trim().default(""),
    ERECHT24_PLUGIN_KEY: z.string().trim().default(""),
  })
  .refine(
    (c) =>
      c.NODE_ENV !== "production" || c.BETTER_AUTH_URL.startsWith("https://"),
    {
      message: "BETTER_AUTH_URL must be an https URL in production",
      path: ["BETTER_AUTH_URL"],
    }
  )
  .refine((c) => !c.DEV_AUTH_ENABLED || c.DEV_AUTH_KEY.length >= 16, {
    message:
      "DEV_AUTH_KEY (min. 16 characters) is required when DEV_AUTH_ENABLED=true",
    path: ["DEV_AUTH_KEY"],
  })
  .refine(
    (c) => c.RELAY_INTERNAL_KEY === "" || c.RELAY_INTERNAL_KEY.length >= 32,
    {
      message: "RELAY_INTERNAL_KEY must be empty or at least 32 characters",
      path: ["RELAY_INTERNAL_KEY"],
    }
  )
  .refine((c) => c.RELAY_INTERNAL_URL === "" || c.RELAY_INTERNAL_KEY !== "", {
    message: "RELAY_INTERNAL_URL needs RELAY_INTERNAL_KEY",
    path: ["RELAY_INTERNAL_URL"],
  });

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(
  env: Record<string, string | undefined> = process.env
): Config {
  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  - ${i.path.join(".")}: ${i.message}`
    );
    throw new Error(`Invalid configuration:\n${lines.join("\n")}`);
  }
  return result.data;
}
