import {
  PLAYER_JWT_AUDIENCE,
  RELAY_KEY_HEADER,
  RelayPlayerStatus,
} from "@soulwick/contracts";
import {
  createLocalJWKSet,
  errors,
  type JSONWebKeySet,
  type JWTVerifyGetKey,
  jwtVerify,
} from "jose";
import type { Logger } from "./logger.ts";

/** Checks the `hello.token` of a client. */
export interface PlayerTokenVerifier {
  /** Player id of a valid player JWT, or null (invalid, expired, foreign, keys unavailable). */
  verify: (token: string) => Promise<string | null>;
}

/**
 * Verifies the player JWTs of the API (P-027: Better Auth jwt plugin, EdDSA/Ed25519, `aud`
 * PLAYER_JWT_AUDIENCE, from GET /auth/token) against the API's JWKS (`GET /auth/jwks` on
 * API_INTERNAL_URL). The relay holds no secret of the API.
 *
 * Key set cache: fetched on first use, reused for `cacheMs`. A token with an unknown key id
 * (rotation) refetches at once, but at most once per `cooldownMs`, so random key ids cannot make
 * the relay hammer the API. When a refetch fails, the last good key set stays in use; without any
 * key set every token is refused (`unauthorized`). Concurrent refetches share one request.
 */
