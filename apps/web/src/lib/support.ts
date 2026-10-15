import "server-only";
import type { PublicConfig } from "@soulwick/contracts";
import { apiGet } from "@/lib/api";

/** Same shape check as the API (`SUPPORT_EMAIL` is validated there); guards the mailto link. */
const EMAIL_SHAPE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/**
 * Support address from `GET /public/config` (`SUPPORT_EMAIL` of the API, P-026); null when it is
 * not configured or the API is unreachable. Never throws.
 */
export async function loadSupportEmail(): Promise<string | null> {
  const config = await apiGet<PublicConfig>("/public/config", 60);
  const email = config.ok ? config.data.supportEmail?.trim() : undefined;
  return email && EMAIL_SHAPE.test(email) ? email : null;
}

export function mailtoHref(
  email: string,
  options: { subject?: string; body?: string } = {}
): string {
  const params = Object.entries(options)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${encodeURIComponent(value ?? "")}`);
  return params.length > 0
    ? `mailto:${email}?${params.join("&")}`
    : `mailto:${email}`;
}
