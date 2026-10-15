import { describe, expect, it } from "bun:test";
import {
  decodeRelayFrame,
  encodeRelayFrame,
  RELAY_FRAME_HEADER_BYTES,
  RELAY_FRAME_TEST_VECTORS,
  RelayClientMessage,
  ROOM_CODE_ALPHABET,
  RoomCode,
} from "@soulwick/contracts";
import { parseClientMessage, stampSender } from "../src/protocol.ts";
import { generateRoomCode } from "../src/rooms.ts";

const toHex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const fromHex = (hex: string) => new Uint8Array(Buffer.from(hex, "hex"));
const CODE_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
const AMBIGUOUS = /[01OIL]/;

describe("binary frame", () => {
  for (const v of RELAY_FRAME_TEST_VECTORS) {
    it(`matches test vector: ${v.name}`, () => {
      const encoded = encodeRelayFrame({
        from: v.from,
        to: v.to,
        channel: v.channel,
        mode: v.mode,
        data: fromHex(v.dataHex),
      });
      expect(toHex(encoded)).toBe(v.hex);
      const decoded = decodeRelayFrame(fromHex(v.hex));
      expect(decoded).not.toBeNull();
      expect({
        ...decoded,
        data: toHex(decoded?.data ?? new Uint8Array()),
      }).toEqual({
        from: v.from,
        to: v.to,
        channel: v.channel,
        mode: v.mode,
        data: v.dataHex,
      });
    });
  }

  it("rejects frames shorter than the header", () => {
    expect(
      decodeRelayFrame(new Uint8Array(RELAY_FRAME_HEADER_BYTES - 1))
    ).toBeNull();
  });

  it("stamps the sender into a copy and keeps the rest untouched", () => {
    const original = fromHex("63000000010000000302cafe");
    const stamped = stampSender(original, 2);
    expect(toHex(stamped)).toBe("02000000010000000302cafe");
    expect(toHex(original)).toBe("63000000010000000302cafe");
  });
});

describe("room codes", () => {
  it("uses 6 characters from the unambiguous alphabet", () => {
    expect(ROOM_CODE_ALPHABET).not.toMatch(AMBIGUOUS);
    for (let i = 0; i < 2000; i += 1) {
      expect(generateRoomCode()).toMatch(CODE_PATTERN);
    }
  });

  it("covers the whole alphabet", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      for (const ch of generateRoomCode()) {
        seen.add(ch);
      }
    }
    expect(seen.size).toBe(ROOM_CODE_ALPHABET.length);
  });

  it("normalises user input and rejects ambiguous characters", () => {
    expect(RoomCode.parse(" abc234 ")).toBe("ABC234");
    expect(RoomCode.safeParse("ABC10O").success).toBe(false);
    expect(RoomCode.safeParse("ABCDE").success).toBe(false);
  });
});

describe("control messages", () => {
  it("requires guildId for guild rooms", () => {
    expect(
      RelayClientMessage.safeParse({ type: "create", mode: "guild" }).success
    ).toBe(false);
    expect(
      RelayClientMessage.safeParse({
        type: "create",
        mode: "guild",
        guildId: "6f1d1b5e-3c3a-4f43-9a51-0c1f1d2c3b4a",
      }).success
    ).toBe(true);
    expect(
      RelayClientMessage.safeParse({ type: "create", mode: "quick" }).success
    ).toBe(true);
  });

  it("reports the request type and the reason of invalid messages", () => {
    expect(parseClientMessage("{nope")).toEqual({
      ok: false,
      reason: "not valid JSON",
    });
    const bad = parseClientMessage(
      JSON.stringify({ type: "kick", peerId: "x" })
    );
    expect(bad.ok).toBe(false);
    expect(bad).toMatchObject({ request: "kick" });
    const unknown = parseClientMessage(JSON.stringify({ type: "teleport" }));
    expect(unknown).toMatchObject({ ok: false, request: "teleport" });
  });

  it("accepts end_run with and without a known reason", () => {
    for (const msg of [
      { type: "end_run" },
      { type: "end_run", reason: "portal" },
      { type: "end_run", reason: "wiped" },
      { type: "end_run", reason: "abandoned" },
    ]) {
      expect(RelayClientMessage.safeParse(msg).success).toBe(true);
    }
    expect(
      parseClientMessage(JSON.stringify({ type: "end_run", reason: "won" }))
    ).toMatchObject({ ok: false, request: "end_run" });
  });
});
