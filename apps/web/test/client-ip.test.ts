import { describe, expect, it, mock } from "bun:test";

// `server-only` throws outside the react-server condition; Next.js resolves it to an empty module.
mock.module("server-only", () => ({}));
const { clientIpFrom } = await import("../src/lib/client-ip");

/** KF5 security review: the visitor must not pick the address the API rate-limits him by. */
describe("client ip", () => {
  const from = (h: Record<string, string>) => (name: string) => h[name] ?? null;

  it("takes the entry Traefik appended, not the forged ones before it", () => {
    expect(
      clientIpFrom(from({ "x-forwarded-for": "1.1.1.1, 203.0.113.7" }), {})
    ).toBe("203.0.113.7");
  });

  it("counts several trusted proxies from the right", () => {
    expect(
      clientIpFrom(
        from({ "x-forwarded-for": "6.6.6.6, 203.0.113.7, 172.68.1.2" }),
        { TRUSTED_PROXY_HOPS: "2" }
      )
    ).toBe("203.0.113.7");
  });

  it("believes CF-Connecting-IP only behind Cloudflare", () => {
    const headers = from({
      "cf-connecting-ip": "198.51.100.4",
      "x-forwarded-for": "198.51.100.4, 172.68.1.2",
    });
    expect(clientIpFrom(headers, {})).toBe("172.68.1.2");
    expect(clientIpFrom(headers, { TRUST_CLOUDFLARE: "true" })).toBe(
      "198.51.100.4"
    );
  });

  it("ignores garbage and missing headers", () => {
    expect(clientIpFrom(from({ "x-forwarded-for": "nope" }), {})).toBeNull();
    expect(clientIpFrom(from({}), {})).toBeNull();
    expect(
      clientIpFrom(from({ "x-forwarded-for": "203.0.113.7" }), {
        TRUSTED_PROXY_HOPS: "0",
      })
    ).toBeNull();
  });
});
