import type { AdminPlayerNote } from "@soulwick/contracts";
import type { Prisma } from "@soulwick/db";
import { iso } from "../lib/validate.ts";
import type { DbOrTx } from "./db-types.ts";

const noteInclude = {
  admin: { select: { email: true } },
} satisfies Prisma.PlayerNoteInclude;

type NoteRow = Prisma.PlayerNoteGetPayload<{ include: typeof noteInclude }>;

const toNote = (n: NoteRow): AdminPlayerNote => ({
  id: n.id,
  playerId: n.playerId,
  text: n.text,
  createdAt: iso(n.createdAt),
  authorId: n.adminId,
  authorEmail: n.admin?.email ?? null,
});

/** Moderation notes of a player, newest first (P-023). */
export async function listPlayerNotes(
  db: DbOrTx,
  playerId: string
): Promise<AdminPlayerNote[]> {
  const rows = await db.playerNote.findMany({
    where: { playerId },
    include: noteInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return rows.map(toNote);
}

export async function createPlayerNote(
  db: DbOrTx,
  data: { playerId: string; adminId: string; text: string; now: Date }
): Promise<AdminPlayerNote> {
  const row = await db.playerNote.create({
    data: {
      playerId: data.playerId,
      adminId: data.adminId,
      text: data.text,
      createdAt: data.now,
    },
    include: noteInclude,
  });
  return toNote(row);
}

/** The note if it belongs to this player, else null. */
export function findPlayerNote(db: DbOrTx, playerId: string, noteId: string) {
  return db.playerNote.findFirst({ where: { id: noteId, playerId } });
}
