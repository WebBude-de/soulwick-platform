import type { AdminRun } from "@soulwick/contracts";
import Link from "next/link";
import { deleteRun, flagRun, unflagRun } from "@/app/actions";
import {
  flagReasonText,
  formatDateTime,
  formatDuration,
  RUN_MODE_LABEL,
} from "@/lib/format";
import { DangerAction } from "./danger-action";
import { Chip, EmptyRow } from "./ui";

/** Run list with moderation actions. `canDelete` = role admin. */
export function RunTable({
  runs,
  returnTo,
  canDelete,
}: {
  runs: AdminRun[];
  returnTo: string;
  canDelete: boolean;
}) {
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Zeitpunkt</th>
          <th>Teilnehmer</th>
          <th>Modus</th>
          <th className="text-right">Raum</th>
          <th className="text-right">Dauer</th>
          <th>Version</th>
          <th>Status</th>
          <th>Aktionen</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((run) => (
          <tr key={run.id}>
            <td className="whitespace-nowrap font-data" title={run.id}>
              {formatDateTime(run.createdAt)}
            </td>
            <td>
              {run.participants.length === 0 ? (
                <span className="text-muted">(gelöscht)</span>
              ) : null}
              {run.participants.map((p, i) => (
                <span key={p.id}>
                  {i > 0 ? ", " : null}
                  <Link className="link" href={`/spieler/${p.id}`}>
                    {p.name}
                  </Link>
                </span>
              ))}
            </td>
            <td className="whitespace-nowrap">
              {RUN_MODE_LABEL[run.mode] ?? run.mode}
              {run.guildTag && run.guildId ? (
                <Link
                  className="link ml-1 font-data"
                  href={`/gilden/${run.guildId}`}
                >
                  [{run.guildTag}]
                </Link>
              ) : null}
            </td>
            <td className="text-right font-data">{run.roomReached}</td>
            <td className="text-right font-data">
              {formatDuration(run.durationSeconds)}
            </td>
            <td className="font-data text-muted">{run.gameVersion}</td>
            <td>
              {run.flagged ? (
                <div className="space-y-1">
                  <Chip tone="flagged">gemeldet</Chip>
                  <div className="max-w-56 text-muted text-xs">
                    {flagReasonText(run.flagReason)}
                  </div>
                </div>
              ) : (
                <Chip tone="active">gewertet</Chip>
              )}
            </td>
            <td>
              <div className="flex flex-col items-start gap-2">
                {run.flagged ? (
                  <form action={unflagRun.bind(null, run.id, returnTo)}>
                    <button className="btn btn-sm" type="submit">
                      Freigeben
                    </button>
                  </form>
                ) : (
                  <DangerAction
                    action={flagRun.bind(null, run.id, returnTo)}
                    neutral
                    reason={{
                      label: "Grund",
                      placeholder: "z. B. Zeit unrealistisch",
                      maxLength: 200,
                    }}
                    small
                    submitLabel="Markieren"
                    trigger="Markieren…"
                  />
                )}
                {canDelete ? (
                  <DangerAction
                    action={deleteRun.bind(null, run.id, returnTo)}
                    description="Der Run verschwindet endgültig aus Ranglisten und Statistiken. Markieren reicht meistens."
                    small
                    submitLabel="Run löschen"
                    trigger="Löschen…"
                  />
                ) : null}
              </div>
            </td>
          </tr>
        ))}
        {runs.length === 0 ? (
          <EmptyRow colSpan={8}>Keine Runs.</EmptyRow>
        ) : null}
      </tbody>
    </table>
  );
}
