import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { RELAY_CLOSE_CODES } from "@soulwick/contracts";
import { sign } from "hono/jwt";
import { createHarness, inOrder, playerToken } from "./helpers.ts";
import { API_KEY, FOREIGN_KEY, signPlayerJwt } from "./jwt.ts";

const hello = (token: string, protocolVersion = 1) => ({
  type: "hello",
  token,
  protocolVersion,
  gameVersion: "1.0.0",
  platform: "windows",
});

describe("hello", () => {
  it("welcomes a valid player with name and limits", async () => {
    const h = createHarness();
    const s = h.status.add("Lumen");
    const p = h.connect();
    await p.send(hello(await playerToken(s.playerId)));
    expect(p.t.last()).toEqual({
      type: "welcome",
      playerId: s.playerId,
      name: "Lumen",
      protocolVersion: 1,
      maxFrameBytes: 65_536,
      maxPlayers: 4,
      clientRouting: "host_only",
    });
    expect(p.client.closed).toBe(false);
  });

  it("rejects invalid, foreign-key, expired, wrong-audience and HS256 tokens with unauthorized (4001)", async () => {
    const h = createHarness();
    const s = h.status.add("P");
    const [header, payload] = (await playerToken(s.playerId)).split(".");
    const tokens = [
      "not-a-jwt",
      // Signed with a key the API never published (unknown kid), and with a foreign key under
      // the API's kid.
      await playerToken(s.playerId, { key: FOREIGN_KEY }),
      await signPlayerJwt(s.playerId, { key: FOREIGN_KEY, kid: API_KEY.kid }),
      await playerToken(s.playerId, { expiresIn: -10 }),
      await playerToken(s.playerId, { audience: "soulwick-web" }),
      // The former HS256 player tokens (TOKEN_SECRET) are not accepted any more.
      await sign(
        { sub: s.playerId, typ: "player", exp: Date.now() / 1000 + 600 },
        "test-player-secret-0123456789abcdef",
        "HS256"
      ),
      // Payload of a valid token without its signature.
      `${header}.${payload}.`,
    ];
    await inOrder(tokens, async (token) => {
      const p = h.connect();
      await p.send(hello(token));
      expect(p.t.errors()).toEqual(["unauthorized"]);
      expect(p.t.closed?.code).toBe(RELAY_CLOSE_CODES.unauthorized);
    });
    expect(h.relay.clients.size).toBe(0);
    // Token checks never ask the API for the player's status.
    expect(h.status.calls).toBe(0);
  });

  it("checks the JWT only at hello: an expired token does not end a running connection", async () => {
    const wall = { now: Date.now() };
    const h = createHarness({}, { tokenNow: () => wall.now });
    const s = h.status.add("Lang");
    const p = h.connect();
    await p.send(hello(await playerToken(s.playerId, { expiresIn: 60 })));
    expect(p.t.last()?.type).toBe("welcome");
    wall.now += 3_600_000;
    await p.send({ type: "create", mode: "quick" });
    expect(p.t.of("created")).toHaveLength(1);
    expect(p.client.closed).toBe(false);
    // A new connection with the same, now expired token is refused.
    const late = h.connect();
    await late.send(hello(await playerToken(s.playerId, { expiresIn: 60 })));
    expect(late.t.errors()).toEqual(["unauthorized"]);
  });

  it("rejects a token of a deleted player", async () => {
    const h = createHarness();
    const p = h.connect();
    await p.send(hello(await playerToken(randomUUID())));
    expect(p.t.errors()).toEqual(["unauthorized"]);
    expect(p.t.closed?.code).toBe(RELAY_CLOSE_CODES.unauthorized);
  });

  it("rejects another protocol version with version_mismatch (4006)", async () => {
    const h = createHarness({ PROTOCOL_VERSION: "3" });
    const s = h.status.add("P");
    const p = h.connect();
    await p.send(hello(await playerToken(s.playerId), 2));
    expect(p.t.of("error")[0]).toMatchObject({
      code: "version_mismatch",
      request: "hello",
    });
    expect(p.t.closed?.code).toBe(RELAY_CLOSE_CODES.versionMismatch);
  });

  it("rejects banned players with banned (4003)", async () => {
    const h = createHarness();
    const s = h.status.add("Ash", { banned: true });
    const p = h.connect();
    await p.send(hello(await playerToken(s.playerId)));
    expect(p.t.errors()).toEqual(["banned"]);
    expect(p.t.closed?.code).toBe(RELAY_CLOSE_CODES.banned);
  });

  it("rejects a player banned after hello at the next create/join", async () => {
    const h = createHarness();
    const host = await h.host();
    const p = await h.player("Later");
    p.status.banned = true;
    await p.send({ type: "join", code: host.code });
    expect(p.t.errors()).toEqual(["banned"]);
    expect(p.t.closed?.code).toBe(RELAY_CLOSE_CODES.banned);
    expect(host.t.of("peer_joined")).toHaveLength(0);
  });

  it("requires hello first and within the timeout", async () => {
    const h = createHarness();
    const early = h.connect();
    await early.send({ type: "create", mode: "quick" });
    expect(early.t.errors()).toEqual(["hello_required"]);
    expect(early.t.closed?.code).toBe(RELAY_CLOSE_CODES.unauthorized);

    const binary = h.connect();
    binary.frame(1, [1]);
    expect(binary.t.errors()).toEqual(["hello_required"]);

    const slow = h.connect();
    h.advance(4999);
    h.relay.sweep();
    expect(slow.t.closed).toBeNull();
    h.advance(1);
    h.relay.sweep();
    expect(slow.t.errors()).toEqual(["hello_required"]);
    expect(slow.t.closed?.code).toBe(RELAY_CLOSE_CODES.unauthorized);
  });

  it("answers malformed messages with invalid_message and keeps the connection", async () => {
    const h = createHarness();
    const p = await h.player("P");
    await h.relay.handleText(p.client, "{oops");
    await p.send({ type: "kick", peerId: "two" });
    await p.send({ type: "create", mode: "guild" });
    await p.send(hello("again"));
    expect(p.t.errors()).toEqual([
      "invalid_message",
      "invalid_message",
      "invalid_message",
      "invalid_message",
    ]);
    expect(p.t.of("error")[1]?.request).toBe("kick");
    expect(p.client.closed).toBe(false);
  });

  it("works without the API: name is null, quick rooms work, guild rooms do not", async () => {
    const h = createHarness();
    const s = h.status.add("Offline");
    h.status.down = true;
    const p = h.connect();
    await p.send(hello(await playerToken(s.playerId)));
    expect(p.t.of("welcome")[0]?.name).toBeNull();
    await p.send({ type: "create", mode: "guild", guildId: randomUUID() });
    expect(p.t.errors()).toEqual(["api_unavailable"]);
    await p.send({ type: "create", mode: "quick" });
    expect(p.t.of("created")).toHaveLength(1);
  });
});

