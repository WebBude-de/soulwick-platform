import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg-deep px-4">
      <div className="card max-w-md space-y-4 p-6">
        <p className="eyebrow">404</p>
        <h1 className="text-[28px] text-gold">Nicht gefunden</h1>
        <p className="text-soft">
          Diese Seite gibt es nicht (mehr) – vielleicht wurde der Eintrag
          gelöscht.
        </p>
        <Link className="btn" href="/">
          Zur Übersicht
        </Link>
      </div>
    </main>
  );
}
