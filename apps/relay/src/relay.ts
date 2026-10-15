import {
  type ClientPlatform,
  HOST_PEER_ID,
  MAX_ROOM_PLAYERS,
  RELAY_CLOSE_CODES,
  RELAY_TARGET_ALL,
  type RelayBanPlayerResponse,
  type RelayClientMessage,
  type RelayCloseRoomResponse,
  type RelayErrorCode,
  type RelayKickResponse,
  type RelayRoomSummary,
  type RelayServerMessage,
  RelayTransferMode,
  type RoomClosedReason,
  type RoomPeer,
  type RunEndReason,
} from "@soulwick/contracts";
import {
  isGuildMember,
  type PlayerStatusResult,
  type PlayerStatusSource,
  type PlayerTokenVerifier,
} from "./auth.ts";
import type { Config } from "./config.ts";
import { ConnectionLimiter } from "./limits.ts";
import type { Logger } from "./logger.ts";
import type { Metrics } from "./metrics.ts";
import {
  encodeServerMessage,
  parseClientMessage,
  readFrameHeader,
  stampSender,
} from "./protocol.ts";
import { generateRoomCode, type RandomInt, Room } from "./rooms.ts";

/** The socket as the relay sees it; Bun's ServerWebSocket in production, a fake in tests. */
export interface Transport {
  bufferedAmount: () => number;
  close: (code: number, reason: string) => void;
  readonly ip: string;
  ping: () => void;
  sendBinary: (bytes: Uint8Array) => void;
  sendText: (text: string) => void;
}

export interface RelayDeps {
  logger: Logger;
  metrics: Metrics;
  /** Milliseconds; injectable so tests control expiry, heartbeat and rate limits. */
  now: () => number;
  /** [0, 1) for the simulated packet loss. */
  random?: () => number;
  randomInt?: RandomInt;
  /** Used for the simulated latency. */
  schedule?: (fn: () => void, ms: number) => void;
  status: PlayerStatusSource;
  /** Checks `hello.token` (player JWT against the API's JWKS, P-027). */
  tokens: PlayerTokenVerifier;
}

interface PlayerInfo {
  gameVersion: string;
  name: string | null;
  platform: ClientPlatform;
  playerId: string;
}

/** Error codes that can be triggered per game packet; their notices are throttled to 1/s. */
const THROTTLED_NOTICE_MS = 1000;
/** Rate-limit strikes are forgotten after this much quiet time. */
const STRIKE_RESET_MS = 10_000;
const MAX_CODE_ATTEMPTS = 50;

/** State of one WebSocket connection. */
export class Client {
  readonly id: number;
  readonly transport: Transport;
  readonly openedAt: number;
  readonly limiter: ConnectionLimiter;
  lastSeenAt: number;
  lastMessageAt: number;
  lastPingAt: number;
  player: PlayerInfo | null = null;
  room: Room<Client> | null = null;
  /** 0 while not in a room. */
  peerId = 0;
  /** When the client created or joined its current room (ms); 0 while not in a room. */
  joinedRoomAt = 0;
  /** Set in the constructor: Biome infers the literal `false` from a field initializer. */
  closed: boolean;
  strikes = 0;
  lastLimitNoticeAt = Number.NEGATIVE_INFINITY;
  readonly notices = new Map<string, number>();
  /** Control messages of one connection are handled one after another. */
  queue: Promise<void> = Promise.resolve();
  bytesIn = 0;
  bytesOut = 0;
  /** Largest binary frame this connection sent (bytes), for the close log. Set in the constructor. */
  maxFrameIn: number;

  constructor(id: number, transport: Transport, now: number, config: Config) {
    this.id = id;
    this.transport = transport;
    this.openedAt = now;
    this.closed = false;
    this.maxFrameIn = 0;
    this.lastSeenAt = now;
    this.lastMessageAt = now;
    this.lastPingAt = now;
    this.limiter = new ConnectionLimiter(
      {
        messagesPerSecond: config.MAX_MESSAGES_PER_SECOND,
        bytesPerSecond: config.MAX_BYTES_PER_SECOND,
      },
      now
    );
  }

  get peer(): RoomPeer {
    if (!this.player) {
      throw new Error("peer of an unauthenticated connection");
    }
    return {
      peerId: this.peerId,
      playerId: this.player.playerId,
      name: this.player.name,
      platform: this.player.platform,
    };
  }
}

/**
 * Lobby and packet forwarding (KONZEPT_ONLINE.md §2). Transport-agnostic: `server.ts` feeds it
 * Bun WebSocket events, tests feed it fakes. The relay never reads game packets beyond the header.
 */
