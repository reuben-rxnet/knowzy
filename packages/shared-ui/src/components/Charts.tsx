// Charts, drawn in SVG over numbers the caller already computed.
//
// No charting library, and that is a decision rather than an omission: a
// library adds a bundle to every analytics page, a second theming system beside
// the design tokens, and an accessibility story we would have to retrofit —
// while `Meter` shows that a labelled proportional bar is nine lines of CSS.
//
// Four rules every component here enforces, copied from `Meter` because §29 of
// the design spec names all four:
//
//   1. NO HIDDEN DENOMINATOR. A percentage is drawn with its own number on it.
//   2. NO COLOUR-ONLY MEANING. Every series carries its label, in the legend
//      AND on the bar where it fits. Eight per cent of men cannot distinguish
//      the red/green pass-fail pairing, which makes this a rule rather than a
//      preference.
//   3. A DATA ALTERNATIVE, ALWAYS. Each chart renders a visually-hidden table
//      with the same numbers, so a screen reader gets the data rather than
//      "graphic".
//   4. NO AGGREGATION HERE. These components draw what they are given. A
//      component that computed its own totals would be a second, untested
//      version of the read model.
//
// They compute no score, decide no band, and invent no value: a series with no
// data renders as absent, never as zero.

import type { ReactNode } from 'react';

export type SeriesTone = 'brand' | 'success' | 'info' | 'warning' | 'danger' | 'neutral' | 'accent';

const FILL: Record<SeriesTone, string> = {
  brand: 'fill-brand-navy',
  success: 'fill-success',
  info: 'fill-info',
  warning: 'fill-warning',
  danger: 'fill-danger',
  neutral: 'fill-line-strong',
  accent: 'fill-ai',
};

const STROKE: Record<SeriesTone, string> = {
  brand: 'stroke-brand-navy',
  success: 'stroke-success',
  info: 'stroke-info',
  warning: 'stroke-warning',
  danger: 'stroke-danger',
  neutral: 'stroke-line-strong',
  accent: 'stroke-ai',
};

const SWATCH: Record<SeriesTone, string> = {
  brand: 'bg-brand-navy',
  success: 'bg-success',
  info: 'bg-info',
  warning: 'bg-warning',
  danger: 'bg-danger',
  neutral: 'bg-line-strong',
  accent: 'bg-ai',
};

