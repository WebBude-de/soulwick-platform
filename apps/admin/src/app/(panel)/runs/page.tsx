import type { AdminRunList } from "@soulwick/contracts";
import type { Metadata } from "next";
import { RunTable } from "@/components/run-table";
import {
  ErrorBox,
  FilterBar,
  Flash,
  Pager,
  PageTitle,
  TableCard,
} from "@/components/ui";
import { api, getMe, isAdmin } from "@/lib/api";
import { param } from "@/lib/format";

export const metadata: Metadata = { title: "Runs" };
const LIMIT = 50;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const FILTERS = [
  { slug: "gemeldet", label: "Gemeldet", flagged: "true" },
  { slug: "gewertet", label: "Gewertet", flagged: "false" },
  { slug: "alle", label: "Alle", flagged: undefined },
] as const;

export default async function RunsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const [params, me] = await Promise.all([searchParams, getMe()]);
  const filter =
    FILTERS.find((f) => f.slug === param(params, "filter")) ?? FILTERS[0];
  const page = Math.max(1, Number(param(params, "seite") ?? 1) || 1);
  const offset = (page - 1) * LIMIT;
  const query = new URLSearchParams({
    limit: String(LIMIT),
    offset: String(offset),
    ...(filter.flagged ? { flagged: filter.flagged } : {}),
  });
  const result = await api<AdminRunList>(`/admin/runs?${query}`);
  const returnTo = `/runs?filter=${filter.slug}${page > 1 ? `&seite=${page}` : ""}`;

  return (
    <>
      <PageTitle
        icon="runs"
        sub={
          <>
            Gemeldete Runs zählen nicht in den Ranglisten, bis sie freigegeben
            werden. Markieren braucht einen Grund (steht im Protokoll)
            {isAdmin(me)
              ? "; Löschen ist endgültig."
              : "; Löschen dürfen nur Admins."}
          </>
        }
      >
        Runs
      </PageTitle>
      <Flash params={params} />
      <FilterBar
        items={FILTERS.map((f) => ({
          href: `/runs?filter=${f.slug}`,
          label: f.label,
          current: f.slug === filter.slug,
        }))}
        label="Runs filtern"
      />
      {result.ok ? (
        <TableCard
          footer={
            <Pager
              href={(n) => `/runs?filter=${filter.slug}&seite=${n}`}
              limit={LIMIT}
              offset={offset}
              total={result.data.total}
            />
          }
        >
          <RunTable
            canDelete={isAdmin(me)}
            returnTo={returnTo}
            runs={result.data.items}
          />
        </TableCard>
      ) : (
        <ErrorBox message={result.message} />
      )}
    </>
  );
}
