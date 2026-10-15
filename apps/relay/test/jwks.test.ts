import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { silentLogger } from "./helpers.ts";
import {
  API_KEY,
  createTestKey,
  FOREIGN_KEY,
  fakeJwks,
  signPlayerJwt,
  testTokenVerifier,
} from "./jwt.ts";

/** Key set cache of the relay's player JWT check (P-027). */
describe("JWKS verifier", () => {
  const start = Date.now();

  function setup(opts: { cacheMs?: number; cooldownMs?: number } = {}) {
    const jwks = fakeJwks();
    const clock = { now: start };
    const verifier = testTokenVerifier(silentLogger, {
      fetch: jwks.fetch,
      now: () => clock.now,
      cacheMs: opts.cacheMs ?? 600_000,
      cooldownMs: opts.cooldownMs ?? 30_000,
    });
    return { jwks, clock, verifier };
  }

  it("returns the player id of a valid token and fetches the key set once", async () => {
    const { jwks, verifier } = setup();
    const id = randomUUID();
    const token = await signPlayerJwt(id);
    const results = await Promise.all([
      verifier.verify(token),
      verifier.verify(token),
      verifier.verify(token),
    ]);
    expect(results).toEqual([id, id, id]);
    expect(await verifier.verify(token)).toBe(id);
    expect(jwks.state.calls).toBe(1);
  });

  it("refetches after the cache time", async () => {
    const { jwks, clock, verifier } = setup({ cacheMs: 60_000 });
    const token = await signPlayerJwt(randomUUID());
    await verifier.verify(token);
    clock.now += 59_000;
    await verifier.verify(token);
    expect(jwks.state.calls).toBe(1);
    clock.now += 2000;
    await verifier.verify(token);
    expect(jwks.state.calls).toBe(2);
  });

  it("follows a key rotation: an unknown kid refetches at once", async () => {
    const { jwks, clock, verifier } = setup();
    expect(await verifier.verify(await signPlayerJwt(randomUUID()))).not.toBe(
      null
    );
    const rotated = await createTestKey("test-key-2");
    jwks.state.keys = [API_KEY, rotated];
    clock.now += 31_000;
    const id = randomUUID();
    expect(
      await verifier.verify(await signPlayerJwt(id, { key: rotated }))
    ).toBe(id);
    expect(jwks.state.calls).toBe(2);
    // Tokens of the old key still pass while it is published (grace period).
    expect(await verifier.verify(await signPlayerJwt(id))).toBe(id);
  });

  it("unknown kids refetch at most once per cooldown", async () => {
    const { jwks, clock, verifier } = setup({ cooldownMs: 30_000 });
    const foreign = await signPlayerJwt(randomUUID(), { key: FOREIGN_KEY });
    expect(await verifier.verify(foreign)).toBeNull();
    expect(await verifier.verify(foreign)).toBeNull();
    expect(await verifier.verify(foreign)).toBeNull();
    expect(jwks.state.calls).toBe(1);
    clock.now += 30_000;
    expect(await verifier.verify(foreign)).toBeNull();
    expect(jwks.state.calls).toBe(2);
  });

  it("keeps the last key set while the API is down; without one every token is refused", async () => {
    const { jwks, clock, verifier } = setup({ cacheMs: 60_000 });
    const id = randomUUID();
    const token = await signPlayerJwt(id);
    jwks.state.down = true;
    expect(await verifier.verify(token)).toBeNull();
    jwks.state.down = false;
    // Within the cooldown after the failed attempt nothing is fetched.
    expect(await verifier.verify(token)).toBeNull();
    clock.now += 30_000;
    expect(await verifier.verify(token)).toBe(id);

    jwks.state.down = true;
    clock.now += 120_000;
    expect(await verifier.verify(token)).toBe(id);
    expect(jwks.state.calls).toBe(3);
  });

  it("checks expiry against its own clock", async () => {
    const { clock, verifier } = setup();
    const id = randomUUID();
    const token = await signPlayerJwt(id, { expiresIn: 60 });
    expect(await verifier.verify(token)).toBe(id);
    clock.now += 61_000;
    expect(await verifier.verify(token)).toBeNull();
  });
});
