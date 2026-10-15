import {
  AdminBugReportQuery,
  UpdateBugReportRequest,
  Uuid,
} from "@soulwick/contracts";
import { Hono } from "hono";
import { parseBody, parseParam, parseQuery } from "../../lib/validate.ts";
import { requireRole } from "../../middleware/auth.ts";
import {
  deleteBugReport,
  getBugReport,
  getBugReportImage,
  listBugReports,
  setBugReportStatus,
} from "../../services/bug-reports.ts";
import type { AppEnv, Deps } from "../../types.ts";

/**
 * Bug reports from the game (P-033): moderators and admins read them and set the status, only
 * admins delete. Unknown ids answer 404 `bug_report_not_found`, malformed ones 404 `not_found`.
 */
export function adminBugReportRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();
  const now = () => deps.now?.() ?? new Date();
  const retentionDays = deps.config.BUG_REPORT_RETENTION_DAYS;
  const reportId = (c: Parameters<typeof parseParam>[0]) =>
    parseParam(c, "id", Uuid);

  app.get("/", async (c) => {
    const q = parseQuery(c, AdminBugReportQuery);
    return c.json(await listBugReports(deps.db, q));
  });

  app.get("/:id", async (c) =>
    c.json(await getBugReport(deps.db, reportId(c), retentionDays))
  );

  app.get("/:id/image", async (c) => {
    const { bytes, mime } = await getBugReportImage(deps.db, reportId(c));
    c.header("Content-Type", mime);
    c.header("Content-Length", String(bytes.length));
    // Screenshots may show personal data: only the requesting browser may keep a copy.
    c.header("Cache-Control", "private, max-age=300");
    c.header("Content-Disposition", "inline");
    return c.body(new Uint8Array(bytes));
  });

  app.patch("/:id", requireRole("moderator"), async (c) => {
    const id = reportId(c);
    const { status } = await parseBody(c, UpdateBugReportRequest);
    return c.json(
      await setBugReportStatus(deps.db, {
        id,
        status,
        adminId: c.get("admin").id,
        now: now(),
        retentionDays,
      })
    );
  });

  app.delete("/:id", requireRole("admin"), async (c) => {
    await deleteBugReport(deps.db, {
      id: reportId(c),
      adminId: c.get("admin").id,
    });
    return c.body(null, 204);
  });

  return app;
}
