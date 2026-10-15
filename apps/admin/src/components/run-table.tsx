import type { AdminRun } from "@soulwick/contracts";
import Link from "next/link";
import { deleteRun, flagRun, unflagRun } from "@/app/actions";
import {
  flagReasonText,
  formatDateTimeShort,
  formatDuration,
  RUN_MODE_LABEL,
  RUN_MODE_SHORT,
} from "@/lib/format";
import { RowAction, RowDangerAction } from "./danger-action";
import { Chip, EmptyRow, RowActions, When } from "./ui";

/** Participants on one line; cut with an ellipsis, all names in the tooltip. */
function Participants({ run }: { run: AdminRun }) {
  if (run.participants.length === 0) {
    return <span className="text-muted">(gelöscht)</span>;
  }
  return (
    <span
      className="cell-truncate"
      title={run.participants.map((p) => p.name).join(", ")}
    >
      {run.participants.map((p, i) => (
        <span key={p.id}>
          {i > 0 ? ", " : null}
          <Link className="link font-semibold" href={`/spieler/${p.id}`}>
            {p.name}
          </Link>
        </span>
      ))}
    </span>
  );
}

/**
 * Run list with moderation actions. `canDelete` = role admin.
 *
 * Fixed column widths keep every row one line high: only the participants take the remaining
 * width (names cut with an ellipsis, full list as tooltip). When every listed run is flagged (the
 * "Gemeldet" filter), the status column would only repeat "gemeldet", so it shows the reason
 * instead; in mixed lists the reason is the tooltip of the "gemeldet" chip. Narrow screens scroll
 * the table sideways.
 */
export function RunTable({
  runs,
  returnTo,
  canDelete,
}: {
  runs: AdminRun[];
  returnTo: string;
  canDelete: boolean;
}) {
  const allFlagged = runs.length > 0 && runs.every((r) => r.flagged);
  return (
    <table className="table min-w-4xl table-fixed">
      <colgroup>
        <col className="w-34" />
        <col />
        <col className="w-30" />
        <col className="w-18" />
        <col className="w-20" />
        <col className="w-25" />
        {/* Flagged list: the reason shares the free width with the participants. */}
        <col className={allFlagged ? undefined : "w-30"} />
        <col className={canDelete ? "w-46" : "w-38"} />
      </colgroup>
      <thead>
        <tr>
          <th>Zeitpunkt</th>
          <th>Teilnehmer</th>
          <th>Modus</th>
          <th className="text-right">Raum</th>
          <th className="text-right">Dauer</th>
          <th>Version</th>
          <th>{allFlagged ? "Meldegrund" : "Status"}</th>
          <th className="text-right">Aktionen</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((run) => {
          const when = formatDateTimeShort(run.createdAt);
          const reason = flagReasonText(run.flagReason);
          const who =
            run.participants.map((p) => p.name).join(", ") || "(gelöscht)";
          return (
            <tr key={run.id}>
              <td>
                <When iso={run.createdAt} />
              </td>
              <td>
                <Participants run={run} />
              </td>
              <td
                className="whitespace-nowrap"
                title={RUN_MODE_LABEL[run.mode] ?? run.mode}
              >
                {RUN_MODE_SHORT[run.mode] ?? run.mode}
                {run.guildTag && run.guildId ? (
                  <Link
                    className="link ml-1.5 font-data"
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
              <td className="font-data text-muted">
                <span className="cell-truncate" title={run.gameVersion}>
                  {run.gameVersion}
                </span>
              </td>
              <td>
                {allFlagged ? (
                  <span className="cell-truncate text-soft" title={reason}>
                    {reason}
                  </span>
                ) : run.flagged ? (
                  <Chip title={`Meldegrund: ${reason}`} tone="flagged">
                    gemeldet
                  </Chip>
                ) : (
                  <Chip tone="active">gewertet</Chip>
                )}
              </td>
              <td>
                <RowActions>
                  {run.flagged ? (
                    <RowAction
                      action={unflagRun.bind(null, run.id, returnTo)}
                      hint="Run wieder werten (zählt dann in den Ranglisten)"
                      icon="check"
                      label="Freigeben"
                    />
                  ) : (
                    <RowDangerAction
                      action={flagRun.bind(null, run.id, returnTo)}
                      description={
                        <>
                          <p className="text-muted">{who}</p>
                          <p>
                            Der Run zählt nicht mehr in den Ranglisten, bis er
                            freigegeben wird.
                          </p>
                        </>
                      }
                      icon="flag"
                      id={`run-flag-${run.id}`}
                      label="Markieren"
                      neutral
                      reason={{
                        label: "Grund",
                        placeholder: "z. B. Zeit unrealistisch",
                        maxLength: 200,
                      }}
                      submitLabel="Markieren"
                      title={`Run vom ${when} markieren`}
                    />
                  )}
                  {canDelete ? (
                    <RowDangerAction
                      action={deleteRun.bind(null, run.id, returnTo)}
                      description={
                        <>
                          <p className="text-muted">{who}</p>
                          <p>
                            Der Run verschwindet endgültig aus Ranglisten und
                            Statistiken. Markieren reicht meistens.
                          </p>
                        </>
                      }
                      icon="trash"
                      iconOnly
                      id={`run-delete-${run.id}`}
                      label="Run löschen"
                      submitLabel="Run löschen"
                      title={`Run vom ${when} löschen`}
                    />
                  ) : null}
                </RowActions>
              </td>
            </tr>
          );
        })}
        {runs.length === 0 ? (
          <EmptyRow colSpan={8}>Keine Runs.</EmptyRow>
        ) : null}
      </tbody>
    </table>
  );
}
