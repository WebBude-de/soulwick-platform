const dateTime = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Berlin",
});

export const formatDateTime = (iso: string | null | undefined) =>
  iso ? dateTime.format(new Date(iso)) : "–";

const dateTimeShort = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Berlin",
});

/** "13.10.26, 23:46" for table cells (fixed width with tabular figures). */
export const formatDateTimeShort = (iso: string | null | undefined) =>
  iso ? dateTimeShort.format(new Date(iso)) : "–";

export function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

export const RUN_MODE_LABEL: Record<string, string> = {
  solo: "Solo",
  quick: "Schnelles Spiel",
  guild: "Gilde",
};
/** Short mode names for narrow table columns (full name as tooltip). */
export const RUN_MODE_SHORT: Record<string, string> = {
  solo: "Solo",
  quick: "Schnell",
  guild: "Gilde",
};
export const GUILD_ROLE_LABEL: Record<string, string> = {
  founder: "Gründer",
  officer: "Offizier",
  member: "Mitglied",
};
export const ADMIN_ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  moderator: "Moderator",
};

export const AUDIT_ACTION_LABEL: Record<string, string> = {
  "player.ban": "Spieler gesperrt",
  "player.unban": "Spieler entsperrt",
  "player.rename": "Spieler umbenannt",
  "player.delete": "Spieler gelöscht",
  "guild.rename": "Gilde umbenannt",
  "guild.remove_member": "Mitglied entfernt",
  "guild.reset_invite_code": "Einladungscode zurückgesetzt",
  "guild.disband": "Gilde aufgelöst",
  "run.flag": "Run markiert",
  "run.unflag": "Run freigegeben",
  "run.delete": "Run gelöscht",
  "admin.create": "Admin angelegt",
  "admin.disable": "Admin deaktiviert",
  "admin.enable": "Admin aktiviert",
  "admin.password_change": "Eigenes Passwort geändert",
  "admin.email_change": "Eigene E-Mail geändert",
  // Legacy: retired actions (legal.* with P-025, deletion requests with P-026); old audit
  // entries stay readable.
  "legal.refresh": "Rechtstexte aktualisiert",
  "legal.register_push_client": "Push-Client registriert",
  "deletion_request.resolve": "Löschantrag abgeschlossen",
  "player.note_add": "Notiz angelegt",
  "player.note_delete": "Notiz gelöscht",
  "guild.transfer": "Gründerrolle übertragen",
  "relay.room_close": "Raum geschlossen",
  "relay.kick": "Aus Raum entfernt",
  "bug_report.status": "Bug-Meldung bearbeitet",
  "bug_report.delete": "Bug-Meldung gelöscht",
};

/** Deletion log channels (P-026). */
export const DELETION_CHANNEL_LABEL: Record<string, string> = {
  web_code: "Website-Code",
  in_game: "Im Spiel",
  admin: "Durch Admin",
};

export const DELETION_CHANNEL_HINT: Record<string, string> = {
  web_code: "Spieler auf der Website, mit Einmal-Code aus dem Spiel",
  in_game: "Spieler selbst im Spiel",
  admin: "Admin auf der Spielerseite, z. B. nach Support-Anfrage",
};

export const FLAG_REASON_LABEL: Record<string, string> = {
  too_fast: "zu schnell",
  unknown_game_version: "unbekannte Spielversion",
  participant_not_in_guild: "Teilnehmer nicht in der Gilde",
};

export const flagReasonText = (reason: string | null) =>
  reason
    ? reason
        .split(",")
        .map((r) => FLAG_REASON_LABEL[r] ?? r)
        .join(", ")
    : "–";

/** Reads a single string search param. */
export const param = (
  params: Record<string, string | string[] | undefined>,
  key: string
) => (typeof params[key] === "string" ? (params[key] as string) : undefined);

/** First 8 characters of a UUID: enough to tell rows apart, full id in the title. */
export const shortId = (id: string | null | undefined) =>
  id ? id.slice(0, 8) : "–";

export const AUDIT_TARGET_LABEL: Record<string, string> = {
  player: "Spieler",
  guild: "Gilde",
  run: "Run",
  admin_user: "Admin",
  // Legacy targets of retired actions (legal.* with P-025, deletion_request.* with P-026).
  deletion_request: "Löschantrag",
  legal_document: "Rechtstext",
  relay_room: "Raum",
  bug_report: "Bug-Meldung",
};

/** Tone of an audit action in lists: destructive red, flags orange, reversals green. */
export function auditTone(
  action: string
): "danger" | "flagged" | "active" | "muted" {
  if (
    [
      "player.ban",
      "player.delete",
      "guild.disband",
      "guild.remove_member",
      "run.delete",
      "admin.disable",
      "relay.room_close",
      "relay.kick",
      "bug_report.delete",
    ].includes(action)
  ) {
    return "danger";
  }
  if (action === "run.flag") {
    return "flagged";
  }
  if (["player.unban", "run.unflag", "admin.enable"].includes(action)) {
    return "active";
  }
  return "muted";
}

