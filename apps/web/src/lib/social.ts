import { z } from "zod";
import file from "../../content/social.json";

/**
 * Social channels of Soulwick from `content/social.json` (edited by the project member, see the
 * web README). Every channel is listed with an empty `url` until it exists; only channels with a
 * URL are rendered (footer, community row). Store pages (Steam, Google Play, App Store) live in
 * `content/stores.json` (`src/lib/stores.ts`). The file is validated once when this module
 * loads, so a typo fails the build instead of shipping a broken link.
 */
export const SOCIAL_CHANNEL_IDS = [
  "discord",
  "tiktok",
  "youtube",
  "instagram",
  "x",
  "reddit",
] as const;

export type SocialChannelId = (typeof SOCIAL_CHANNEL_IDS)[number];

export interface SocialLink {
  id: SocialChannelId;
  /** Name of the channel as shown on the page (brand name, same in every language). */
  label: string;
  url: string;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

const ChannelSchema = z.strictObject({
  id: z.enum(SOCIAL_CHANNEL_IDS),
  label: z.string().trim().min(1, "label must not be empty"),
  url: z
    .string()
    .trim()
    .refine((value) => value === "" || isHttpsUrl(value), {
      message: 'url must be empty ("") or start with https://',
    }),
});

export const SocialFileSchema = z.strictObject({
  channels: z
    .array(ChannelSchema)
    .refine(
      (channels) => new Set(channels.map((c) => c.id)).size === channels.length,
      { message: "every channel id may appear only once" }
    ),
});

/**
 * Validates the content of `social.json` and returns the channels that have a URL, in file
 * order. Throws a readable error naming the broken entry.
 */
export function parseSocialFile(data: unknown): SocialLink[] {
  const result = SocialFileSchema.safeParse(data);
  if (!result.success) {
    throw new Error(
      `apps/web/content/social.json is invalid:\n${z.prettifyError(result.error)}`
    );
  }
  return result.data.channels.filter((channel) => channel.url !== "");
}

const LINKS = parseSocialFile(file);

/** Channels with a URL (may be empty: then nothing social is rendered). */
export function socialLinks(): SocialLink[] {
  return LINKS;
}
