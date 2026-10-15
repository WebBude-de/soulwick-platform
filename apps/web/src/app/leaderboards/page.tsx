import type { LeaderboardResponse } from "@soulwick/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { LeaderboardsView } from "@/components/leaderboards/leaderboards-view";
import {
  apiQuery,
  type SearchParams,
  selectBoard,
} from "@/components/leaderboards/params";
import type { Locale } from "@/i18n/locale";
import { apiGet } from "@/lib/api";
import { liveFeaturesEnabled } from "@/lib/features";

/**
 * Rendered per request: the selection comes from the query string, the data from the API, and
 * `LIVE_FEATURES` is checked on every request (404 in teaser mode).
 */
export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<SearchParams>;
}

export async function generateMetadata(): Promise<Metadata> {
  if (!liveFeaturesEnabled()) {
    notFound();
  }
  const t = await getTranslations("leaderboards");
  return {
    title: t("meta.title"),
    description: t("meta.description"),
    alternates: { canonical: "/leaderboards" },
  };
}

export default async function LeaderboardsRoute({ searchParams }: Props) {
  if (!liveFeaturesEnabled()) {
    notFound();
  }
  const locale = (await getLocale()) as Locale;
  const selection = selectBoard(await searchParams, locale);
  const result = await apiGet<LeaderboardResponse>(
    `/leaderboards/${selection.kind.kind}?${apiQuery(selection)}`
  );
  return (
    <div className="container-site py-10 sm:py-14">
      <LeaderboardsView result={result} selection={selection} />
    </div>
  );
}