export function createJwksVerifier(opts: {
  cacheMs: number;
  cooldownMs: number;
  logger: Logger;
  timeoutMs: number;
  url: string;
  fetch?: typeof fetch;
  /** Wall clock in ms (cache and `exp`); not the relay's test clock. */
  now?: () => number;
}): PlayerTokenVerifier {
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  let keySet: JWTVerifyGetKey | null = null;
  let fetchedAt = Number.NEGATIVE_INFINITY;
  let lastAttempt = Number.NEGATIVE_INFINITY;
  let inflight: Promise<boolean> | null = null;

  async function load(): Promise<boolean> {
    lastAttempt = now();
    try {
      const res = await doFetch(opts.url, {
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
      if (!res.ok) {
        opts.logger.error("jwks_api_error", { status: res.status });
        return false;
      }
      const body = (await res.json()) as Partial<JSONWebKeySet> | null;
      if (!(body && Array.isArray(body.keys))) {
        opts.logger.error("jwks_invalid_response", {});
        return false;
      }
      keySet = createLocalJWKSet(body as JSONWebKeySet);
      fetchedAt = now();
      return true;
    } catch (err) {
      opts.logger.error("jwks_unreachable", {
        error: err instanceof Error ? err.name : "unknown",
      });
      return false;
    }
  }

  function refresh(): Promise<boolean> {
    inflight ??= load().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  const coolingDown = () => now() - lastAttempt < opts.cooldownMs;

  async function check(token: string, keys: JWTVerifyGetKey) {
    const { payload } = await jwtVerify(token, keys, {
      algorithms: ["EdDSA"],
      audience: PLAYER_JWT_AUDIENCE,
      currentDate: new Date(now()),
      requiredClaims: ["sub", "exp"],
    });
    return typeof payload.sub === "string" && payload.sub ? payload.sub : null;
  }

  return {
    async verify(token) {
      const stale = now() - fetchedAt >= opts.cacheMs;
      // A fetch in flight is awaited even within the cooldown (parallel hellos at start-up).
      if (inflight || ((!keySet || stale) && !coolingDown())) {
        await refresh();
      }
      const keys = keySet;
      if (!keys) {
        return null;
      }
      try {
        return await check(token, keys);
      } catch (err) {
        if (
          !(err instanceof errors.JWKSNoMatchingKey) ||
          (coolingDown() && !inflight)
        ) {
          return null;
        }
        // Unknown key id: the API may have rotated its signing key.
        if (!((await refresh()) && keySet)) {
          return null;
        }
        try {
          return await check(token, keySet);
        } catch {
          return null;
        }
      }
    },
  };
}

export type PlayerStatusResult =
  | { kind: "ok"; status: RelayPlayerStatus }
  | { kind: "not_found" }
  | { kind: "unavailable" };

/**
 * Membership in a guild (D-147, P-031): the API lists every active guild in `guildIds`; older
 * APIs only send the single `guildId`.
 */
export function isGuildMember(
  status: RelayPlayerStatus,
  guildId: string
): boolean {
  return status.guildIds
    ? status.guildIds.includes(guildId)
    : status.guildId === guildId;
}

/** Ban and guild status of a player; the relay never talks to the database itself. */
export interface PlayerStatusSource {
  /** Drops a cached answer, e.g. after the API reported a ban (POST /internal/players/:id/ban). */
  forget?: (playerId: string) => void;
  get: (playerId: string) => Promise<PlayerStatusResult>;
}

interface CacheEntry {
  expiresAt: number;
  result: PlayerStatusResult;
}

const MAX_CACHE_ENTRIES = 10_000;

/**
 * Asks `GET {apiUrl}/internal/relay/players/:id/status` (KONZEPT_ONLINE.md §2.7). Answers are
 * cached for `cacheMs`; failures are not cached, concurrent lookups for one player share a request.
 * Without URL or key every lookup is `unavailable` (quick rooms still work, guild rooms do not).
 */
export function createApiStatusSource(opts: {
  apiUrl: string;
  cacheMs: number;
  key: string;
  logger: Logger;
  timeoutMs: number;
  fetch?: typeof fetch;
  now?: () => number;
}): PlayerStatusSource {
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const cache = new Map<string, CacheEntry>();
  const inflight = new Map<string, Promise<PlayerStatusResult>>();
  /** In-flight lookups started before a `forget`; their answers are not cached. */
  const forgotten = new Set<Promise<PlayerStatusResult>>();

  if (!(opts.apiUrl && opts.key)) {
    opts.logger.info("status_source_disabled", {
      reason: "API_INTERNAL_URL or RELAY_INTERNAL_KEY not set",
    });
    return { get: () => Promise.resolve({ kind: "unavailable" }) };
  }

  async function load(playerId: string): Promise<PlayerStatusResult> {
    const url = `${opts.apiUrl}/internal/relay/players/${encodeURIComponent(playerId)}/status`;
    try {
      const res = await doFetch(url, {
        headers: { [RELAY_KEY_HEADER]: opts.key },
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
      if (res.status === 404) {
        const body = (await res.json().catch(() => null)) as {
          error?: unknown;
        } | null;
        if (body?.error === "player_not_found") {
          return { kind: "not_found" };
        }
      }
      if (!res.ok) {
        opts.logger.error("status_api_error", { status: res.status });
        return { kind: "unavailable" };
      }
      const parsed = RelayPlayerStatus.safeParse(await res.json());
      if (!parsed.success) {
        opts.logger.error("status_api_invalid_response", {});
        return { kind: "unavailable" };
      }
      return { kind: "ok", status: parsed.data };
    } catch (err) {
      opts.logger.error("status_api_unreachable", {
        error: err instanceof Error ? err.name : "unknown",
      });
      return { kind: "unavailable" };
    }
  }

  function sweep(t: number) {
    if (cache.size < MAX_CACHE_ENTRIES) {
      return;
    }
    for (const [id, entry] of cache) {
      if (entry.expiresAt <= t) {
        cache.delete(id);
      }
    }
    if (cache.size >= MAX_CACHE_ENTRIES) {
      cache.clear();
    }
  }

  return {
    forget(playerId) {
      cache.delete(playerId);
      // A lookup still in flight may carry the old answer: let it finish, but neither cache nor
      // share it any more.
      const pending = inflight.get(playerId);
      if (pending) {
        inflight.delete(playerId);
        forgotten.add(pending);
      }
    },
    get(playerId) {
      const t = now();
      const hit = cache.get(playerId);
      if (hit && hit.expiresAt > t) {
        return Promise.resolve(hit.result);
      }
      const pending = inflight.get(playerId);
      if (pending) {
        return pending;
      }
      const request: Promise<PlayerStatusResult> = load(playerId).then(
        (result) => {
          if (forgotten.delete(request)) {
            return result;
          }
          inflight.delete(playerId);
          if (result.kind !== "unavailable" && opts.cacheMs > 0) {
            sweep(now());
            cache.set(playerId, { result, expiresAt: now() + opts.cacheMs });
          }
          return result;
        }
      );
      inflight.set(playerId, request);
      return request;
    },
  };
}
