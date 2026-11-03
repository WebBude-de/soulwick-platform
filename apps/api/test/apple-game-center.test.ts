import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "../src/lib/logger.ts";
import {
  APPLE_KEYS_URL,
  APPLE_REVOKE_URL,
  APPLE_TOKEN_URL,
  sendRevocations,
} from "../src/services/apple.ts";
import { authIntegrityIssues } from "./auth-integrity.ts";
import {
  byUrl,
  type FakeHandler,
  fakeFetch,
  json,
  unsignedJwt,
} from "./fake-fetch.ts";
import { createTestContext, type TestContext } from "./helpers.ts";

const BUNDLE_ID = "test.soulwick.ios";
const KID = "test-apple-kid";
const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const appleTeamKey = generateKeyPairSync("ec", { namedCurve: "P-256" });
const APPLE_PEM = appleTeamKey.privateKey
  .export({ format: "pem", type: "pkcs8" })
  .toString();
const jwks = {
  keys: [
    { ...rsa.publicKey.export({ format: "jwk" }), kid: KID, alg: "RS256" },
  ],
};

const b64 = (v: unknown) =>
  Buffer.from(JSON.stringify(v)).toString("base64url");
function identityToken(claims: Record<string, unknown>, key = rsa.privateKey) {
  const input = `${b64({ alg: "RS256", kid: KID })}.${b64({
    iss: "https://appleid.apple.com",
    aud: BUNDLE_ID,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 600,
    ...claims,
  })}`;
  return `${input}.${sign("RSA-SHA256", Buffer.from(input), key).toString("base64url")}`;
}

/** Apple's endpoints; the code exchange answers for `sub` (it must match the identity token). */
const appleApi = (
  extra: Record<string, FakeHandler> = {},
  sub = "apple-native-sub.0001"
) =>
  byUrl({
    [APPLE_KEYS_URL]: () => json(jwks),
    [APPLE_TOKEN_URL]: () =>
      json({
        id_token: unsignedJwt({ sub }),
        refresh_token: "apple-native-refresh",
      }),
    [APPLE_REVOKE_URL]: () => new Response(null, { status: 200 }),
    ...extra,
  });

async function waitFor(check: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) {
    await Bun.sleep(20);
  }
}

