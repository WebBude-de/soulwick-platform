import { BugReportImageMime } from "@soulwick/contracts";
import { apiBinary } from "@/lib/api";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Screenshot of a bug report (P-033). The API serves it only with the admin bearer token, which
 * stays in the httpOnly cookie: this handler fetches the bytes server-side and passes on nothing
 * but the image (fixed path, image types only). The proxy already turned visitors without a
 * session cookie away; an invalid session gets the API's status without a body.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!UUID.test(id)) {
    return new Response(null, { status: 404 });
  }
  const res = await apiBinary(
    `/admin/bug-reports/${encodeURIComponent(id)}/image`
  );
  if (!res) {
    return new Response(null, { status: 502 });
  }
  const mime = BugReportImageMime.safeParse(
    res.headers.get("content-type")?.split(";")[0]?.trim()
  );
  if (!(res.ok && mime.success)) {
    await res.body?.cancel();
    return new Response(null, { status: res.ok ? 502 : res.status });
  }
  return new Response(res.body, {
    headers: {
      "content-type": mime.data,
      // Screenshots may show personal data: only this browser may keep a copy (like the API).
      "cache-control": "private, max-age=300",
      "content-disposition": "inline",
      "x-content-type-options": "nosniff",
    },
  });
}
