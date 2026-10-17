import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  AdminBugReportDetail,
  AdminBugReportList,
  BUG_REPORT_MAX_BODY_BYTES,
  BUG_REPORT_MAX_IMAGE_BYTES,
  BUG_REPORT_MAX_MARKS,
  DeletionCodeResponse,
} from "@soulwick/contracts";
import { sniffImageMime } from "../src/lib/image.ts";
import { placeholderPng } from "../src/lib/placeholder-png.ts";
import { runHousekeeping } from "../src/services/housekeeping.ts";
import { createTestContext, type TestContext } from "./helpers.ts";

const PNG = placeholderPng(64, 36);
const PNG_BASE64 = Buffer.from(PNG).toString("base64");
/** Smallest headers the sniffer accepts, padded with zeros. */
const JPEG_BASE64 = Buffer.from([
  0xff,
  0xd8,
  0xff,
  0xe0,
  ...new Array(28).fill(0),
]).toString("base64");
const WEBP_BASE64 = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0x24, 0, 0, 0]),
  Buffer.from("WEBPVP8 "),
  Buffer.alloc(24),
]).toString("base64");

const silentLogger = { info: () => undefined, error: () => undefined };

function reportBody(overrides: Record<string, unknown> = {}) {
  return {
    note: "Die Fackel links flackert durch die Wand.",
    categories: ["light", "graphics", "light"],
    marks: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.25, note: "hier" }],
    strokes: [
      [
        [0.5, 0.5],
        [0.55, 0.52],
      ],
    ],
    context: {
      location: "Krypta, Raum 7",
      seed: "abc123",
      fps: 60,
      extra: { renderer: "forward_plus" },
    },
    gameVersion: "1.0.0",
    platform: "windows",
    image: PNG_BASE64,
    ...overrides,
  };
}