const AUDIT_DETAIL_LABEL: Record<string, string> = {
  reason: "Grund",
  previousReason: "vorher",
  durationDays: "Tage",
  expiresAt: "bis",
  from: "von",
  to: "zu",
  name: "Name",
  tag: "Kürzel",
  email: "E-Mail",
  role: "Rolle",
  status: "Status",
  note: "Notiz",
  playerId: "Spieler",
  newFounderId: "neuer Gründer",
  disbanded: "aufgelöst",
  text: "Text",
  noteId: "Notiz-ID",
  banId: "Sperre",
  banIds: "Sperren",
  code: "Raum",
  playerIds: "Spieler",
  previousFounderId: "vorher",
  founderId: "neu",
  roomClosed: "Raum geschlossen",
  started: "Run lief",
  guildId: "Gilde",
  guildDisbanded: "Gilde aufgelöst",
  wasBanned: "war gesperrt",
  revokedSessions: "andere Sitzungen beendet",
  source: "Quelle",
  categories: "Kategorien",
  platform: "Plattform",
  gameVersion: "Version",
  createdAt: "erstellt",
  // Legacy: player.delete entries from the time of deletion requests (before P-026).
  deletionRequestId: "Löschantrag",
};

const detailValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "–";
  }
  if (typeof value === "boolean") {
    return value ? "ja" : "nein";
  }
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return JSON.stringify(value);
};

/** Audit details as short "label: value" pairs (unknown keys keep their name). */
export function auditDetails(
  details: unknown
): { key: string; label: string; value: string }[] {
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return details === null || details === undefined
      ? []
      : [{ key: "value", label: "", value: detailValue(details) }];
  }
  return Object.entries(details as Record<string, unknown>).map(
    ([key, value]) => ({
      key,
      label: AUDIT_DETAIL_LABEL[key] ?? key,
      value: detailValue(value),
    })
  );
}

export const ROOM_MODE_LABEL: Record<string, string> = {
  quick: "Schnelles Spiel",
  guild: "Gilde",
};

export const PLATFORM_LABEL: Record<string, string> = {
  windows: "Windows",
  linux: "Linux",
  macos: "macOS",
  android: "Android",
  ios: "iOS",
  web: "Web",
};

/** Short age like "4 min", "2 h 5 min", "3 d" for relay rooms and players. */
export function formatAge(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 1) {
    return `${totalSeconds} s`;
  }
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} h ${minutes % 60} min`;
  }
  return `${Math.floor(hours / 24)} d`;
}

/** Bytes per second as "812 B/s" or "12,4 KB/s". */
export function formatRate(bytesPerSecond: number): string {
  if (bytesPerSecond < 1024) {
    return `${bytesPerSecond} B/s`;
  }
  return `${(bytesPerSecond / 1024).toLocaleString("de-DE", { maximumFractionDigits: 1 })} KB/s`;
}

const dayFormat = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "UTC",
});

/** UTC calendar day ("2026-10-15") as "15.10.". */
export const formatDay = (date: string) =>
  dayFormat.format(new Date(`${date}T00:00:00Z`));

export const formatNumber = (n: number | null | undefined, digits = 0) =>
  n === null || n === undefined
    ? "–"
    : n.toLocaleString("de-DE", { maximumFractionDigits: digits });

/** Characters of the account (P-034); the final names come from the game, the ids stay. */
export const CHARACTER_LABEL: Record<string, string> = {
  wick: "Wick",
  ember: "Ember",
  moss: "Moss",
  frost: "Frost",
};

/** Colour slots of `PlayerAppearance.colors` in display order. */
export const APPEARANCE_COLOR_SLOTS = [
  { key: "hair", label: "Haare" },
  { key: "outfit", label: "Kleidung" },
  { key: "skin", label: "Haut" },
  { key: "accent", label: "Akzent" },
] as const;

/** Bug report status (P-033). */
export const BUG_STATUS_LABEL: Record<string, string> = {
  new: "Neu",
  seen: "Gesehen",
  done: "Erledigt",
  wont_fix: "Wird nicht behoben",
};

/** Chip tone per status: new needs attention, done is green, the rest calm. */
export const BUG_STATUS_TONE: Record<
  string,
  "active" | "danger" | "flagged" | "muted"
> = {
  new: "flagged",
  seen: "muted",
  done: "active",
  wont_fix: "muted",
};

/** Kind of a report from the feedback tool: bug (default, older builds) or idea. */
export const BUG_KIND_LABEL: Record<string, string> = {
  bug: "Fehler",
  idea: "Idee",
};

/** Chip tone per kind: bugs red, ideas green. */
export const BUG_KIND_TONE: Record<string, "active" | "danger"> = {
  bug: "danger",
  idea: "active",
};

export const BUG_CATEGORY_LABEL: Record<string, string> = {
  ui: "Oberfläche",
  graphics: "Grafik",
  light: "Licht",
  layout: "Raumaufbau",
  gameplay: "Spielablauf",
  bug: "Fehler",
  text: "Text",
};

/** "8,4 KB", "1,2 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${formatNumber(bytes / 1024, 1)} KB`;
  }
  return `${formatNumber(bytes / (1024 * 1024), 1)} MB`;
}
