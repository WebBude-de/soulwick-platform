import { z } from "zod";
import { IsoDateTime, Uuid } from "./common.ts";

/**
 * Relay contract (apps/relay, KONZEPT_ONLINE.md §2, D-119, P-016).
 *
 * Transport: one WebSocket per game instance to `wss://<relay>/v1` (local `ws://localhost:8790/v1`).
 * - Control messages are JSON **text** frames, discriminated by `type` (schemas below).
 * - Game packets are **binary** frames: a fixed 10-byte little-endian header plus the untouched
 *   Godot packet (see RELAY_FRAME_*). The relay never reads the payload.
 *
 * The first message must be `hello` (within HELLO_TIMEOUT_SECONDS). The token never goes into the
 * URL, so it does not end up in access logs.
 */

/**
 * Network protocol version of the game (RPCs, packets, replicated properties). The relay only
 * admits clients whose `hello.protocolVersion` equals its configured `PROTOCOL_VERSION`; this
 * constant is the default. Bump it in the game and in the relay environment together.
 */
export const PROTOCOL_VERSION = 1;

/** Path of the WebSocket endpoint; the `v1` stands for this wire format (header + messages). */
export const RELAY_WS_PATH = "/v1";

/** Players per room including the host (D-084). */
export const MAX_ROOM_PLAYERS = 4;
/** Peer id of the host, as Godot's MultiplayerPeer expects. Clients get 2, 3, ... (never reused). */
export const HOST_PEER_ID = 1;

/** No 0/O, 1/I/L: codes are read aloud and typed from Discord. Same alphabet as guild invites. */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 6;
/** TESTWERT: seconds after connecting within which `hello` has to arrive. */
export const HELLO_TIMEOUT_SECONDS = 5;

/** Header used by the API's internal relay endpoint. */
export const RELAY_KEY_HEADER = "x-relay-key";

/** Accepts lower case and surrounding spaces from user input; normalised to upper case. */
export const RoomCode = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .pipe(
    z
      .string()
      .length(ROOM_CODE_LENGTH)
      .regex(/^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]+$/, "invalid room code")
  );
export type RoomCode = z.infer<typeof RoomCode>;

export const RoomMode = z.enum(["quick", "guild"]);
export type RoomMode = z.infer<typeof RoomMode>;

export const ClientPlatform = z.enum([
  "windows",
  "linux",
  "macos",
  "android",
  "ios",
]);
export type ClientPlatform = z.infer<typeof ClientPlatform>;

/** Version string of the game build, e.g. "0.9.0" or "1.0.0-beta.2". */
export const GameVersion = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[0-9A-Za-z.+-]+$/, "invalid game version");

export const RelayPeerId = z.number().int().min(1).max(2_147_483_647);

/**
 * Who may a client address? `host_only` (default): clients may only send to the host (to = 1);
 * Godot's SceneMultiplayer forwards client-to-client RPCs through the host (`server_relay`).
 * `any`: clients may also target other peers or broadcast. The host may always target anyone.
 */
export const ClientRouting = z.enum(["host_only", "any"]);
export type ClientRouting = z.infer<typeof ClientRouting>;

// ---------------------------------------------------------------------------------------------
// Error codes and close codes
// ---------------------------------------------------------------------------------------------

/**
 * Stable machine-readable codes of `error` messages. The game maps them to translation keys.
 * New codes may be added; existing ones are never renamed.
 */
