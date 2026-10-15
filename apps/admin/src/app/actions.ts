"use server";

import type {
  AdminChangePasswordResponse,
  AdminDeletePlayerResponse,
  AdminLoginResponse,
  AdminRelayCloseRoomResponse,
  AdminRelayKickResponse,
  AdminSelf,
  BanResponse,
  TransferGuildResponse,
} from "@soulwick/contracts";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api, apiBase, errorText } from "@/lib/api";
import { clearSession, getToken, setSession } from "@/lib/session";

// Every action ends with a redirect carrying a flash message (?ok=… or ?fehler=…), so the
// admin panel works without any client-side JavaScript.

const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

/** Bound arguments come back from the browser: only same-origin panel paths are allowed. */
const safePath = (path: string) =>
  path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\")
    ? path
    : "/";

function back(
  path: string,
  result: { ok: true } | { ok: false; message: string },
  okText: string
): never {
  const target = safePath(path);
  revalidatePath(target.split("?")[0] ?? "/");
  const query = result.ok
    ? `ok=${encodeURIComponent(okText)}`
    : `fehler=${encodeURIComponent(result.message)}`;
  redirect(`${target}${target.includes("?") ? "&" : "?"}${query}`);
}

const fail = (message: string) => ({ ok: false as const, message });

/** Destructive steps need the checkbox from <DangerAction> (checked again on the server). */
const confirmed = (form: FormData) => form.get("confirm") === "on";

/** Typed confirmation (guild tag, player name): ignores surrounding spaces and case. */
const typedConfirmation = (form: FormData, expected: string) =>
  str(form, "confirmText").toLowerCase() === expected.trim().toLowerCase();

const NOT_CONFIRMED = "Nicht ausgeführt: Bitte die Bestätigung ankreuzen.";
const MIN_REASON = 3;
const REASON_MISSING = `Nicht ausgeführt: Bitte einen Grund angeben (mindestens ${MIN_REASON} Zeichen, wird protokolliert).`;
/** Optional relay result of a ban (P-024), appended to the success message. */
const BAN_RELAY_TEXT: Record<string, string> = {
  disconnected: " Aus dem laufenden Spiel getrennt.",
  not_connected: " Der Spieler war gerade nicht online.",
  unavailable:
    " Der Relay-Server war nicht erreichbar – die Sperre greift beim nächsten Verbindungsaufbau.",
  not_configured:
    " Kein Relay eingerichtet – laufende Spiele wurden nicht getrennt.",
};
const DURATION_LABEL: Record<string, string> = {
  "1": "1 Tag",
  "7": "7 Tage",
  "30": "30 Tage",
  permanent: "dauerhaft",
};

// --- session ---------------------------------------------------------------------------------

