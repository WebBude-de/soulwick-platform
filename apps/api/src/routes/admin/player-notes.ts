import { CreatePlayerNoteRequest, Uuid } from "@soulwick/contracts";
import type { Hono } from "hono";
import { ApiError, forbidden, notFound } from "../../lib/errors.ts";
import { iso, parseBody, parseParam } from "../../lib/validate.ts";
import { requireRole } from "../../middleware/auth.ts";
import { writeAudit } from "../../services/audit.ts";
import {
  createPlayerNote,
  findPlayerNote,
  listPlayerNotes,
} from "../../services/player-notes.ts";
import type { AppEnv, Deps } from "../../types.ts";

/**
 * Moderation notes under /admin/players/:id/notes (P-023): moderators and admins read and write;
 * deleting is for admins and the author of the note. Every write is audited with the text.
 */
export function registerPlayerNoteRoutes(app: Hono<AppEnv>, deps: Deps) {
  const now = () => deps.now?.() ?? new Date();

  async function requirePlayer(id: string) {
    const exists = await deps.db.player.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) {
      throw notFound("Player");
    }
  }

  app.get("/:id/notes", requireRole("moderator"), async (c) => {
    const id = parseParam(c, "id", Uuid);
    await requirePlayer(id);
    return c.json({ items: await listPlayerNotes(deps.db, id) });
  });

  app.post("/:id/notes", requireRole("moderator"), async (c) => {
    const id = parseParam(c, "id", Uuid);
    const { text } = await parseBody(c, CreatePlayerNoteRequest);
    await requirePlayer(id);
    const admin = c.get("admin");
    const note = await deps.db.$transaction(async (tx) => {
      const created = await createPlayerNote(tx, {
        playerId: id,
        adminId: admin.id,
        text,
        now: now(),
      });
      await writeAudit(tx, {
        adminId: admin.id,
        action: "player.note_add",
        targetType: "player",
        targetId: id,
        details: { noteId: created.id, text },
      });
      return created;
    });
    return c.json(note, 201);
  });

  app.delete("/:id/notes/:noteId", requireRole("moderator"), async (c) => {
    const id = parseParam(c, "id", Uuid);
    const noteId = parseParam(c, "noteId", Uuid);
    const note = await findPlayerNote(deps.db, id, noteId);
    if (!note) {
      throw new ApiError(404, "note_not_found", "Note not found");
    }
    const admin = c.get("admin");
    if (admin.role !== "admin" && note.adminId !== admin.id) {
      throw forbidden("Only admins and the author may delete a note");
    }
    await deps.db.$transaction(async (tx) => {
      await tx.playerNote.delete({ where: { id: noteId } });
      await writeAudit(tx, {
        adminId: admin.id,
        action: "player.note_delete",
        targetType: "player",
        targetId: id,
        details: {
          noteId,
          authorId: note.adminId,
          createdAt: iso(note.createdAt),
          text: note.text,
        },
      });
    });
    return c.body(null, 204);
  });
}