export class Relay {
  readonly rooms = new Map<string, Room<Client>>();
  readonly clients = new Set<Client>();
  /** Player id -> room; enforces one room per player across connections. */
  private readonly playerRooms = new Map<string, Room<Client>>();
  private nextClientId = 1;
  private readonly config: Config;
  private readonly deps: RelayDeps;

  constructor(config: Config, deps: RelayDeps) {
    this.config = config;
    this.deps = deps;
  }

  // -------------------------------------------------------------------------------------------
  // Transport events
  // -------------------------------------------------------------------------------------------

  open(transport: Transport): Client {
    const client = new Client(
      this.nextClientId,
      transport,
      this.deps.now(),
      this.config
    );
    this.nextClientId += 1;
    this.clients.add(client);
    this.deps.metrics.connectionsTotal += 1;
    this.deps.logger.info("connection_open", {
      conn: client.id,
      ip: transport.ip,
    });
    return client;
  }

  /** Resolves when this message (and everything queued before it) has been handled. */
  handleText(client: Client, text: string): Promise<void> {
    if (client.closed) {
      return client.queue;
    }
    const now = this.deps.now();
    const size = Buffer.byteLength(text);
    this.received(client, size, now);
    this.deps.metrics.controlIn += 1;
    if (!this.withinLimits(client, size, now)) {
      return client.queue;
    }
    if (size > this.config.MAX_CONTROL_BYTES) {
      this.sendError(
        client,
        "frame_too_large",
        `Control messages are limited to ${this.config.MAX_CONTROL_BYTES} bytes`
      );
      return client.queue;
    }
    const parsed = parseClientMessage(text);
    if (!parsed.ok) {
      if (!client.player && parsed.request !== "hello") {
        this.fail(
          client,
          "hello_required",
          "First message must be hello",
          RELAY_CLOSE_CODES.unauthorized
        );
        return client.queue;
      }
      this.sendError(client, "invalid_message", parsed.reason, parsed.request);
      return client.queue;
    }
    const message = parsed.message;
    if (!client.player && message.type !== "hello") {
      this.fail(
        client,
        "hello_required",
        "First message must be hello",
        RELAY_CLOSE_CODES.unauthorized,
        message.type
      );
      return client.queue;
    }
    client.queue = client.queue
      .then(() => this.dispatch(client, message))
      .catch((err: unknown) => {
        this.deps.logger.error("handler_failed", {
          conn: client.id,
          request: message.type,
          error: err instanceof Error ? err.message : String(err),
        });
        this.sendError(client, "internal", "Internal error", message.type);
      });
    return client.queue;
  }

  handleBinary(client: Client, bytes: Uint8Array): void {
    if (client.closed) {
      return;
    }
    const now = this.deps.now();
    const metrics = this.deps.metrics;
    this.received(client, bytes.length, now);
    metrics.framesIn += 1;
    client.maxFrameIn = Math.max(client.maxFrameIn, bytes.length);
    metrics.maxFrameIn = Math.max(metrics.maxFrameIn, bytes.length);
    if (!client.player) {
      this.fail(
        client,
        "hello_required",
        "First message must be hello",
        RELAY_CLOSE_CODES.unauthorized
      );
      return;
    }
    if (!this.withinLimits(client, bytes.length, now)) {
      metrics.drop("rate_limited");
      return;
    }
    if (bytes.length > this.config.MAX_FRAME_BYTES) {
      metrics.drop("too_large");
      this.notice(
        client,
        "frame_too_large",
        `Frames are limited to ${this.config.MAX_FRAME_BYTES} bytes`,
        now
      );
      return;
    }
    const room = client.room;
    if (!room) {
      // Game packets still in flight after leave/room_closed are normal: drop them silently
      // instead of answering with an error the game cannot attribute to a request.
      metrics.drop("not_in_room");
      return;
    }
    const header = readFrameHeader(bytes);
    if (!header) {
      metrics.drop("invalid");
      this.notice(client, "invalid_message", "Frame shorter than header", now);
      return;
    }
    room.bytesIn += bytes.length;
    const targets = this.resolveTargets(client, room, header.to, now);
    if (!targets) {
      return;
    }
    if (targets.length === 0) {
      metrics.drop("unknown_target");
      return;
    }
    const out = stampSender(bytes, client.peerId);
    for (const target of targets) {
      this.forward(target, out, header.mode);
    }
  }

