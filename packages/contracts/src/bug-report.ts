import { z } from "zod";
import { IsoDateTime, Uuid } from "./common.ts";

/**
 * Bug reports from the game (P-033): the in-game feedback tool (F9) uploads a screenshot with
 * marked areas, notes and categories; admins and moderators read them in the admin panel. Since
 * 17.10.2026 the tool has two tabs, "report a bug" and "submit an idea" (`kind`); the game no
 * longer shows categories, but older builds still send them.
 */

// --- limits -------------------------------------------------------------------------------------

/** Longest player note of a report (characters). */
export const BUG_REPORT_MAX_NOTE = 2000;
/** Longest note of one mark (characters). */
export const BUG_REPORT_MAX_MARK_NOTE = 300;
/** Most marks (rectangles) per report. */
export const BUG_REPORT_MAX_MARKS = 20;
/** Most freehand strokes per report. */
export const BUG_REPORT_MAX_STROKES = 20;
/** Most points per freehand stroke; the game thins longer strokes before the upload. */
export const BUG_REPORT_MAX_STROKE_POINTS = 256;
/** Largest `context` object, measured as UTF-8 JSON (16 KiB). */
export const BUG_REPORT_MAX_CONTEXT_BYTES = 16 * 1024;
/** Largest decoded screenshot (1.5 MiB). WebP or JPEG keep a 1080p screenshot well below it. */
export const BUG_REPORT_MAX_IMAGE_BYTES = 1_572_864;
/** Base64 length of BUG_REPORT_MAX_IMAGE_BYTES (4 characters per 3 bytes, with padding). */
export const BUG_REPORT_MAX_IMAGE_BASE64 =
  Math.ceil(BUG_REPORT_MAX_IMAGE_BYTES / 3) * 4;
/**
 * Largest request body of POST /bug-reports (2.25 MiB): the base64 image plus 256 KiB for note,
 * marks, strokes and context. Larger bodies get 413 `payload_too_large` before they are parsed.
 */
export const BUG_REPORT_MAX_BODY_BYTES =
  BUG_REPORT_MAX_IMAGE_BASE64 + 256 * 1024;
/** TESTWERT: reports are deleted this many days after they were sent (P-033). */
export const BUG_REPORT_RETENTION_DAYS_DEFAULT = 90;

// --- enums --------------------------------------------------------------------------------------

/** Whether the player reports a bug or submits an idea; reports without `kind` are bugs. */
export const BugReportKind = z.enum(["bug", "idea"]);
export type BugReportKind = z.infer<typeof BugReportKind>;

/**
 * What the report is about; the player may pick several (or none). Builds since 17.10.2026 send
 * none; the field stays for older builds.
 */
export const BugReportCategory = z.enum([
  "ui",
  "graphics",
  "light",
  "layout",
  "gameplay",
  "bug",
  "text",
]);
export type BugReportCategory = z.infer<typeof BugReportCategory>;

/** Platform of the game build that sent the report. */
export const BugReportPlatform = z.enum([
  "windows",
  "linux",
  "android",
  "ios",
  "macos",
  /** Web build of the game (added after the first release of the contract). */
  "web",
]);
export type BugReportPlatform = z.infer<typeof BugReportPlatform>;

/** Processing state in the admin panel; new reports start as `new`. */
export const BugReportStatus = z.enum(["new", "seen", "done", "wont_fix"]);
export type BugReportStatus = z.infer<typeof BugReportStatus>;

/** Image types the API accepts; detected from the magic bytes, never from the client. */
export const BugReportImageMime = z.enum([
  "image/webp",
  "image/jpeg",
  "image/png",
]);
export type BugReportImageMime = z.infer<typeof BugReportImageMime>;

// --- upload (game) ------------------------------------------------------------------------------

/** Relative coordinate on the screenshot: 0 = left/top edge, 1 = right/bottom edge. */
export const RelativeCoord = z.number().min(0).max(1);

/** A marked rectangle, relative to the screenshot size, with an optional short note. */
export const BugReportMark = z.object({
  x: RelativeCoord,
  y: RelativeCoord,
  w: RelativeCoord,
  h: RelativeCoord,
  note: z.string().trim().max(BUG_REPORT_MAX_MARK_NOTE).default(""),
});
export type BugReportMark = z.infer<typeof BugReportMark>;

