import type { PublicGuild } from "@soulwick/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { GuildView } from "@/components/leaderboards/guild-view";
import { apiGet } from "@/lib/api";

/** Rendered per request from the API (`GET /public/guilds/:tag`, cached 60 s). */
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ tag: string }>;
}

/** Same shape as `GuildTag` in the contracts; anything else is a 404, not an API call. */
const TAG_PATTERN = /^[A-Za-z0-9]{2,5}$/;

function cleanTag(raw: string): string | null {
  const tag = decodeURIComponent(raw);
  return TAG_PATTERN.test(tag) ? tag : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tag: rawTag } = await params;
  const tag = cleanTag(rawTag);
  if (!tag) {
    return {};
  }
  const t = await getTranslations("guilds");
  const upper = tag.toUpperCase();
  return {
    title: t("meta.title", { tag: upper }),
    alternates: { canonical: `/guilds/${upper}` },
  };
}

export default async function GuildRoute({ params }: Props) {
  const { tag: rawTag } = await params;
  const tag = cleanTag(rawTag);
  if (!tag) {
    notFound();
  }

  const result = await apiGet<PublicGuild>(
    `/public/guilds/${encodeURIComponent(tag)}`,
    60
  );
  if (!result.ok && result.status === 404) {
    notFound();
  }
  return (
    <div className="container-site py-10 sm:py-14">
      <GuildView result={result} />
    </div>
  );
}
