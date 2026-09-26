// CSV export and snapshots — reporting.md §8.1.
//
// TWO CONTROLS, AND THEY ARE NOT THE SAME KIND OF THING.
//
// The header block is an HONESTY control. A CSV that leaves the platform is a
// file somebody will open in six months with no idea what it covers, whose
// scope it was rendered under, or how much of it was withheld. So every export
// carries, above the data: the report, its resolved interval, the effective
// scope, `asOf`, the minimum group size, the suppressed-cell count, who
// exported it and when. S8 requires it; the reason it is worth the lines is
// that a suppressed dataset with no note reads as a complete one.
//
// The formula guard is a SECURITY control. A cell beginning `=`, `+`, `-`, `@`,
// tab or CR is a formula in Excel and LibreOffice, so `=HYPERLINK(...)` in a
// document name becomes a live link in the reader's spreadsheet. Prefixing a
// single quote defuses it. This is the same guard the Audit Explorer already
// uses and it is deliberately shared: two implementations of one escaping rule
// is one implementation and one bug waiting.
//
// A SNAPSHOT IS NOT A PUBLICATION. §8.2 U1 is explicit that a published report
// is a definition plus an audience, re-rendered per viewer, precisely so
// publishing cannot leak past an entitlement. A snapshot is the opposite by
// design: an explicit, audited capture of what a report said at a moment, taken
// by a named person, readable afterwards only by somebody who could have run it
// themselves. Conflating the two would turn "save this for the board pack" into
// a way to hand one team another team's rows.

import type { ReadOnlyDb } from './audit-explorer.js';
import type { RefreshDb } from './refresh.js';
import type { DatasetName, DatasetResult } from './datasets.js';
import { DATASET_DEFINITIONS } from './datasets.js';
import { SUPPRESSED } from './suppression.js';

/** Shared with the Audit Explorer's export. One rule, one implementation. */
const FORMULA_START = /^[=+\-@\t\r]/;

export const csvCell = (value: unknown): string => {
  const text = value === null || value === undefined ? '' : String(value);
  const guarded = FORMULA_START.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
};

export interface ExportContext {
  readonly exporterDisplayName: string;
  readonly exportedAt: Date;
  /** The scope in words, for the header block. Never a list of internal ids. */
  readonly effectiveScope: string;
}

/**
 * The header block, as CSV comment rows above the data.
 *
 * Written as data rows rather than `#` comments: a spreadsheet shows them, and
 * a `#` line is invisible in Excel's default import. The point is that the
 * reader SEES the caveats, not that a parser can skip them.
 */
export const csvHeaderBlock = (
  result: DatasetResult,
  context: ExportContext,
): readonly string[] => {
  const definition = DATASET_DEFINITIONS[result.name as DatasetName];
  const lines: string[][] = [
    ['Knowzy report', result.title],
    ['Grain', result.grain],
    ['Exported by', context.exporterDisplayName],
    ['Exported at', context.exportedAt.toISOString()],
    ['Effective scope', context.effectiveScope],
    [
      'Data as of',
      // An unrefreshed model says so. "Not yet refreshed" in a file beats an
      // export timestamp masquerading as a data timestamp.
      result.asOf ?? 'Not yet refreshed — this export contains no model data',
    ],
    [
      'Window',
      result.windowFrom === null
        ? 'Not windowed — current state'
        : `${result.windowFrom} to ${result.windowTo} (half-open, UTC)`,
    ],
    ['Rows', String(result.rowCount)],
    ['Minimum group size', String(result.minimumGroupSize)],
    [
      'Suppressed cells',
      result.suppressedCellCount === 0
        ? '0 — nothing was withheld'
        : `${result.suppressedCellCount} — cells below the minimum group size are shown as ${SUPPRESSED}`,
    ],
    ['Totals cover', 'visible rows only; a suppressed row contributes to no total'],
  ];

  // B3: every metric's formula travels with the file. A number in a
  // spreadsheet with no definition is a number somebody will redefine.
  for (const metric of definition.metrics) {
    lines.push([`Formula — ${metric.label}`, metric.formula]);
  }

  return [...lines.map((cells) => cells.map(csvCell).join(',')), ''];
};

export const toDatasetCsv = (result: DatasetResult, context: ExportContext): string => {
  const definition = DATASET_DEFINITIONS[result.name as DatasetName];
  const columns = [
    ...definition.dimensions.map((dimension) => dimension.column),
    ...definition.metrics.map((metric) => metric.column),
  ];
  const labels = [
    ...definition.dimensions.map((dimension) => dimension.label),
    ...definition.metrics.map((metric) => metric.label),
  ];

  const rows = result.rows.map((row) =>
    columns
      .map((column) => {
        const value = row[column];
        // A suppressed cell exports as the WORD. A blank would be
        // indistinguishable from missing data once the file is out of the
        // platform, and a zero would be a lie about a measurement.
        return value === undefined ? '' : value;
      })
      .map(csvCell)
      .join(','),
  );

  return [...csvHeaderBlock(result, context), labels.map(csvCell).join(','), ...rows, ''].join(
    '\n',
  );
};

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