export const RelayErrorCode = z.enum([
  /** Token missing, invalid, expired, or the player no longer exists. Connection closes (4001). */
  "unauthorized",
  /** First message was not `hello`, or `hello` did not arrive in time. Connection closes (4001). */
  "hello_required",
  /** Player is banned. Connection closes (4003). */
  "banned",
  /** `hello.protocolVersion` differs from the relay (closes, 4006), or `join` with another game version. */
  "version_mismatch",
  /** Text frame is not valid JSON or does not match a control message schema. */
  "invalid_message",
  "room_not_found",
  "room_full",
  /** The run is in progress; nobody can join until the host sends `end_run` (D-085). */
  "room_started",
  "not_guild_member",
  /** `create`/`join` while this player (on any connection) is already in a room. */
  "already_in_room",
  /** `join` of a room whose host kicked this player before. */
  "kicked",
  /** `leave`/`start`/`kick`/`end_run` or a game packet without being in a room. */
  "not_in_room",
  /** `start`/`kick`/`end_run` by a client. */
  "not_host",
  /** `kick` target is not in the room (or is the host). */
  "peer_not_found",
  /** Game packet to a target the sender may not address (client routing `host_only`). */
  "invalid_target",
  /** The API could not be asked (guild rooms need it). Quick rooms keep working. */
  "api_unavailable",
  /** Too many messages or bytes per second; the message was dropped. Repeated: closes (4008). */
  "rate_limited",
  /** Message larger than `maxFrameBytes`; dropped. */
  "frame_too_large",
  "internal",
  /** `end_run` while no run is in progress (room still in the lobby). */
  "room_not_started",
]);
export type RelayErrorCode = z.infer<typeof RelayErrorCode>;

/** WebSocket close codes the relay uses (application range 4000-4999, plus 1001 on shutdown). */
export const RELAY_CLOSE_CODES = {
  /** Relay shuts down (restart/deploy): treat like the host leaving. */
  shutdown: 1001,
  /** No pong / no message within the heartbeat timeout, or idle without a room. */
  timeout: 4000,
  unauthorized: 4001,
  banned: 4003,
  versionMismatch: 4006,
  rateLimited: 4008,
  /** The connection could not keep up with its incoming packets (backpressure). */
  slowConsumer: 4010,
} as const;

// ---------------------------------------------------------------------------------------------
// Room snapshots
// ---------------------------------------------------------------------------------------------

export const RoomPeer = z.object({
  peerId: RelayPeerId,
  playerId: Uuid,
  /** From the API; null when the API was not reachable at `hello`. */
  name: z.string().nullable(),
  platform: ClientPlatform,
});
export type RoomPeer = z.infer<typeof RoomPeer>;

export const RoomInfo = z.object({
  code: RoomCode,
  mode: RoomMode,
  /** Set for mode `guild`. */
  guildId: Uuid.nullable(),
  hostPeerId: z.literal(HOST_PEER_ID),
  /** True while a run is in progress; false in the lobby (before `start`, after `end_run`). */
  started: z.boolean(),
  maxPlayers: z.number().int(),
  /** Everybody in the room runs this game version (and the relay's protocol version). */
  gameVersion: GameVersion,
  /** Host first, then clients by peer id. */
  peers: z.array(RoomPeer),
  /** When a room in the lobby closes with `expired`; null while a run is in progress. */
  expiresAt: IsoDateTime.nullable(),
});
export type RoomInfo = z.infer<typeof RoomInfo>;

// ---------------------------------------------------------------------------------------------
// Control messages: game -> relay
// ---------------------------------------------------------------------------------------------

export const HelloMessage = z.object({
  type: z.literal("hello"),
  /**
   * Player JWT from `GET /auth/token` of the API (P-027; EdDSA, `aud` PLAYER_JWT_AUDIENCE, about
   * 15 minutes). The relay checks it against the API's JWKS only here; a connection stays open
   * when the JWT expires later. Not the session token of the login.
   */
  token: z.string().min(1).max(4096),
  protocolVersion: z.number().int().min(0),
  gameVersion: GameVersion,
  platform: ClientPlatform,
});

export const CreateMessage = z
  .object({
    type: z.literal("create"),
    mode: RoomMode,
    /** Required for mode `guild`; the relay checks membership via the API. */
    guildId: Uuid.optional(),
  })
  .refine((m) => m.mode !== "guild" || m.guildId !== undefined, {
    message: "guildId is required for mode guild",
    path: ["guildId"],
  });

export const JoinMessage = z.object({
  type: z.literal("join"),
  code: RoomCode,
});

export const LeaveMessage = z.object({ type: z.literal("leave") });
export const StartMessage = z.object({ type: z.literal("start") });

