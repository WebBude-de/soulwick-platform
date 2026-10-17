import {
  type AdminBugReportDetail,
  type AdminBugReportList,
  type AdminBugReportListItem,
  type AdminBugReportQuery,
  BUG_REPORT_NOTE_PREVIEW,
  type BugReportCategory,
  type BugReportImageMime,
  type BugReportKind,
  type BugReportKindCounts,
  type BugReportMark,
  type BugReportPlatform,
  type BugReportStatus,
  type BugReportStatusCounts,
  type BugReportStroke,
  type CreateBugReportRequest,
  IsoDateTime,
  Uuid,
} from "@soulwick/contracts";
import type { Prisma } from "@soulwick/db";
import { z } from "zod";
import { ApiError, isRecordNotFound, withCause } from "../lib/errors.ts";
import { iso, isoOrNull } from "../lib/validate.ts";
import { writeAudit } from "./audit.ts";
import type { Db, DbOrTx } from "./db-types.ts";

/**
 * Bug reports from the game (P-033): upload, admin list/detail/image, status, deletion and the
 * automatic cleanup after the retention period.
 */

const DAY_MS = 86_400_000;

export const bugReportNotFound = () =>
  new ApiError(404, "bug_report_not_found", "Bug report not found");

/** Everything but the image bytes. */
const DETAIL_SELECT = {
  id: true,
  playerId: true,
  createdAt: true,
  status: true,
  kind: true,
  note: true,
  categories: true,
  marks: true,
  strokes: true,
  context: true,
  gameVersion: true,
  platform: true,
  imageMime: true,
  handledBy: true,
  handledAt: true,
  player: { select: { name: true } },
  handledByUser: { select: { email: true } },
} satisfies Prisma.BugReportSelect;

type DetailRow = Prisma.BugReportGetPayload<{ select: typeof DETAIL_SELECT }>;

/** POST /bug-reports: stores one report; `createdAt` comes from the app clock (cursor precision). */
export async function createBugReport(
  db: DbOrTx,
  input: {
    playerId: string;
    body: z.output<typeof CreateBugReportRequest>;
    image: { bytes: Uint8Array<ArrayBuffer>; mime: BugReportImageMime };
    now: Date;
  }
): Promise<{ id: string }> {
  const { body } = input;
  const row = await db.bugReport.create({
    data: {
      playerId: input.playerId,
      createdAt: input.now,
      kind: body.kind,
      note: body.note,
      categories: body.categories,
      marks: body.marks as Prisma.InputJsonArray,
      strokes: body.strokes as Prisma.InputJsonArray,
      context: body.context as Prisma.InputJsonObject,
      gameVersion: body.gameVersion,
      platform: body.platform,
      imageMime: input.image.mime,
      image: input.image.bytes,
    },
    select: { id: true },
  });
  return row;
}

// --- cursor -------------------------------------------------------------------------------------

const CursorPayload = z.tuple([IsoDateTime, Uuid]);

/** Opaque cursor: base64url of `[createdAt, id]` of the last row of the previous page. */
export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify([iso(createdAt), id])).toString(
    "base64url"
  );
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch (err) {
    throw withCause(invalidCursor(), err);
  }
  const parsed = CursorPayload.safeParse(raw);
  if (!parsed.success) {
    throw invalidCursor();
  }
  return { createdAt: new Date(parsed.data[0]), id: parsed.data[1] };
}

const invalidCursor = () =>
  new ApiError(400, "validation_error", "Invalid query", {
    details: [{ path: "cursor", message: "invalid cursor" }],
  });

// --- mapping ------------------------------------------------------------------------------------

function notePreview(note: string): string {
  return note.length > BUG_REPORT_NOTE_PREVIEW
    ? `${note.slice(0, BUG_REPORT_NOTE_PREVIEW).trimEnd()}…`
    : note;
}

const asArray = (value: Prisma.JsonValue): unknown[] =>
  Array.isArray(value) ? value : [];