describe("Sign in with Apple in the iOS app (KF5)", () => {
  const fake = fakeFetch();
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext(
      {
        APPLE_APP_BUNDLE_ID: BUNDLE_ID,
        APPLE_TEAM_ID: "TESTTEAM01",
        APPLE_KEY_ID: "TESTKEY001",
        APPLE_PRIVATE_KEY: APPLE_PEM,
      },
      { fetch: fake.fetch }
    );
  });
  afterAll(() => ctx.close());
  beforeEach(() => {
    fake.state.calls = [];
    fake.state.handler = appleApi();
  });

  it("verifies the identity token and nonce, stores the refresh token encrypted", async () => {
    const nonce = "raw-nonce-from-the-app";
    const res = await ctx.req("POST", "/auth/apple", {
      body: {
        identityToken: identityToken({
          sub: "apple-native-sub.0001",
          nonce: createHash("sha256").update(nonce).digest("hex"),
        }),
        authorizationCode: "apple-auth-code",
        nonce,
        name: "Apfelkern",
      },
    });
    expect(res.status).toBe(200);
    expect(res.json.player.name).toBe("Apfelkern");
    const exchange = fake.state.calls.find(
      (c) => c.url.href === APPLE_TOKEN_URL
    );
    expect(new URLSearchParams(exchange?.body ?? "").get("client_id")).toBe(
      BUNDLE_ID
    );
    const row = await ctx.client.query(
      "select refresh_token, client_id from auth_accounts where provider_id = 'apple'"
    );
    expect(row.rows[0].client_id).toBe(BUNDLE_ID);
    expect(row.rows[0].refresh_token).not.toContain("apple-native-refresh");
    expect(await authIntegrityIssues(ctx.client)).toEqual([]);

    const again = await ctx.req("POST", "/auth/apple", {
      body: { identityToken: identityToken({ sub: "apple-native-sub.0001" }) },
    });
    expect(again.json.player.id).toBe(res.json.player.id);
  });

  it("rejects forged, foreign, expired tokens and a wrong nonce", async () => {
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const cases = [
      identityToken({ sub: "x" }, other.privateKey),
      identityToken({ sub: "x", aud: "other.app" }),
      identityToken({ sub: "x", exp: Math.floor(Date.now() / 1000) - 3600 }),
      identityToken({ sub: "x", iss: "https://evil.example" }),
      "not-a-jwt-but-long-enough-to-pass",
    ];
    for (const token of cases) {
      const res = await ctx.req("POST", "/auth/apple", {
        body: { identityToken: token },
      });
      expect(res.status).toBe(401);
      expect(res.json.error).toBe("invalid_apple_token");
    }
    const nonce = await ctx.req("POST", "/auth/apple", {
      body: {
        identityToken: identityToken({ sub: "x", nonce: "expected" }),
        nonce: "something-else",
      },
    });
    expect(nonce.status).toBe(401);
  });

  it("revokes Apple's token when the account is deleted (queue, retry with back-off)", async () => {
    const res = await ctx.req("POST", "/auth/apple", {
      body: {
        identityToken: identityToken({ sub: "apple-delete-sub" }),
        authorizationCode: "code",
      },
    });
    fake.state.handler = byUrl({
      [APPLE_TOKEN_URL]: () =>
        json({
          id_token: unsignedJwt({ sub: "apple-delete-sub" }),
          refresh_token: "refresh-to-revoke",
        }),
      [APPLE_KEYS_URL]: () => json(jwks),
    });
    await ctx.req("POST", "/auth/apple", {
      body: {
        identityToken: identityToken({ sub: "apple-delete-sub" }),
        authorizationCode: "code-2",
      },
    });
    fake.state.calls = [];
    fake.state.handler = appleApi();
    const deleted = await ctx.req("DELETE", "/me", { token: res.json.token });
    expect(deleted.status).toBe(204);
    await waitFor(() =>
      fake.state.calls.some((c) => c.url.href === APPLE_REVOKE_URL)
    );
    const revoke = fake.state.calls.find(
      (c) => c.url.href === APPLE_REVOKE_URL
    );
    const form = new URLSearchParams(revoke?.body ?? "");
    expect(form.get("token")).toBe("refresh-to-revoke");
    expect(form.get("client_id")).toBe(BUNDLE_ID);
    expect(form.get("token_type_hint")).toBe("refresh_token");
    await waitFor(() => false, 100);
    const queue = await ctx.client.query(
      "select count(*)::int as n from oauth_token_revocations"
    );
    expect(queue.rows[0].n).toBe(0);
  });

  it("keeps failed revocations for the housekeeping and drops tokens Apple no longer knows", async () => {
    fake.state.handler = appleApi({}, "apple-retry-sub");
    const res = await ctx.req("POST", "/auth/apple", {
      body: {
        identityToken: identityToken({ sub: "apple-retry-sub" }),
        authorizationCode: "code",
      },
    });
    fake.state.handler = appleApi(
      { [APPLE_REVOKE_URL]: () => new Response("down", { status: 503 }) },
      "apple-retry-sub"
    );
    await ctx.req("DELETE", "/me", { token: res.json.token });
    await waitFor(() =>
      fake.state.calls.some((c) => c.url.href === APPLE_REVOKE_URL)
    );
    await Bun.sleep(100);
    const queued = await ctx.client.query(
      "select attempts, next_attempt_at from oauth_token_revocations"
    );
    expect(queued.rows[0].attempts).toBe(1);
    expect(new Date(queued.rows[0].next_attempt_at).getTime()).toBeGreaterThan(
      Date.now()
    );

    fake.state.handler = appleApi({
      [APPLE_REVOKE_URL]: () => json({ error: "invalid_grant" }, 400),
    });
    const later = new Date(Date.now() + 3_600_000);
    const sent = await sendRevocations({
      db: ctx.db,
      config: ctx.config,
      logger: createLogger("silent"),
      fetch: fake.fetch,
      now: () => later,
    });
    expect(sent).toEqual({ revoked: 1, failed: 0 });
  });

  it("unlinking Apple queues its token too", async () => {
    fake.state.handler = appleApi({}, "apple-unlink-sub");
    const guest = await ctx.login();
    const added = await ctx.req("POST", "/me/logins", {
      token: guest.token,
      body: {
        provider: "apple",
        identityToken: identityToken({ sub: "apple-unlink-sub" }),
        authorizationCode: "code",
      },
    });
    expect(added.status).toBe(200);
    fake.state.calls = [];
    const unlinked = await ctx.req("DELETE", "/me/identities/apple", {
      token: added.json.token,
    });
    expect(unlinked.status).toBe(200);
    await waitFor(() =>
      fake.state.calls.some((c) => c.url.href === APPLE_REVOKE_URL)
    );
    expect(fake.state.calls.some((c) => c.url.href === APPLE_REVOKE_URL)).toBe(
      true
    );
    expect(await authIntegrityIssues(ctx.client)).toEqual([]);
  });
});