/** Why the host ended a run: exit portal reached, everybody dead, or given up. */
export const RunEndReason = z.enum(["portal", "wiped", "abandoned"]);
export type RunEndReason = z.infer<typeof RunEndReason>;

/**
 * Host only: the run is over, the group is back in the (shared) village. The room returns to the
 * lobby state: `started` false, the lobby expiry restarts, joins are allowed again (kicked players
 * stay out) and `start` works again.
 */
export const EndRunMessage = z.object({
  type: z.literal("end_run"),
  reason: RunEndReason.optional(),
});

export const KickMessage = z.object({
  type: z.literal("kick"),
  peerId: RelayPeerId,
});

/** Application-level ping for round-trip measurement; the relay answers `pong` with the same `t`. */
export const RelayPingMessage = z.object({
  type: z.literal("ping"),
  t: z.number().optional(),
});

export const RelayClientMessage = z.discriminatedUnion("type", [
  HelloMessage,
  CreateMessage,
  JoinMessage,
  LeaveMessage,
  StartMessage,
  KickMessage,
  RelayPingMessage,
  EndRunMessage,
]);
export type RelayClientMessage = z.infer<typeof RelayClientMessage>;
export type RelayClientMessageType = RelayClientMessage["type"];

// ---------------------------------------------------------------------------------------------
// Control messages: relay -> game
// ---------------------------------------------------------------------------------------------

export const WelcomeMessage = z.object({
  type: z.literal("welcome"),
  playerId: Uuid,
  /** From the API; null when the API was not reachable. */
  name: z.string().nullable(),
  protocolVersion: z.number().int(),
  /** Largest accepted WebSocket message (header + payload) in bytes. */
  maxFrameBytes: z.number().int(),
  maxPlayers: z.number().int(),
  clientRouting: ClientRouting,
});

export const CreatedMessage = z.object({
  type: z.literal("created"),
  code: RoomCode,
  peerId: z.literal(HOST_PEER_ID),
  room: RoomInfo,
});

export const JoinedMessage = z.object({
  type: z.literal("joined"),
  code: RoomCode,
  /** Own peer id, >= 2. */
  peerId: RelayPeerId,
  room: RoomInfo,
});

/** Full snapshot, sent to every member after each change (join, leave, kick, start, end_run). */
export const RoomStateMessage = z.object({
  type: z.literal("room_state"),
  room: RoomInfo,
});

export const PeerJoinedMessage = z.object({
  type: z.literal("peer_joined"),
  peer: RoomPeer,
});

export const PeerLeftReason = z.enum(["left", "kicked", "disconnected"]);
export type PeerLeftReason = z.infer<typeof PeerLeftReason>;

export const PeerLeftMessage = z.object({
  type: z.literal("peer_left"),
  peerId: RelayPeerId,
  reason: PeerLeftReason,
});

export const StartedMessage = z.object({ type: z.literal("started") });

/** To every member (host included) after `end_run`; `reason` is null if the host gave none. */
export const RunEndedMessage = z.object({
  type: z.literal("run_ended"),
  reason: RunEndReason.nullable(),
});

export const RoomClosedReason = z.enum([
  /** Confirmation of the receiver's own `leave` (host or client). */
  "left",
  /** The host left or disconnected; the run ends like a death (D-085). */
  "host_left",
  /** Not started within the lobby time limit (after `create` or `end_run`). */
  "expired",
  /** The receiver was kicked by the host (or by a moderator via the admin panel). */
  "kicked",
  /** The relay shuts down. */
  "shutdown",
  /**
   * A moderator closed the whole room via the admin panel (P-024). Added later without a protocol
   * bump; the game maps it to LOBBY_ERR_CLOSED_BY_ADMIN, older builds should treat unknown reasons
   * like `host_left`.
   */
  "closed_by_admin",
]);
export type RoomClosedReason = z.infer<typeof RoomClosedReason>;

/** The receiver is no longer in the room; the connection stays open for `create`/`join`. */
export const RoomClosedMessage = z.object({
  type: z.literal("room_closed"),
  code: RoomCode,
  reason: RoomClosedReason,
});