const asObject = (value: Prisma.JsonValue): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

function locationOf(context: Prisma.JsonValue): string | null {
  const location = asObject(context).location;
  return typeof location === "string" && location.trim() !== ""
    ? location
    : null;
}

function toListItem(row: DetailRow): AdminBugReportListItem {
  return {
    id: row.id,
    playerId: row.playerId,
    playerName: row.player.name,
    createdAt: iso(row.createdAt),
    status: row.status,
    kind: row.kind,
    categories: row.categories as BugReportCategory[],
    notePreview: notePreview(row.note),
    markCount: asArray(row.marks).length,
    strokeCount: asArray(row.strokes).length,
    platform: row.platform as BugReportPlatform,
    gameVersion: row.gameVersion,
    location: locationOf(row.context),
    handledAt: isoOrNull(row.handledAt),
    handledByEmail: row.handledByUser?.email ?? null,
  };
}

export const bugReportImagePath = (id: string) =>
  `/admin/bug-reports/${id}/image`;

function toDetail(
  row: DetailRow,
  imageBytes: number,
  retentionDays: number
): AdminBugReportDetail {
  return {
    ...toListItem(row),
    note: row.note,
    marks: asArray(row.marks) as BugReportMark[],
    strokes: asArray(row.strokes) as BugReportStroke[],
    context: asObject(row.context),
    imageMime: row.imageMime as BugReportImageMime,
    imageBytes,
    imageUrl: bugReportImagePath(row.id),
    handledById: row.handledBy,
    expiresAt: iso(new Date(row.createdAt.getTime() + retentionDays * DAY_MS)),
  };
}

// --- admin --------------------------------------------------------------------------------------

/** GET /admin/bug-reports: newest first, keyset pagination over (created_at, id). */
export async function listBugReports(
  db: DbOrTx,
  q: AdminBugReportQuery
): Promise<AdminBugReportList> {
  const shared: Prisma.BugReportWhereInput = {
    ...(q.platform ? { platform: q.platform } : {}),
    ...(q.category ? { categories: { has: q.category } } : {}),
    ...(q.playerId ? { playerId: q.playerId } : {}),
  };
  const byStatus = q.status ? { status: q.status } : {};
  const byKind = q.kind ? { kind: q.kind } : {};
  const where: Prisma.BugReportWhereInput = {
    ...shared,
    ...byStatus,
    ...byKind,
  };
  const after = q.cursor ? decodeCursor(q.cursor) : null;
  const page: Prisma.BugReportWhereInput = after
    ? {
        AND: [
          where,
          {
            OR: [
              { createdAt: { lt: after.createdAt } },
              { createdAt: after.createdAt, id: { lt: after.id } },
            ],
          },
        ],
      }
    : where;

  const [rows, total, grouped, groupedKinds] = await Promise.all([
    db.bugReport.findMany({
      where: page,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: q.limit + 1,
      select: DETAIL_SELECT,
    }),
    db.bugReport.count({ where }),
    db.bugReport.groupBy({
      by: ["status"],
      where: { ...shared, ...byKind },
      _count: true,
    }),
    db.bugReport.groupBy({
      by: ["kind"],
      where: { ...shared, ...byStatus },
      _count: true,
    }),
  ]);
  const counts: BugReportStatusCounts = {
    new: 0,
    seen: 0,
    done: 0,
    wont_fix: 0,
  };
  for (const row of grouped) {
    counts[row.status] = row._count;
  }
  const kindCounts: BugReportKindCounts = { bug: 0, idea: 0 };
  for (const row of groupedKinds) {
    kindCounts[row.kind] = row._count;
  }
  const hasMore = rows.length > q.limit;
  const items = rows.slice(0, q.limit);
  const last = items.at(-1);
  return {
    items: items.map(toListItem),
    nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
    total,
    counts,
    kindCounts,
  };
}

async function imageSize(db: DbOrTx, id: string): Promise<number> {
  const rows = await db.$queryRaw<{ n: number }[]>`
    select octet_length(image)::int as n from bug_reports where id = ${id}::uuid`;
  return rows[0]?.n ?? 0;
}