  handlePong(client: Client): void {
    client.lastSeenAt = this.deps.now();
  }

  /** The socket is gone (or we closed it). Idempotent. */
  handleClose(client: Client, code: number, reason: string): void {
    if (client.closed) {
      return;
    }
    client.closed = true;
    this.clients.delete(client);
    // Captured before leaving: the close log says which room lost whom (host or client).
    const now = this.deps.now();
    const room = client.room?.code;
    const peerId = client.room ? client.peerId : undefined;
    const started = client.room?.started;
    this.leaveRoom(client, "disconnected");
    this.deps.logger.info("connection_close", {
      conn: client.id,
      playerId: client.player?.playerId,
      code,
      reason: reason || undefined,
      room,
      peerId,
      started,
      seconds: Math.round((now - client.openedAt) / 1000),
      // Silence before the close: ~HEARTBEAT_TIMEOUT = dead link, ~0 = active socket cut off.
      silentMs: now - client.lastSeenAt,
      maxFrameIn: client.maxFrameIn || undefined,
      bytesIn: client.bytesIn,
      bytesOut: client.bytesOut,
    });
  }

  // -------------------------------------------------------------------------------------------
  // Timers
  // -------------------------------------------------------------------------------------------

  /** Called about once per second: hello timeout, heartbeat, idle connections, room expiry. */
  sweep(): void {
    const now = this.deps.now();
    const helloMs = this.config.HELLO_TIMEOUT_SECONDS * 1000;
    const heartbeatMs = this.config.HEARTBEAT_INTERVAL_SECONDS * 1000;
    const timeoutMs = this.config.HEARTBEAT_TIMEOUT_SECONDS * 1000;
    const idleMs = this.config.IDLE_MINUTES * 60_000;
    for (const client of [...this.clients]) {
      if (!client.player && now - client.openedAt >= helloMs) {
        this.fail(
          client,
          "hello_required",
          "hello did not arrive in time",
          RELAY_CLOSE_CODES.unauthorized
        );
      } else if (now - client.lastSeenAt >= timeoutMs) {
        this.disconnect(client, RELAY_CLOSE_CODES.timeout, "heartbeat timeout");
      } else if (!client.room && now - client.lastMessageAt >= idleMs) {
        this.disconnect(client, RELAY_CLOSE_CODES.timeout, "idle");
      } else if (now - client.lastPingAt >= heartbeatMs) {
        client.lastPingAt = now;
        client.transport.ping();
      }
    }
    for (const room of [...this.rooms.values()]) {
      if (!room.started && room.expiresAt !== null && now >= room.expiresAt) {
        this.closeRoom(room, "expired");
      } else {
        room.sampleRates(now);
      }
    }
    this.deps.metrics.sample(now);
  }

  /** Closes every room (`shutdown`) and every connection (1001). */
  shutdown(): void {
    this.deps.logger.info("shutdown", this.stats());
    for (const room of [...this.rooms.values()]) {
      this.closeRoom(room, "shutdown");
    }
    for (const client of [...this.clients]) {
      this.disconnect(
        client,
        RELAY_CLOSE_CODES.shutdown,
        "relay shutting down"
      );
    }
  }

  stats() {
    let players = 0;
    let playersInRooms = 0;
    for (const client of this.clients) {
      if (client.player) {
        players += 1;
      }
      if (client.room) {
        playersInRooms += 1;
      }
    }
    return {
      connections: this.clients.size,
      players,
      playersInRooms,
      rooms: this.rooms.size,
      roomsStarted: [...this.rooms.values()].filter((r) => r.started).length,
    };
  }

  // -------------------------------------------------------------------------------------------
  // Moderation (internal HTTP endpoints, called by the API for the admin panel)
  // -------------------------------------------------------------------------------------------

  /** Every open room without tokens or addresses, oldest first. */
  listRooms(): RelayRoomSummary[] {
    const now = this.deps.now();
    return [...this.rooms.values()]
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((room) => {
        const players = room.others().map((member) => ({
          ...member.peer,
          host: member.peerId === HOST_PEER_ID,
          inRoomSeconds: Math.max(
            0,
            Math.floor((now - member.joinedRoomAt) / 1000)
          ),
        }));
        return {
          code: room.code,
          mode: room.mode,
          guildId: room.guildId,
          started: room.started,
          gameVersion: room.gameVersion,
          playerCount: players.length,
          maxPlayers: room.maxPlayers,
          players,
          createdAt: new Date(room.createdAt).toISOString(),
          ageSeconds: Math.max(0, Math.floor((now - room.createdAt) / 1000)),
          expiresAt:
            room.expiresAt === null
              ? null
              : new Date(room.expiresAt).toISOString(),
          runsStarted: room.runsStarted,
          bytesInPerSecond: Math.max(0, room.rates.bytesInPerSecond),
          bytesOutPerSecond: Math.max(0, room.rates.bytesOutPerSecond),
        };
      });
  }

