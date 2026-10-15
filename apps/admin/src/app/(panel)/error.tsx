"use client";

export default function PanelError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flash flash-error" role="alert">
        <p>
          <span className="mr-2 font-data text-muted uppercase tracking-wider">
            Fehler
          </span>
          Die Daten konnten nicht geladen werden. Ist die API erreichbar?
        </p>
      </div>
      <button className="btn" onClick={reset} type="button">
        Erneut versuchen
      </button>
    </div>
  );
}
