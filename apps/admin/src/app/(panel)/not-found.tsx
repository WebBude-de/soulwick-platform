import Link from "next/link";
import { PageTitle } from "@/components/ui";

/** notFound() from a panel page (deleted player, unknown guild id): keeps the sidebar. */
export default function PanelNotFound() {
  return (
    <>
      <PageTitle sub="Den Eintrag gibt es nicht (mehr) – vielleicht wurde er gelöscht oder die ID ist falsch.">
        Nicht gefunden
      </PageTitle>
      <Link className="btn" href="/">
        Zur Übersicht
      </Link>
    </>
  );
}