  /** Closes a room for everybody (`room_closed` with `closed_by_admin`). Null = no such room. */
  adminCloseRoom(code: string, reason: string): RelayCloseRoomResponse | null {
    const room = this.rooms.get(code);
    if (!room) {
      return null;
    }
    const playerIds = room
      .others()
      .flatMap((m) => (m.player ? [m.player.playerId] : []));
    const started = room.started;
    this.deps.logger.info("admin_room_close", {
      room: code,
      players: playerIds.length,
      reason,
    });
    this.closeRoom(room, "closed_by_admin");
    return { code, playerIds, started };
  }

  /**
   * Kicks a player like the host would; kicking the host closes the room (host `kicked`, the
   * others `host_left`). The player cannot join this room again.
   */
  adminKick(
    code: string,
    playerId: string,
    reason: string
  ): RelayKickResponse | "room_not_found" | "player_not_in_room" {
    const room = this.rooms.get(code);
    if (!room) {
      return "room_not_found";
    }
    const target = room.others().find((m) => m.player?.playerId === playerId);
    if (!target) {
      return "player_not_in_room";
    }
    const peerId = target.peerId;
    room.kicked.add(playerId);
    this.deps.logger.info("admin_kick", {
      room: code,
      peerId,
      playerId,
      reason,
    });
    if (peerId !== HOST_PEER_ID) {
      this.removeMember(room, target, "kicked");
      return { code, playerId, peerId, roomClosed: false };
    }
    this.detach(target);
    this.send(target, { type: "room_closed", code, reason: "kicked" });
    this.closeRoom(room, "host_left", undefined, "admin_kick_host");
    return { code, playerId, peerId, roomClosed: true };
  }

  /**
   * The API banned this player: forget the cached status and close every connection of the
   * player with `banned` (4003). Rooms see the usual disconnect (`peer_left` / `host_left`).
   */
  banPlayer(playerId: string): RelayBanPlayerResponse {
    this.deps.status.forget?.(playerId);
    const rooms = new Set<string>();
    let connections = 0;
    for (const client of [...this.clients]) {
      if (client.player?.playerId !== playerId) {
        continue;
      }
      connections += 1;
      if (client.room) {
        rooms.add(client.room.code);
      }
      this.fail(client, "banned", "Player is banned", RELAY_CLOSE_CODES.banned);
    }
    if (connections > 0) {
      this.deps.logger.info("admin_ban_disconnect", {
        playerId,
        connections,
      });
    }
    return { playerId, connections, rooms: [...rooms] };
  }

  // -------------------------------------------------------------------------------------------
  // Control messages
  // -------------------------------------------------------------------------------------------

  private dispatch(client: Client, message: RelayClientMessage) {
    if (client.closed) {
      return;
    }
    switch (message.type) {
      case "hello":
        return this.hello(client, message);
      case "create":
        return this.create(client, message);
      case "join":
        return this.join(client, message);
      case "leave":
        return this.leave(client);
      case "start":
        return this.start(client);
      case "kick":
        return this.kick(client, message.peerId);
      case "end_run":
        return this.endRun(client, message.reason);
      case "ping":
        this.send(client, { type: "pong", t: message.t });
        return;
      default:
        return;
    }
  }

  private async hello(
    client: Client,
    msg: Extract<RelayClientMessage, { type: "hello" }>
  ) {
    if (client.player) {
      this.sendError(client, "invalid_message", "Already greeted", "hello");
      return;
    }
    if (msg.protocolVersion !== this.config.PROTOCOL_VERSION) {
      this.fail(
        client,
        "version_mismatch",
        `Relay speaks protocol ${this.config.PROTOCOL_VERSION}, client ${msg.protocolVersion}`,
        RELAY_CLOSE_CODES.versionMismatch,
        "hello"
      );
      return;
    }
    const playerId = await this.deps.tokens.verify(msg.token);
    if (client.closed) {
      return;
    }
    if (!playerId) {
      this.fail(
        client,
        "unauthorized",
        "Invalid or expired token",
        RELAY_CLOSE_CODES.unauthorized,
        "hello"
      );
      return;
    }
    const result = await this.deps.status.get(playerId);
    if (client.closed || this.rejectPlayer(client, result, "hello")) {
      return;
    }
    client.player = {
      playerId,
      name: result.kind === "ok" ? result.status.name : null,
      platform: msg.platform,
      gameVersion: msg.gameVersion,
    };
    this.deps.logger.info("hello", {
      conn: client.id,
      playerId,
      platform: msg.platform,
      gameVersion: msg.gameVersion,
      api: result.kind,
    });
    this.send(client, {
      type: "welcome",
      playerId,
      name: client.player.name,
      protocolVersion: this.config.PROTOCOL_VERSION,
      maxFrameBytes: this.config.MAX_FRAME_BYTES,
      maxPlayers: MAX_ROOM_PLAYERS,
      clientRouting: this.config.CLIENT_ROUTING,
    });
  }

