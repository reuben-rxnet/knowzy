// Privacy suppression — reporting.md §7.
//
// The rule everyone implements is S1: a cell counting fewer than
// `minimumGroupSize` people is not shown. The rule almost nobody implements is
// S3, and it is the one that makes the first rule mean anything:
//
//   > **Complementary suppression** applies: when suppressing one cell would
//   > let it be derived from a visible total and its siblings, the smallest
//   > additional cell is suppressed too, iteratively. Suppressing a cell while
//   > publishing the total that reveals it is not suppression.
//
// Concretely. Four teams took an assessment: 12, 9, 3 and 8 learners, total 32.
// Suppress the 3 and publish the rest and the reader computes 32 − 12 − 9 − 8 =
// 3. The cell is not hidden; it is merely not printed. So a second cell — the
// smallest survivor — goes too, and the reader is left with an underdetermined
// pair. That is suppression. The first version is a compliance gesture.
//
// FIVE THINGS THIS MODULE REFUSES TO DO
//
//   * It never returns 0 or null for a suppressed cell (S2). A zero is a
//     measurement and a blank is a bug; `SUPPRESSED` is a third thing and it
//     has to travel as one.
//   * It never suppresses a count of THINGS. A question, a document or a
//     section is not a person, and suppressing "17 questions in RX_NET"
//     protects nobody while making the report useless. The caller declares
//     which measures are person-bearing; this module has no opinion it can get
//     wrong on its own.
//   * It has no override (S9). There is no argument, no flag and no permission
//     that disables it, so there is nothing for a future caller to find.
//   * It does not lower the threshold. `minimumGroupSize` is configurable
//     upward only (S1), enforced here as well as at the configuration layer,
//     because two enforcement points is how a control survives one of them
//     being refactored.
//   * It does not decide who may see person-level rows. That is S5, a policy
//     question, and it belongs to the route.
//
// Pure: no database, no clock, no configuration lookup. Given rows and a
// threshold it returns rows plus a count, and every test of it is a table.

/** The floor. `minimumGroupSize` may be raised above this, never below (S1). */
export const MINIMUM_GROUP_SIZE_FLOOR = 5;

/**
 * What a suppressed measure becomes.
 *
 * A string, not null and not zero, so that a surface which forgets to handle it
 * renders the word `SUPPRESSED` — visibly wrong and instantly diagnosable —
 * rather than a plausible number.
 */
export const SUPPRESSED = 'SUPPRESSED' as const;
export type Suppressed = typeof SUPPRESSED;

export type Measure = number | null | Suppressed;

export const isSuppressed = (value: Measure): value is Suppressed => value === SUPPRESSED;

/** One row of a dataset: string dimensions, numeric measures. */
export interface DatasetRow {
  readonly [column: string]: string | number | null | Suppressed | undefined;
}

export interface SuppressionPolicy {
  /**
   * The measure whose size decides whether a row is identifying — almost
   * always a count of distinct people.
   */
  readonly groupSizeColumn: string;
  /**
   * Every measure that must be hidden along with it.
   *
   * Hiding the head count and publishing the pass rate beside it is not
   * suppression either: with a group of three, a pass rate of 66.7% names two
   * of them. So the whole row's person-derived measures go together.
   */
  readonly dependentColumns: readonly string[];
  /**
   * The dimensions within which siblings are compared for S3.
   *
   * Complementary suppression only makes sense inside a group that shares a
   * visible total. Rows are partitioned by these columns; a row with no
   * declared partition is compared against the whole dataset.
   */
  readonly partitionBy?: readonly string[];
  readonly minimumGroupSize: number;
}

export interface SuppressionResult<T extends DatasetRow> {
  readonly rows: readonly T[];
  readonly suppressedCellCount: number;
  /** Rows suppressed by S1, before S3 added any. Reported so the two are distinguishable. */
  readonly primarySuppressedRowCount: number;
  readonly complementarySuppressedRowCount: number;
  readonly minimumGroupSize: number;
}

/**
 * The threshold in force, clamped upward only.
 *
 * A configured 3 is treated as 5 and the caller is not consulted. S1 says
 * "configurable upward only"; silently accepting a lower number because a
 * configuration row said so is how a privacy control is disabled by a typo.
 */
export const effectiveMinimumGroupSize = (configured: number | undefined): number =>
  configured === undefined || !Number.isFinite(configured)
    ? MINIMUM_GROUP_SIZE_FLOOR
    : Math.max(MINIMUM_GROUP_SIZE_FLOOR, Math.floor(configured));

