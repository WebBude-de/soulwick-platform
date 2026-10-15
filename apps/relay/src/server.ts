import { RELAY_WS_PATH, type RelayHealthResponse } from "@soulwick/contracts";
import { type Server, type ServerWebSocket, serve, sleep } from "bun";
import {
  createApiStatusSource,
  createJwksVerifier,
  type PlayerStatusSource,
  type PlayerTokenVerifier,
} from "./auth.ts";
import type { Config } from "./config.ts";
import { handleInternal, hasRelayKey, json } from "./internal.ts";
import { IpConnectionLimiter } from "./limits.ts";
import { createLogger, type Logger } from "./logger.ts";
import { Metrics } from "./metrics.ts";
import { type Client, Relay, type RelayDeps, type Transport } from "./relay.ts";

const SWEEP_INTERVAL_MS = 1000;
/** On stop: how long the clients get to answer the close handshake. */
const CLOSE_GRACE_MS = 2000;
const TRAILING_SLASHES = /\/+$/;
/** TESTWERT: at most one JWKS fetch per this time because of unknown key ids. */
const JWKS_REFETCH_COOLDOWN_MS = 30_000;

interface SocketData {
  client: Client | null;
  ip: string;
}

export interface RelayServer {
  readonly metrics: Metrics;
  readonly port: number;
  readonly relay: Relay;
  readonly server: Server<SocketData>;
  /** Closes all rooms (`shutdown`) and connections, then the listener. */
  stop: () => Promise<void>;
}

export interface RelayServerOverrides {
  logger?: Logger;
  now?: () => number;
  random?: RelayDeps["random"];
  status?: PlayerStatusSource;
  /** Tests drive `relay.sweep()` themselves. */
  sweepIntervalMs?: number | null;
  /** Replaces the JWKS check of `hello.token`. */
  tokens?: PlayerTokenVerifier;
}

function clientIp(
  req: Request,
  server: Server<SocketData>,
  trustProxy: boolean
): string {
  if (trustProxy) {
    // Behind the Cloudflare proxy (orange cloud) the visitor's address is CF-Connecting-IP.
    const cloudflare = req.headers.get("cf-connecting-ip")?.trim();
    if (cloudflare) {
      return cloudflare;
    }
    const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) {
      return forwarded;
    }
    const real = req.headers.get("x-real-ip")?.trim();
    if (real) {
      return real;
    }
  }
  return server.requestIP(req)?.address ?? "unknown";
}

function transportFor(ws: ServerWebSocket<SocketData>): Transport {
  return {
    ip: ws.data.ip,
    bufferedAmount: () => ws.getBufferedAmount(),
    close: (code, reason) => ws.close(code, reason),
    ping: () => {
      ws.ping();
    },
    sendBinary: (bytes) => {
      ws.sendBinary(bytes);
    },
    sendText: (text) => {
      ws.sendText(text);
    },
  };
}

