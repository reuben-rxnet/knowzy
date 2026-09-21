// A proportion, drawn.
//
// §29 allows horizontal bars and progress bars, and requires an accessible
// name, a text summary, and a data alternative "where practical". Here it is
// entirely practical, so the numbers are always rendered as text beside the
// bar: the bar is decoration over a value that is readable without it.
//
// Three rules this component enforces, because §29 names all three as things
// to avoid:
//
//   * No hidden denominator. `value` and `max` are both displayed.
//   * No colour-only legend. Every band carries its label.
//   * No unlabelled axis. A threshold marker states its number.
//
// It draws what it is given. It computes no score and decides no band.

import type { ReactNode } from 'react';

export type MeterTone = 'success' | 'info' | 'warning' | 'danger' | 'neutral';

const FILL: Record<MeterTone, string> = {
  success: 'bg-success',
  info: 'bg-info',
  warning: 'bg-warning',
  danger: 'bg-danger',
  neutral: 'bg-line-strong',
};

export interface MeterProps {
  /** What the bar is of — shown, and part of the accessible name. */
  readonly label: ReactNode;
  readonly percent: number;
  readonly tone?: MeterTone;
  /** The raw numbers behind the percentage: "3 of 8 correct". */
  readonly summary?: ReactNode;
  /** A status word beside the value, e.g. a proficiency band. */
  readonly trailing?: ReactNode;
  /** Reference lines, each labelled with its own number (§29). */
  readonly thresholds?: readonly { readonly at: number; readonly label: string }[];
  readonly size?: 'md' | 'sm';
}

export const Meter = ({
  label,
  percent,
  tone = 'info',
  summary,
  trailing,
  thresholds = [],
  size = 'md',
}: MeterProps) => {
  // Clamped for drawing only. The number printed is the one supplied.
  const width = Math.max(0, Math.min(100, percent));

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-base font-medium text-ink">{label}</span>
        <span className="flex items-baseline gap-2">
          <span className="font-mono text-base font-semibold tabular-nums text-brand-navy-text">
            {percent}%
          </span>
          {trailing}
        </span>
      </div>

      <div
        className={`relative w-full overflow-hidden rounded-pill bg-surface-sunken ${
          size === 'sm' ? 'h-1.5' : 'h-2.5'
        }`}
        // One accessible name carrying the whole claim, so a screen reader
        // hears the value rather than "graphic".
        role="img"
        aria-label={`${typeof label === 'string' ? label : ''} ${percent}%${
          typeof summary === 'string' ? ` — ${summary}` : ''
        }`}
      >
        <div className={`h-full rounded-pill ${FILL[tone]}`} style={{ width: `${width}%` }} />
        {thresholds.map((threshold) => (
          <span
            key={threshold.label}
            aria-hidden="true"
            title={`${threshold.label} ${threshold.at}%`}
            className="absolute top-0 h-full w-px bg-ink-subtle/50"
            style={{ left: `${Math.max(0, Math.min(100, threshold.at))}%` }}
          />
        ))}
      </div>

      {summary === undefined ? null : <p className="text-sm text-ink-muted">{summary}</p>}
    </div>
  );
};

/**
 * The scale a score was judged against.
 *
 * Bands come from the server's `appliedThresholds` — the ones actually used
 * for this result, not a copy of the defaults. Showing where the score fell is
 * the difference between "0%" and "0%, which is the bottom of five bands".
 */
export const BandScale = ({
  bands,
  score,
  currentBand,
  bandLabel,
}: {
  readonly bands: readonly {
    readonly band: string;
    readonly minInclusive: number;
    readonly maxExclusive: number;
  }[];
  readonly score: number;
  readonly currentBand: string;
  /** Formats a band token for display; identity by default. */
  readonly bandLabel?: (band: string) => string;
}) => (
  <ol className="flex flex-col gap-1">
    {bands.map((band) => {
      const current = band.band === currentBand;
      return (
        <li
          key={band.band}
          {...(current ? { 'aria-current': 'true' as const } : {})}
          className={`flex flex-wrap items-center justify-between gap-2 rounded-md px-3 py-2 text-base ${
            current
              ? // Not colour alone: the current band is also the only row
                // carrying a word saying so.
                'bg-info-soft font-semibold text-brand-navy-text ring-1 ring-inset ring-info/30'
              : 'text-ink-muted'
          }`}
        >
          <span>{bandLabel === undefined ? band.band : bandLabel(band.band)}</span>
          <span className="flex items-center gap-2">
            <span className="font-mono text-sm tabular-nums">
              {band.minInclusive}–{Math.min(100, band.maxExclusive)}%
            </span>
            {current ? (
              <span className="rounded-pill bg-info px-2 py-0.5 text-2xs font-bold text-white">
                {score}%
              </span>
            ) : null}
          </span>
        </li>
      );
    })}
  </ol>
);
