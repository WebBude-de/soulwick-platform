import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { clientIp } from "../src/lib/client-ip.ts";

function appWith(trustProxy: boolean) {
  const app = new Hono();
  app.get("/", (c) => c.text(clientIp(c, trustProxy)));
  return app;
}

describe("clientIp", () => {
  it("prefers CF-Connecting-IP behind the Cloudflare proxy", async () => {
    const res = await appWith(true).request("/", {
      headers: {
        "cf-connecting-ip": "203.0.113.7",
        "x-forwarded-for": "198.51.100.1, 172.68.0.1",
      },
    });
    expect(await res.text()).toBe("203.0.113.7");
  });

  it("falls back to the first X-Forwarded-For entry without Cloudflare", async () => {
    const res = await appWith(true).request("/", {
      headers: { "x-forwarded-for": "198.51.100.1, 10.0.0.2" },
    });
    expect(await res.text()).toBe("198.51.100.1");
  });

  it("ignores proxy headers when the proxy is not trusted", async () => {
    const res = await appWith(false).request("/", {
      headers: { "cf-connecting-ip": "203.0.113.7" },
    });
    expect(await res.text()).toBe("unknown");
  });
});