  private async create(
    client: Client,
    msg: Extract<RelayClientMessage, { type: "create" }>
  ) {
    if (this.alreadyInRoom(client, "create")) {
      return;
    }
    const guildId = msg.mode === "guild" ? (msg.guildId ?? null) : null;
    const result = await this.statusFor(client, guildId);
    if (
      !result ||
      this.rejectPlayer(client, result, "create") ||
      this.alreadyInRoom(client, "create")
    ) {
      return;
    }
    if (guildId && !this.checkGuild(client, result, guildId, "create")) {
      return;
    }
    const player = client.player as PlayerInfo;
    const code = this.uniqueCode();
    const now = this.deps.now();
    const room = new Room<Client>({
      code,
      mode: msg.mode,
      guildId,
      gameVersion: player.gameVersion,
      maxPlayers: MAX_ROOM_PLAYERS,
      now,
      ttlMs: this.config.ROOM_IDLE_MINUTES * 60_000,
    });
    this.rooms.set(code, room);
    this.attach(client, room, HOST_PEER_ID);
    this.deps.metrics.roomsCreated += 1;
    this.deps.logger.info("room_created", {
      room: code,
      mode: msg.mode,
      guildId: guildId ?? undefined,
      playerId: player.playerId,
      gameVersion: player.gameVersion,
    });
    this.send(client, {
      type: "created",
      code,
      peerId: HOST_PEER_ID,
      room: room.info(),
    });
    this.broadcastState(room);
  }

  private async join(
    client: Client,
    msg: Extract<RelayClientMessage, { type: "join" }>
  ) {
    if (this.alreadyInRoom(client, "join")) {
      return;
    }
    const target = this.joinable(client, msg.code);
    if (!target) {
      return;
    }
    const result = await this.statusFor(client, target.guildId);
    if (
      !result ||
      this.rejectPlayer(client, result, "join") ||
      this.alreadyInRoom(client, "join")
    ) {
      return;
    }
    // The room may have changed while the API was asked.
    const room = this.joinable(client, msg.code);
    if (!room) {
      return;
    }
    if (
      room.guildId &&
      !this.checkGuild(client, result, room.guildId, "join")
    ) {
      return;
    }
    const peerId = room.allocatePeerId();
    this.attach(client, room, peerId);
    this.deps.logger.info("room_joined", {
      room: room.code,
      peerId,
      playerId: client.player?.playerId,
    });
    this.send(client, {
      type: "joined",
      code: room.code,
      peerId,
      room: room.info(),
    });
    for (const other of room.others(peerId)) {
      this.send(other, { type: "peer_joined", peer: client.peer });
    }
    this.broadcastState(room);
  }

  private leave(client: Client) {
    if (!client.room) {
      this.sendError(client, "not_in_room", "Not in a room", "leave");
      return;
    }
    this.leaveRoom(client, "left");
  }

  private start(client: Client) {
    const room = this.hostRoom(client, "start");
    if (!room) {
      return;
    }
    if (room.started) {
      this.sendError(client, "room_started", "Room already started", "start");
      return;
    }
    room.startRun();
    this.deps.logger.info("room_started", {
      room: room.code,
      players: room.members.size,
    });
    for (const member of room.others()) {
      this.send(member, { type: "started" });
    }
    this.broadcastState(room);
  }