// --- Game Center ------------------------------------------------------------------------------

const CERT_URL = "https://static.gc.apple.com/public-key/gc-prod-test.cer";
const PLAYER_ID = "T:_test_team_player_0001";

/** A self-signed test certificate from openssl (null when openssl is missing). */
function makeCertificate(): { der: Buffer; keyPem: string } | null {
  const dir = mkdtempSync(join(tmpdir(), "soulwick-gc-"));
  try {
    const run = Bun.spawnSync([
      "openssl",
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(dir, "key.pem"),
      "-outform",
      "DER",
      "-out",
      join(dir, "cert.der"),
      "-days",
      "2",
      "-subj",
      "/CN=soulwick-test-game-center",
    ]);
    if (run.exitCode !== 0) {
      return null;
    }
    return {
      der: readFileSync(join(dir, "cert.der")),
      keyPem: readFileSync(join(dir, "key.pem"), "utf8"),
    };
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const certificate = makeCertificate();

describe.skipIf(certificate === null)("Game Center (KF5)", () => {
  const fake = fakeFetch();
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext(
      { GAME_CENTER_BUNDLE_IDS: `${BUNDLE_ID},other.bundle` },
      { fetch: fake.fetch }
    );
  });
  afterAll(() => ctx.close());
  beforeEach(() => {
    fake.state.calls = [];
    fake.state.handler = byUrl({
      [CERT_URL]: () => new Response(new Uint8Array(certificate?.der ?? [])),
    });
  });

  function proof(overrides: Record<string, unknown> = {}) {
    const timestamp = Date.now();
    const salt = Buffer.from("test-salt-1234");
    const ts = Buffer.alloc(8);
    ts.writeBigUInt64BE(BigInt(timestamp));
    const signature = sign(
      "RSA-SHA256",
      Buffer.concat([Buffer.from(PLAYER_ID), Buffer.from(BUNDLE_ID), ts, salt]),
      certificate?.keyPem ?? ""
    );
    return {
      publicKeyUrl: CERT_URL,
      signature: signature.toString("base64"),
      salt: salt.toString("base64"),
      timestamp,
      playerId: PLAYER_ID,
      bundleId: BUNDLE_ID,
      ...overrides,
    };
  }

  it("signs in with a valid signature and caches the certificate", async () => {
    const first = await ctx.req("POST", "/auth/game-center", {
      body: { ...proof(), name: "Kristall" },
    });
    expect(first.status).toBe(200);
    expect(first.json.player.name).toBe("Kristall");
    const second = await ctx.req("POST", "/auth/game-center", {
      body: proof(),
    });
    expect(second.json.player.id).toBe(first.json.player.id);
    expect(fake.state.calls).toHaveLength(1);
  });

  it("rejects wrong signatures, bundles, old timestamps and foreign certificate hosts", async () => {
    const cases = [
      proof({ playerId: "T:_someone_else" }),
      proof({ bundleId: "other.bundle" }),
      proof({ bundleId: "not.allowed" }),
      proof({ timestamp: Date.now() - 3_600_000 }),
      proof({ publicKeyUrl: "https://evil.example.com/key.cer" }),
      proof({ publicKeyUrl: "http://static.gc.apple.com/key.cer" }),
    ];
    for (const body of cases) {
      const res = await ctx.req("POST", "/auth/game-center", { body });
      expect(res.status).toBe(401);
      expect(res.json.error).toBe("invalid_game_center_signature");
    }
    fake.state.handler = () => new Response("down", { status: 500 });
    const down = await ctx.req("POST", "/auth/game-center", {
      body: proof({ publicKeyUrl: `${CERT_URL}?v=2` }),
    });
    expect(down.status).toBe(502);
    expect(down.json.error).toBe("game_center_unavailable");
  });

  it("adds Game Center to a guest account in the game", async () => {
    const guest = await ctx.login();
    const res = await ctx.req("POST", "/me/logins", {
      token: guest.token,
      body: {
        provider: "game_center",
        ...proof({ playerId: PLAYER_ID }),
      },
    });
    // Both accounts are empty (the Game Center one from above, the fresh guest): the caller's
    // account is absorbed, the usual "second device" case (D-122).
    expect(res.status).toBe(200);
    expect(res.json.removedPlayerId).toBe(guest.id);
  });
});
