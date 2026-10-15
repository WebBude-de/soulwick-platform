import "server-only";
import type { AdminSelf } from "@soulwick/contracts";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getToken } from "./session";

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string; message: string };

const ERROR_TEXTS: Record<string, string> = {
  unreachable: "Die API ist nicht erreichbar.",
  unauthorized: "Sitzung abgelaufen – bitte erneut anmelden.",
  invalid_credentials: "E-Mail oder Passwort falsch.",
  forbidden: "Dafür fehlen dir die Rechte.",
  not_found: "Nicht gefunden.",
  validation_error: "Eingabe ungültig.",
  rate_limited: "Zu viele Anfragen – bitte kurz warten.",
  not_banned: "Der Spieler ist nicht gesperrt.",
  not_a_member: "Der Spieler ist kein Mitglied dieser Gilde.",
  guild_disbanded: "Die Gilde ist bereits aufgelöst.",
  guild_name_taken: "Name oder Kürzel ist bereits vergeben.",
  email_taken: "Es gibt bereits einen Admin mit dieser E-Mail.",
  cannot_change_self: "Du kannst dich nicht selbst deaktivieren.",
  player_not_found: "Den Spieler gibt es nicht (mehr).",
  // Admin-API v2 (P-023, P-024)
  relay_not_configured:
    "Der Relay-Server ist in der API nicht eingerichtet (RELAY_INTERNAL_URL/RELAY_INTERNAL_KEY fehlen).",
  relay_unavailable:
    "Der Relay-Server antwortet gerade nicht – bitte gleich noch einmal versuchen.",
  room_not_found:
    "Den Raum gibt es nicht mehr (schon geschlossen oder abgelaufen).",
  player_not_in_room: "Der Spieler ist nicht mehr in diesem Raum.",
  note_not_found: "Die Notiz gibt es nicht (mehr).",
  already_founder: "Der Spieler leitet die Gilde bereits.",
};

export function errorText(code: string, fallback?: string): string {
  return ERROR_TEXTS[code] ?? fallback ?? `Fehler: ${code}`;
}

/** Base URL of the API (server-side only). */
export const apiBase = () => process.env.API_URL ?? "http://localhost:8787";

/** Parses a response body; non-JSON bodies (e.g. a proxy error page) count as empty. */
async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * Server-side call to the Soulwick API with the admin token from the session cookie.
 * Redirects to the login page when the token is missing or rejected.
 */
export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<ApiResult<T>> {
  const token = await getToken();
  if (!token) {
    redirect("/login");
  }
  let res: Response;
  try {
    res = await fetch(new URL(path, apiBase()), {
      method: init.method ?? "GET",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        ...(init.body === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return {
      ok: false,
      status: 0,
      error: "unreachable",
      message: errorText("unreachable"),
    };
  }

  if (res.status === 401) {
    // Expired, revoked (logout elsewhere, account disabled) or unknown session.
    redirect("/login?abgelaufen=1");
  }
  const json = await readJson(res);
  if (!res.ok) {
    const body = (json ?? {}) as { error?: string; message?: string };
    const code = body.error ?? `http_${res.status}`;
    return {
      ok: false,
      status: res.status,
      error: code,
      message: errorText(code, body.message),
    };
  }
  return { ok: true, status: res.status, data: json as T };
}

/** Like `api`, but throws on failure (for page data that must exist). */
export async function apiOrThrow<T>(path: string): Promise<T> {
  const result = await api<T>(path);
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.data;
}

/** The session check (GET /admin/me), once per request; the panel layout shows its error. */
export const getMeResult = cache(
  async (): Promise<ApiResult<AdminSelf>> => api<AdminSelf>("/admin/me")
);

/** The logged-in admin, once per request (pages; the layout already handled failures). */
export async function getMe(): Promise<AdminSelf> {
  const result = await getMeResult();
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.data;
}

export const isAdmin = (me: AdminSelf) => me.role === "admin";
