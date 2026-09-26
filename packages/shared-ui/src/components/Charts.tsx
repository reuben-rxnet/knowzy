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
  <table className="knowzy-sr-only">
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
