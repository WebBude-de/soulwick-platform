import type { Metadata } from "next";
import Image from "next/image";
import { login } from "@/app/actions";

export const metadata: Metadata = { title: "Anmelden" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const error = typeof params.fehler === "string" ? params.fehler : null;
  // Hints from the proxy / API check (session ran out or was revoked) and from logout.
  const note =
    params.abgelaufen === "1"
      ? "Deine Sitzung ist abgelaufen oder wurde beendet – bitte melde dich neu an."
      : params.abgemeldet === "1"
        ? "Du bist abgemeldet."
        : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg-deep px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2">
          <Image
            alt="Soulwick"
            height={96}
            preload
            src="/brand/logo.webp"
            unoptimized
            width={320}
          />
          <p className="eyebrow">Admin-Bereich</p>
        </div>
        <form action={login} className="card space-y-4 p-6">
          <h1 className="text-[22px] text-text">Anmelden</h1>
          {error ? (
            <p className="flash flash-error text-sm" role="alert">
              {error}
            </p>
          ) : null}
          {note && !error ? (
            <p className="flash flash-note text-sm" role="status">
              {note}
            </p>
          ) : null}
          <label className="block">
            <span className="field-label">E-Mail</span>
            <input
              autoComplete="username"
              className="input w-full"
              name="email"
              required
              type="email"
            />
          </label>
          <label className="block">
            <span className="field-label">Passwort</span>
            <input
              autoComplete="current-password"
              className="input w-full"
              name="password"
              required
              type="password"
            />
          </label>
          <button className="btn btn-primary w-full" type="submit">
            Anmelden
          </button>
        </form>
        <div className="divider opacity-70" />
      </div>
    </main>
  );
}
