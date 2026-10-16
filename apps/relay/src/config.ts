import { parseArgs } from "node:util";
import {
  ClientRouting,
  HELLO_TIMEOUT_SECONDS,
  PLAYER_JWKS_PATH,
  PROTOCOL_VERSION,
} from "@soulwick/contracts";
import { z } from "zod";

const TRAILING_SLASHES = /\/+$/;

const int = (min: number, fallback: number) =>
  z.coerce.number().int().min(min).default(fallback);

/**
 * Limits marked TESTWERT are first guesses (KONZEPT_ONLINE.md §2) and get tuned with real
 * traffic. Everything can be overridden per environment.
 */
const ConfigSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    /** 0 = random free port (tests). */
    RELAY_PORT: z.coerce.number().int().min(0).max(65_535).default(8790),
    /** "::" = dual stack (IPv6 and IPv4), so `ws://localhost` works for clients that resolve ::1 first. */
    RELAY_HOST: z.string().default("::"),

    /** Only clients with exactly this `hello.protocolVersion` are admitted (P16). */
    PROTOCOL_VERSION: int(0, PROTOCOL_VERSION),

    /**
     * Internal base URL of the API of the same environment, e.g. http://soulwick-api:8787: public
     * keys of the player JWTs (GET /auth/jwks, P-027) and the ban and guild checks.
     */
    API_INTERNAL_URL: z
      .url("API_INTERNAL_URL must be the internal URL of the API")
      .transform((v) => v.replace(TRAILING_SLASHES, "")),
    /** Where the JWKS comes from; empty = API_INTERNAL_URL + /auth/jwks. */
    JWKS_URL: z
      .union([z.literal(""), z.url()])
      .default("")
      .transform((v) => v.replace(TRAILING_SLASHES, "")),
    /** TESTWERT: how long the key set is reused (a token with an unknown key id refetches earlier). */
    JWKS_CACHE_SECONDS: z.coerce.number().min(0).default(600),
    /** Same value as RELAY_INTERNAL_KEY of the API. */
    RELAY_INTERNAL_KEY: z.string().trim().default(""),
    /** TESTWERT: how long ban/guild answers of the API are reused. */
    STATUS_CACHE_SECONDS: z.coerce.number().min(0).default(30),
    API_TIMEOUT_MS: int(100, 2000),

    /** TESTWERT: largest WebSocket message (binary: 10-byte header + Godot packet). */
    MAX_FRAME_BYTES: int(64, 65_536),
    /** Largest JSON control message. */
    MAX_CONTROL_BYTES: int(256, 4096),
    /** TESTWERT: per connection, control messages and game packets together. */
    MAX_MESSAGES_PER_SECOND: int(1, 1000),
    /** TESTWERT: per connection, incoming bytes. */
    MAX_BYTES_PER_SECOND: int(1024, 1_048_576),
    /** Rate-limit notices (at most one per second) before the connection is closed. */
    RATE_LIMIT_STRIKES: int(1, 5),
    /** TESTWERT: new WebSocket connections per client IP and minute. */
    MAX_CONNECTIONS_PER_IP_PER_MINUTE: int(1, 30),
    /**
     * TESTWERT: unsent bytes per receiver above which its unreliable packets are dropped (reliable
     * ones are still queued). Raised from 1 MiB to 4 MiB after the online test of 16.10.2026.
     */
    MAX_BUFFERED_BYTES: int(1024, 4_194_304),
    /**
     * TESTWERT: a receiver whose buffer stays over MAX_BUFFERED_BYTES this long is closed as slow
     * consumer (4010). 0 = at once, as before the online test of 16.10.2026.
     */
    SLOW_CONSUMER_GRACE_SECONDS: z.coerce.number().min(0).max(60).default(5),

    /** TESTWERT: an unstarted room closes after this time (`expired`). */
    ROOM_IDLE_MINUTES: z.coerce.number().positive().default(10),
    /** TESTWERT: a connection without a room and without messages closes after this time. */
    IDLE_MINUTES: z.coerce.number().positive().default(10),
    /** TESTWERT: seconds after connecting within which `hello` has to arrive. */
    HELLO_TIMEOUT_SECONDS: z.coerce
      .number()
      .positive()
      .default(HELLO_TIMEOUT_SECONDS),
    /** TESTWERTE: WebSocket ping interval and the silence after which a connection is dropped. */
    HEARTBEAT_INTERVAL_SECONDS: z.coerce.number().positive().default(15),
    HEARTBEAT_TIMEOUT_SECONDS: z.coerce.number().positive().default(30),

    /** Whom clients may address, see ClientRouting in @soulwick/contracts (decision with MP2). */
    CLIENT_ROUTING: ClientRouting.default("host_only"),

    /** Behind Dokploy/Traefik the client IP comes from X-Forwarded-For (same as the API, P-005). */
    TRUST_PROXY: z
      .enum(["true", "false", "1", "0"])
      .default("true")
      .transform((v) => v === "true" || v === "1"),
    LOG_LEVEL: z.enum(["info", "error", "silent"]).default("info"),

    /** Local testing only (ignored with NODE_ENV=production): delay of every forwarded packet. */
    RELAY_SIM_LATENCY_MS: z.coerce.number().int().min(0).max(10_000).default(0),
    /** Local testing only: percentage (0-100) of unreliable packets (mode 0/1) that is dropped. */
    RELAY_SIM_LOSS: z.coerce.number().min(0).max(100).default(0),
  })
  .refine((c) => c.MAX_BYTES_PER_SECOND >= c.MAX_FRAME_BYTES, {
    message: "MAX_BYTES_PER_SECOND must be at least MAX_FRAME_BYTES",
    path: ["MAX_BYTES_PER_SECOND"],
  })
  .refine((c) => c.HEARTBEAT_TIMEOUT_SECONDS > c.HEARTBEAT_INTERVAL_SECONDS, {
    message: "HEARTBEAT_TIMEOUT_SECONDS must exceed the interval",
    path: ["HEARTBEAT_TIMEOUT_SECONDS"],
  })
  .transform((c) => ({
    ...c,
    JWKS_URL: c.JWKS_URL || `${c.API_INTERNAL_URL}${PLAYER_JWKS_PATH}`,
    ...(c.NODE_ENV === "production"
      ? { RELAY_SIM_LATENCY_MS: 0, RELAY_SIM_LOSS: 0 }
      : {}),
  }));