/** GET /admin/bug-reports/:id: everything but the image bytes; 404 `bug_report_not_found`. */
export async function getBugReport(
  db: DbOrTx,
  id: string,
  retentionDays: number
): Promise<AdminBugReportDetail> {
  const row = await db.bugReport.findUnique({
    where: { id },
    select: DETAIL_SELECT,
  });
  if (!row) {
    throw bugReportNotFound();
  }
  return toDetail(row, await imageSize(db, id), retentionDays);
}

/** GET /admin/bug-reports/:id/image. */
export async function getBugReportImage(
  db: DbOrTx,
  id: string
): Promise<{ bytes: Uint8Array; mime: BugReportImageMime }> {
  const row = await db.bugReport.findUnique({
    where: { id },
    select: { image: true, imageMime: true },
  });
  if (!row) {
    throw bugReportNotFound();
  }
  return { bytes: row.image, mime: row.imageMime as BugReportImageMime };
}

/**
 * PATCH /admin/bug-reports/:id: sets the status; anything but `new` records who and when, `new`
 * clears both. Audit `bug_report.status` in the same transaction.
 */
export async function setBugReportStatus(
  db: Db,
  input: {
    id: string;
    status: BugReportStatus;
    adminId: string;
    now: Date;
    retentionDays: number;
  }
): Promise<AdminBugReportDetail> {
  const { id, status, adminId, now } = input;
  await db.$transaction(async (tx) => {
    const current = await tx.bugReport.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!current) {
      throw bugReportNotFound();
    }
    const handled = status !== "new";
    await tx.bugReport.update({
      where: { id },
      data: {
        status,
        handledBy: handled ? adminId : null,
        handledAt: handled ? now : null,
      },
    });
    await writeAudit(tx, {
      adminId,
      action: "bug_report.status",
      targetType: "bug_report",
      targetId: id,
      details: { from: current.status, to: status },
    });
  });
  return await getBugReport(db, id, input.retentionDays);
}

/** DELETE /admin/bug-reports/:id (admin): audit `bug_report.delete` without note or image. */
export async function deleteBugReport(
  db: Db,
  input: { id: string; adminId: string }
): Promise<void> {
  const { id, adminId } = input;
  await db.$transaction(async (tx) => {
    let row: {
      playerId: string;
      status: BugReportStatus;
      kind: BugReportKind;
      categories: string[];
      platform: string;
      gameVersion: string;
      createdAt: Date;
    };
    try {
      row = await tx.bugReport.delete({
        where: { id },
        select: {
          playerId: true,
          status: true,
          kind: true,
          categories: true,
          platform: true,
          gameVersion: true,
          createdAt: true,
        },
      });
    } catch (err) {
      if (isRecordNotFound(err)) {
        throw withCause(bugReportNotFound(), err);
      }
      throw err;
    }
    await writeAudit(tx, {
      adminId,
      action: "bug_report.delete",
      targetType: "bug_report",
      targetId: id,
      details: {
        playerId: row.playerId,
        status: row.status,
        kind: row.kind,
        categories: row.categories,
        platform: row.platform,
        gameVersion: row.gameVersion,
        createdAt: iso(row.createdAt),
      },
    });
  });
}

// --- retention ----------------------------------------------------------------------------------

/** Deletes reports older than `retentionDays` (P-033); returns how many went. */
export async function deleteExpiredBugReports(
  db: DbOrTx,
  now: Date,
  retentionDays: number
): Promise<number> {
  const { count } = await db.bugReport.deleteMany({
    where: {
      createdAt: { lt: new Date(now.getTime() - retentionDays * DAY_MS) },
    },
  });
  return count;
}

/** For the account deletion preview (P-033). */
export function countBugReportsOf(
  db: DbOrTx,
  playerId: string
): Promise<number> {
  return db.bugReport.count({ where: { playerId } });
}