  /** The run is over: back to the lobby, joins allowed again, `start` works again. */
  private endRun(client: Client, reason: RunEndReason | undefined) {
    const room = this.hostRoom(client, "end_run");
    if (!room) {
      return;
    }
    if (!room.started) {
      this.sendError(
        client,
        "room_not_started",
        "No run in progress",
        "end_run"
      );
      return;
    }
    const now = this.deps.now();
    room.endRun(now, this.config.ROOM_IDLE_MINUTES * 60_000);
    this.deps.logger.info("run_ended", {
      room: room.code,
      reason,
      players: room.members.size,
    });
    for (const member of room.others()) {
      this.send(member, { type: "run_ended", reason: reason ?? null });
    }
    this.broadcastState(room);
  }

  private kick(client: Client, peerId: number) {
    const room = this.hostRoom(client, "kick");
    if (!room) {
      return;
    }
    const target =
      peerId === HOST_PEER_ID ? undefined : room.members.get(peerId);
    if (!target) {
      this.sendError(client, "peer_not_found", `No peer ${peerId}`, "kick");
      return;
    }
    if (target.player) {
      room.kicked.add(target.player.playerId);
    }
    this.removeMember(room, target, "kicked");
  }

  // -------------------------------------------------------------------------------------------
  // Rooms
  // -------------------------------------------------------------------------------------------

  private attach(client: Client, room: Room<Client>, peerId: number) {
    client.room = room;
    client.peerId = peerId;
    client.joinedRoomAt = this.deps.now();
    room.members.set(peerId, client);
    if (client.player) {
      this.playerRooms.set(client.player.playerId, room);
    }
  }

  private detach(client: Client) {
    const room = client.room;
    if (room) {
      room.members.delete(client.peerId);
    }
    if (
      client.player &&
      this.playerRooms.get(client.player.playerId) === room
    ) {
      this.playerRooms.delete(client.player.playerId);
    }
    client.room = null;
    client.peerId = 0;
    client.joinedRoomAt = 0;
  }

  private leaveRoom(client: Client, reason: "left" | "disconnected") {
    const room = client.room;
    if (!room) {
      return;
    }
    if (client.peerId === HOST_PEER_ID) {
      this.closeRoom(room, "host_left", client);
    } else {
      this.removeMember(room, client, reason);
    }
  }

  /** A client leaves, disconnects or is kicked; the run goes on for the others (D-085). */
  private removeMember(
    room: Room<Client>,
    client: Client,
    reason: "left" | "disconnected" | "kicked"
  ) {
    const peerId = client.peerId;
    this.detach(client);
    if (reason !== "disconnected") {
      this.send(client, {
        type: "room_closed",
        code: room.code,
        reason: reason === "kicked" ? "kicked" : "left",
      });
    }
    this.deps.logger.info("peer_left", {
      room: room.code,
      peerId,
      playerId: client.player?.playerId,
      reason,
    });
    for (const other of room.others()) {
      this.send(other, { type: "peer_left", peerId, reason });
    }
    this.broadcastState(room);
  }

  /**
   * Everybody out; `initiator` (the host leaving on purpose) gets `left` instead of the reason.
   * `cause` replaces the reason in metrics and logs (admin actions send an existing reason).
   */
  private closeRoom(
    room: Room<Client>,
    reason: RoomClosedReason,
    initiator?: Client,
    cause: string = reason
  ) {
    const players = room.members.size;
    for (const member of room.others()) {
      this.detach(member);
      this.send(member, {
        type: "room_closed",
        code: room.code,
        reason: member === initiator ? "left" : reason,
      });
    }
    this.rooms.delete(room.code);
    this.deps.metrics.roomClosed(cause);
    this.deps.logger.info("room_closed", {
      room: room.code,
      reason: cause,
      players,
      started: room.started,
      seconds: Math.round((this.deps.now() - room.createdAt) / 1000),
    });
  }

  private broadcastState(room: Room<Client>) {
    const state: RelayServerMessage = { type: "room_state", room: room.info() };
    for (const member of room.others()) {
      this.send(member, state);
    }
  }

