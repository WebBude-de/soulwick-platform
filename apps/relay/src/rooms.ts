import { randomInt as cryptoRandomInt } from "node:crypto";
import {
  HOST_PEER_ID,
  RELAY_ROOM_RATE_WINDOW_SECONDS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type RoomInfo,
  type RoomMode,
  type RoomPeer,
} from "@soulwick/contracts";

/** Random integer in [0, max). */
export type RandomInt = (max: number) => number;

export function generateRoomCode(randomInt: RandomInt = cryptoRandomInt) {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

/** What a room needs to know about a member; implemented by the relay's connection state. */
export interface RoomMember {
  readonly peer: RoomPeer;
}

/**
 * One lobby/run in memory. Host is always peer 1; clients get 2, 3, ... and ids are never reused
 * within a room, so a late packet from a peer that left cannot reach a newcomer. A room can host
 * several runs one after another: `start` -> run -> `end_run` -> lobby -> `start` ...
 */
export class Room<M extends RoomMember = RoomMember> {
  readonly code: string;
  readonly mode: RoomMode;
  readonly guildId: string | null;
  readonly gameVersion: string;
  readonly maxPlayers: number;
  readonly createdAt: number;
  /**
   * True while a run is in progress. Set in the constructor: Biome infers the literal `false` from
   * a field initializer.
   */
  started: boolean;
  /** Rooms in the lobby close at this time (ms); null while a run is in progress. */
  expiresAt: number | null;
  readonly members = new Map<number, M>();
  /** Player ids the host kicked; they cannot join again (also not between runs). */
  readonly kicked = new Set<string>();
  /** `start` messages so far (admin view). */
  runsStarted = 0;
  /** Game packet bytes received from / delivered to members of this room (admin view). */
  bytesIn = 0;
  bytesOut = 0;
  /** Bytes per second over the last finished rate window. */
  readonly rates = { bytesInPerSecond: 0, bytesOutPerSecond: 0 };
  private rateSample: { at: number; in: number; out: number };
  private nextPeerId = HOST_PEER_ID + 1;

  constructor(opts: {
    code: string;
    mode: RoomMode;
    guildId: string | null;
    gameVersion: string;
    maxPlayers: number;
    now: number;
    ttlMs: number;
  }) {
    this.code = opts.code;
    this.mode = opts.mode;
    this.guildId = opts.guildId;
    this.gameVersion = opts.gameVersion;
    this.maxPlayers = opts.maxPlayers;
    this.createdAt = opts.now;
    this.started = false;
    this.expiresAt = opts.now + opts.ttlMs;
    this.rateSample = { at: opts.now, in: 0, out: 0 };
  }

  startRun() {
    this.started = true;
    this.expiresAt = null;
    this.runsStarted += 1;
  }

  /** Called from the relay's sweep; closes a rate window every RELAY_ROOM_RATE_WINDOW_SECONDS. */
  sampleRates(now: number) {
    const elapsed = now - this.rateSample.at;
    if (elapsed < RELAY_ROOM_RATE_WINDOW_SECONDS * 1000) {
      return;
    }
    const seconds = elapsed / 1000;
    this.rates.bytesInPerSecond = Math.round(
      (this.bytesIn - this.rateSample.in) / seconds
    );
    this.rates.bytesOutPerSecond = Math.round(
      (this.bytesOut - this.rateSample.out) / seconds
    );
    this.rateSample = { at: now, in: this.bytesIn, out: this.bytesOut };
  }

  /** Back to the lobby; the lobby time limit starts again. */
  endRun(now: number, ttlMs: number) {
    this.started = false;
    this.expiresAt = now + ttlMs;
  }

  get isFull(): boolean {
    return this.members.size >= this.maxPlayers;
  }

  /** Next client peer id; call once per joining client. */
  allocatePeerId(): number {
    const id = this.nextPeerId;
    this.nextPeerId += 1;
    return id;
  }

  /** Members except the given peer ids, in peer id order. */
  others(...exclude: number[]): M[] {
    return [...this.members.entries()]
      .filter(([id]) => !exclude.includes(id))
      .sort(([a], [b]) => a - b)
      .map(([, m]) => m);
  }

  info(): RoomInfo {
    return {
      code: this.code,
      mode: this.mode,
      guildId: this.guildId,
      hostPeerId: HOST_PEER_ID,
      started: this.started,
      maxPlayers: this.maxPlayers,
      gameVersion: this.gameVersion,
      peers: this.others().map((m) => m.peer),
      expiresAt:
        this.expiresAt === null ? null : new Date(this.expiresAt).toISOString(),
    };
  }
}