export const RelayErrorMessage = z.object({
  type: z.literal("error"),
  code: RelayErrorCode,
  message: z.string(),
  /** `type` of the control message that failed; absent for game packets and timeouts. */
  request: z.string().optional(),
});

export const RelayPongMessage = z.object({
  type: z.literal("pong"),
  t: z.number().optional(),
});

export const RelayServerMessage = z.discriminatedUnion("type", [
  WelcomeMessage,
  CreatedMessage,
  JoinedMessage,
  RoomStateMessage,
  PeerJoinedMessage,
  PeerLeftMessage,
  StartedMessage,
  RunEndedMessage,
  RoomClosedMessage,
  RelayErrorMessage,
  RelayPongMessage,
]);
export type RelayServerMessage = z.infer<typeof RelayServerMessage>;

// ---------------------------------------------------------------------------------------------
// Binary game packets
// ---------------------------------------------------------------------------------------------

/**
 * Layout (little endian), 10 bytes header, then the Godot packet:
 *
 * | offset | type  | field   | meaning                                                          |
 * | 0      | int32 | from    | sender peer id, **always overwritten by the relay**              |
 * | 4      | int32 | to      | target: peer id, 0 = all, negative = all except `-to`            |
 * | 8      | uint8 | channel | Godot transfer channel                                           |
 * | 9      | uint8 | mode    | Godot TransferMode: 0 unreliable, 1 unreliable ordered, 2 reliable |
 * | 10     | bytes | data    | Godot packet, forwarded unchanged                                |
 *
 * The relay forwards the frame with `to`, `channel`, `mode` and `data` unchanged and `from` set to
 * the sender. Frames are never delivered back to their sender.
 */
export const RELAY_FRAME_HEADER_BYTES = 10;
export const RELAY_FRAME_OFFSET = {
  from: 0,
  to: 4,
  channel: 8,
  mode: 9,
  data: 10,
} as const;
/** Target value for "all peers in the room" (except the sender). */
export const RELAY_TARGET_ALL = 0;

export const RelayTransferMode = {
  unreliable: 0,
  unreliableOrdered: 1,
  reliable: 2,
} as const;

export interface RelayFrame {
  channel: number;
  data: Uint8Array;
  from: number;
  mode: number;
  to: number;
}

export function encodeRelayFrame(frame: RelayFrame): Uint8Array {
  const bytes = new Uint8Array(RELAY_FRAME_HEADER_BYTES + frame.data.length);
  const view = new DataView(bytes.buffer);
  view.setInt32(RELAY_FRAME_OFFSET.from, frame.from, true);
  view.setInt32(RELAY_FRAME_OFFSET.to, frame.to, true);
  view.setUint8(RELAY_FRAME_OFFSET.channel, frame.channel);
  view.setUint8(RELAY_FRAME_OFFSET.mode, frame.mode);
  bytes.set(frame.data, RELAY_FRAME_HEADER_BYTES);
  return bytes;
}

/** Returns null for frames shorter than the header. `data` is a view, not a copy. */
export function decodeRelayFrame(bytes: Uint8Array): RelayFrame | null {
  if (bytes.length < RELAY_FRAME_HEADER_BYTES) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    from: view.getInt32(RELAY_FRAME_OFFSET.from, true),
    to: view.getInt32(RELAY_FRAME_OFFSET.to, true),
    channel: view.getUint8(RELAY_FRAME_OFFSET.channel),
    mode: view.getUint8(RELAY_FRAME_OFFSET.mode),
    data: bytes.subarray(RELAY_FRAME_HEADER_BYTES),
  };
}

/**
 * Test vectors for the binary frame, shared by `bun test` (apps/relay) and the GUT test of the
 * game's `online/relay_peer.gd`. `hex` is the complete WebSocket message, lower case, no spaces.
 */
