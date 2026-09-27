// Previous-period comparison — the arithmetic behind every KPI delta.
//
// Until decision R-1 (2026-09-27) the platform stored no history of any
// point-in-time figure, and every screen was correctly forbidden from showing
// "vs previous period". R-1 made coverage history a permanent requirement, and
// `reporting.coverage_snapshot` now records one row per UTC day. That makes a
// delta HONEST for two kinds of figure, and only two:
//
//   DATED_ROWS  a FLOW over a window — assessments completed, generations,
//               cost. The previous window is counted from the same dated rows,
//               so it needs no stored history at all.
//   SNAPSHOT    a STATE at a moment — total questions, coverage, sources. The
//               previous value is the snapshot recorded on the day the period
//               began. No snapshot, no comparison.
//
// FOUR THINGS THIS MODULE REFUSES TO DO
//
//   * It never compares against a number nobody recorded. A missing base is
//     `NOT_YET_AVAILABLE` with the date a comparison becomes possible, never a
//     zero and never an estimate.
//   * It never computes a percentage change from a zero base. "+∞%" is not a
//     trend, and "+100%" would be a lie about a base of nothing. The absolute
//     change is still reported.
//   * It never reports a percentage change of a percentage. Pass rate moving
//     from 80% to 84% is +4 POINTS; "+5%" is a different, easily misread
//     claim. Ratio metrics carry points only.
//   * It never infers direction from a rounded figure. FLAT means the two
//     values are equal, not that they round to the same display.
//
// Pure: no database, no clock. The caller supplies both values and the basis.

export type ComparisonBasis = 'SNAPSHOT' | 'DATED_ROWS';

/** How the change is expressed, which decides whether a percentage is meaningful. */
export type ChangeUnit = 'count' | 'points' | 'currency';

export type ComparisonStatus =
  /** Both values were measured. */
  | 'AVAILABLE'
  /** No base value exists yet: no snapshot that old, or no earlier window recorded. */
  | 'NOT_YET_AVAILABLE'
  /** The current or previous value is withheld by privacy suppression. */
  | 'SUPPRESSED'
  /** A contributor's cost could not be observed, so no total exists to compare. */
  | 'NOT_OBSERVABLE'
  /** The base is platform-wide and the caller's view is restricted. */
  | 'SCOPE_RESTRICTED';

export type Direction = 'UP' | 'DOWN' | 'FLAT';

export interface Comparison {
  readonly status: ComparisonStatus;
  readonly basis: ComparisonBasis;
  readonly previous: number | null;
  /** current − previous, in the metric's own unit. Null unless AVAILABLE. */
  readonly change: number | null;
  /** (current − previous) ÷ previous × 100. Null for points, for a zero base, and unless AVAILABLE. */
  readonly changePercent: number | null;
  readonly direction: Direction | null;
  readonly unit: ChangeUnit;
  /** The day or window the previous value belongs to, ISO. */
  readonly baseFrom: string | null;
  readonly baseTo: string | null;
  /** One sentence a reader can check. Always present, including for AVAILABLE. */
  readonly note: string;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** A measured comparison of two recorded values. */
export const compareValues = (args: {
  readonly current: number;
  readonly previous: number;
  readonly unit: ChangeUnit;
  readonly basis: ComparisonBasis;
  readonly baseFrom: string;
  readonly baseTo: string | null;
  readonly note: string;
}): Comparison => {
  const change = round2(args.current - args.previous);
  const direction: Direction =
    args.current > args.previous ? 'UP' : args.current < args.previous ? 'DOWN' : 'FLAT';
  const changePercent =
    args.unit === 'points' || args.previous === 0
      ? null
      : round2(((args.current - args.previous) / args.previous) * 100);
  return {
    status: 'AVAILABLE',
    basis: args.basis,
    previous: args.previous,
    change,
    changePercent,
    direction,
    unit: args.unit,
    baseFrom: args.baseFrom,
    baseTo: args.baseTo,
    note: args.note,
  };
};

/** A comparison that cannot be made, with the reason. */
export const noComparison = (args: {
  readonly status: Exclude<ComparisonStatus, 'AVAILABLE'>;
  readonly unit: ChangeUnit;
  readonly basis: ComparisonBasis;
  readonly note: string;
}): Comparison => ({
  status: args.status,
  basis: args.basis,
  previous: null,
  change: null,
  changePercent: null,
  direction: null,
  unit: args.unit,
  baseFrom: null,
  baseTo: null,
  note: args.note,
});

/**
 * The previous window of a flow metric: the `days` immediately before `from`.
 *
 * Half-open, like every window here (D9): [from − days, from).
 */
export const previousWindow = (from: Date, days: number): { from: Date; to: Date } => ({
  from: new Date(from.getTime() - days * 86_400_000),
  to: new Date(from.getTime()),
});

/** The UTC calendar date of an instant, as `YYYY-MM-DD`. */
export const utcDate = (instant: Date): string => instant.toISOString().slice(0, 10);

/** `YYYY-MM-DD` plus `days`, in UTC. */
export const addDays = (date: string, days: number): string =>
  utcDate(new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000));

/**
 * How far a snapshot may predate the start of the period and still serve as
 * its base. A snapshot three weeks older than the period start would compare
 * a different period and call it this one, so the tolerance is small, and the
 * base date actually used is always printed with the comparison.
 */
export const SNAPSHOT_BASE_TOLERANCE_DAYS = 3;