export type Config = z.output<typeof ConfigSchema>;

/**
 * Environment plus command line. Aliases: `PORT` for RELAY_PORT, `SIM_LATENCY_MS` and
 * `SIM_LOSS_PERCENT` for the simulation; `--sim-latency=<ms>` and `--sim-loss=<percent>` win over
 * the environment (`bun run --cwd apps/relay dev --sim-latency=120`).
 */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  argv: string[] = []
): Config {
  const { values } = parseArgs({
    args: argv,
    options: {
      "sim-latency": { type: "string" },
      "sim-loss": { type: "string" },
    },
    strict: false,
    allowPositionals: true,
  });
  const arg = (name: "sim-latency" | "sim-loss") => {
    const v = values[name];
    return typeof v === "string" ? v : undefined;
  };
  const merged = {
    ...env,
    RELAY_PORT: env.RELAY_PORT ?? env.PORT,
    RELAY_SIM_LATENCY_MS:
      arg("sim-latency") ?? env.RELAY_SIM_LATENCY_MS ?? env.SIM_LATENCY_MS,
    RELAY_SIM_LOSS:
      arg("sim-loss") ?? env.RELAY_SIM_LOSS ?? env.SIM_LOSS_PERCENT,
  };
  const result = ConfigSchema.safeParse(merged);
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  - ${i.path.join(".")}: ${i.message}`
    );
    throw new Error(`Invalid configuration:\n${lines.join("\n")}`);
  }
  return result.data;
}