/** Starts the HTTP + WebSocket listener: `GET /health`, `GET /metrics` (keyed), WS on `/v1`. */
export function startRelayServer(
  config: Config,
  overrides: RelayServerOverrides = {}
): RelayServer {
  const logger = overrides.logger ?? createLogger(config.LOG_LEVEL);
  const now = overrides.now ?? Date.now;
  const metrics = new Metrics(now());
  const status =
    overrides.status ??
    createApiStatusSource({
      apiUrl: config.API_INTERNAL_URL,
      key: config.RELAY_INTERNAL_KEY,
      cacheMs: config.STATUS_CACHE_SECONDS * 1000,
      timeoutMs: config.API_TIMEOUT_MS,
      logger,
      now,
    });
  const tokens =
    overrides.tokens ??
    createJwksVerifier({
      url: config.JWKS_URL,
      cacheMs: config.JWKS_CACHE_SECONDS * 1000,
      cooldownMs: JWKS_REFETCH_COOLDOWN_MS,
      timeoutMs: config.API_TIMEOUT_MS,
      logger,
    });
  const relay = new Relay(config, {
    logger,
    metrics,
    status,
    tokens,
    now,
    random: overrides.random,
  });
  const ipLimiter = new IpConnectionLimiter(
    config.MAX_CONNECTIONS_PER_IP_PER_MINUTE
  );
  let draining = false;
  let openSockets = 0;
  let allClosed: (() => void) | null = null;

  const server = serve<SocketData>({
    port: config.RELAY_PORT,
    hostname: config.RELAY_HOST,
    fetch(req, srv) {
      const url = new URL(req.url);
      const path = url.pathname.replace(TRAILING_SLASHES, "") || "/";
      if (req.method === "GET" && path === "/health") {
        const stats = relay.stats();
        const body: RelayHealthResponse = {
          status: draining ? "draining" : "ok",
          protocolVersion: config.PROTOCOL_VERSION,
          rooms: stats.rooms,
          players: stats.players,
          connections: stats.connections,
          time: new Date(now()).toISOString(),
        };
        return json(body, draining ? 503 : 200);
      }
      if (req.method === "GET" && path === "/metrics") {
        if (!hasRelayKey(req, config.RELAY_INTERNAL_KEY)) {
          return json({ error: "not_found", message: "Route not found" }, 404);
        }
        return json({
          uptimeSeconds: Math.round((now() - metrics.startedAt) / 1000),
          protocolVersion: config.PROTOCOL_VERSION,
          ...relay.stats(),
          ...metrics.rates(),
          connectionsTotal: metrics.connectionsTotal,
          connectionsRejected: metrics.connectionsRejected,
          roomsCreated: metrics.roomsCreated,
          roomsClosed: metrics.roomsClosed,
          controlIn: metrics.controlIn,
          framesIn: metrics.framesIn,
          framesOut: metrics.framesOut,
          bytesIn: metrics.bytesIn,
          bytesOut: metrics.bytesOut,
          framesDropped: metrics.framesDropped,
          errors: metrics.errors,
          slowConsumersClosed: metrics.slowConsumersClosed,
          maxFrameIn: metrics.maxFrameIn,
        });
      }
      if (path.startsWith("/internal/")) {
        return handleInternal(req, path, relay, config, now);
      }
      if (path === RELAY_WS_PATH) {
        if (draining) {
          return json({ error: "draining", message: "Relay restarting" }, 503);
        }
        const ip = clientIp(req, srv, config.TRUST_PROXY);
        if (!ipLimiter.allow(ip, now())) {
          metrics.connectionsRejected += 1;
          logger.info("connection_rejected", { ip, reason: "rate_limited" });
          return json(
            { error: "rate_limited", message: "Too many connections" },
            429
          );
        }
        if (srv.upgrade(req, { data: { client: null, ip } })) {
          return;
        }
        return json(
          { error: "upgrade_required", message: "WebSocket only" },
          426
        );
      }
      return json({ error: "not_found", message: "Route not found" }, 404);
    },
    websocket: {
      // Hard cap; frames between MAX_FRAME_BYTES and this get an error and are dropped, larger
      // ones close the connection (1009) inside Bun.
      maxPayloadLength: config.MAX_FRAME_BYTES * 2,
      // Our own heartbeat (relay.sweep) pings every HEARTBEAT_INTERVAL_SECONDS and times out;
      // Bun's idle timer (with its own pings) is only the backstop. Cloudflare drops WebSockets
      // after 100 s without traffic, the 15 s pings keep both directions busy.
      idleTimeout: Math.min(960, config.HEARTBEAT_TIMEOUT_SECONDS * 4),
      sendPings: true,
      backpressureLimit: config.MAX_BUFFERED_BYTES * 4,
      closeOnBackpressureLimit: true,
      open(ws) {
        openSockets += 1;
        ws.data.client = relay.open(transportFor(ws));
      },
      message(ws, message) {
        const client = ws.data.client;
        if (!client) {
          return;
        }
        if (typeof message === "string") {
          relay.handleText(client, message).catch(() => undefined);
        } else {
          relay.handleBinary(client, message);
        }
      },
      pong(ws) {
        if (ws.data.client) {
          relay.handlePong(ws.data.client);
        }
      },
      close(ws, code, reason) {
        openSockets -= 1;
        if (openSockets === 0) {
          allClosed?.();
        }
        if (ws.data.client) {
          relay.handleClose(ws.data.client, code, reason);
        }
      },
    },
  });

  const sweepMs =
    overrides.sweepIntervalMs === undefined
      ? SWEEP_INTERVAL_MS
      : overrides.sweepIntervalMs;
  const timer =
    sweepMs === null ? null : setInterval(() => relay.sweep(), sweepMs);

  return {
    metrics,
    relay,
    server,
    port: server.port ?? config.RELAY_PORT,
    async stop() {
      draining = true;
      if (timer) {
        clearInterval(timer);
      }
      relay.shutdown();
      if (openSockets > 0) {
        await Promise.race([
          new Promise<void>((resolve) => {
            allClosed = resolve;
          }),
          sleep(CLOSE_GRACE_MS),
        ]);
      }
      // Bun 1.3.14: after server-initiated WebSocket closes, `stop(true)` alone never resolves;
      // `stop(false)` closes the listener first, then `stop(true)` completes. Bounded anyway.
      await Promise.race([
        Promise.all([server.stop(false), server.stop(true)]),
        sleep(1000),
      ]);
    },
  };
}