const partitionKey = (row: DatasetRow, columns: readonly string[]): string =>
  columns.map((column) => String(row[column] ?? '')).join('\u0000');

const groupSizeOf = (row: DatasetRow, column: string): number | null => {
  const value = row[column];
  return typeof value === 'number' ? value : null;
};

/**
 * Applies S1 and S3.
 *
 * Returns new row objects; the input is never mutated, because a caller that
 * cached the pre-suppression rows would otherwise find them altered under it.
 */
export const applySuppression = <T extends DatasetRow>(
  rows: readonly T[],
  policy: SuppressionPolicy,
): SuppressionResult<T> => {
  const threshold = effectiveMinimumGroupSize(policy.minimumGroupSize);
  const columns = [policy.groupSizeColumn, ...policy.dependentColumns];
  const suppressedIndexes = new Set<number>();

  // ---------------------------------------------------------------- S1
  rows.forEach((row, index) => {
    const size = groupSizeOf(row, policy.groupSizeColumn);
    // A null group size is NOT suppressed: it means the measure was not
    // computed for this row, which is a different fact and one the read model
    // is responsible for. Suppressing it would report a privacy action that
    // did not happen.
    if (size !== null && size > 0 && size < threshold) suppressedIndexes.add(index);
  });
  const primary = suppressedIndexes.size;

  // ---------------------------------------------------------------- S3
  //
  // Within each partition: while exactly one row is suppressed and two or more
  // rows are visible, the suppressed value is recoverable from the partition
  // total. Suppress the SMALLEST visible row as well -- smallest because it is
  // the least informative row to lose -- and repeat, because suppressing it
  // can leave the same condition true again.
  const partitions = new Map<string, number[]>();
  rows.forEach((row, index) => {
    const key = partitionKey(row, policy.partitionBy ?? []);
    const bucket = partitions.get(key);
    if (bucket === undefined) partitions.set(key, [index]);
    else bucket.push(index);
  });

  for (const indexes of partitions.values()) {
    // A partition of one cannot leak by subtraction: there is no total beside
    // it that is not the cell itself.
    if (indexes.length < 2) continue;

    for (;;) {
      const hidden = indexes.filter((index) => suppressedIndexes.has(index));
      const visible = indexes.filter((index) => !suppressedIndexes.has(index));
      // Nothing hidden: nothing to protect. More than one hidden: the sum of
      // the hidden group is known but no individual member is, which is what
      // S3 asks for.
      if (hidden.length !== 1 || visible.length === 0) break;

      const smallest = visible.reduce((best, index) => {
        const a = groupSizeOf(rows[index] as DatasetRow, policy.groupSizeColumn) ?? Infinity;
        const b = groupSizeOf(rows[best] as DatasetRow, policy.groupSizeColumn) ?? Infinity;
        return a < b ? index : best;
      }, visible[0] as number);
      suppressedIndexes.add(smallest);
    }
  }

  const suppressed = rows.map((row, index) => {
    if (!suppressedIndexes.has(index)) return row;
    const copy: Record<string, unknown> = { ...row };
    for (const column of columns) {
      // Only columns the row actually has. Writing SUPPRESSED into a column
      // that does not exist would invent a field in the response.
      if (column in copy) copy[column] = SUPPRESSED;
    }
    return copy as T;
  });

  return {
    rows: suppressed,
    // S2: the count is on the response, so a reader can tell "no data" from
    // "data I may not see".
    suppressedCellCount: suppressedIndexes.size * columns.length,
    primarySuppressedRowCount: primary,
    complementarySuppressedRowCount: suppressedIndexes.size - primary,
    minimumGroupSize: threshold,
  };
};

/**
 * Totals computed over the rows AS PUBLISHED (S4).
 *
 * A suppressed row must not contribute to a visible total, or the total is the
 * subtraction attack S3 exists to prevent. So this sums only what survived, and
 * the response says the total is of visible rows -- an understated total that
 * is labelled beats an exact one that leaks.
 */
export const visibleTotals = <T extends DatasetRow>(
  rows: readonly T[],
  columns: readonly string[],
): Readonly<Record<string, number>> => {
  const totals: Record<string, number> = {};
  for (const column of columns) {
    totals[column] = rows.reduce((sum, row) => {
      const value = row[column];
      return typeof value === 'number' ? sum + value : sum;
    }, 0);
  }
  return totals;
};