/** One point of a freehand stroke: `[x, y]`, relative like the marks. */
export const BugReportPoint = z.tuple([RelativeCoord, RelativeCoord]);
export type BugReportPoint = z.infer<typeof BugReportPoint>;

/** A freehand stroke: 1 to BUG_REPORT_MAX_STROKE_POINTS points in drawing order. */
export const BugReportStroke = z
  .array(BugReportPoint)
  .min(1)
  .max(BUG_REPORT_MAX_STROKE_POINTS);
export type BugReportStroke = z.infer<typeof BugReportStroke>;

/**
 * Free-form game state at the moment of the report (JSON object, at most
 * BUG_REPORT_MAX_CONTEXT_BYTES as UTF-8 JSON). The named fields are the ones the admin panel shows;
 * every other key is stored as sent. No personal data (no Steam ids, no names other than the
 * player's own, no file paths with user names).
 */
export const BugReportContext = z
  .looseObject({
    /** Where the player was, readable, e.g. "Krypta, Raum 7 (Arena Tore)" or "Dorf". Shown in the list. */
    location: z.string().max(200).optional(),
    /** Scene or room template, e.g. "res://dungeon/rooms/combat/arena_tore_crypt.tscn". */
    scene: z.string().max(300).optional(),
    /** Run seed, if a run was active. */
    seed: z.string().max(64).optional(),
    /** Window or screen resolution, e.g. "1920x1080". */
    resolution: z.string().max(32).optional(),
    /** Game language, e.g. "de". */
    locale: z.string().max(16).optional(),
  })
  .refine(
    (value) =>
      new TextEncoder().encode(JSON.stringify(value)).length <=
      BUG_REPORT_MAX_CONTEXT_BYTES,
    { message: `context must be at most ${BUG_REPORT_MAX_CONTEXT_BYTES} bytes` }
  );
export type BugReportContext = z.infer<typeof BugReportContext>;

/**
 * POST /bug-reports (player session, guest accounts included) -> 201 `CreateBugReportResponse`.
 *
 * - Body at most BUG_REPORT_MAX_BODY_BYTES; `image` is plain base64 (no `data:` prefix) of a WebP,
 *   JPEG or PNG file, decoded at most BUG_REPORT_MAX_IMAGE_BYTES. The type is taken from the magic
 *   bytes; there is no MIME field to send.
 * - Errors: 400 `validation_error` (schema, with `details`), 400 `invalid_json`, 400
 *   `invalid_image` (not base64, empty or not WebP/JPEG/PNG), 413 `payload_too_large` (body or
 *   decoded image too large), 401 `unauthorized`, 403 `banned`, 429 `rate_limited` (per player
 *   and per IP and hour, header `Retry-After` in seconds).
 * - Reports are kept BUG_REPORT_RETENTION_DAYS_DEFAULT days (TESTWERT) and deleted with the account.
 */
export const CreateBugReportRequest = z.object({
  /** "bug" (default, also for older builds without the field) or "idea". */
  kind: BugReportKind.default("bug"),
  /** What happened, in the player's words; may be empty when the marks say it all. */
  note: z.string().trim().max(BUG_REPORT_MAX_NOTE).default(""),
  /** Duplicates are removed. */
  categories: z
    .array(BugReportCategory)
    .max(BugReportCategory.options.length * 2)
    .default([])
    .transform((list) => [...new Set(list)]),
  marks: z.array(BugReportMark).max(BUG_REPORT_MAX_MARKS).default([]),
  strokes: z.array(BugReportStroke).max(BUG_REPORT_MAX_STROKES).default([]),
  context: BugReportContext,
  gameVersion: z.string().trim().min(1).max(32),
  platform: BugReportPlatform,
  /** Base64 of the screenshot (WebP preferred, JPEG or PNG). */
  image: z.string().min(1),
});
export type CreateBugReportRequest = z.input<typeof CreateBugReportRequest>;

export const CreateBugReportResponse = z.object({ id: Uuid });
export type CreateBugReportResponse = z.infer<typeof CreateBugReportResponse>;

// --- admin panel --------------------------------------------------------------------------------

/** Characters of the note in the list (`notePreview`). */
export const BUG_REPORT_NOTE_PREVIEW = 140;