export const RELAY_FRAME_TEST_VECTORS: ReadonlyArray<{
  name: string;
  from: number;
  to: number;
  channel: number;
  mode: number;
  dataHex: string;
  hex: string;
}> = [
  {
    name: "host broadcasts reliable",
    from: 1,
    to: 0,
    channel: 0,
    mode: 2,
    dataHex: "dead",
    hex: "01000000000000000002dead",
  },
  {
    name: "client to host, channel 3, unreliable",
    from: 2,
    to: 1,
    channel: 3,
    mode: 0,
    dataHex: "6869",
    hex: "020000000100000003006869",
  },
  {
    name: "host to all except peer 2, unreliable ordered",
    from: 1,
    to: -2,
    channel: 1,
    mode: 1,
    dataHex: "00ff",
    hex: "01000000feffffff010100ff",
  },
  {
    name: "host to peer 4, empty payload",
    from: 1,
    to: 4,
    channel: 0,
    mode: 2,
    dataHex: "",
    hex: "01000000040000000002",
  },
  {
    name: "large peer id and channel 255",
    from: 1,
    to: 305_419_896,
    channel: 255,
    mode: 2,
    dataHex: "01020304",
    hex: "0100000078563412ff0201020304",
  },
];

// ---------------------------------------------------------------------------------------------
// HTTP: relay health and the API's internal endpoint for the relay
// ---------------------------------------------------------------------------------------------

/** `GET /health` of the relay (public). */
export const RelayHealthResponse = z.object({
  status: z.enum(["ok", "draining"]),
  protocolVersion: z.number().int(),
  rooms: z.number().int(),
  players: z.number().int(),
  connections: z.number().int(),
  time: IsoDateTime,
});
export type RelayHealthResponse = z.infer<typeof RelayHealthResponse>;

/**
 * `GET /internal/relay/players/:playerId/status?guildId=<uuid>` on the API, header
 * `x-relay-key: <RELAY_INTERNAL_KEY>`. 401 `unauthorized` for a wrong key, 404 `player_not_found`
 * for an unknown player, 404 `not_found` when the endpoint is disabled (no key configured).
 */
export const RelayPlayerStatusQuery = z.object({
  guildId: Uuid.optional(),
});
export type RelayPlayerStatusQuery = z.infer<typeof RelayPlayerStatusQuery>;

export const RelayPlayerStatus = z.object({
  playerId: Uuid,
  name: z.string(),
  banned: z.boolean(),
  /** Current (active) guild of the player, null if none. */
  guildId: Uuid.nullable(),
  /** Whether the player is a member of the queried `guildId`; null without the query parameter. */
  guildMember: z.boolean().nullable(),
});
export type RelayPlayerStatus = z.infer<typeof RelayPlayerStatus>;

// ---------------------------------------------------------------------------------------------
// HTTP: the relay's internal endpoints (admin panel via the API, bans)
// ---------------------------------------------------------------------------------------------

/**
 * Internal endpoints of the relay, called by the API only (`RELAY_INTERNAL_URL`), header
 * `x-relay-key: <RELAY_INTERNAL_KEY>` (the same key the relay uses towards the API).
 * - 404 `not_found` while the relay has no RELAY_INTERNAL_KEY (endpoints disabled),
 * - 401 `unauthorized` for a missing or wrong key,
 * - 400 `invalid_json` / `validation_error` for a bad body,
 * - 404 `room_not_found`, 404 `player_not_in_room`.
 * Answers never contain tokens, IP addresses or packet contents. PROTOCOL_VERSION stays the same:
 * closing sends `room_closed` with the added reason `closed_by_admin`, kicking uses the existing
 * `room_closed` (`kicked`, `host_left`) and `peer_left` (`kicked`) messages, a ban the `banned`
 * error (4003).
 */
export const RELAY_INTERNAL_PATHS = {
  rooms: "/internal/rooms",
  closeRoom: (code: string) => `/internal/rooms/${code}/close`,
  kick: (code: string) => `/internal/rooms/${code}/kick`,
  banPlayer: (playerId: string) => `/internal/players/${playerId}/ban`,
} as const;

/** TESTWERT: window of the per-room bytes-per-second figures. */
export const RELAY_ROOM_RATE_WINDOW_SECONDS = 5;