// ---------------------------------------------------------------------------
// Two-way suppression — for a grid whose rows AND columns both have totals
// ---------------------------------------------------------------------------

export interface GridSuppressionPolicy {
  readonly groupSizeColumn: string;
  readonly dependentColumns: readonly string[];
  /** The dimension(s) that identify a grid ROW, e.g. department. */
  readonly rowBy: readonly string[];
  /** The dimension(s) that identify a grid COLUMN, e.g. topic. */
  readonly columnBy: readonly string[];
  readonly minimumGroupSize: number;
}

/**
 * S1 and S3 over a two-dimensional grid.
 *
 * `applySuppression` protects a cell against subtraction from ONE total. A
 * heatmap has two: every row has a total and every column has a total, and a
 * reader who knows a column's total can recover the single hidden cell in it
 * even when its row hides two. So S3 is applied along BOTH axes, repeatedly,
 * until neither axis has a line with exactly one hidden cell beside a visible
 * one — each added suppression can create that condition on the other axis,
 * which is why it iterates rather than running each axis once.
 *
 * It terminates: every pass either adds a cell to the hidden set or stops, and
 * the set is bounded by the number of cells.
 */
export const applyGridSuppression = <T extends DatasetRow>(
  rows: readonly T[],
  policy: GridSuppressionPolicy,
): SuppressionResult<T> => {
  const threshold = effectiveMinimumGroupSize(policy.minimumGroupSize);
  const columns = [policy.groupSizeColumn, ...policy.dependentColumns];
  const hidden = new Set<number>();

  rows.forEach((row, index) => {
    const size = groupSizeOf(row, policy.groupSizeColumn);
    if (size !== null && size > 0 && size < threshold) hidden.add(index);
  });
  const primary = hidden.size;

  const linesOf = (by: readonly string[]): number[][] => {
    const lines = new Map<string, number[]>();
    rows.forEach((row, index) => {
      const key = partitionKey(row, by);
      const line = lines.get(key);
      if (line === undefined) lines.set(key, [index]);
      else line.push(index);
    });
    return [...lines.values()];
  };
  const axes = [linesOf(policy.rowBy), linesOf(policy.columnBy)];

  for (let changed = true; changed;) {
    changed = false;
    for (const lines of axes) {
      for (const line of lines) {
        if (line.length < 2) continue;
        const hiddenHere = line.filter((index) => hidden.has(index));
        const visible = line.filter((index) => !hidden.has(index));
        if (hiddenHere.length !== 1 || visible.length === 0) continue;
        const smallest = visible.reduce((best, index) => {
          const a = groupSizeOf(rows[index] as DatasetRow, policy.groupSizeColumn) ?? Infinity;
          const b = groupSizeOf(rows[best] as DatasetRow, policy.groupSizeColumn) ?? Infinity;
          return a < b ? index : best;
        }, visible[0] as number);
        hidden.add(smallest);
        changed = true;
      }
    }
  }

  const suppressed = rows.map((row, index) => {
    if (!hidden.has(index)) return row;
    const copy: Record<string, unknown> = { ...row };
    for (const column of columns) if (column in copy) copy[column] = SUPPRESSED;
    return copy as T;
  });

  return {
    rows: suppressed,
    suppressedCellCount: hidden.size * columns.length,
    primarySuppressedRowCount: primary,
    complementarySuppressedRowCount: hidden.size - primary,
    minimumGroupSize: threshold,
  };
};

/**
 * The sentence a screen prints beside a withheld cell.
 *
 * One wording, produced here, so the dashboard, the CSV header and a snapshot
 * give the same reason. Null when nothing was withheld: a reason for a
 * suppression that did not happen is its own small fabrication.
 */
export const suppressionReasonOf = (
  result: Pick<
    SuppressionResult<DatasetRow>,
    'primarySuppressedRowCount' | 'complementarySuppressedRowCount' | 'minimumGroupSize'
  >,
): string | null => {
  if (result.primarySuppressedRowCount === 0 && result.complementarySuppressedRowCount === 0) {
    return null;
  }
  const primary = `${result.primarySuppressedRowCount} group(s) had fewer than ${result.minimumGroupSize} distinct learners (S1)`;
  return result.complementarySuppressedRowCount === 0
    ? `${primary}.`
    : `${primary}; ${result.complementarySuppressedRowCount} more withheld so the first could not be derived from a total (S3).`;
};
