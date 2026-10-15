import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { logout } from "@/app/actions";
import { CurrentLink, type NavItem, NavLinks } from "@/components/nav-links";
import { Chip, ErrorBox } from "@/components/ui";
import { getMeResult, isAdmin } from "@/lib/api";
import { ADMIN_ROLE_LABEL } from "@/lib/format";

export default async function PanelLayout({
  children,
}: {
  children: ReactNode;
}) {
  // 401 already redirected to /login; anything else (API down) gets a calm page with a retry.
  const meResult = await getMeResult();
  if (!meResult.ok) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg-deep px-4">
        <div className="w-full max-w-md space-y-4">
          <ErrorBox message={meResult.message} />
          <div className="flex flex-wrap gap-3">
            <Link className="btn" href="/">
              Erneut versuchen
            </Link>
            <form action={logout}>
              <button className="btn" type="submit">
                Abmelden
              </button>
            </form>
          </div>
        </div>
      </main>
    );
  }
  const me = meResult.data;
  const nav: NavItem[] = [
    { href: "/", label: "Übersicht", icon: "overview" },
    { href: "/statistik", label: "Statistik", icon: "stats" },
    { href: "/spieler", label: "Spieler", icon: "players" },
    { href: "/gilden", label: "Gilden", icon: "guilds" },
    { href: "/runs", label: "Runs", icon: "runs" },
    { href: "/live-raeume", label: "Live-Räume", icon: "live" },
    { href: "/loeschungen", label: "Löschprotokoll", icon: "deletion" },
    { href: "/protokoll", label: "Protokoll", icon: "audit" },
    ...(isAdmin(me)
      ? [{ href: "/admins", label: "Admins", icon: "admins" } as const]
      : []),
  ];

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-line border-b-2 bg-bg-deep md:sticky md:top-0 md:flex md:h-screen md:w-60 md:flex-none md:flex-col md:border-r-2 md:border-b-0">
        <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3 md:block md:px-5 md:pt-6">
          <Link className="block w-fit" href="/">
            <Image
              alt="Soulwick"
              height={48}
              src="/brand/logo.webp"
              unoptimized
              width={160}
            />
          </Link>
          <p className="eyebrow md:mt-2">Admin-Bereich</p>
        </div>
        <nav
          aria-label="Hauptnavigation"
          className="md:flex-1 md:overflow-y-auto"
        >
          <NavLinks items={nav} />
        </nav>
        <div className="hidden md:block">
          <div className="divider mx-4 opacity-70" />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-line border-t-2 px-4 py-3 text-sm md:block md:space-y-3 md:border-t-0 md:px-5 md:pb-6">
          <div className="min-w-0 space-y-1">
            <Link
              className="block break-all text-soft hover:text-text"
              href="/konto"
              title="Mein Konto"
            >
              {me.email}
            </Link>
            <Chip tone={isAdmin(me) ? "flagged" : "muted"}>
              {ADMIN_ROLE_LABEL[me.role]}
            </Chip>
          </div>
          <div className="flex flex-wrap gap-2">
            <CurrentLink className="btn btn-sm" href="/konto">
              Mein Konto
            </CurrentLink>
            <form action={logout}>
              <button className="btn btn-sm" type="submit">
                Abmelden
              </button>
            </form>
          </div>
        </div>
      </aside>
      <main
        className="min-w-0 flex-1 px-4 py-6 sm:px-6 md:px-8 md:py-8"
        id="inhalt"
      >
        <div className="mx-auto max-w-360">{children}</div>
      </main>
    </div>
  );
}