export async function login(form: FormData) {
  let res: Response;
  try {
    res = await fetch(new URL("/admin/auth/login", apiBase()), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: str(form, "email"),
        password: String(form.get("password") ?? ""),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    redirect(`/login?fehler=${encodeURIComponent(errorText("unreachable"))}`);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    const code =
      body.error === "validation_error"
        ? "invalid_credentials"
        : (body.error ?? "unreachable");
    redirect(`/login?fehler=${encodeURIComponent(errorText(code))}`);
  }
  const data = (await res.json()) as AdminLoginResponse;
  // The cookie lives exactly as long as the session (ADMIN_TOKEN_TTL_HOURS, no sliding refresh).
  await setSession(data.token, data.expiresAt);
  redirect("/");
}

/**
 * Ends the session on the server (POST /admin/auth/logout), then removes the cookies. The cookie
 * goes even if the API is unreachable; the session then simply runs out at `expiresAt`.
 */
export async function logout() {
  const token = await getToken();
  if (token) {
    try {
      await fetch(new URL("/admin/auth/logout", apiBase()), {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // Unreachable API: nothing more to do than dropping the cookie.
    }
  }
  await clearSession();
  redirect("/login?abgemeldet=1");
}

// --- own account ("Mein Konto") -------------------------------------------------------------

const ACCOUNT_PATH = "/konto";
const MIN_PASSWORD = 12;
/** Texts of this page that differ from the general ones in lib/api.ts. */
const ACCOUNT_ERROR_TEXT: Record<string, string> = {
  email_taken: "Diese E-Mail-Adresse ist bereits vergeben.",
  validation_error:
    "Eingabe ungültig – bitte E-Mail-Adresse bzw. Passwort prüfen.",
  rate_limited:
    "Zu viele Versuche – bitte warte etwas (nach mehreren falschen Passwörtern bis zu 15 Minuten).",
};

function backAccount(
  result: { ok: true } | { ok: false; error: string; message: string },
  okText: string
): never {
  // The sidebar shows the e-mail as well, so the whole panel is revalidated.
  revalidatePath("/", "layout");
  const query = result.ok
    ? `ok=${encodeURIComponent(okText)}`
    : `fehler=${encodeURIComponent(ACCOUNT_ERROR_TEXT[result.error] ?? result.message)}`;
  redirect(`${ACCOUNT_PATH}?${query}`);
}

const accountFail = (message: string) => ({
  ok: false as const,
  error: "",
  message,
});

export async function changeOwnEmail(form: FormData) {
  const email = str(form, "email");
  const currentPassword = String(form.get("currentPassword") ?? "");
  if (!(email && currentPassword)) {
    backAccount(
      accountFail("Bitte neue E-Mail-Adresse und aktuelles Passwort angeben."),
      ""
    );
  }
  const result = await api<AdminSelf>("/admin/me/email", {
    method: "POST",
    body: { email, currentPassword },
  });
  backAccount(
    result,
    result.ok
      ? `E-Mail-Adresse geändert. Du meldest dich ab jetzt mit ${result.data.email} an.`
      : ""
  );
}

export async function changeOwnPassword(form: FormData) {
  const currentPassword = String(form.get("currentPassword") ?? "");
  const newPassword = String(form.get("newPassword") ?? "");
  const repeatPassword = String(form.get("repeatPassword") ?? "");
  if (!currentPassword) {
    backAccount(accountFail("Bitte das aktuelle Passwort angeben."), "");
  }
  if (newPassword.length < MIN_PASSWORD) {
    backAccount(
      accountFail(
        `Das neue Passwort braucht mindestens ${MIN_PASSWORD} Zeichen.`
      ),
      ""
    );
  }
  if (newPassword !== repeatPassword) {
    backAccount(
      accountFail("Die beiden neuen Passwörter stimmen nicht überein."),
      ""
    );
  }
  const result = await api<AdminChangePasswordResponse>("/admin/me/password", {
    method: "POST",
    body: { currentPassword, newPassword },
  });
  const revoked = result.ok ? result.data.revokedSessions : 0;
  backAccount(
    result,
    revoked === 0
      ? "Passwort geändert. Diese Sitzung bleibt angemeldet."
      : `Passwort geändert. ${revoked === 1 ? "Eine andere Sitzung wurde" : `${revoked} andere Sitzungen wurden`} abgemeldet, diese bleibt angemeldet.`
  );
}

// --- players ---------------------------------------------------------------------------------

export async function banPlayer(
  playerId: string,
  playerName: string,
  form: FormData
) {
  const path = `/spieler/${playerId}`;
  const reason = str(form, "reason");
  const duration = str(form, "duration");
  if (reason.length < MIN_REASON) {
    back(path, fail(REASON_MISSING), "");
  }
  if (!(confirmed(form) && Object.hasOwn(DURATION_LABEL, duration))) {
    back(path, fail(NOT_CONFIRMED), "");
  }
  const durationDays = duration === "permanent" ? null : Number(duration);
  const result = await api<BanResponse>(`/admin/players/${playerId}/bans`, {
    method: "POST",
    body: { reason, durationDays },
  });
  const relay = result.ok ? result.data.relay : undefined;
  back(
    path,
    result,
    `„${playerName}“ gesperrt (${DURATION_LABEL[duration]}).${relay ? (BAN_RELAY_TEXT[relay] ?? "") : ""}`
  );
}

export async function unbanPlayer(playerId: string, playerName: string) {
  const result = await api(`/admin/players/${playerId}/unban`, {
    method: "POST",
  });
  back(
    `/spieler/${playerId}`,
    result,
    `Sperre von „${playerName}“ aufgehoben.`
  );
}

export async function renamePlayer(playerId: string, form: FormData) {
  const name = str(form, "name");
  const result = await api(`/admin/players/${playerId}`, {
    method: "PATCH",
    body: { name },
  });
  back(`/spieler/${playerId}`, result, `Spieler heißt jetzt „${name}“.`);
}

// --- guilds ----------------------------------------------------------------------------------

export async function renameGuild(guildId: string, form: FormData) {
  const name = str(form, "name");
  const tag = str(form, "tag");
  const result = await api(`/admin/guilds/${guildId}`, {
    method: "PATCH",
    body: { ...(name ? { name } : {}), ...(tag ? { tag } : {}) },
  });
  back(`/gilden/${guildId}`, result, "Gilde aktualisiert.");
}

export async function removeGuildMember(
  guildId: string,
  playerId: string,
  playerName: string,
  form: FormData
) {
  const path = `/gilden/${guildId}`;
  if (!confirmed(form)) {
    back(path, fail(NOT_CONFIRMED), "");
  }
  const result = await api(`/admin/guilds/${guildId}/members/${playerId}`, {
    method: "DELETE",
  });
  back(path, result, `„${playerName}“ aus der Gilde entfernt.`);
}

export async function resetInviteCode(guildId: string) {
  const result = await api(`/admin/guilds/${guildId}/invite-code`, {
    method: "POST",
  });
  back(`/gilden/${guildId}`, result, "Einladungscode zurückgesetzt.");
}

/** Requires the admin to type the guild tag as confirmation. */
export async function disbandGuild(
  guildId: string,
  tag: string,
  form: FormData
) {
  const path = `/gilden/${guildId}`;
  if (!typedConfirmation(form, tag)) {
    back(path, fail("Nicht ausgeführt: Bitte das Kürzel exakt eintippen."), "");
  }
  const result = await api(`/admin/guilds/${guildId}/disband`, {
    method: "POST",
  });
  back(path, result, `Gilde [${tag}] aufgelöst.`);
}

// --- runs ------------------------------------------------------------------------------------

export async function flagRun(runId: string, returnTo: string, form: FormData) {
  const reason = str(form, "reason");
  if (reason.length < MIN_REASON) {
    back(returnTo, fail(REASON_MISSING), "");
  }
  const result = await api(`/admin/runs/${runId}/flag`, {
    method: "POST",
    body: { reason },
  });
  back(
    returnTo,
    result,
    "Run markiert – er zählt nicht mehr in den Ranglisten."
  );
}

export async function unflagRun(runId: string, returnTo: string) {
  const result = await api(`/admin/runs/${runId}/unflag`, { method: "POST" });
  back(
    returnTo,
    result,
    "Run freigegeben – er zählt wieder in den Ranglisten."
  );
}

export async function deleteRun(
  runId: string,
  returnTo: string,
  form: FormData
) {
  if (!confirmed(form)) {
    back(returnTo, fail(NOT_CONFIRMED), "");
  }
  const result = await api(`/admin/runs/${runId}`, { method: "DELETE" });
  back(returnTo, result, "Run gelöscht.");
}

// --- admin users -----------------------------------------------------------------------------

export async function createAdminUser(form: FormData) {
  const result = await api("/admin/admins", {
    method: "POST",
    body: {
      email: str(form, "email"),
      password: String(form.get("password") ?? ""),
      role: str(form, "role"),
    },
  });
  back("/admins", result, `Zugang ${str(form, "email")} angelegt.`);
}

export async function setAdminDisabled(
  adminId: string,
  email: string,
  disabled: boolean,
  form: FormData
) {
  if (disabled && !confirmed(form)) {
    back("/admins", fail(NOT_CONFIRMED), "");
  }
  const result = await api(
    `/admin/admins/${adminId}/${disabled ? "disable" : "enable"}`,
    { method: "POST" }
  );
  back(
    "/admins",
    result,
    disabled ? `Zugang ${email} deaktiviert.` : `Zugang ${email} aktiviert.`
  );
}

// --- account deletion by an admin (P-026) ---------------------------------------------------

function deletedText(data: AdminDeletePlayerResponse): string {
  const parts = [`Konto „${data.name}“ gelöscht.`];
  // Several guilds per player (D-147); older API builds only send `guild`.
  const guilds = data.guilds ?? (data.guild ? [data.guild] : []);
  const tags = (list: typeof guilds) =>
    list.map((g) => `[${g.tag}]`).join(", ");
  const disbanded = guilds.filter((g) => g.disbanded);
  const handedOver = guilds.filter((g) => !g.disbanded && g.newFounderId);
  const left = guilds.filter((g) => !(g.disbanded || g.newFounderId));
  if (left.length > 0) {
    parts.push(
      `Aus ${left.length === 1 ? "Gilde" : "Gilden"} ${tags(left)} entfernt.`
    );
  }
  if (handedOver.length > 0) {
    parts.push(`Gründerrolle in ${tags(handedOver)} weitergegeben.`);
  }
  if (disbanded.length > 0) {
    parts.push(
      `${disbanded.length === 1 ? "Gilde" : "Gilden"} ${tags(disbanded)} aufgelöst (letztes Mitglied).`
    );
  }
  if (data.wasBanned) {
    parts.push("Das Konto war gesperrt.");
  }
  parts.push("Im Löschprotokoll vermerkt.");
  return parts.join(" ");
}

/**
 * Player page: deletes the account after the admin typed the player name. Players delete their
 * own accounts automatically (P-026); this is for cases without access to the game.
 */
export async function deletePlayer(
  playerId: string,
  playerName: string,
  form: FormData
) {
  const path = `/spieler/${playerId}`;
  if (!typedConfirmation(form, playerName)) {
    back(
      path,
      fail("Nicht ausgeführt: Bitte den Spielernamen exakt eintippen."),
      ""
    );
  }
  const note = str(form, "note");
  const result = await api<AdminDeletePlayerResponse>(
    `/admin/players/${encodeURIComponent(playerId)}`,
    { method: "DELETE", body: note ? { note } : undefined }
  );
  if (!result.ok) {
    back(path, result, "");
  }
  revalidatePath("/spieler");
  revalidatePath("/loeschungen");
  redirect(`/spieler?ok=${encodeURIComponent(deletedText(result.data))}`);
}

// --- moderation notes (P-023) ----------------------------------------------------------------

const NOTE_MAX = 2000;

export async function addPlayerNote(playerId: string, form: FormData) {
  const path = `/spieler/${playerId}`;
  const text = str(form, "text");
  if (text.length === 0 || text.length > NOTE_MAX) {
    back(path, fail(`Die Notiz braucht 1 bis ${NOTE_MAX} Zeichen.`), "");
  }
  const result = await api(`/admin/players/${playerId}/notes`, {
    method: "POST",
    body: { text },
  });
  back(path, result, "Notiz gespeichert.");
}

export async function deletePlayerNote(
  playerId: string,
  noteId: string,
  form: FormData
) {
  const path = `/spieler/${playerId}`;
  if (!confirmed(form)) {
    back(path, fail(NOT_CONFIRMED), "");
  }
  const result = await api(
    `/admin/players/${playerId}/notes/${encodeURIComponent(noteId)}`,
    { method: "DELETE" }
  );
  back(path, result, "Notiz gelöscht.");
}

// --- guild leadership (P-023) ----------------------------------------------------------------

export async function transferGuild(
  guildId: string,
  playerId: string,
  playerName: string,
  form: FormData
) {
  const path = `/gilden/${guildId}`;
  const reason = str(form, "reason");
  if (reason.length < MIN_REASON) {
    back(path, fail(REASON_MISSING), "");
  }
  if (!confirmed(form)) {
    back(path, fail(NOT_CONFIRMED), "");
  }
  const result = await api<TransferGuildResponse>(
    `/admin/guilds/${guildId}/transfer`,
    { method: "POST", body: { playerId, reason } }
  );
  back(
    path,
    result,
    `„${playerName}“ leitet jetzt die Gilde; die bisherige Leitung ist Offizier.`
  );
}

// --- live rooms on the relay (P-024) ---------------------------------------------------------

const RELAY_PATH = "/live-raeume";
/** Relay not set up or not answering: a calm note, not an error. */
const RELAY_NOTES = new Set(["relay_not_configured", "relay_unavailable"]);

function backRelay(
  result: { ok: true } | { ok: false; error: string; message: string },
  okText: string
): never {
  revalidatePath(RELAY_PATH);
  const query = result.ok
    ? `ok=${encodeURIComponent(okText)}`
    : `${RELAY_NOTES.has(result.error) ? "hinweis" : "fehler"}=${encodeURIComponent(result.message)}`;
  redirect(`${RELAY_PATH}?${query}`);
}

export async function closeRelayRoom(code: string, form: FormData) {
  const reason = str(form, "reason");
  if (reason.length < MIN_REASON) {
    backRelay({ ok: false, error: "", message: REASON_MISSING }, "");
  }
  if (!confirmed(form)) {
    backRelay({ ok: false, error: "", message: NOT_CONFIRMED }, "");
  }
  const result = await api<AdminRelayCloseRoomResponse>(
    `/admin/relay/rooms/${encodeURIComponent(code)}/close`,
    { method: "POST", body: { reason } }
  );
  const count = result.ok ? result.data.playerIds.length : 0;
  backRelay(result, `Raum ${code} geschlossen (${count} Spieler getrennt).`);
}

export async function kickRelayPlayer(
  code: string,
  playerId: string,
  playerName: string,
  form: FormData
) {
  const reason = str(form, "reason");
  if (reason.length < MIN_REASON) {
    backRelay({ ok: false, error: "", message: REASON_MISSING }, "");
  }
  if (!confirmed(form)) {
    backRelay({ ok: false, error: "", message: NOT_CONFIRMED }, "");
  }
  const result = await api<AdminRelayKickResponse>(
    `/admin/relay/rooms/${encodeURIComponent(code)}/kick`,
    { method: "POST", body: { playerId, reason } }
  );
  backRelay(
    result,
    result.ok && result.data.roomClosed
      ? `„${playerName}“ war Host – Raum ${code} wurde für alle geschlossen.`
      : `„${playerName}“ aus Raum ${code} entfernt.`
  );
}
