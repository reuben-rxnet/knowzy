// The shape of a catalogue entry — reporting.md §4.
//
// Its own module so that both the R1 catalogue (datasets.ts) and the R2
// dashboard entries (dashboard.ts) can declare entries without importing each
// other: boundary rule B9 refuses a cycle, even one made only of types.

import type { SuppressionPolicy } from './suppression.js';

/** The dashboard's panels (Phase 10 R2), as catalogue names. */
export const DASHBOARD_DATASETS = [
  'kpis',
  'question-trend',
  'question-status',
  'department-role',
  'learner-performance',
  'source-health',
  'activity',
] as const;
export type DashboardDatasetName = (typeof DASHBOARD_DATASETS)[number];

/** Every catalogue entry: R1's five reports, then the dashboard's panels. */
export const DATASETS = [
  'question-pipeline',
  'generation',
  'assessments',
  'filing',
  'sources',
  ...DASHBOARD_DATASETS,
] as const;
export type DatasetName = (typeof DATASETS)[number];

/** One measure, with the sentence that defines it. */
export interface MetricDefinition {
  readonly column: string;
  readonly label: string;
  /** B3. Written as an expression a reader can check against the numbers. */
  readonly formula: string;
  /** True where the figure is modelled rather than counted (B7). */
  readonly estimated?: boolean;
}

export interface DatasetDefinition {
  readonly name: DatasetName;
  readonly title: string;
  readonly grain: string;
  /** The read models this entry reads, for the staleness report. */
  readonly models: readonly string[];
  readonly requiredPermission: string;
  /** §3.2: an aggregate a reader cannot decompose is one they cannot audit. */
  readonly drillThrough: string | null;
  readonly dimensions: readonly { column: string; label: string }[];
  readonly metrics: readonly MetricDefinition[];
  /**
   * Present only where a row could identify a person (S1).
   *
   * Absent on four of the five entries, and that is the point: a question, a
   * document and a section are not people, and suppressing "17 questions in
   * RX_NET" protects nobody while making the report useless.
   */
  readonly suppression?: Omit<SuppressionPolicy, 'minimumGroupSize'>;
  /** Whether the entry supports a day window at all. */
  readonly windowed: boolean;
  /** The window when the request names none. Absent means 30. */
  readonly defaultWindowDays?: number;
  /** The row cap when the request names none. Absent means MAX_DATASET_ROWS. */
  readonly defaultPageSize?: number;
  /**
   * True where the entry suppresses person-derived figures ITSELF, because its
   * shape is not a flat list the generic engine can partition: a two-axis grid,
   * a set of headline figures, a feed. The catalogue reports it exactly as it
   * reports `suppression`, so a reader is told before opening it.
   */
  readonly suppressesPeople?: boolean;
  /**
   * False where summing a metric column is meaningless — eight headline
   * figures in different units have no total. The response then carries no
   * totals rather than a sum nobody should read.
   */
  readonly summable?: boolean;
}