  private uniqueCode(): string {
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i += 1) {
      const code = generateRoomCode(this.deps.randomInt);
      if (!this.rooms.has(code)) {
        return code;
      }
    }
    throw new Error("could not find a free room code");
  }

  /** The room if `client` may join it right now; otherwise sends the error and returns null. */
  private joinable(client: Client, code: string): Room<Client> | null {
    const room = this.rooms.get(code);
    const player = client.player as PlayerInfo;
    let error: [RelayErrorCode, string] | null = null;
    if (!room) {
      error = ["room_not_found", `No open room ${code}`];
    } else if (room.kicked.has(player.playerId)) {
      error = ["kicked", "The host removed you from this room"];
    } else if (room.started) {
      error = ["room_started", "A run is in progress; join after it ended"];
    } else if (room.isFull) {
      error = ["room_full", `Room is full (${room.maxPlayers} players)`];
    } else if (room.gameVersion !== player.gameVersion) {
      error = [
        "version_mismatch",
        `Room runs game version ${room.gameVersion}, you run ${player.gameVersion}`,
      ];
    }
    if (error) {
      this.sendError(client, error[0], error[1], "join");
      return null;
    }
    return room ?? null;
  }

  private hostRoom(client: Client, request: string): Room<Client> | null {
    if (!client.room) {
      this.sendError(client, "not_in_room", "Not in a room", request);
      return null;
    }
    if (client.peerId !== HOST_PEER_ID) {
      this.sendError(client, "not_host", "Only the host may do this", request);
      return null;
    }
    return client.room;
  }

  private alreadyInRoom(client: Client, request: string): boolean {
    const playerId = client.player?.playerId;
    if (client.room || (playerId && this.playerRooms.has(playerId))) {
      this.sendError(
        client,
        "already_in_room",
        "Leave your current room first",
        request
      );
      return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------------------------
  // Player checks
  // -------------------------------------------------------------------------------------------

  /** Fresh (or cached) API status; null if the connection closed meanwhile. */
  private async statusOf(client: Client): Promise<PlayerStatusResult | null> {
    const playerId = client.player?.playerId;
    if (!playerId) {
      return null;
    }
    const result = await this.deps.status.get(playerId);
    return client.closed ? null : result;
  }

  /**
   * Like `statusOf`; for a guild room a cached "not a member" is asked again once, because the
   * player may have joined the guild after the answer was cached (D-147, P-031). Positive answers
   * stay cached (STATUS_CACHE_SECONDS).
   */
  private async statusFor(
    client: Client,
    guildId: string | null
  ): Promise<PlayerStatusResult | null> {
    const result = await this.statusOf(client);
    if (
      !(result && guildId && result.kind === "ok" && this.deps.status.forget) ||
      isGuildMember(result.status, guildId)
    ) {
      return result;
    }
    this.deps.status.forget(result.status.playerId);
    return await this.statusOf(client);
  }

  /** Closes the connection for deleted or banned players. True = rejected. */
  private rejectPlayer(
    client: Client,
    result: PlayerStatusResult,
    request: string
  ): boolean {
    if (result.kind === "not_found") {
      this.fail(
        client,
        "unauthorized",
        "Player does not exist",
        RELAY_CLOSE_CODES.unauthorized,
        request
      );
      return true;
    }
    if (result.kind === "ok" && result.status.banned) {
      this.fail(
        client,
        "banned",
        "Player is banned",
        RELAY_CLOSE_CODES.banned,
        request
      );
      return true;
    }
    return false;
  }

  /** Guild rooms need the API: unreachable = `api_unavailable`. True = member. */
  private checkGuild(
    client: Client,
    result: PlayerStatusResult,
    guildId: string,
    request: string
  ): boolean {
    if (result.kind !== "ok") {
      this.sendError(
        client,
        "api_unavailable",
        "Guild membership cannot be checked right now",
        request
      );
      return false;
    }
    if (!isGuildMember(result.status, guildId)) {
      this.sendError(
        client,
        "not_guild_member",
        "Not a member of this guild",
        request
      );
      return false;
    }
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // Packets
  // -------------------------------------------------------------------------------------------

  /**
   * Receivers of a packet: `to` > 0 one peer, 0 everybody else, < 0 everybody else except `-to`.
   * Null = rejected by the routing rule (a notice was sent). Empty = target not (or no longer) here.
   */
  private resolveTargets(
    client: Client,
    room: Room<Client>,
    to: number,
    now: number
  ): Client[] | null {
    const fromHost = client.peerId === HOST_PEER_ID;
    if (
      !fromHost &&
      this.config.CLIENT_ROUTING === "host_only" &&
      to !== HOST_PEER_ID
    ) {
      this.deps.metrics.drop("invalid_target");
      this.notice(
        client,
        "invalid_target",
        "Clients may only send to the host (to = 1)",
        now
      );
      return null;
    }
    if (to > 0) {
      const target = room.members.get(to);
      return target && target !== client ? [target] : [];
    }
    if (to === RELAY_TARGET_ALL) {
      return room.others(client.peerId);
    }
    return room.others(client.peerId, -to);
  }

  private forward(target: Client, bytes: Uint8Array, mode: number) {
    const unreliable = mode !== RelayTransferMode.reliable;
    const random = this.deps.random ?? Math.random;
    if (
      unreliable &&
      this.config.RELAY_SIM_LOSS > 0 &&
      random() * 100 < this.config.RELAY_SIM_LOSS
    ) {
      this.deps.metrics.drop("sim_loss");
      return;
    }
    const latency = this.config.RELAY_SIM_LATENCY_MS;
    if (latency > 0) {
      const schedule = this.deps.schedule ?? setTimeout;
      schedule(() => this.deliver(target, bytes, unreliable), latency);
      return;
    }
    this.deliver(target, bytes, unreliable);
  }

  /** Backpressure: unreliable packets are dropped, a reliable one closes the slow receiver. */
  private deliver(target: Client, bytes: Uint8Array, unreliable: boolean) {
    if (target.closed) {
      return;
    }
    if (target.transport.bufferedAmount() > this.config.MAX_BUFFERED_BYTES) {
      if (unreliable) {
        this.deps.metrics.drop("backpressure");
        return;
      }
      this.deps.metrics.slowConsumersClosed += 1;
      this.deps.logger.info("slow_consumer", {
        conn: target.id,
        playerId: target.player?.playerId,
        room: target.room?.code,
        buffered: target.transport.bufferedAmount(),
        frameBytes: bytes.length,
      });
      this.disconnect(target, RELAY_CLOSE_CODES.slowConsumer, "slow consumer");
      return;
    }
    target.transport.sendBinary(bytes);
    target.bytesOut += bytes.length;
    if (target.room) {
      target.room.bytesOut += bytes.length;
    }
    this.deps.metrics.framesOut += 1;
    this.deps.metrics.bytesOut += bytes.length;
  }

  // -------------------------------------------------------------------------------------------
  // Sending, errors, limits
  // -------------------------------------------------------------------------------------------

  private received(client: Client, size: number, now: number) {
    client.lastSeenAt = now;
    client.lastMessageAt = now;
    client.bytesIn += size;
    this.deps.metrics.bytesIn += size;
  }

  private send(client: Client, message: RelayServerMessage) {
    if (client.closed) {
      return;
    }
    const text = encodeServerMessage(message);
    client.transport.sendText(text);
    const size = Buffer.byteLength(text);
    client.bytesOut += size;
    this.deps.metrics.bytesOut += size;
  }

  private sendError(
    client: Client,
    code: RelayErrorCode,
    message: string,
    request?: string
  ) {
    this.deps.metrics.error(code);
    this.deps.logger.info("client_error", {
      conn: client.id,
      playerId: client.player?.playerId,
      room: client.room?.code,
      code,
      request,
    });
    this.send(client, { type: "error", code, message, request });
  }

  /** Error notice for per-packet problems, at most once per second and code. */
  private notice(
    client: Client,
    code: RelayErrorCode,
    message: string,
    now: number
  ) {
    const last = client.notices.get(code) ?? Number.NEGATIVE_INFINITY;
    if (now - last < THROTTLED_NOTICE_MS) {
      return;
    }
    client.notices.set(code, now);
    this.sendError(client, code, message);
  }

  /** Error, then close. */
  private fail(
    client: Client,
    code: RelayErrorCode,
    message: string,
    closeCode: number,
    request?: string
  ) {
    this.sendError(client, code, message, request);
    this.disconnect(client, closeCode, code);
  }

  private disconnect(client: Client, code: number, reason: string) {
    if (client.closed) {
      return;
    }
    client.transport.close(code, reason);
    this.handleClose(client, code, reason);
  }

  /** False = over the limit (message dropped). Repeated violations close the connection. */
  private withinLimits(client: Client, size: number, now: number): boolean {
    if (client.limiter.allow(size, now)) {
      return true;
    }
    if (now - client.lastLimitNoticeAt < THROTTLED_NOTICE_MS) {
      return false;
    }
    if (now - client.lastLimitNoticeAt > STRIKE_RESET_MS) {
      client.strikes = 0;
    }
    client.lastLimitNoticeAt = now;
    client.strikes += 1;
    this.deps.logger.info("rate_limited", {
      conn: client.id,
      playerId: client.player?.playerId,
      strikes: client.strikes,
    });
    if (client.strikes >= this.config.RATE_LIMIT_STRIKES) {
      this.fail(
        client,
        "rate_limited",
        "Too many messages; connection closed",
        RELAY_CLOSE_CODES.rateLimited
      );
    } else {
      this.sendError(client, "rate_limited", "Too many messages; dropped");
    }
    return false;
  }
}