export const RelayRoomPlayer = z.object({
  peerId: RelayPeerId,
  playerId: Uuid,
  /** From the API; null when the API was not reachable at `hello`. */
  name: z.string().nullable(),
  platform: ClientPlatform,
  /** Peer 1. */
  host: z.boolean(),
  /** Seconds since the player created or joined the room. */
  inRoomSeconds: z.number().int().min(0),
});
export type RelayRoomPlayer = z.infer<typeof RelayRoomPlayer>;

export const RelayRoomSummary = z.object({
  code: RoomCode,
  mode: RoomMode,
  guildId: Uuid.nullable(),
  /** True while a run is in progress. */
  started: z.boolean(),
  gameVersion: GameVersion,
  playerCount: z.number().int().min(0),
  maxPlayers: z.number().int(),
  /** Host first, then clients by peer id. */
  players: z.array(RelayRoomPlayer),
  createdAt: IsoDateTime,
  ageSeconds: z.number().int().min(0),
  /** Lobby expiry; null while a run is in progress. */
  expiresAt: IsoDateTime.nullable(),
  /** Runs started in this room so far (`start` messages). */
  runsStarted: z.number().int().min(0),
  /**
   * Game packet traffic of this room (binary frames only) over the last
   * RELAY_ROOM_RATE_WINDOW_SECONDS; 0 for rooms younger than the window.
   */
  bytesInPerSecond: z.number().int().min(0),
  bytesOutPerSecond: z.number().int().min(0),
});
export type RelayRoomSummary = z.infer<typeof RelayRoomSummary>;

/** `GET /internal/rooms`: every open room, oldest first. */
export const RelayRoomList = z.object({
  time: IsoDateTime,
  protocolVersion: z.number().int(),
  rooms: z.array(RelayRoomSummary),
});
export type RelayRoomList = z.infer<typeof RelayRoomList>;

/** Moderation reason (admin panel); goes into the relay log and the API's audit log. */
export const RelayModerationReason = z.string().trim().min(3).max(500);

/**
 * `POST /internal/rooms/:code/close`: everybody (host included) leaves the room with
 * `room_closed` (`closed_by_admin`); the room is gone. 404 `room_not_found`.
 */
export const RelayCloseRoomRequest = z.object({
  reason: RelayModerationReason,
});
export type RelayCloseRoomRequest = z.infer<typeof RelayCloseRoomRequest>;

export const RelayCloseRoomResponse = z.object({
  code: RoomCode,
  /** Player ids that were in the room. */
  playerIds: z.array(Uuid),
  started: z.boolean(),
});
export type RelayCloseRoomResponse = z.infer<typeof RelayCloseRoomResponse>;

/**
 * `POST /internal/rooms/:code/kick`: like a kick by the host. A client gets `room_closed`
 * (`kicked`), the others `peer_left` (`kicked`); the player cannot join this room again. Kicking
 * the host closes the room: the host gets `room_closed` (`kicked`), the others `room_closed`
 * (`host_left`). 404 `room_not_found`, 404 `player_not_in_room`.
 */
export const RelayKickRequest = z.object({
  playerId: Uuid,
  reason: RelayModerationReason,
});
export type RelayKickRequest = z.infer<typeof RelayKickRequest>;

export const RelayKickResponse = z.object({
  code: RoomCode,
  playerId: Uuid,
  peerId: RelayPeerId,
  /** The host was kicked, so the room was closed for everybody. */
  roomClosed: z.boolean(),
});
export type RelayKickResponse = z.infer<typeof RelayKickResponse>;

/**
 * `POST /internal/players/:playerId/ban` (no body): the API banned this player. The relay forgets
 * its cached status and closes every connection of the player with the `banned` error (4003),
 * so rooms see `peer_left` (`disconnected`) or `room_closed` (`host_left`). Always 200, also when
 * the player is not connected (`connections: 0`).
 */
export const RelayBanPlayerResponse = z.object({
  playerId: Uuid,
  connections: z.number().int().min(0),
  /** Codes of the rooms the player was in. */
  rooms: z.array(RoomCode),
});
export type RelayBanPlayerResponse = z.infer<typeof RelayBanPlayerResponse>;
