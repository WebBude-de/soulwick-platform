import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  AdminPlayerDetail,
  AdminPlayerNote,
  AdminPlayerNoteList,
} from "@soulwick/contracts";
import { createTestContext, type TestContext } from "./helpers.ts";

describe("admin moderation (notes, guild transfer, filters)", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(() => ctx.close());

  describe("player notes", () => {
    it("moderators add and list notes; the detail counts them; every write is audited", async () => {
      const mod = await ctx.createAdmin("moderator");
      const p = await ctx.login("Notiert");

      const first = await ctx.req("POST", `/admin/players/${p.id}/notes`, {
        token: mod.token,
        body: { text: "  Hat im Chat beleidigt.  " },
      });
      expect(first.status).toBe(201);
      const note = AdminPlayerNote.parse(first.json);
      expect(note).toMatchObject({
        playerId: p.id,
        text: "Hat im Chat beleidigt.",
        authorId: mod.id,
        authorEmail: mod.email,
      });
      await ctx.req("POST", `/admin/players/${p.id}/notes`, {
        token: mod.token,
        body: { text: "Zweite Notiz" },
      });

      const list = await ctx.req("GET", `/admin/players/${p.id}/notes`, {
        token: mod.token,
      });
      expect(list.status).toBe(200);
      expect(
        AdminPlayerNoteList.parse(list.json).items.map((n) => n.text)
      ).toEqual(["Zweite Notiz", "Hat im Chat beleidigt."]);

      const detail = await ctx.req("GET", `/admin/players/${p.id}`, {
        token: mod.token,
      });
      expect(AdminPlayerDetail.parse(detail.json)).toMatchObject({
        noteCount: 2,
        runsTotal: 0,
      });

      const audit = await ctx.req(
        "GET",
        `/admin/audit?targetId=${p.id}&action=player.note_add`,
        { token: mod.token }
      );
      expect(audit.json.total).toBe(2);
      expect(audit.json.items[1].details).toEqual({
        noteId: note.id,
        text: "Hat im Chat beleidigt.",
      });
    });

    it("only admins and the author delete notes", async () => {
      const author = await ctx.createAdmin("moderator");
      const other = await ctx.createAdmin("moderator");
      const admin = await ctx.createAdmin("admin");
      const p = await ctx.login();
      const add = async (text: string) =>
        (
          await ctx.req("POST", `/admin/players/${p.id}/notes`, {
            token: author.token,
            body: { text },
          })
        ).json.id as string;
      const a = await add("Von der Autorin gelöscht");
      const b = await add("Vom Admin gelöscht");

      const denied = await ctx.req(
        "DELETE",
        `/admin/players/${p.id}/notes/${a}`,
        { token: other.token }
      );
      expect(denied.status).toBe(403);
      expect(denied.json.error).toBe("forbidden");

      expect(
        (
          await ctx.req("DELETE", `/admin/players/${p.id}/notes/${a}`, {
            token: author.token,
          })
        ).status
      ).toBe(204);
      expect(
        (
          await ctx.req("DELETE", `/admin/players/${p.id}/notes/${b}`, {
            token: admin.token,
          })
        ).status
      ).toBe(204);
      const again = await ctx.req(
        "DELETE",
        `/admin/players/${p.id}/notes/${b}`,
        { token: admin.token }
      );
      expect(again.status).toBe(404);
      expect(again.json.error).toBe("note_not_found");

      const audit = await ctx.req(
        "GET",
        `/admin/audit?targetId=${p.id}&action=player.note_delete`,
        { token: admin.token }
      );
      expect(
        audit.json.items.map((e: { details: { text: string } }) => e.details)
      ).toEqual([
        expect.objectContaining({ noteId: b, text: "Vom Admin gelöscht" }),
        expect.objectContaining({
          noteId: a,
          authorId: author.id,
          text: "Von der Autorin gelöscht",
        }),
      ]);
    });

    it("validates input and ownership of the note; notes go with the account", async () => {
      const admin = await ctx.createAdmin("admin");
      const p = await ctx.login();
      const q = await ctx.login();
      const empty = await ctx.req("POST", `/admin/players/${p.id}/notes`, {
        token: admin.token,
        body: { text: "   " },
      });
      expect(empty.status).toBe(400);
      const unknown = await ctx.req(
        "POST",
        `/admin/players/${randomUUID()}/notes`,
        { token: admin.token, body: { text: "Hallo" } }
      );
      expect(unknown.status).toBe(404);
      expect(
        (
          await ctx.req("GET", `/admin/players/${randomUUID()}/notes`, {
            token: admin.token,
          })
        ).status
      ).toBe(404);

      const note = await ctx.req("POST", `/admin/players/${p.id}/notes`, {
        token: admin.token,
        body: { text: "Gehört zu p" },
      });
      // Right note id, wrong player.
      const wrongPlayer = await ctx.req(
        "DELETE",
        `/admin/players/${q.id}/notes/${note.json.id}`,
        { token: admin.token }
      );
      expect(wrongPlayer.status).toBe(404);
      expect(wrongPlayer.json.error).toBe("note_not_found");

      expect(
        (
          await ctx.req("DELETE", `/admin/players/${p.id}`, {
            token: admin.token,
          })
        ).status
      ).toBe(200);
      expect(await ctx.db.playerNote.count({ where: { playerId: p.id } })).toBe(
        0
      );
    });
  });

  describe("guilds", () => {
    async function guildWithMembers() {
      const founder = await ctx.login();
      const member = await ctx.login();
      const tag = `T${randomUUID().slice(0, 4)}`.toUpperCase();
      const created = await ctx.req("POST", "/guilds", {
        token: founder.token,
        body: { name: `Gilde ${tag}`, tag },
      });
      await ctx.req("POST", "/guilds/join", {
        token: member.token,
        body: { inviteCode: created.json.inviteCode },
      });
      return { id: created.json.id as string, founder, member };
    }

    it("transfers the founder role to a member; the previous founder becomes officer", async () => {
      const mod = await ctx.createAdmin("moderator");
      const g = await guildWithMembers();
      const res = await ctx.req("POST", `/admin/guilds/${g.id}/transfer`, {
        token: mod.token,
        body: { playerId: g.member.id, reason: "Gründer inaktiv" },
      });
      expect(res.status).toBe(200);
      expect(res.json).toEqual({
        id: g.id,
        founderId: g.member.id,
        previousFounderId: g.founder.id,
      });
      const own = await ctx.req("GET", `/guilds/${g.id}`, {
        token: g.member.token,
      });
      expect(own.json.founderId).toBe(g.member.id);
      const roles = Object.fromEntries(
        own.json.members.map((m: { playerId: string; role: string }) => [
          m.playerId,
          m.role,
        ])
      );
      expect(roles).toEqual({
        [g.member.id]: "founder",
        [g.founder.id]: "officer",
      });

      const audit = await ctx.req(
        "GET",
        `/admin/audit?targetId=${g.id}&action=guild.transfer`,
        { token: mod.token }
      );
      expect(audit.json.items[0].details).toEqual({
        from: g.founder.id,
        to: g.member.id,
        reason: "Gründer inaktiv",
      });
    });

    it("rejects non-members, the current founder, a missing reason and disbanded guilds", async () => {
      const admin = await ctx.createAdmin("admin");
      const g = await guildWithMembers();
      const outsider = await ctx.login();
      const transfer = (playerId: string, reason?: string) =>
        ctx.req("POST", `/admin/guilds/${g.id}/transfer`, {
          token: admin.token,
          body: { playerId, ...(reason ? { reason } : {}) },
        });

      const notMember = await transfer(outsider.id, "Test");
      expect(notMember.status).toBe(404);
      expect(notMember.json.error).toBe("not_a_member");
      const founder = await transfer(g.founder.id, "Test");
      expect(founder.status).toBe(409);
      expect(founder.json.error).toBe("already_founder");
      expect((await transfer(g.member.id)).status).toBe(400);

      await ctx.req("POST", `/admin/guilds/${g.id}/disband`, {
        token: admin.token,
      });
      const disbanded = await transfer(g.member.id, "Test");
      expect(disbanded.status).toBe(409);
      expect(disbanded.json.error).toBe("guild_disbanded");
      expect(
        (
          await ctx.req("POST", `/admin/guilds/${randomUUID()}/transfer`, {
            token: admin.token,
            body: { playerId: g.member.id, reason: "Test" },
          })
        ).status
      ).toBe(404);
    });

    it("filters the list by status (active, disbanded, all)", async () => {
      const admin = await ctx.createAdmin("admin");
      const active = await guildWithMembers();
      const gone = await guildWithMembers();
      await ctx.req("POST", `/admin/guilds/${gone.id}/disband`, {
        token: admin.token,
      });
      const ids = async (query: string) =>
        (
          await ctx.req("GET", `/admin/guilds?limit=200${query}`, {
            token: admin.token,
          })
        ).json.items.map((g: { id: string }) => g.id) as string[];

      const disbanded = await ids("&status=disbanded");
      expect(disbanded).toContain(gone.id);
      expect(disbanded).not.toContain(active.id);
      const onlyActive = await ids("&status=active");
      expect(onlyActive).toContain(active.id);
      expect(onlyActive).not.toContain(gone.id);
      expect(await ids("&status=all")).toEqual(
        expect.arrayContaining([active.id, gone.id])
      );
      // Old parameter keeps working; status wins over it.
      expect(await ids("&includeDisbanded=true")).toContain(gone.id);
      expect(await ids("")).not.toContain(gone.id);
      expect(await ids("&includeDisbanded=true&status=active")).not.toContain(
        gone.id
      );
      const bad = await ctx.req("GET", "/admin/guilds?status=gone", {
        token: admin.token,
      });
      expect(bad.status).toBe(400);
    });
  });

  describe("audit filters", () => {
    it("filters by time range (days or timestamps), action group and target type", async () => {
      const admin = await ctx.createAdmin("admin");
      const at = (iso: string) => new Date(iso);
      for (const [action, targetType, createdAt] of [
        ["relay.kick", "player", "2020-01-01T10:00:00Z"],
        ["relay.room_close", "relay_room", "2020-01-02T23:59:00Z"],
        ["player.ban", "player", "2020-01-03T00:00:00Z"],
      ] as const) {
        await ctx.db.auditLog.create({
          data: {
            adminId: admin.id,
            action,
            targetType,
            targetId: "audit-filter-test",
            createdAt: at(createdAt),
          },
        });
      }
      const actions = async (query: string) =>
        (
          await ctx.req(
            "GET",
            `/admin/audit?targetId=audit-filter-test${query}`,
            {
              token: admin.token,
            }
          )
        ).json.items.map((e: { action: string }) => e.action);

      expect(await actions("&from=2020-01-02&to=2020-01-02")).toEqual([
        "relay.room_close",
      ]);
      expect(await actions("&from=2020-01-02")).toEqual([
        "player.ban",
        "relay.room_close",
      ]);
      expect(await actions("&to=2020-01-02T23:58:00Z")).toEqual(["relay.kick"]);
      expect(await actions("&actionPrefix=relay.")).toEqual([
        "relay.room_close",
        "relay.kick",
      ]);
      expect(await actions("&targetType=player")).toEqual([
        "player.ban",
        "relay.kick",
      ]);
      expect(await actions("&action=player.ban&actionPrefix=relay.")).toEqual(
        []
      );
      const bad = await ctx.req("GET", "/admin/audit?from=gestern", {
        token: admin.token,
      });
      expect(bad.status).toBe(400);
    });
  });
});
