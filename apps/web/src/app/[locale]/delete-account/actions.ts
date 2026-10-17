"use server";

import {
  type AccountDeletionConfirmRequest,
  type AccountDeletionConfirmResponse,
  type AccountDeletionVerifyRequest,
  type AccountDeletionVerifyResponse,
  DeletionCode,
} from "@soulwick/contracts";
import { headers } from "next/headers";
import { apiPost } from "@/lib/api";
import {
  CONFIRM_FIELD,
  DELETION_LIMITS,
  type DeletionFieldError,
  type DeletionFormState,
  type DeletionFormValues,
  type DeletionGuild,
  type DeletionPreview,
  HONEYPOT_FIELD,
  INTENT_FIELD,
  PREVIEW_GUILD_NAME_FIELD,
  PREVIEW_GUILD_TAG_FIELD,
} from "@/lib/deletion-form";

/**
 * Server Action behind the deletion flow (P-026). One action for all steps so the page also
 * works without JavaScript: the pressed button's `intent` decides what happens.
 * - `verify`: POST /account-deletion/verify with player name + code from the game.
 * - `confirm`: POST /account-deletion/confirm with the confirmation key from step one.
 * - `cancel`: forget the confirmation key, nothing is deleted.
 * The API URL never reaches the browser.
 */
export async function submitDeletionStep(
  _previous: DeletionFormState,
  formData: FormData
): Promise<DeletionFormState> {
  switch (text(formData, INTENT_FIELD)) {
    case "confirm":
      return await confirm(formData);
    case "cancel":
      return {
        status: "verify",
        values: { playerName: "", code: "" },
        fieldErrors: {},
        notice: "cancelled",
      };
    default:
      return await verify(formData);
  }
}

async function verify(formData: FormData): Promise<DeletionFormState> {
  const values: DeletionFormValues = {
    playerName: text(formData, "playerName"),
    code: text(formData, "code"),
  };

  // Bots fill every field; answer like a wrong code so they learn nothing, but send nothing.
  if (text(formData, HONEYPOT_FIELD) !== "") {
    return {
      status: "verify",
      values,
      fieldErrors: {},
      notice: "codeMismatch",
    };
  }

  const fieldErrors: Partial<
    Record<keyof DeletionFormValues, DeletionFieldError>
  > = {};
  const nameLength = [...values.playerName].length;
  if (
    nameLength < DELETION_LIMITS.playerNameMin ||
    nameLength > DELETION_LIMITS.playerNameMax
  ) {
    fieldErrors.playerName = "nameLength";
  }
  // Same rules as the API: spaces and dashes are ignored, lower case is fine.
  const code = DeletionCode.safeParse(values.code);
  if (!code.success) {
    fieldErrors.code = "codeFormat";
  }
  if (!code.success || fieldErrors.playerName) {
    return { status: "verify", values, fieldErrors };
  }

  const body: AccountDeletionVerifyRequest = {
    playerName: values.playerName,
    code: code.data,
  };
  const result = await apiPost<AccountDeletionVerifyResponse>(
    "/account-deletion/verify",
    body,
    await forwardedFor()
  );

  if (result.ok) {
    return {
      status: "confirm",
      confirmation: result.data.token,
      account: result.data.account,
    };
  }
  if (result.status === 400 && result.error === "invalid_deletion_code") {
    return {
      status: "verify",
      values,
      fieldErrors: {},
      notice: "codeMismatch",
    };
  }
  if (result.status === 429) {
    return { status: "verify", values, fieldErrors: {}, notice: "rateLimited" };
  }
  if (result.status === 400) {
    return { status: "verify", values, fieldErrors: {}, notice: "rejected" };
  }
  return { status: "verify", values, fieldErrors: {}, notice: "unreachable" };
}

async function confirm(formData: FormData): Promise<DeletionFormState> {
  const confirmation = text(formData, CONFIRM_FIELD);
  const account = readPreview(formData);
  const expired: DeletionFormState = {
    status: "verify",
    values: { playerName: account?.playerName ?? "", code: "" },
    fieldErrors: {},
    notice: "confirmExpired",
  };
  if (!(confirmation && account)) {
    return expired;
  }

  const body: AccountDeletionConfirmRequest = { token: confirmation };
  const result = await apiPost<AccountDeletionConfirmResponse>(
    "/account-deletion/confirm",
    body
  );

  if (result.ok) {
    return { status: "deleted", deletedAt: result.data.deletedAt };
  }
  if (result.status === 400 && result.error === "deletion_token_invalid") {
    return expired;
  }
  // Nothing was deleted; keep the step open so the player can try again.
  return {
    status: "confirm",
    confirmation,
    account,
    failed: result.status === "unreachable" ? "unreachable" : "rejected",
  };
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The preview shown in step two travels with the form, so a failed final click (server not
 * reachable) can show the same step again without asking the API. Display only; the API
 * decides by the confirmation key alone.
 */
function readPreview(formData: FormData) {
  const playerName = text(formData, "previewName");
  const runCount = Number.parseInt(text(formData, "previewRuns"), 10);
  if (!playerName || Number.isNaN(runCount)) {
    return null;
  }
  // One name/tag pair per guild, in the order the API listed them.
  const names = formData.getAll(PREVIEW_GUILD_NAME_FIELD);
  const tags = formData.getAll(PREVIEW_GUILD_TAG_FIELD);
  const guilds: DeletionGuild[] = [];
  names.forEach((name, i) => {
    const tag = tags[i];
    if (typeof name === "string" && typeof tag === "string" && name && tag) {
      guilds.push({ name: name.trim(), tag: tag.trim() });
    }
  });
  const preview: DeletionPreview = {
    playerName,
    runCount,
    guild: guilds[0] ?? null,
    guilds,
  };
  return preview;
}

/**
 * The API rate-limits per client IP. The website calls it from its own server, so the visitor's
 * address is passed on; otherwise all visitors would share the website's limit.
 */
async function forwardedFor(): Promise<Record<string, string>> {
  const incoming = await headers();
  const ip =
    incoming.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    incoming.get("x-real-ip")?.trim();
  return ip ? { "x-forwarded-for": ip } : {};
}