/** The hidden data table every chart carries (rule 3). */
const DataAlternative = ({
  caption,
  head,
  rows,
}: {
  readonly caption: string;
  readonly head: readonly string[];
  readonly rows: readonly (readonly (string | number)[])[];
}) => (
  // Hidden by a WRAPPER, not by putting the class on the table: CSS will not
  // shrink a table below its content, so a `knowzy-sr-only` table kept its
  // full width and widened a phone-sized Reports page. The wrapper is a block,
  // so the 1px box and the clip hold.
  <div className="knowzy-sr-only">
    <table>
      <caption>{caption}</caption>
      <thead>
        <tr>
          {head.map((cell) => (
            <th key={cell} scope="col">
              {cell}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={String(row[0])}>
            {row.map((cell, index) =>
              index === 0 ? (
                <th key={String(cell)} scope="row">
                  {cell}
                </th>
              ) : (
                <td key={`${String(row[0])}-${index}`}>{cell}</td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

// ---------------------------------------------------------------------------
// Vertical bars — "Learning completion by department"
// ---------------------------------------------------------------------------

export interface BarDatum {
  readonly label: string;
  readonly value: number;
  readonly tone?: SeriesTone;
  /** Printed on the bar. Defaults to the value with the unit appended. */
  readonly display?: string;
}

export const BarChart = ({
  title,
  description,
  data,
  unit = '%',
  max = 100,
  height = 240,
}: {
  readonly title: string;
  readonly description?: ReactNode;
  readonly data: readonly BarDatum[];
  readonly unit?: string;
  readonly max?: number;
  readonly height?: number;
}) => {
  if (data.length === 0) return null;

  const PAD_LEFT = 44;
  const PAD_BOTTOM = 34;
  const PAD_TOP = 22;
  const width = Math.max(320, data.length * 132);
  const plotHeight = height - PAD_BOTTOM - PAD_TOP;
  const band = (width - PAD_LEFT) / data.length;
  const barWidth = Math.min(72, band * 0.56);
  const ticks = [0, 20, 40, 60, 80, 100].filter((tick) => tick <= max);

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex flex-col gap-0.5">
        <span className="text-md font-semibold text-brand-navy-text">{title}</span>
        {description === undefined ? null : (
          <span className="text-sm text-ink-muted">{description}</span>
        )}
      </figcaption>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="presentation"
        aria-hidden="true"
      >
        {/* Gridlines with their own numbers: no unlabelled axis. */}
        {ticks.map((tick) => {
          const y = PAD_TOP + plotHeight - (tick / max) * plotHeight;
          return (
            <g key={tick}>
              <line
                x1={PAD_LEFT}
                x2={width}
                y1={y}
                y2={y}
                className="stroke-line"
                strokeWidth={1}
              />
              <text x={PAD_LEFT - 8} y={y + 4} textAnchor="end" className="fill-ink-muted text-2xs">
                {tick}
                {unit}
              </text>
            </g>
          );
        })}

        {data.map((datum, index) => {
          const clamped = Math.max(0, Math.min(max, datum.value));
          const barHeight = (clamped / max) * plotHeight;
          const x = PAD_LEFT + index * band + (band - barWidth) / 2;
          const y = PAD_TOP + plotHeight - barHeight;
          return (
            <g key={datum.label}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(2, barHeight)}
                rx={4}
                className={FILL[datum.tone ?? 'brand']}
              />
              <text
                x={x + barWidth / 2}
                y={y - 7}
                textAnchor="middle"
                className="fill-brand-navy-text text-xs font-semibold"
              >
                {datum.display ?? `${datum.value}${unit}`}
              </text>
              <text
                x={x + barWidth / 2}
                y={height - 10}
                textAnchor="middle"
                className="fill-ink-muted text-2xs"
              >
                {datum.label}
              </text>
            </g>
          );
        })}
      </svg>

      <DataAlternative
        caption={title}
        head={['Category', `Value (${unit})`]}
        rows={data.map((datum) => [datum.label, datum.display ?? `${datum.value}${unit}`])}
      />
    </figure>
  );
};

// ---------------------------------------------------------------------------
// 100% stacked horizontal bars — "Skillset status by level"
// ---------------------------------------------------------------------------

export interface StackSeries {
  readonly key: string;
  readonly label: string;
  readonly tone: SeriesTone;
}

export interface StackRow {
  readonly label: string;
  /** Percentages by series key. The caller's numbers; they are not re-normalized. */
  readonly parts: Readonly<Record<string, number>>;
}

export const StackedBarChart = ({
  title,
  description,
  series,
  rows,
}: {
  readonly title: string;
  readonly description?: ReactNode;
  readonly series: readonly StackSeries[];
  readonly rows: readonly StackRow[];
}) => {
  if (rows.length === 0) return null;

  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="flex flex-col gap-0.5">
        <span className="text-md font-semibold text-brand-navy-text">{title}</span>
        {description === undefined ? null : (
          <span className="text-sm text-ink-muted">{description}</span>
        )}
      </figcaption>

      <div className="flex flex-col gap-3">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-3">
            <span className="w-20 shrink-0 text-sm text-ink">{row.label}</span>
            <div className="flex h-8 flex-1 overflow-hidden rounded-md border border-line">
              {series.map((entry) => {
                const value = row.parts[entry.key] ?? 0;
                if (value <= 0) return null;
                return (
                  <div
                    key={entry.key}
                    className={`flex items-center justify-center ${SWATCH[entry.tone]}`}
                    style={{ width: `${value}%` }}
                    title={`${entry.label}: ${value}%`}
                  >
                    {/* The number is ON the segment where it fits: a stacked bar
                        whose segments are only distinguishable by colour is
                        unreadable to a colour-blind reader and to a printer. */}
                    {value >= 8 ? (
                      <span className="text-2xs font-semibold text-white">{value}%</span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {series.map((entry) => (
          <li key={entry.key} className="flex items-center gap-1.5 text-2xs text-ink-muted">
            <span aria-hidden="true" className={`size-2.5 rounded-full ${SWATCH[entry.tone]}`} />
            {entry.label}
          </li>
        ))}
      </ul>

      <DataAlternative
        caption={title}
        head={['Row', ...series.map((entry) => `${entry.label} (%)`)]}
        rows={rows.map((row) => [row.label, ...series.map((entry) => row.parts[entry.key] ?? 0)])}
      />
    </figure>
  );
};

// ---------------------------------------------------------------------------
// Trend line — only ever over rows that carry their own timestamps
// ---------------------------------------------------------------------------

export interface TrendPoint {
  readonly label: string;
  readonly value: number;
}

export const TrendChart = ({
  title,
  description,
  points,
  unit = '',
  tone = 'info',
  height = 180,
}: {
  readonly title: string;
  readonly description?: ReactNode;
  readonly points: readonly TrendPoint[];
  readonly unit?: string;
  readonly tone?: SeriesTone;
  readonly height?: number;
}) => {
  // One point is not a trend, and drawing it as a flat line would imply a
  // history that does not exist.
  if (points.length < 2) return null;

  const PAD_LEFT = 44;
  const PAD_BOTTOM = 28;
  const PAD_TOP = 16;
  const width = Math.max(360, points.length * 72);
  const plotHeight = height - PAD_BOTTOM - PAD_TOP;
  const peak = Math.max(...points.map((point) => point.value), 1);
  const step = (width - PAD_LEFT - 12) / (points.length - 1);

  const coords = points.map((point, index) => ({
    x: PAD_LEFT + index * step,
    y: PAD_TOP + plotHeight - (point.value / peak) * plotHeight,
    point,
  }));
  const path = coords
    .map((coord, index) => `${index === 0 ? 'M' : 'L'} ${coord.x.toFixed(1)} ${coord.y.toFixed(1)}`)
    .join(' ');

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex flex-col gap-0.5">
        <span className="text-md font-semibold text-brand-navy-text">{title}</span>
        {description === undefined ? null : (
          <span className="text-sm text-ink-muted">{description}</span>
        )}
      </figcaption>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="presentation"
        aria-hidden="true"
      >
        {[0, peak / 2, peak].map((tick) => {
          const y = PAD_TOP + plotHeight - (tick / peak) * plotHeight;
          return (
            <g key={tick}>
              <line x1={PAD_LEFT} x2={width} y1={y} y2={y} className="stroke-line" />
              <text x={PAD_LEFT - 8} y={y + 4} textAnchor="end" className="fill-ink-muted text-2xs">
                {Math.round(tick)}
                {unit}
              </text>
            </g>
          );
        })}

        <path d={path} fill="none" strokeWidth={2.5} className={STROKE[tone]} />
        {coords.map((coord) => (
          <g key={coord.point.label}>
            <circle cx={coord.x} cy={coord.y} r={3.5} className={FILL[tone]} />
            <text
              x={coord.x}
              y={height - 8}
              textAnchor="middle"
              className="fill-ink-muted text-2xs"
            >
              {coord.point.label}
            </text>
          </g>
        ))}
      </svg>

      <DataAlternative
        caption={title}
        head={['Period', `Value${unit === '' ? '' : ` (${unit})`}`]}
        rows={points.map((point) => [point.label, point.value])}
      />
    </figure>
  );
};

// ---------------------------------------------------------------------------
// Donut — a split of a whole, with the whole stated
// ---------------------------------------------------------------------------

export interface DonutSlice {
  readonly label: string;
  readonly value: number;
  readonly tone: SeriesTone;
}

export const DonutChart = ({
  title,
  description,
  slices,
  centreLabel,
  centreValue,
}: {
  readonly title: string;
  readonly description?: ReactNode;
  readonly slices: readonly DonutSlice[];
  readonly centreLabel?: string;
  readonly centreValue?: string;
}) => {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  if (total <= 0) return null;

  const RADIUS = 56;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  let offset = 0;

  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="flex flex-col gap-0.5">
        <span className="text-md font-semibold text-brand-navy-text">{title}</span>
        {description === undefined ? null : (
          <span className="text-sm text-ink-muted">{description}</span>
        )}
      </figcaption>

      <div className="flex items-center gap-5">
        <svg
          viewBox="0 0 160 160"
          className="size-36 shrink-0"
          role="presentation"
          aria-hidden="true"
        >
          <g transform="rotate(-90 80 80)">
            {slices.map((slice) => {
              const fraction = slice.value / total;
              const dash = fraction * CIRCUMFERENCE;
              const element = (
                <circle
                  key={slice.label}
                  cx={80}
                  cy={80}
                  r={RADIUS}
                  fill="none"
                  strokeWidth={22}
                  strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
                  strokeDashoffset={-offset}
                  className={STROKE[slice.tone]}
                />
              );
              offset += dash;
              return element;
            })}
          </g>
          {centreValue === undefined ? null : (
            <>
              <text
                x={80}
                y={76}
                textAnchor="middle"
                className="fill-brand-navy-text text-xl font-semibold"
              >
                {centreValue}
              </text>
              <text x={80} y={96} textAnchor="middle" className="fill-ink-muted text-2xs">
                {centreLabel ?? ''}
              </text>
            </>
          )}
        </svg>

        <ul className="flex flex-col gap-1.5">
          {slices.map((slice) => (
            <li key={slice.label} className="flex items-center gap-2 text-sm">
              <span aria-hidden="true" className={`size-2.5 rounded-full ${SWATCH[slice.tone]}`} />
              <span className="text-ink">{slice.label}</span>
              <span className="font-mono font-semibold tabular-nums text-brand-navy-text">
                {slice.value}
              </span>
              <span className="text-2xs text-ink-muted">
                {Math.round((slice.value / total) * 100)}%
              </span>
            </li>
          ))}
        </ul>
      </div>

      <DataAlternative
        caption={title}
        head={['Slice', 'Value', 'Share (%)']}
        rows={slices.map((slice) => [
          slice.label,
          slice.value,
          Math.round((slice.value / total) * 100),
        ])}
      />
    </figure>
  );
};

// ---------------------------------------------------------------------------
// Ranked insight list — "Top skill gaps", "Upcoming learning"
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Activity heatmap — a contribution grid over recorded periods
// ---------------------------------------------------------------------------

export interface HeatCell {
  /** The period label, e.g. `2026-09-24`, `2026-W39`, `2026-09`. */
  readonly bucket: string;
  /** The value being shaded. Absent periods are NOT passed as zero. */
  readonly value: number;
  /** Everything else about the period, for the tooltip and the hidden table. */
  readonly detail: readonly (readonly [string, string | number])[];
}

/**
 * A contribution-style grid.
 *
 * FIVE SHADES, not a continuous gradient, and the scale is printed as a legend
 * with its own numbers on it (rule 1). A continuous ramp invites the reader to
 * compare two squares by eye and conclude something the data does not support;
 * five labelled bands say "this period was in the top fifth" and nothing more.
 *
 * A PERIOD WITH NO ACTIVITY IS DRAWN EMPTY AND SAYS SO, rather than being
 * shaded as the lowest band. "Nothing was generated on the 22nd" and "a little
 * was generated on the 22nd" are different facts, and a heatmap that renders
 * them the same colour is a heatmap that cannot be read.
 *
 * Every square carries a `<title>`, which is what a pointer shows and what a
 * screen reader reads for that node; the hidden table beneath carries the
 * whole series regardless (rule 3).
 *
 * It computes NO totals and NO buckets (rule 4): the caller passes the periods
 * it actually has, newest or oldest first as it likes, and this draws them in
 * the order given.
 */
export const ActivityHeatmap = ({
  cells,
  caption,
  valueLabel,
  columns = 14,
  emptyLabel = 'No activity recorded',
}: {
  readonly cells: readonly HeatCell[];
  readonly caption: string;
  /** What the shaded number IS. Printed in the legend, never left to a colour. */
  readonly valueLabel: string;
  readonly columns?: number;
  readonly emptyLabel?: string;
}) => {
  if (cells.length === 0) return null;

  const values = cells.map((cell) => cell.value).filter((value) => value > 0);
  const max = values.length === 0 ? 0 : Math.max(...values);

  // Band boundaries, in the units being shaded, so the legend can print them.
  // Five bands over the observed maximum; with a maximum of zero there is
  // nothing to band and every cell renders as empty.
  const bands = [0.2, 0.4, 0.6, 0.8, 1].map((fraction) => Math.max(1, Math.ceil(max * fraction)));
  const bandOf = (value: number): number => {
    if (value <= 0) return -1;
    return bands.findIndex((ceiling) => value <= ceiling);
  };

  const BAND_CLASS = [
    'bg-info/20 ring-info/30',
    'bg-info/40 ring-info/40',
    'bg-info/60 ring-info/50',
    'bg-info/80 ring-info/60',
    'bg-info ring-info',
  ];

  return (
    <div className="flex flex-col gap-3">
      {/* A CAPPED cell, not a fractional one. With `1fr` a single-period series
          stretched one square to 80px across a wide card, which read as a
          block of colour rather than a calendar. A contribution grid's squares
          are small and uniform however many there are, so the track has a
          maximum and the grid sits left. */}
      <div
        className="grid w-fit gap-1"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0.75rem, 1.125rem))` }}
      >
        {cells.map((cell) => {
          const band = bandOf(cell.value);
          return (
            <span
              key={cell.bucket}
              className={`aspect-square rounded-sm ring-1 ring-inset ${
                band === -1 ? 'bg-surface-sunken ring-line' : (BAND_CLASS[band] ?? BAND_CLASS[0])
              }`}
              // `title` rather than a custom tooltip: it is what a pointer
              // shows, what a keyboard user gets on focus in most browsers, and
              // it needs no client JavaScript on a server-rendered page.
              title={[
                cell.bucket,
                band === -1 ? emptyLabel : `${valueLabel}: ${cell.value.toLocaleString()}`,
                ...cell.detail.map(([name, value]) => `${name}: ${value}`),
              ].join(' · ')}
            >
              <span className="knowzy-sr-only">
                {cell.bucket}: {band === -1 ? emptyLabel : `${cell.value} ${valueLabel}`}
              </span>
            </span>
          );
        })}
      </div>

      {/* The scale, with its numbers on it. Rule 1 and rule 2 together: the
          bands are labelled, so the colour is a convenience rather than the
          only carrier of the meaning. */}
      <div className="flex flex-wrap items-center gap-2 text-2xs text-ink-muted">
        <span>{emptyLabel}</span>
        <span
          aria-hidden="true"
          className="size-3 rounded-sm bg-surface-sunken ring-1 ring-inset ring-line"
        />
        {bands.map((ceiling, index) => (
          <span key={ceiling} className="flex items-center gap-1">
            <span
              aria-hidden="true"
              className={`size-3 rounded-sm ring-1 ring-inset ${BAND_CLASS[index] ?? BAND_CLASS[0]}`}
            />
            <span>{`\u2264 ${ceiling.toLocaleString()}`}</span>
          </span>
        ))}
        <span>{valueLabel}</span>
      </div>

      <DataAlternative
        caption={caption}
        head={['Period', valueLabel, ...(cells[0]?.detail.map(([name]) => name) ?? [])]}
        rows={cells.map((cell) => [
          cell.bucket,
          cell.value,
          ...cell.detail.map(([, value]) => value),
        ])}
      />
    </div>
  );
};

export interface InsightRow {
  readonly label: string;
  readonly figure: ReactNode;
  readonly trailing?: ReactNode;
}

export const InsightList = ({
  title,
  icon,
  rows,
  emptyLabel,
}: {
  readonly title: string;
  readonly icon?: ReactNode;
  readonly rows: readonly InsightRow[];
  readonly emptyLabel: string;
}) => (
  <section className="flex flex-col gap-2">
    <h3 className="flex items-center gap-2 text-base font-semibold text-brand-navy-text">
      {icon}
      {title}
    </h3>
    {rows.length === 0 ? (
      <p className="text-sm text-ink-muted">{emptyLabel}</p>
    ) : (
      <ol className="flex flex-col">
        {rows.map((row, index) => (
          <li
            key={row.label}
            className="flex items-baseline gap-3 border-b border-line py-2 last:border-b-0"
          >
            <span
              aria-hidden="true"
              className="grid size-5 shrink-0 place-items-center rounded bg-neutral-soft text-2xs font-semibold text-ink-muted"
            >
              {index + 1}
            </span>
            <span className="flex-1 text-sm text-ink">{row.label}</span>
            <span className="font-mono text-sm tabular-nums text-ink-muted">{row.figure}</span>
            {row.trailing === undefined ? null : (
              <span className="text-2xs text-ink-muted">{row.trailing}</span>
            )}
          </li>
        ))}
      </ol>
    )}
  </section>
);

// ---------------------------------------------------------------------------
// Multi-series line — "Question Generation Trend"
// ---------------------------------------------------------------------------

export interface LineSeries {
  readonly key: string;
  readonly label: string;
  readonly tone: SeriesTone;
}

export interface LinePoint {
  readonly label: string;
  /** Values by series key. A missing key is drawn as absent, never as zero. */
  readonly values: Readonly<Record<string, number>>;
  /** The period is still running. Drawn hollow, and named in the legend. */
  readonly partial?: boolean;
}

/** A round axis ceiling, so gridlines carry numbers a reader would write. */
const niceCeiling = (value: number): number => {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((m) => m * magnitude >= value) ?? 10;
  return step * magnitude;
};

/**
 * Two or more series over the same periods.
 *
 * The LAST point of each series is labelled with its value, as the approved
 * design does, and a PARTIAL period — the current month, still running — is
 * drawn hollow at the end of a dashed segment and named in the legend. A
 * partial month drawn level with complete ones reads as a decline; this is
 * the one place the chart itself has to say so.
 */
export const LineChart = ({
  title,
  description,
  series,
  points,
  partialLabel = 'Period still in progress',
  height = 240,
}: {
  readonly title: string;
  readonly description?: ReactNode;
  readonly series: readonly LineSeries[];
  readonly points: readonly LinePoint[];
  readonly partialLabel?: string;
  readonly height?: number;
}) => {
  if (points.length < 2 || series.length === 0) return null;

  const PAD_LEFT = 48;
  const PAD_RIGHT = 56;
  const PAD_BOTTOM = 30;
  const PAD_TOP = 18;
  const width = Math.max(520, points.length * 60);
  const plotHeight = height - PAD_BOTTOM - PAD_TOP;
  const peak = niceCeiling(
    Math.max(...points.flatMap((point) => series.map((entry) => point.values[entry.key] ?? 0))),
  );
  const step = (width - PAD_LEFT - PAD_RIGHT) / (points.length - 1);
  const xOf = (index: number) => PAD_LEFT + index * step;
  const yOf = (value: number) => PAD_TOP + plotHeight - (value / peak) * plotHeight;
  const ticks = [...new Set([0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(peak * f * 100) / 100))];
  // Thin the x labels on a long daily series so they do not overprint.
  const labelEvery = Math.max(1, Math.ceil(points.length / 12));
  const hasPartial = points.some((point) => point.partial === true);

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex flex-col gap-0.5">
        <span className="text-md font-semibold text-brand-navy-text">{title}</span>
        {description === undefined ? null : (
          <span className="text-sm text-ink-muted">{description}</span>
        )}
      </figcaption>

      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {series.map((entry) => (
          <li key={entry.key} className="flex items-center gap-1.5 text-2xs text-ink-muted">
            <span aria-hidden="true" className={`size-2.5 rounded-full ${SWATCH[entry.tone]}`} />
            {entry.label}
          </li>
        ))}
        {hasPartial ? (
          <li className="flex items-center gap-1.5 text-2xs text-ink-muted">
            <span
              aria-hidden="true"
              className="size-2.5 rounded-full border-2 border-ink-muted bg-brand-surface"
            />
            {partialLabel}
          </li>
        ) : null}
      </ul>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="presentation"
        aria-hidden="true"
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD_LEFT}
              x2={width - PAD_RIGHT}
              y1={yOf(tick)}
              y2={yOf(tick)}
              className="stroke-line"
            />
            <text
              x={PAD_LEFT - 8}
              y={yOf(tick) + 4}
              textAnchor="end"
              className="fill-ink-muted text-2xs"
            >
              {tick.toLocaleString('en-GB')}
            </text>
          </g>
        ))}

        {series.map((entry) => {
          const coords = points
            .map((point, index) => ({ index, value: point.values[entry.key], point }))
            .filter(
              (c): c is { index: number; value: number; point: LinePoint } =>
                typeof c.value === 'number',
            );
          const complete = coords.filter((c) => c.point.partial !== true);
          const solid = complete
            .map(
              (c, i) =>
                `${i === 0 ? 'M' : 'L'} ${xOf(c.index).toFixed(1)} ${yOf(c.value).toFixed(1)}`,
            )
            .join(' ');
          const last = coords.at(-1);
          const lastComplete = complete.at(-1);
          return (
            <g key={entry.key}>
              <path d={solid} fill="none" strokeWidth={2.5} className={STROKE[entry.tone]} />
              {last !== undefined && last.point.partial === true && lastComplete !== undefined ? (
                <path
                  d={`M ${xOf(lastComplete.index)} ${yOf(lastComplete.value)} L ${xOf(last.index)} ${yOf(last.value)}`}
                  fill="none"
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  className={STROKE[entry.tone]}
                />
              ) : null}
              {coords.map((c) =>
                c.point.partial === true ? (
                  <circle
                    key={c.index}
                    cx={xOf(c.index)}
                    cy={yOf(c.value)}
                    r={4}
                    strokeWidth={2}
                    className={`fill-brand-surface ${STROKE[entry.tone]}`}
                  />
                ) : (
                  <circle
                    key={c.index}
                    cx={xOf(c.index)}
                    cy={yOf(c.value)}
                    r={3.5}
                    className={FILL[entry.tone]}
                  />
                ),
              )}
              {last === undefined ? null : (
                <text
                  x={xOf(last.index) + 8}
                  y={yOf(last.value) + 4}
                  className={`${FILL[entry.tone]} text-xs font-semibold`}
                >
                  {last.value.toLocaleString('en-GB')}
                </text>
              )}
            </g>
          );
        })}

        {points.map((point, index) =>
          index % labelEvery === 0 || index === points.length - 1 ? (
            <text
              key={point.label}
              x={xOf(index)}
              y={height - 8}
              textAnchor="middle"
              className="fill-ink-muted text-2xs"
            >
              {point.label}
            </text>
          ) : null,
        )}
      </svg>

      <DataAlternative
        caption={title}
        head={['Period', ...series.map((entry) => entry.label), 'Partial']}
        rows={points.map((point) => [
          point.label,
          ...series.map((entry) => point.values[entry.key] ?? '—'),
          point.partial === true ? 'yes' : 'no',
        ])}
      />
    </figure>
  );
};

// ---------------------------------------------------------------------------
// Vertical stacked columns, absolute — "Questions by Department & Job Role"
// ---------------------------------------------------------------------------

export interface ColumnStack {
  readonly label: string;
  /** Counts by series key. The caller's numbers, drawn as given. */
  readonly parts: Readonly<Record<string, number>>;
}

export const StackedColumnChart = ({
  title,
  description,
  series,
  columns,
  height = 260,
}: {
  readonly title: string;
  readonly description?: ReactNode;
  readonly series: readonly StackSeries[];
  readonly columns: readonly ColumnStack[];
  readonly height?: number;
}) => {
  if (columns.length === 0 || series.length === 0) return null;

  const PAD_LEFT = 44;
  const PAD_BOTTOM = 36;
  const PAD_TOP = 20;
  const width = Math.max(420, columns.length * 96);
  const plotHeight = height - PAD_BOTTOM - PAD_TOP;
  // The stack heights are sums of the parts the caller gave. That is drawing,
  // not aggregation: the column total printed on top is the sum of what is
  // drawn beneath it, and the hidden table carries both.
  const totals = columns.map((column) =>
    series.reduce((sum, entry) => sum + (column.parts[entry.key] ?? 0), 0),
  );
  const peak = niceCeiling(Math.max(...totals, 1));
  const band = (width - PAD_LEFT) / columns.length;
  const barWidth = Math.min(56, band * 0.56);
  const yOf = (value: number) => PAD_TOP + plotHeight - (value / peak) * plotHeight;
  const ticks = [...new Set([0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(peak * f)))];

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex flex-col gap-0.5">
        <span className="text-md font-semibold text-brand-navy-text">{title}</span>
        {description === undefined ? null : (
          <span className="text-sm text-ink-muted">{description}</span>
        )}
      </figcaption>

      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {series.map((entry) => (
          <li key={entry.key} className="flex items-center gap-1.5 text-2xs text-ink-muted">
            <span aria-hidden="true" className={`size-2.5 rounded-full ${SWATCH[entry.tone]}`} />
            {entry.label}
          </li>
        ))}
      </ul>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="presentation"
        aria-hidden="true"
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={PAD_LEFT} x2={width} y1={yOf(tick)} y2={yOf(tick)} className="stroke-line" />
            <text
              x={PAD_LEFT - 8}
              y={yOf(tick) + 4}
              textAnchor="end"
              className="fill-ink-muted text-2xs"
            >
              {tick.toLocaleString('en-GB')}
            </text>
          </g>
        ))}

        {columns.map((column, index) => {
          const x = PAD_LEFT + index * band + (band - barWidth) / 2;
          let base = 0;
          return (
            <g key={column.label}>
              {series.map((entry) => {
                const value = column.parts[entry.key] ?? 0;
                if (value <= 0) return null;
                const y = yOf(base + value);
                const h = yOf(base) - y;
                base += value;
                return (
                  <rect
                    key={entry.key}
                    x={x}
                    y={y}
                    width={barWidth}
                    height={Math.max(1, h)}
                    className={FILL[entry.tone]}
                  >
                    <title>{`${column.label} · ${entry.label}: ${value}`}</title>
                  </rect>
                );
              })}
              {/* The column's total on top: rule 1, no hidden denominator. */}
              <text
                x={x + barWidth / 2}
                y={yOf(totals[index] ?? 0) - 6}
                textAnchor="middle"
                className="fill-brand-navy-text text-xs font-semibold"
              >
                {(totals[index] ?? 0).toLocaleString('en-GB')}
              </text>
              <text
                x={x + barWidth / 2}
                y={height - 12}
                textAnchor="middle"
                className="fill-ink-muted text-2xs"
              >
                {column.label}
              </text>
            </g>
          );
        })}
      </svg>

      <DataAlternative
        caption={title}
        head={['Column', ...series.map((entry) => entry.label), 'Total']}
        rows={columns.map((column, index) => [
          column.label,
          ...series.map((entry) => column.parts[entry.key] ?? 0),
          totals[index] ?? 0,
        ])}
      />
    </figure>
  );
};

// ---------------------------------------------------------------------------
// Matrix heatmap — "Learner Performance", rows × columns of percentages
// ---------------------------------------------------------------------------

export interface MatrixCell {
  readonly row: string;
  readonly column: string;
  /**
   * A percentage, `null` for "no attempts", or `'SUPPRESSED'`. Three different
   * facts, drawn three different ways: a number, a dash, and the word.
   */
  readonly value: number | null | 'SUPPRESSED';
  /** Extra facts for the pointer tooltip. */
  readonly detail?: readonly (readonly [string, string | number])[];
}

/** The approved design's five bands, with their boundaries printed in the legend. */
const MATRIX_BANDS: readonly {
  readonly below: number;
  readonly label: string;
  readonly cls: string;
}[] = [
  { below: 60, label: '< 60%', cls: 'bg-danger text-white' },
  { below: 70, label: '60–70%', cls: 'bg-danger-soft text-danger' },
  { below: 80, label: '70–80%', cls: 'bg-warning-soft text-warning' },
  { below: 90, label: '80–90%', cls: 'bg-success-soft text-success' },
  { below: Infinity, label: '≥ 90%', cls: 'bg-success text-white' },
];

const HATCH =
  'bg-[repeating-linear-gradient(135deg,var(--color-surface-sunken)_0_6px,var(--color-line)_6px_8px)]';

/**
 * A rows × columns grid of percentages, as a real table.
 *
 * EVERY CELL PRINTS ITS NUMBER (rule 2): the band colour is a reading aid, not
 * the carrier. A SUPPRESSED cell is hatched and says "Suppressed" — never
 * blank, never zero, never only a colour (S2) — and a cell with no attempts
 * shows a dash and says so to a screen reader. The grid computes nothing: it
 * draws the values given. Because it IS a table, it needs no separate data
 * alternative.
 */
export const MatrixHeatmap = ({
  caption,
  rows,
  columns,
  cells,
  suppressedLabel = 'Suppressed',
  emptyLabel = 'No attempts',
  unit = '%',
}: {
  readonly caption: string;
  readonly rows: readonly string[];
  readonly columns: readonly string[];
  readonly cells: readonly MatrixCell[];
  readonly suppressedLabel?: string;
  readonly emptyLabel?: string;
  readonly unit?: string;
}) => {
  if (rows.length === 0 || columns.length === 0) return null;
  const at = new Map(cells.map((cell) => [`${cell.row}\u0000${cell.column}`, cell]));
  const bandOf = (value: number) => MATRIX_BANDS.find((band) => value < band.below);

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-1 text-xs">
          <caption className="knowzy-sr-only">{caption}</caption>
          <thead>
            <tr>
              <td />
              {columns.map((column) => (
                <th key={column} scope="col" className="px-1 text-center font-semibold text-ink">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row}>
                <th scope="row" className="whitespace-nowrap pr-2 text-left font-medium text-ink">
                  {row}
                </th>
                {columns.map((column) => {
                  const cell = at.get(`${row}\u0000${column}`);
                  if (cell === undefined || cell.value === null) {
                    return (
                      <td
                        key={column}
                        className="h-9 rounded-sm bg-surface-sunken text-center text-ink-subtle"
                        title={`${row} · ${column}: ${emptyLabel}`}
                      >
                        <span aria-hidden="true">—</span>
                        <span className="knowzy-sr-only">{emptyLabel}</span>
                      </td>
                    );
                  }
                  if (cell.value === 'SUPPRESSED') {
                    return (
                      <td
                        key={column}
                        className={`h-9 rounded-sm ${HATCH} text-center text-2xs font-semibold text-ink-muted`}
                        title={`${row} · ${column}: ${suppressedLabel}`}
                        data-suppressed="true"
                      >
                        {suppressedLabel}
                      </td>
                    );
                  }
                  const detail = (cell.detail ?? []).map(([k, v]) => `${k}: ${v}`).join(' · ');
                  return (
                    <td
                      key={column}
                      className={`h-9 rounded-sm text-center font-semibold tabular-nums ${bandOf(cell.value)?.cls ?? ''}`}
                      title={`${row} · ${column}: ${cell.value}${unit}${detail === '' ? '' : ` · ${detail}`}`}
                    >
                      {`${Math.round(cell.value)}${unit}`}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-2xs text-ink-muted">
        {MATRIX_BANDS.map((band) => (
          <span key={band.label} className="flex items-center gap-1">
            <span aria-hidden="true" className={`h-3 w-5 rounded-sm ${band.cls}`} />
            {band.label}
          </span>
        ))}
        <span className="flex items-center gap-1">
          <span aria-hidden="true" className={`h-3 w-5 rounded-sm ${HATCH}`} />
          {suppressedLabel}
        </span>
        <span className="flex items-center gap-1">
          <span aria-hidden="true" className="h-3 w-5 rounded-sm bg-surface-sunken" />
          {emptyLabel}
        </span>
      </div>
    </div>
  );
};
