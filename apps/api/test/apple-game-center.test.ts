import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import {
  createHash,
  generateKeyPairSync,
  sign,
  X509Certificate,
} from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "../src/lib/logger.ts";
import {
  APPLE_KEYS_URL,
  APPLE_REVOKE_URL,
  APPLE_TOKEN_URL,
  sendRevocations,
} from "../src/services/apple.ts";
import { chainsToRoot } from "../src/services/game-center.ts";
import { GAME_CENTER_CAS } from "../src/services/game-center-cas.ts";
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
const sha256Hex = (s: string) => createHash("sha256").update(s).digest("hex");

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

  /** A server nonce (POST /auth/apple/nonce) and the identity token carrying its hash. */
  async function signedIn(sub: string, extra: Record<string, unknown> = {}) {
    const issued = await ctx.req("POST", "/auth/apple/nonce");
    expect(issued.status).toBe(201);
    const nonce = issued.json.nonce as string;
    return {
      nonce,
      identityToken: identityToken({ sub, nonce: sha256Hex(nonce) }),
      ...extra,
    };
  }

  it("verifies the identity token with a server nonce, stores the refresh token encrypted", async () => {
    const body = await signedIn("apple-native-sub.0001", {
      authorizationCode: "apple-auth-code",
      name: "Apfelkern",
    });
    const res = await ctx.req("POST", "/auth/apple", { body });
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
      body: await signedIn("apple-native-sub.0001"),
    });
    expect(again.json.player.id).toBe(res.json.player.id);
  });

  it("needs a server nonce, accepts it once and only with a matching token nonce", async () => {
    const missing = await ctx.req("POST", "/auth/apple", {
      body: { identityToken: identityToken({ sub: "x" }) },
    });
    expect(missing.status).toBe(400);

    const selfMade = "my-own-nonce-1234567890";
    const unknown = await ctx.req("POST", "/auth/apple", {
      body: {
        identityToken: identityToken({ sub: "x", nonce: sha256Hex(selfMade) }),
        nonce: selfMade,
      },
    });
    expect(unknown.status).toBe(401);
    expect(unknown.json.error).toBe("invalid_apple_token");

    const body = await signedIn("apple-replay-sub");
    expect((await ctx.req("POST", "/auth/apple", { body })).status).toBe(200);
    const replay = await ctx.req("POST", "/auth/apple", { body });
    expect(replay.status).toBe(401);

    const issued = (await ctx.req("POST", "/auth/apple/nonce")).json.nonce;
    const mismatch = await ctx.req("POST", "/auth/apple", {
      body: {
        identityToken: identityToken({ sub: "x", nonce: sha256Hex("other") }),
        nonce: issued,
      },
    });
    expect(mismatch.status).toBe(401);
  });

  it("rejects forged, foreign and expired tokens", async () => {
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const cases: [Record<string, unknown>, typeof rsa.privateKey][] = [
      [{ sub: "x" }, other.privateKey],
      [{ sub: "x", aud: "other.app" }, rsa.privateKey],
      [{ sub: "x", exp: Math.floor(Date.now() / 1000) - 3600 }, rsa.privateKey],
      [{ sub: "x", iss: "https://evil.example" }, rsa.privateKey],
    ];
    for (const [claims, key] of cases) {
      const nonce = (await ctx.req("POST", "/auth/apple/nonce")).json.nonce;
      const res = await ctx.req("POST", "/auth/apple", {
        body: {
          identityToken: identityToken(
            { ...claims, nonce: sha256Hex(nonce) },
            key
          ),
          nonce,
        },
      });
      expect(res.status).toBe(401);
      expect(res.json.error).toBe("invalid_apple_token");
    }
  });

  it("revokes Apple's token when the account is deleted (queue, retry with back-off)", async () => {
    fake.state.handler = byUrl({
      [APPLE_TOKEN_URL]: () =>
        json({
          id_token: unsignedJwt({ sub: "apple-delete-sub" }),
          refresh_token: "refresh-to-revoke",
        }),
      [APPLE_KEYS_URL]: () => json(jwks),
    });
    const res = await ctx.req("POST", "/auth/apple", {
      body: await signedIn("apple-delete-sub", { authorizationCode: "code" }),
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
    await Bun.sleep(100);
    const queue = await ctx.client.query(
      "select count(*)::int as n from oauth_token_revocations"
    );
    expect(queue.rows[0].n).toBe(0);
  });

  it("keeps failed revocations for the housekeeping and drops tokens Apple no longer knows", async () => {
    fake.state.handler = appleApi({}, "apple-retry-sub");
    const res = await ctx.req("POST", "/auth/apple", {
      body: await signedIn("apple-retry-sub", { authorizationCode: "code" }),
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
        ...(await signedIn("apple-unlink-sub", { authorizationCode: "code" })),
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

/** Apple's Game Center certificate gc-prod-12 (public), DER as base64; valid 2026-03-17 – 2027-05-27. */
const APPLE_GC_PROD_12 =
  "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";

describe("Game Center certificate chain (DigiCert, embedded)", () => {
  it("accepts Apple's real certificate and nothing self-made", () => {
    const cas = GAME_CENTER_CAS.map((pem) => new X509Certificate(pem));
    const apple = new X509Certificate(Buffer.from(APPLE_GC_PROD_12, "base64"));
    expect(chainsToRoot(apple, cas, new Date("2026-11-03T12:00:00Z"))).toBe(
      true
    );
    // Expired intermediate/leaf dates do not matter for the chain, the CA's do.
    expect(chainsToRoot(apple, cas, new Date("2040-01-01T00:00:00Z"))).toBe(
      false
    );
  });
});

const CERT_URL = "https://static.gc.apple.com/public-key/gc-prod-test.cer";
const PLAYER_ID = "T:_test_team_player_0001";

interface TestPki {
  cas: string[];
  leafDer: Buffer;
  leafKey: string;
  rogueDer: Buffer;
  rogueKey: string;
}

/** A test CA (root + intermediate) with an "Apple" leaf, plus a self-signed rogue leaf (openssl). */
function makePki(): TestPki | null {
  const dir = mkdtempSync(join(tmpdir(), "soulwick-gc-"));
  const f = (name: string) => join(dir, name);
  const run = (args: string[]) =>
    Bun.spawnSync(["openssl", ...args], { cwd: dir }).exitCode === 0;
  try {
    writeFileSync(
      f("ca.ext"),
      "basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n"
    );
    const ok =
      run([
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        f("root.key"),
        "-out",
        f("root.pem"),
        "-days",
        "3",
        "-subj",
        "/CN=Soulwick Test Root",
        "-addext",
        "basicConstraints=critical,CA:TRUE",
        "-addext",
        "keyUsage=critical,keyCertSign,cRLSign",
      ]) &&
      run([
        "req",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        f("inter.key"),
        "-out",
        f("inter.csr"),
        "-subj",
        "/CN=Soulwick Test Intermediate",
      ]) &&
      run([
        "x509",
        "-req",
        "-in",
        f("inter.csr"),
        "-CA",
        f("root.pem"),
        "-CAkey",
        f("root.key"),
        "-CAcreateserial",
        "-out",
        f("inter.pem"),
        "-days",
        "3",
        "-extfile",
        f("ca.ext"),
      ]) &&
      run([
        "req",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        f("leaf.key"),
        "-out",
        f("leaf.csr"),
        "-subj",
        "/C=US/O=Apple Inc./CN=Apple Inc.",
      ]) &&
      run([
        "x509",
        "-req",
        "-in",
        f("leaf.csr"),
        "-CA",
        f("inter.pem"),
        "-CAkey",
        f("inter.key"),
        "-CAcreateserial",
        "-outform",
        "DER",
        "-out",
        f("leaf.der"),
        "-days",
        "2",
      ]) &&
      run([
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        f("rogue.key"),
        "-outform",
        "DER",
        "-out",
        f("rogue.der"),
        "-days",
        "2",
        "-subj",
        "/C=US/O=Apple Inc./CN=Apple Inc.",
      ]);
    if (!ok) {
      return null;
    }
    return {
      cas: [
        readFileSync(f("inter.pem"), "utf8"),
        readFileSync(f("root.pem"), "utf8"),
      ],
      leafDer: readFileSync(f("leaf.der")),
      leafKey: readFileSync(f("leaf.key"), "utf8"),
      rogueDer: readFileSync(f("rogue.der")),
      rogueKey: readFileSync(f("rogue.key"), "utf8"),
    };
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const pki = makePki();

describe.skipIf(pki === null)("Game Center (KF5)", () => {
  const fake = fakeFetch();
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext(
      { GAME_CENTER_BUNDLE_IDS: `${BUNDLE_ID},other.bundle` },
      { fetch: fake.fetch, gameCenterCas: pki?.cas }
    );
  });
  afterAll(() => ctx.close());
  beforeEach(() => {
    fake.state.calls = [];
    fake.state.handler = (call) =>
      call.url.hostname === "static.gc.apple.com"
        ? new Response(
            new Uint8Array(
              (call.url.pathname.includes("rogue")
                ? pki?.rogueDer
                : pki?.leafDer) ?? []
            )
          )
        : new Response("unexpected", { status: 599 });
  });

  function proof(overrides: Record<string, unknown> = {}, key = pki?.leafKey) {
    const timestamp = Date.now();
    const salt = Buffer.from("test-salt-1234");
    const ts = Buffer.alloc(8);
    ts.writeBigUInt64BE(BigInt(timestamp));
    const signature = sign(
      "RSA-SHA256",
      Buffer.concat([Buffer.from(PLAYER_ID), Buffer.from(BUNDLE_ID), ts, salt]),
      key ?? ""
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

  it("signs in with a valid signature, loads without redirects and caches the certificate", async () => {
    const first = await ctx.req("POST", "/auth/game-center", {
      body: { ...proof(), name: "Kristall" },
    });
    expect(first.status).toBe(200);
    expect(first.json.player.name).toBe("Kristall");
    expect(fake.state.calls[0]?.redirect).toBe("error");
    const second = await ctx.req("POST", "/auth/game-center", {
      body: proof(),
    });
    expect(second.json.player.id).toBe(first.json.player.id);
    expect(fake.state.calls).toHaveLength(1);
  });

  it("refuses a certificate that does not chain to the trusted CA (self-signed 'Apple Inc.')", async () => {
    const res = await ctx.req("POST", "/auth/game-center", {
      body: proof(
        { publicKeyUrl: "https://static.gc.apple.com/public-key/rogue.cer" },
        pki?.rogueKey
      ),
    });
    expect(res.status).toBe(401);
    expect(res.json.error).toBe("invalid_game_center_signature");
  });

  it("rejects wrong signatures, bundles, old timestamps and every other certificate URL", async () => {
    const cases = [
      proof({ playerId: "T:_someone_else" }),
      proof({ bundleId: "other.bundle" }),
      proof({ bundleId: "not.allowed" }),
      proof({ timestamp: Date.now() - 3_600_000 }),
      proof({ publicKeyUrl: "https://evil.example.com/public-key/key.cer" }),
      proof({ publicKeyUrl: "http://static.gc.apple.com/public-key/key.cer" }),
      proof({ publicKeyUrl: "https://www.apple.com/public-key/key.cer" }),
      proof({ publicKeyUrl: "https://static.gc.apple.com/other/key.cer" }),
      proof({
        publicKeyUrl: "https://static.gc.apple.com:8443/public-key/k.cer",
      }),
      proof({
        publicKeyUrl: "https://static.gc.apple.com.evil.com/public-key/k.cer",
      }),
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

  it("caps the certificate cache", async () => {
    for (let i = 0; i < 12; i += 1) {
      await ctx.req("POST", "/auth/game-center", {
        body: proof({ publicKeyUrl: `${CERT_URL}?n=${i}` }),
      });
    }
    // Cached are only certificates that passed the checks; at most 8.
    const cached = new Set(fake.state.calls.map((c) => c.url.href)).size;
    expect(cached).toBe(12);
    const again = fake.state.calls.length;
    await ctx.req("POST", "/auth/game-center", {
      body: proof({ publicKeyUrl: `${CERT_URL}?n=0` }),
    });
    // ?n=0 was evicted (oldest beyond 8): loaded again.
    expect(fake.state.calls.length).toBe(again + 1);
  });

  it("adds Game Center to a guest account in the game", async () => {
    const guest = await ctx.login();
    const res = await ctx.req("POST", "/me/logins", {
      token: guest.token,
      body: { provider: "game_center", ...proof() },
    });
    // Both accounts are empty (the Game Center one from above, the fresh guest): the caller's
    // account is absorbed, the usual "second device" case (D-122).
    expect(res.status).toBe(200);
    expect(res.json.removedPlayerId).toBe(guest.id);
  });
});
