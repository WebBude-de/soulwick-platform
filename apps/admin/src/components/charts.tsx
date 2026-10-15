/**
 * Calm, server-rendered charts in plain HTML/CSS (no client JS, no chart library). One series per
 * chart in the data hue (--attr); text stays in text tokens; values are in a table next to it.
 */

export interface ColumnDatum {
  key: string;
  /** Axis label (only some are shown). */
  label: string;
  /** Native hover text, e.g. "15.10.: 3 Runs". */
  title: string;
  value: number;
}

/** Whole-number ticks in steps of 1, 2 or 5 × 10^n, about four of them, from 0. */
function ticks(max: number): number[] {
  const rough = Math.max(1, max / 4);
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = ([1, 2, 5, 10].find((m) => m * power >= rough) ?? 10) * power;
  const top = Math.max(step, Math.ceil(max / step) * step);
  return Array.from({ length: top / step + 1 }, (_, i) => i * step);
}

const MAX_AXIS_LABELS = 8;

/** Column chart for a daily series: thin columns (max 24 px) from one baseline, 2 px gaps. */
export function ColumnChart({
  title,
  summary,
  data,
}: {
  title: string;
  /** Short text next to the title, e.g. "Summe 20 · Spitze 5". */
  summary: string;
  data: ColumnDatum[];
}) {
  const max = Math.max(0, ...data.map((d) => d.value));
  const axis = ticks(max);
  const top = axis.at(-1) ?? 1;
  const every = Math.max(1, Math.ceil(data.length / MAX_AXIS_LABELS));
  const pct = (v: number) => `${(v / top) * 100}%`;
  const last = data.length - 1;
  // Every n-th day plus the last one, without crowding the last label.
  const showLabel = (i: number) =>
    i === last || (i % every === 0 && last - i >= every / 2);

  return (
    <figure className="card p-4 sm:p-5">
      <figcaption className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-bold font-pixel text-[20px] text-text">
          {title}
        </span>
        <span className="text-muted text-sm">{summary}</span>
      </figcaption>
      <div aria-hidden="true" className="flex gap-3">
        <div className="relative h-40 w-8 shrink-0 font-data text-muted text-xs">
          {axis.map((t) => (
            <span
              className="absolute right-0 translate-y-1/2"
              key={t}
              style={{ bottom: pct(t) }}
            >
              {t}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="relative h-40">
            {axis.map((t) => (
              <div
                className="absolute inset-x-0 border-line border-t"
                key={t}
                style={{ bottom: pct(t) }}
              />
            ))}
            <div className="absolute inset-0 flex items-end gap-[2px]">
              {data.map((d) => (
                <div
                  className="flex h-full min-w-0 flex-1 items-end justify-center"
                  key={d.key}
                  title={d.title}
                >
                  <div
                    className="w-full max-w-6 rounded-t-[4px] bg-attr"
                    style={{ height: pct(d.value) }}
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="relative mt-1 h-5 font-data text-muted text-xs">
            {data.map((d, i) =>
              showLabel(i) ? (
                <span
                  className="absolute -translate-x-1/2 whitespace-nowrap"
                  key={d.key}
                  style={{ left: `${((i + 0.5) / data.length) * 100}%` }}
                >
                  {d.label}
                </span>
              ) : null
            )}
          </div>
        </div>
      </div>
    </figure>
  );
}

/**
 * Small inline-SVG column chart for the overview: one series, fixed height, scales to the card
 * width (columns stretch, the baseline keeps 1 px through `vector-effect`). Hover text per day via
 * <title>; the total and the first/last day stand next to it as text.
 */
export function SparkColumns({
  label,
  data,
}: {
  /** Accessible summary, e.g. "Runs pro Tag, 14 Tage, Summe 20". */
  label: string;
  data: ColumnDatum[];
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const slot = 10;
  const height = 100;
  return (
    <svg
      aria-label={label}
      className="block h-16 w-full"
      preserveAspectRatio="none"
      role="img"
      viewBox={`0 0 ${Math.max(1, data.length) * slot} ${height}`}
    >
      {data.map((d, i) => {
        // At least a sliver for days with data, nothing for zero days.
        const h = d.value === 0 ? 0 : Math.max(4, (d.value / max) * height);
        return (
          <g key={d.key}>
            <title>{d.title}</title>
            {/* Full-height transparent hit area so the hover text works on empty days too. */}
            <rect
              fill="transparent"
              height={height}
              width={slot}
              x={i * slot}
              y={0}
            />
            <rect
              className="fill-attr"
              height={h}
              width={slot - 2}
              x={i * slot + 1}
              y={height - h}
            />
          </g>
        );
      })}
      <line
        className="stroke-line-light"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
        x1={0}
        x2={data.length * slot}
        y1={height}
        y2={height}
      />
    </svg>
  );
}

export interface BarDatum {
  key: string;
  label: string;
  value: number;
}

/** Horizontal bars with the value at the tip, as a table (readable without the bars). */
export function BarTable({
  caption,
  labelHeader,
  valueHeader,
  data,
}: {
  caption: string;
  labelHeader: string;
  valueHeader: string;
  data: BarDatum[];
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <table className="table">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          <th className="w-24">{labelHeader}</th>
          <th>{valueHeader}</th>
        </tr>
      </thead>
      <tbody>
        {data.map((d) => (
          <tr key={d.key}>
            <td className="whitespace-nowrap font-data">{d.label}</td>
            <td>
              <div className="flex items-center gap-2">
                <div
                  aria-hidden="true"
                  className="h-3 rounded-r-[4px] bg-attr"
                  style={{ width: `${(d.value / max) * 80}%` }}
                />
                <span className="font-data">{d.value}</span>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
