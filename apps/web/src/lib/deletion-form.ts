/**
 * Shared shape of the account deletion flow (`/delete-account`, P-026): limits, field names and
 * the state the Server Action returns. Safe for client components (no zod, no server code).
 *
 * Flow: `verify` (player name + one-time code from the game) → `confirm` (shows the account,
 * deletes it for good) → `deleted`. The confirmation key from step one only travels in a hidden
 * form field back to the Server Action; nothing is stored in the browser.
 */

export const DELETION_LIMITS = {
  playerNameMin: 2,
  playerNameMax: 24,
  /** Eight characters plus room for the spaces or dashes people type to group them. */
  codeInputMax: 12,
} as const;

/** Name of the submit button value that tells the Server Action which step was sent. */
export const INTENT_FIELD = "intent";
export type DeletionIntent = "verify" | "confirm" | "cancel";

/** Invisible bot trap of step one; people never see or fill it. */
export const HONEYPOT_FIELD = "website";

/** Hidden field of the confirmation step. */
export const CONFIRM_FIELD = "confirmation";

export interface DeletionFormValues {
  code: string;
  playerName: string;
}

export type DeletionFieldError = "nameLength" | "codeFormat";

/** Shown above the first step. */
export type DeletionNotice =
  /** Name and code don't match, or the code expired, was used or replaced. */
  | "codeMismatch"
  | "rateLimited"
  | "unreachable"
  | "rejected"
  /** The confirmation step took too long or was already used. */
  | "confirmExpired"
  | "cancelled";

export interface DeletionGuild {
  name: string;
  tag: string;
}

export interface DeletionPreview {
  /** Oldest current guild (kept for API builds without `guilds`). */
  guild: DeletionGuild | null;
  /** All current guilds (D-147); optional, older API builds only send `guild`. */
  guilds?: DeletionGuild[];
  playerName: string;
  runCount: number;
}

/** Every guild of the account, falling back to the single `guild` of older API builds. */
export function previewGuilds(account: DeletionPreview): DeletionGuild[] {
  if (account.guilds) {
    return account.guilds;
  }
  return account.guild ? [account.guild] : [];
}

/** Hidden fields that carry the guilds of the preview through the confirmation step. */
export const PREVIEW_GUILD_NAME_FIELD = "previewGuildName";
export const PREVIEW_GUILD_TAG_FIELD = "previewGuildTag";

export type DeletionFormState =
  | { status: "idle" }
  | {
      status: "verify";
      values: DeletionFormValues;
      fieldErrors: Partial<
        Record<keyof DeletionFormValues, DeletionFieldError>
      >;
      notice?: DeletionNotice;
    }
  | {
      status: "confirm";
      /** Opaque value from the server; only sent back with the final click. */
      confirmation: string;
      account: DeletionPreview;
      /** Set when the final click could not reach the server; the step stays open. */
      failed?: "unreachable" | "rejected";
    }
  | { status: "deleted"; deletedAt: string };

export const EMPTY_VALUES: DeletionFormValues = { playerName: "", code: "" };