describe("heartbeat and idle", () => {
  it("pings every 15 s and drops connections silent for 30 s", async () => {
    const h = createHarness();
    const p = await h.player("P");
    h.advance(15_000);
    h.relay.sweep();
    expect(p.t.pings).toBe(1);
    h.advance(10_000);
    h.relay.handlePong(p.client);
    h.advance(29_999);
    h.relay.sweep();
    expect(p.client.closed).toBe(false);
    h.advance(1);
    h.relay.sweep();
    expect(p.t.closed?.code).toBe(RELAY_CLOSE_CODES.timeout);
  });

  it("closes connections that stay without a room for IDLE_MINUTES", async () => {
    const h = createHarness({ IDLE_MINUTES: "1" });
    const idle = await h.player("Idle");
    const host = await h.host();
    for (let i = 0; i < 4; i += 1) {
      h.advance(15_000);
      h.relay.handlePong(idle.client);
      h.relay.handlePong(host.client);
      h.relay.sweep();
    }
    expect(idle.t.closed?.code).toBe(RELAY_CLOSE_CODES.timeout);
    expect(host.client.closed).toBe(false);
  });
});

describe("guild rooms", () => {
  it("need membership for create and join", async () => {
    const h = createHarness();
    const guildId = randomUUID();
    const founder = await h.player("Founder", { status: { guildId } });
    const member = await h.player("Member", { status: { guildId } });
    const outsider = await h.player("Outsider");

    await outsider.send({ type: "create", mode: "guild", guildId });
    expect(outsider.t.errors()).toEqual(["not_guild_member"]);

    await founder.send({ type: "create", mode: "guild", guildId });
    const created = founder.t.of("created")[0];
    expect(created?.room).toMatchObject({ mode: "guild", guildId });

    await outsider.send({ type: "join", code: created?.code });
    expect(outsider.t.errors()).toEqual([
      "not_guild_member",
      "not_guild_member",
    ]);
    await member.send({ type: "join", code: created?.code });
    expect(member.t.of("joined")[0]?.peerId).toBe(2);
  });

  it("admit members of several guilds through guildIds (D-147)", async () => {
    const h = createHarness();
    const [g1, g2, g3] = [randomUUID(), randomUUID(), randomUUID()];
    const founder = await h.player("Founder", {
      status: { guildId: g1, guildIds: [g1, g2] },
    });
    const member = await h.player("Member", {
      status: { guildId: g3, guildIds: [g3, g2] },
    });
    const outsider = await h.player("Outsider", {
      status: { guildId: g1, guildIds: [g1] },
    });

    await founder.send({ type: "create", mode: "guild", guildId: g2 });
    const created = founder.t.of("created")[0];
    expect(created?.room).toMatchObject({ mode: "guild", guildId: g2 });

    await outsider.send({ type: "join", code: created?.code });
    expect(outsider.t.errors()).toEqual(["not_guild_member"]);
    await member.send({ type: "join", code: created?.code });
    expect(member.t.of("joined")[0]?.peerId).toBe(2);
  });

  it("ask the API again when a cached answer says not a member", async () => {
    const h = createHarness();
    const guildId = randomUUID();
    const founder = await h.player("Founder", {
      status: { guildId, guildIds: [guildId] },
    });
    // Cached before the player joined the guild.
    h.status.cached.set(founder.status.playerId, {
      ...founder.status,
      guildId: null,
      guildIds: [],
    });
    await founder.send({ type: "create", mode: "guild", guildId });
    expect(founder.t.of("created")[0]?.room.guildId).toBe(guildId);
    expect(h.status.forgotten).toEqual([founder.status.playerId]);

    // Members are not asked twice.
    await founder.send({ type: "leave" });
    await founder.send({ type: "create", mode: "guild", guildId });
    expect(h.status.forgotten).toHaveLength(1);
  });

  it("reject joins with api_unavailable while the API is down", async () => {
    const h = createHarness();
    const guildId = randomUUID();
    const founder = await h.player("Founder", { status: { guildId } });
    const member = await h.player("Member", { status: { guildId } });
    await founder.send({ type: "create", mode: "guild", guildId });
    h.status.down = true;
    await member.send({
      type: "join",
      code: founder.t.of("created")[0]?.code,
    });
    expect(member.t.errors()).toEqual(["api_unavailable"]);
  });
});