export interface CaptureSnapshotArgs {
  readonly report: DatasetName;
  readonly label: string;
  readonly reason?: string | null;
  readonly result: DatasetResult;
  readonly scope: Readonly<Record<string, unknown>>;
  readonly capturedByUserId: string | null;
  readonly correlationId: string;
}

export interface SnapshotRow {
  readonly id: string;
  readonly report: string;
  readonly label: string;
  readonly reason: string | null;
  readonly asOf: string;
  readonly rowCount: number;
  readonly suppressedCellCount: number;
  readonly minimumGroupSize: number;
  readonly capturedAt: string;
  readonly capturedByUserId: string | null;
}

/**
 * Captures one dataset.
 *
 * The suppressed rows are stored AS SUPPRESSED, because the snapshot is the
 * result — not the inputs to it. Storing the pre-suppression rows "in case
 * somebody with more access wants them later" would make this table a way to
 * read around S1, which has no override (S9).
 */
export const captureSnapshot = async (
  db: RefreshDb,
  args: CaptureSnapshotArgs,
): Promise<string> => {
  const rows = await db.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO reporting.report_snapshot
       (report, label, reason, as_of, params, scope, minimum_group_size,
        suppressed_cell_count, row_count, payload, captured_by_user_id, correlation_id)
     VALUES ($1, $2, $3, $4::timestamptz, $5::jsonb, $6::jsonb, $7, $8, $9, $10::jsonb, $11::uuid, $12)
     RETURNING id::text AS id`,
    args.report,
    args.label.slice(0, 200),
    args.reason === undefined || args.reason === null ? null : args.reason.slice(0, 500),
    // A snapshot of an unrefreshed model is refused by the route rather than
    // stored with a fabricated timestamp.
    args.result.asOf,
    JSON.stringify({
      windowDays: args.result.windowDays,
      windowFrom: args.result.windowFrom,
      windowTo: args.result.windowTo,
    }),
    JSON.stringify(args.scope),
    args.result.minimumGroupSize,
    args.result.suppressedCellCount,
    args.result.rowCount,
    JSON.stringify(args.result),
    args.capturedByUserId,
    args.correlationId,
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('The snapshot was not recorded.');
  return id;
};

export const listSnapshots = async (
  db: ReadOnlyDb,
  report: DatasetName | null,
  limit = 25,
): Promise<readonly SnapshotRow[]> => {
  const rows = await db.$queryRawUnsafe<
    {
      id: string;
      report: string;
      label: string;
      reason: string | null;
      as_of: Date;
      row_count: number;
      suppressed_cell_count: number;
      minimum_group_size: number;
      captured_at: Date;
      captured_by_user_id: string | null;
    }[]
  >(
    `SELECT id::text AS id, report, label, reason, as_of, row_count,
            suppressed_cell_count, minimum_group_size, captured_at,
            captured_by_user_id::text AS captured_by_user_id
       FROM reporting.report_snapshot
      WHERE ($1::text IS NULL OR report = $1::text)
      ORDER BY captured_at DESC
      LIMIT $2`,
    report,
    Math.min(limit, 100),
  );

  return rows.map((row) => ({
    id: row.id,
    report: row.report,
    label: row.label,
    reason: row.reason,
    asOf: row.as_of.toISOString(),
    rowCount: row.row_count,
    suppressedCellCount: row.suppressed_cell_count,
    minimumGroupSize: row.minimum_group_size,
    capturedAt: row.captured_at.toISOString(),
    capturedByUserId: row.captured_by_user_id,
  }));
};

export const readSnapshot = async (
  db: ReadOnlyDb,
  id: string,
): Promise<(SnapshotRow & { payload: DatasetResult }) | null> => {
  const rows = await db.$queryRawUnsafe<
    {
      id: string;
      report: string;
      label: string;
      reason: string | null;
      as_of: Date;
      row_count: number;
      suppressed_cell_count: number;
      minimum_group_size: number;
      captured_at: Date;
      captured_by_user_id: string | null;
      payload: unknown;
    }[]
  >(
    `SELECT id::text AS id, report, label, reason, as_of, row_count,
            suppressed_cell_count, minimum_group_size, captured_at,
            captured_by_user_id::text AS captured_by_user_id, payload
       FROM reporting.report_snapshot
      WHERE id = $1::uuid`,
    id,
  );
  const row = rows[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    report: row.report,
    label: row.label,
    reason: row.reason,
    asOf: row.as_of.toISOString(),
    rowCount: row.row_count,
    suppressedCellCount: row.suppressed_cell_count,
    minimumGroupSize: row.minimum_group_size,
    capturedAt: row.captured_at.toISOString(),
    capturedByUserId: row.captured_by_user_id,
    payload: row.payload as DatasetResult,
  };
};