describe("bug reports", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(() => ctx.close());

  const send = (token: string, overrides: Record<string, unknown> = {}) =>
    ctx.req("POST", "/bug-reports", { token, body: reportBody(overrides) });

  async function image(token: string, id: string) {
    return await ctx.app.request(`/admin/bug-reports/${id}/image`, {
      headers: { authorization: `Bearer ${token}` },
    });
  }

  it("stores a report and shows it to moderators: list, detail, image", async () => {
    const p = await ctx.login("Fackelfinder");
    const mod = await ctx.createAdmin("moderator");
    const res = await send(p.token);
    expect(res.status).toBe(201);
    const id = res.json.id as string;

    const list = AdminBugReportList.parse(
      (
        await ctx.req("GET", `/admin/bug-reports?playerId=${p.id}`, {
          token: mod.token,
        })
      ).json
    );
    expect(list.total).toBe(1);
    expect(list.nextCursor).toBeNull();
    expect(list.counts).toEqual({ new: 1, seen: 0, done: 0, wont_fix: 0 });
    expect(list.kindCounts).toEqual({ bug: 1, idea: 0 });
    expect(list.items[0]).toMatchObject({
      id,
      playerId: p.id,
      playerName: "Fackelfinder",
      status: "new",
      kind: "bug",
      categories: ["light", "graphics"],
      notePreview: "Die Fackel links flackert durch die Wand.",
      markCount: 1,
      strokeCount: 1,
      platform: "windows",
      gameVersion: "1.0.0",
      location: "Krypta, Raum 7",
      handledAt: null,
      handledByEmail: null,
    });

    const detailRes = await ctx.req("GET", `/admin/bug-reports/${id}`, {
      token: mod.token,
    });
    expect(detailRes.status).toBe(200);
    const detail = AdminBugReportDetail.parse(detailRes.json);
    expect(detail).toMatchObject({
      imageMime: "image/png",
      imageBytes: PNG.length,
      imageUrl: `/admin/bug-reports/${id}/image`,
      marks: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.25, note: "hier" }],
      context: {
        location: "Krypta, Raum 7",
        extra: { renderer: "forward_plus" },
      },
    });
    expect(JSON.stringify(detailRes.json)).not.toContain(PNG_BASE64);
    expect(
      new Date(detail.expiresAt).getTime() -
        new Date(detail.createdAt).getTime()
    ).toBe(90 * 86_400_000);

    const img = await image(mod.token, id);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect(img.headers.get("cache-control")).toContain("private");
    expect(new Uint8Array(await img.arrayBuffer())).toEqual(PNG);

    // Players never see admin routes.
    expect((await image(p.token, id)).status).toBe(401);
  });

  it("detects JPEG and WebP from the magic bytes; guests may report", async () => {
    const admin = await ctx.createAdmin("admin");
    const guest = await ctx.req("POST", "/auth/device", {
      body: { name: "Gastmelder", deviceId: randomUUID() },
    });
    expect(guest.status).toBe(200);
    const token = guest.json.token as string;

    const jpeg = await send(token, { image: JPEG_BASE64, platform: "android" });
    expect(jpeg.status).toBe(201);
    const webp = await send(token, { image: WEBP_BASE64, platform: "linux" });
    expect(webp.status).toBe(201);
    const mimeOf = async (id: string) =>
      (await ctx.req("GET", `/admin/bug-reports/${id}`, { token: admin.token }))
        .json.imageMime;
    expect(await mimeOf(jpeg.json.id)).toBe("image/jpeg");
    expect(await mimeOf(webp.json.id)).toBe("image/webp");
    expect(
      (await image(admin.token, webp.json.id)).headers.get("content-type")
    ).toBe("image/webp");
  });

  it("minimal body: defaults for note, categories, marks and strokes", async () => {
    const p = await ctx.login();
    const res = await ctx.req("POST", "/bug-reports", {
      token: p.token,
      body: {
        context: {},
        gameVersion: "1.0.0",
        platform: "macos",
        image: PNG_BASE64,
      },
    });
    expect(res.status).toBe(201);
  });

  it("rejects broken images with invalid_image", async () => {
    const p = await ctx.login();
    const notBase64 = await send(p.token, { image: "nicht base64!" });
    expect(notBase64.status).toBe(400);
    expect(notBase64.json.error).toBe("invalid_image");

    const text = await send(p.token, {
      image: Buffer.from("<svg xmlns='x'></svg>").toString("base64"),
    });
    expect(text.status).toBe(400);
    expect(text.json.error).toBe("invalid_image");

    // A data URL is not accepted: the type comes from the bytes only.
    const dataUrl = await send(p.token, {
      image: `data:image/png;base64,${PNG_BASE64}`,
    });
    expect(dataUrl.json.error).toBe("invalid_image");
  });

  it("413 payload_too_large for oversized images and bodies", async () => {
    const p = await ctx.login();
    const big = Buffer.alloc(BUG_REPORT_MAX_IMAGE_BYTES + 1);
    Buffer.from(PNG).copy(big);
    const tooBigImage = await send(p.token, {
      image: big.toString("base64"),
    });
    expect(tooBigImage.status).toBe(413);
    expect(tooBigImage.json.error).toBe("payload_too_large");

    const body = JSON.stringify(
      reportBody({ note: "x".repeat(BUG_REPORT_MAX_BODY_BYTES) })
    );
    const res = await ctx.app.request("/bug-reports", {
      method: "POST",
      headers: {
        authorization: `Bearer ${p.token}`,
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(body)),
      },
      body,
    });
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: string }).error).toBe(
      "payload_too_large"
    );
  });

  it("400 validation_error for bad marks, strokes, context, platform", async () => {
    const p = await ctx.login();
    const cases: Record<string, unknown>[] = [
      { marks: [{ x: 1.5, y: 0, w: 0.1, h: 0.1 }] },
      {
        marks: new Array(BUG_REPORT_MAX_MARKS + 1).fill({
          x: 0,
          y: 0,
          w: 0.1,
          h: 0.1,
        }),
      },
      { marks: [{ x: 0, y: 0, w: 0.1, h: 0.1, note: "n".repeat(301) }] },
      { strokes: [[[0.1, -0.1]]] },
      { strokes: [[]] },
      { note: "n".repeat(2001) },
      { categories: ["sound"] },
      { kind: "feature" },
      { kind: "" },
      { platform: "playstation" },
      { context: { blob: "c".repeat(17 * 1024) } },
      { context: "not an object" },
      { gameVersion: "" },
    ];
    for (const overrides of cases) {
      const res = await send(p.token, overrides);
      expect([res.status, res.json.error, overrides]).toEqual([
        400,
        "validation_error",
        overrides,
      ]);
    }
  });

  it("401 without token, 403 banned for banned players", async () => {
    const res = await ctx.req("POST", "/bug-reports", { body: reportBody() });
    expect(res.status).toBe(401);

    const p = await ctx.login();
    const mod = await ctx.createAdmin("moderator");
    await ctx.req("POST", `/admin/players/${p.id}/bans`, {
      token: mod.token,
      body: { reason: "Test", durationDays: 1 },
    });
    const banned = await send(p.token);
    expect(banned.status).toBe(403);
    expect(banned.json.error).toBe("banned");
  });

  it("status: moderators set it with audit; back to new clears handledBy", async () => {
    const p = await ctx.login();
    const mod = await ctx.createAdmin("moderator");
    const id = (await send(p.token)).json.id as string;

    const seen = await ctx.req("PATCH", `/admin/bug-reports/${id}`, {
      token: mod.token,
      body: { status: "seen" },
    });
    expect(seen.status).toBe(200);
    expect(seen.json).toMatchObject({
      status: "seen",
      handledById: mod.id,
      handledByEmail: mod.email,
    });
    expect(seen.json.handledAt).not.toBeNull();

    const reopened = await ctx.req("PATCH", `/admin/bug-reports/${id}`, {
      token: mod.token,
      body: { status: "new" },
    });
    expect(reopened.json).toMatchObject({
      status: "new",
      handledById: null,
      handledAt: null,
    });

    const audit = await ctx.req(
      "GET",
      `/admin/audit?action=bug_report.status&targetId=${id}`,
      { token: mod.token }
    );
    expect(
      audit.json.items.map((e: { details: unknown }) => e.details)
    ).toEqual([
      { from: "seen", to: "new" },
      { from: "new", to: "seen" },
    ]);

    const bad = await ctx.req("PATCH", `/admin/bug-reports/${id}`, {
      token: mod.token,
      body: { status: "closed" },
    });
    expect(bad.json.error).toBe("validation_error");
    const missing = await ctx.req(
      "PATCH",
      `/admin/bug-reports/${randomUUID()}`,
      { token: mod.token, body: { status: "done" } }
    );
    expect(missing.status).toBe(404);
    expect(missing.json.error).toBe("bug_report_not_found");
  });

  it("delete: admin only, with audit; then 404", async () => {
    const p = await ctx.login();
    const mod = await ctx.createAdmin("moderator");
    const admin = await ctx.createAdmin("admin");
    const id = (await send(p.token)).json.id as string;

    expect(
      (
        await ctx.req("DELETE", `/admin/bug-reports/${id}`, {
          token: mod.token,
        })
      ).status
    ).toBe(403);
    expect(
      (
        await ctx.req("DELETE", `/admin/bug-reports/${id}`, {
          token: admin.token,
        })
      ).status
    ).toBe(204);
    const gone = await ctx.req("GET", `/admin/bug-reports/${id}`, {
      token: admin.token,
    });
    expect(gone.status).toBe(404);
    expect(gone.json.error).toBe("bug_report_not_found");
    expect((await image(admin.token, id)).status).toBe(404);
    expect(
      (
        await ctx.req("DELETE", `/admin/bug-reports/${id}`, {
          token: admin.token,
        })
      ).json.error
    ).toBe("bug_report_not_found");

    const audit = await ctx.req(
      "GET",
      `/admin/audit?action=bug_report.delete&targetId=${id}`,
      { token: admin.token }
    );
    expect(audit.json.items[0]).toMatchObject({
      adminId: admin.id,
      targetType: "bug_report",
      details: {
        playerId: p.id,
        status: "new",
        kind: "bug",
        platform: "windows",
      },
    });
  });

  it("list: filters, status counts and cursor pages", async () => {
    const p = await ctx.login();
    const mod = await ctx.createAdmin("moderator");
    const ids: string[] = [];
    for (const platform of ["windows", "linux", "linux"]) {
      ids.push(
        (await send(p.token, { platform, categories: ["ui"] })).json
          .id as string
      );
    }
    await ctx.req("PATCH", `/admin/bug-reports/${ids[0]}`, {
      token: mod.token,
      body: { status: "done" },
    });
    const get = async (query: string) =>
      AdminBugReportList.parse(
        (
          await ctx.req("GET", `/admin/bug-reports?playerId=${p.id}&${query}`, {
            token: mod.token,
          })
        ).json
      );

    const linux = await get("platform=linux");
    expect(linux.total).toBe(2);
    const fresh = await get("status=new");
    expect(fresh.total).toBe(2);
    expect(fresh.counts).toEqual({ new: 2, seen: 0, done: 1, wont_fix: 0 });
    expect((await get("category=ui")).total).toBe(3);
    expect((await get("category=text")).total).toBe(0);

    const first = await get("limit=2");
    expect(first.items.map((i) => i.id)).toEqual(ids.slice(1).reverse());
    expect(first.nextCursor).not.toBeNull();
    const second = await get(`limit=2&cursor=${first.nextCursor}`);
    expect(second.items.map((i) => i.id)).toEqual(ids.slice(0, 1));
    expect(second.nextCursor).toBeNull();

    const badCursor = await ctx.req("GET", "/admin/bug-reports?cursor=abc", {
      token: mod.token,
    });
    expect(badCursor.status).toBe(400);
    expect(badCursor.json.error).toBe("validation_error");
  });

  it("kind: bug by default, ideas without categories, filter and counts", async () => {
    const p = await ctx.login();
    const mod = await ctx.createAdmin("moderator");
    // An older build sends no `kind`; new builds send it and no categories.
    const legacy = (await send(p.token)).json.id as string;
    const bug = (await send(p.token, { kind: "bug", categories: [] })).json
      .id as string;
    const ideaRes = await send(p.token, {
      kind: "idea",
      categories: undefined,
      note: "Eine Truhe im Dorf für die Lieblingswaffe.",
    });
    expect(ideaRes.status).toBe(201);
    const idea = ideaRes.json.id as string;
    await ctx.req("PATCH", `/admin/bug-reports/${bug}`, {
      token: mod.token,
      body: { status: "done" },
    });

    const get = async (query: string) =>
      AdminBugReportList.parse(
        (
          await ctx.req("GET", `/admin/bug-reports?playerId=${p.id}&${query}`, {
            token: mod.token,
          })
        ).json
      );

    const all = await get("limit=50");
    expect(all.total).toBe(3);
    expect(all.kindCounts).toEqual({ bug: 2, idea: 1 });
    expect(Object.fromEntries(all.items.map((i) => [i.id, i.kind]))).toEqual({
      [legacy]: "bug",
      [bug]: "bug",
      [idea]: "idea",
    });

    const ideas = await get("kind=idea");
    expect(ideas.items.map((i) => i.id)).toEqual([idea]);
    expect(ideas.items[0]?.categories).toEqual([]);
    // Status counts respect the kind filter, kind counts ignore it.
    expect(ideas.counts).toEqual({ new: 1, seen: 0, done: 0, wont_fix: 0 });
    expect(ideas.kindCounts).toEqual({ bug: 2, idea: 1 });

    const bugs = await get("kind=bug");
    expect(bugs.items.map((i) => i.id)).toEqual([bug, legacy]);
    expect(bugs.counts).toEqual({ new: 1, seen: 0, done: 1, wont_fix: 0 });

    // Kind counts respect the status filter.
    const fresh = await get("status=new");
    expect(fresh.kindCounts).toEqual({ bug: 1, idea: 1 });
    expect((await get("status=new&kind=bug")).items.map((i) => i.id)).toEqual([
      legacy,
    ]);

    const detail = AdminBugReportDetail.parse(
      (await ctx.req("GET", `/admin/bug-reports/${idea}`, { token: mod.token }))
        .json
    );
    expect(detail).toMatchObject({
      kind: "idea",
      categories: [],
      note: "Eine Truhe im Dorf für die Lieblingswaffe.",
    });

    const badKind = await ctx.req("GET", "/admin/bug-reports?kind=feature", {
      token: mod.token,
    });
    expect(badKind.status).toBe(400);
    expect(badKind.json.error).toBe("validation_error");
  });

  it("stats count new reports; the deletion preview counts them; they go with the account", async () => {
    const admin = await ctx.createAdmin("admin");
    const before = (
      await ctx.req("GET", "/admin/stats", { token: admin.token })
    ).json.newBugReports as number;
    const p = await ctx.login();
    await send(p.token);
    await send(p.token);
    const after = (await ctx.req("GET", "/admin/stats", { token: admin.token }))
      .json.newBugReports as number;
    expect(after).toBe(before + 2);

    const code = DeletionCodeResponse.parse(
      (await ctx.req("POST", "/me/deletion-code", { token: p.token })).json
    ).code;
    const preview = await ctx.req("POST", "/account-deletion/verify", {
      body: { playerName: p.name, code },
    });
    expect(preview.json.account.bugReportCount).toBe(2);

    expect((await ctx.req("DELETE", "/me", { token: p.token })).status).toBe(
      204
    );
    expect(await ctx.db.bugReport.count({ where: { playerId: p.id } })).toBe(0);
  });

  it("housekeeping deletes reports past the retention period only", async () => {
    const p = await ctx.login();
    const old = (await send(p.token)).json.id as string;
    const recent = (await send(p.token)).json.id as string;
    const now = new Date();
    await ctx.db.bugReport.update({
      where: { id: old },
      data: { createdAt: new Date(now.getTime() - 91 * 86_400_000) },
    });
    await ctx.db.bugReport.update({
      where: { id: recent },
      data: { createdAt: new Date(now.getTime() - 89 * 86_400_000) },
    });
    const result = await runHousekeeping({
      db: ctx.db,
      config: ctx.config,
      logger: silentLogger,
      now: () => now,
    });
    expect(result?.bugReports).toBeGreaterThanOrEqual(1);
    expect(
      await ctx.db.bugReport.findUnique({ where: { id: old } })
    ).toBeNull();
    expect(
      await ctx.db.bugReport.findUnique({
        where: { id: recent },
        select: { id: true },
      })
    ).toEqual({ id: recent });
  });

  it("sniffs image types from bytes only", () => {
    expect(sniffImageMime(PNG)).toBe("image/png");
    expect(sniffImageMime(Buffer.from(JPEG_BASE64, "base64"))).toBe(
      "image/jpeg"
    );
    expect(sniffImageMime(Buffer.from(WEBP_BASE64, "base64"))).toBe(
      "image/webp"
    );
    expect(sniffImageMime(Buffer.from("GIF89a....."))).toBeNull();
    expect(sniffImageMime(new Uint8Array(0))).toBeNull();
  });
});

describe("bug report rate limits", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext({
      BUG_REPORTS_PER_HOUR: "2",
      BUG_REPORTS_PER_IP_PER_HOUR: "3",
    });
  });
  afterAll(() => ctx.close());

  it("limits per player and per IP, with Retry-After", async () => {
    const a = await ctx.login();
    const b = await ctx.login();
    const send = (token: string) =>
      ctx.app.request("/bug-reports", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(reportBody()),
      });
    expect((await send(a.token)).status).toBe(201);
    expect((await send(a.token)).status).toBe(201);
    const perPlayer = await send(a.token);
    expect(perPlayer.status).toBe(429);
    expect(((await perPlayer.json()) as { error: string }).error).toBe(
      "rate_limited"
    );
    expect(Number(perPlayer.headers.get("retry-after"))).toBeGreaterThan(0);

    // The blocked attempt did not count; the IP has 2 of 3.
    expect((await send(b.token)).status).toBe(201);
    const perIp = await send(b.token);
    expect(perIp.status).toBe(429);
  });
});
