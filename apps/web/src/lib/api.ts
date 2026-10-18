import "server-only";

export type ApiResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      status: number | "unreachable";
      /** Machine-readable `error` code from the API body (`{ error, message? }`), if any. */
      error?: string;
    };

const DEFAULT_API_URL = "http://localhost:3101";
const TIMEOUT_MS = 5000;

/** Server-side GET against the Soulwick API (env API_URL). Never throws. */
export async function apiGet<T>(
  path: string,
  revalidateSeconds = 30
): Promise<ApiResult<T>> {
  const base = process.env.API_URL ?? DEFAULT_API_URL;
  try {
    const res = await fetch(new URL(path, base), {
      next: { revalidate: revalidateSeconds },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      return { ok: false, status: res.status };
    }
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, status: "unreachable" };
  }
}

/**
 * Server-side JSON POST against the Soulwick API (env API_URL), never cached. Never throws;
 * failed responses carry the API's `error` code so callers can show a fitting message.
 */
export async function apiPost<T>(
  path: string,
  body: unknown,
  extraHeaders: Record<string, string> = {}
): Promise<ApiResult<T>> {
  const base = process.env.API_URL ?? DEFAULT_API_URL;
  try {
    const res = await fetch(new URL(path, base), {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        ...extraHeaders,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      return { ok: false, status: res.status, error: await errorCode(res) };
    }
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, status: "unreachable" };
  }
}

async function errorCode(res: Response): Promise<string | undefined> {
  try {
    const parsed: unknown = await res.json();
    if (
      parsed &&
      typeof parsed === "object" &&
      "error" in parsed &&
      typeof parsed.error === "string"
    ) {
      return parsed.error;
    }
  } catch {
    // Body was not JSON; the status code alone has to do.
  }
}

export function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeZone: "Europe/Berlin",
  }).format(new Date(iso));
}