/**
 * GET /admin/bug-reports (moderator and admin), newest first, cursor pagination: pass
 * `nextCursor` of the previous page as `cursor`. `cursor` is opaque; an invalid one is 400
 * `validation_error`.
 */
export const AdminBugReportQuery = z.object({
  status: BugReportStatus.optional(),
  kind: BugReportKind.optional(),
  platform: BugReportPlatform.optional(),
  category: BugReportCategory.optional(),
  playerId: Uuid.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AdminBugReportQuery = z.infer<typeof AdminBugReportQuery>;

export const BugReportStatusCounts = z.object({
  new: z.number().int().min(0),
  seen: z.number().int().min(0),
  done: z.number().int().min(0),
  wont_fix: z.number().int().min(0),
});
export type BugReportStatusCounts = z.infer<typeof BugReportStatusCounts>;

export const BugReportKindCounts = z.object({
  bug: z.number().int().min(0),
  idea: z.number().int().min(0),
});
export type BugReportKindCounts = z.infer<typeof BugReportKindCounts>;

/** One row of the list; no image, no full note. */
export const AdminBugReportListItem = z.object({
  id: Uuid,
  playerId: Uuid,
  playerName: z.string(),
  createdAt: IsoDateTime,
  status: BugReportStatus,
  kind: BugReportKind,
  categories: z.array(BugReportCategory),
  /** The first BUG_REPORT_NOTE_PREVIEW characters of the note ("…" appended when cut). */
  notePreview: z.string(),
  markCount: z.number().int().min(0),
  strokeCount: z.number().int().min(0),
  platform: BugReportPlatform,
  gameVersion: z.string(),
  /** `context.location` if the game sent one. */
  location: z.string().nullable(),
  /** When the status was last set away from `new`, and by whom (null = never or account gone). */
  handledAt: IsoDateTime.nullable(),
  handledByEmail: z.string().nullable(),
});
export type AdminBugReportListItem = z.infer<typeof AdminBugReportListItem>;

/**
 * 200 of GET /admin/bug-reports. `total` matches all filters; `counts` per status respect every
 * filter except `status`, so the panel can show all four numbers as tabs; `kindCounts` respect
 * every filter except `kind` (for the "Fehler / Ideen / Alle" switch).
 */
export const AdminBugReportList = z.object({
  items: z.array(AdminBugReportListItem),
  /** Pass as `cursor` for the next page; null = last page. */
  nextCursor: z.string().nullable(),
  total: z.number().int().min(0),
  counts: BugReportStatusCounts,
  kindCounts: BugReportKindCounts,
});
export type AdminBugReportList = z.infer<typeof AdminBugReportList>;

/**
 * GET /admin/bug-reports/:id (moderator and admin): everything except the image bytes. Errors: 404
 * `bug_report_not_found`.
 */
export const AdminBugReportDetail = AdminBugReportListItem.extend({
  note: z.string(),
  marks: z.array(BugReportMark),
  strokes: z.array(BugReportStroke),
  context: z.record(z.string(), z.unknown()),
  imageMime: BugReportImageMime,
  /** Decoded size of the screenshot. */
  imageBytes: z.number().int().min(0),
  /**
   * Path of the screenshot on the API, `/admin/bug-reports/<id>/image`: needs the admin bearer
   * token like every admin route, so the admin panel fetches it server-side and passes it on.
   * Answers the bytes with the stored Content-Type and `Cache-Control: private`.
   */
  imageUrl: z.string(),
  handledById: Uuid.nullable(),
  /** When the report is deleted automatically (createdAt + retention). */
  expiresAt: IsoDateTime,
});
export type AdminBugReportDetail = z.infer<typeof AdminBugReportDetail>;

/**
 * PATCH /admin/bug-reports/:id (moderator and admin) -> 200 `AdminBugReportDetail`. Any status
 * other than `new` sets `handledAt`/`handledBy` to now and the calling account; back to `new`
 * clears both. Audit `bug_report.status` with `from`/`to`. Errors: 404 `bug_report_not_found`,
 * 400 `validation_error`.
 *
 * DELETE /admin/bug-reports/:id (admin only) -> 204; audit `bug_report.delete`. Errors: 403
 * `forbidden` (moderator), 404 `bug_report_not_found`.
 */
export const UpdateBugReportRequest = z.object({ status: BugReportStatus });
export type UpdateBugReportRequest = z.infer<typeof UpdateBugReportRequest>;
