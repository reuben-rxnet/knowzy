// Suppression, tested as a table — including the derivation attack S3 exists
// to stop, which is the only test here that a plausible implementation fails.

import { describe, expect, it } from 'vitest';
import {
  applyGridSuppression,
  applySuppression,
  effectiveMinimumGroupSize,
  suppressionReasonOf,
  isSuppressed,
  MINIMUM_GROUP_SIZE_FLOOR,
  SUPPRESSED,
  visibleTotals,
} from './suppression.js';

const policy = {
  groupSizeColumn: 'uniqueLearners',
  dependentColumns: ['attempts', 'passRate'],
  partitionBy: ['assessmentId'],
  minimumGroupSize: 5,
};

const row = (assessmentId: string, team: string, uniqueLearners: number) => ({
  assessmentId,
  team,
  uniqueLearners,
  attempts: uniqueLearners * 2,
  passRate: 50,
});

describe('the threshold', () => {
  it('is 5 by default', () => {
    expect(effectiveMinimumGroupSize(undefined)).toBe(MINIMUM_GROUP_SIZE_FLOOR);
  });

  it('can be raised', () => {
    expect(effectiveMinimumGroupSize(20)).toBe(20);
  });

  it('CANNOT be lowered, whatever configuration says', () => {
    // S1 says "configurable upward only". A configured 1 is how a privacy
    // control gets disabled by a typo in a JSON value.
    expect(effectiveMinimumGroupSize(1)).toBe(5);
    expect(effectiveMinimumGroupSize(0)).toBe(5);
    expect(effectiveMinimumGroupSize(-100)).toBe(5);
  });

  it('ignores a non-finite value rather than trusting it', () => {
    expect(effectiveMinimumGroupSize(Number.NaN)).toBe(5);
  });
});

describe('S1 — a small group is suppressed', () => {
  it('hides a row below the threshold and leaves the rest', () => {
    const result = applySuppression(
      [row('a', 'one', 12), row('a', 'two', 3), row('a', 'three', 9), row('a', 'four', 8)],
      policy,
    );
    expect(result.rows[1]?.uniqueLearners).toBe(SUPPRESSED);
    expect(result.rows[0]?.uniqueLearners).toBe(12);
  });

  it('hides EVERY person-derived measure on that row, not just the head count', () => {
    // A pass rate of 66.7% over a group of three names two of them.
    const result = applySuppression(
      [row('a', 'one', 12), row('a', 'two', 3), row('a', 'x', 9)],
      policy,
    );
    expect(result.rows[1]).toMatchObject({
      uniqueLearners: SUPPRESSED,
      attempts: SUPPRESSED,
      passRate: SUPPRESSED,
    });
    // And leaves the dimensions alone: a suppressed row is still locatable.
    expect(result.rows[1]?.team).toBe('two');
  });

  it('never returns 0 or null in place of a suppressed value', () => {
    const result = applySuppression([row('a', 'one', 2), row('a', 'two', 30)], policy);
    for (const value of [result.rows[0]?.uniqueLearners, result.rows[0]?.attempts]) {
      expect(value).not.toBe(0);
      expect(value).not.toBeNull();
      expect(isSuppressed(value as never)).toBe(true);
    }
  });

  it('leaves a row at exactly the threshold visible', () => {
    const result = applySuppression([row('a', 'one', 5), row('a', 'two', 50)], policy);
    expect(result.rows[0]?.uniqueLearners).toBe(5);
  });

  it('does not suppress a row whose group size was never computed', () => {
    // Null means "not measured", which is a different fact from "too few".
    // Suppressing it would report a privacy action that did not happen.
    const result = applySuppression(
      [{ assessmentId: 'a', team: 'one', uniqueLearners: null, attempts: 4, passRate: 10 }],
      policy,
    );
    expect(result.rows[0]?.uniqueLearners).toBeNull();
    expect(result.suppressedCellCount).toBe(0);
  });
});

describe('S3 — complementary suppression', () => {
  it('suppresses a second cell so the first cannot be derived from the total', () => {
    // 12 + 9 + 3 + 8 = 32. Hide only the 3 and the reader computes it.
    const result = applySuppression(
      [row('a', 'one', 12), row('a', 'two', 3), row('a', 'three', 9), row('a', 'four', 8)],
      policy,
    );
    const hidden = result.rows.filter((r) => isSuppressed(r.uniqueLearners as never));
    expect(hidden).toHaveLength(2);
    expect(result.primarySuppressedRowCount).toBe(1);
    expect(result.complementarySuppressedRowCount).toBe(1);
  });

  it('suppresses the SMALLEST survivor, as the least informative row to lose', () => {
    const result = applySuppression(
      [row('a', 'big', 40), row('a', 'tiny', 2), row('a', 'small', 6)],
      policy,
    );
    // `small` (6) goes, not `big` (40).
    expect(result.rows.find((r) => r.team === 'small')?.uniqueLearners).toBe(SUPPRESSED);
    expect(result.rows.find((r) => r.team === 'big')?.uniqueLearners).toBe(40);
  });

  it('adds nothing when two rows are already hidden', () => {
    // The SUM of the hidden pair is derivable; neither member is. That is what
    // S3 asks for, and suppressing a third row would cost data for nothing.
    const result = applySuppression(
      [row('a', 'one', 2), row('a', 'two', 3), row('a', 'three', 40), row('a', 'four', 50)],
      policy,
    );
    expect(result.rows.filter((r) => isSuppressed(r.uniqueLearners as never))).toHaveLength(2);
    expect(result.complementarySuppressedRowCount).toBe(0);
  });

  it('does not reach across partitions', () => {
    // Assessment `b`'s rows share no total with assessment `a`'s, so hiding
    // one of a's cannot be repaired by hiding one of b's -- and doing so would
    // destroy unrelated data.
    const result = applySuppression(
      [row('a', 'one', 2), row('a', 'two', 30), row('b', 'three', 40), row('b', 'four', 50)],
      policy,
    );
    expect(result.rows.find((r) => r.team === 'three')?.uniqueLearners).toBe(40);
    expect(result.rows.find((r) => r.team === 'four')?.uniqueLearners).toBe(50);
  });

  it('leaves a lone row suppressed without a partner, because none exists', () => {
    // One row in its partition: there is no total beside it that is not the
    // cell itself, so there is nothing to derive it from.
    const result = applySuppression([row('a', 'only', 1)], policy);
    expect(result.rows[0]?.uniqueLearners).toBe(SUPPRESSED);
    expect(result.complementarySuppressedRowCount).toBe(0);
  });

  it('terminates when suppressing the partner re-opens the condition', () => {
    // Three rows, two tiny. Hiding one tiny leaves one hidden and two visible,
    // so a partner goes; that partner is the other tiny, which leaves two
    // hidden and the loop ends. A naive implementation loops forever here.
    const result = applySuppression(
      [row('a', 'one', 1), row('a', 'two', 2), row('a', 'three', 100)],
      policy,
    );
    expect(result.rows.filter((r) => isSuppressed(r.uniqueLearners as never))).toHaveLength(2);
    expect(result.rows.find((r) => r.team === 'three')?.uniqueLearners).toBe(100);
  });
});

describe('S4 — totals are of visible rows', () => {
  it('excludes a suppressed row from a published total', () => {
    const result = applySuppression(
      [row('a', 'one', 12), row('a', 'two', 3), row('a', 'three', 9), row('a', 'four', 8)],
      policy,
    );
    const totals = visibleTotals(result.rows, ['uniqueLearners']);
    // 12 + 9 = 21, not 32. An understated total that is labelled beats an
    // exact one that leaks: publishing 32 here would hand back both hidden
    // cells' sum.
    expect(totals['uniqueLearners']).toBe(21);
  });
});

describe('the input', () => {
  it('is never mutated', () => {
    const rows = [row('a', 'one', 2), row('a', 'two', 30)];
    applySuppression(rows, policy);
    expect(rows[0]?.uniqueLearners).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Two-way suppression — the learner heatmap
// ---------------------------------------------------------------------------

describe('grid suppression (S1 + S3 on both axes)', () => {
  const cell = (department: string, topic: string, learners: number) => ({
    department,
    topic,
    learners,
    averageScore: 80,
  });
  const grid = {
    groupSizeColumn: 'learners',
    dependentColumns: ['averageScore'],
    rowBy: ['department'],
    columnBy: ['topic'],
    minimumGroupSize: 5,
  };
  const hidden = (rows: readonly Record<string, unknown>[]) =>
    rows.filter((r) => r['learners'] === SUPPRESSED).map((r) => `${r['department']}/${r['topic']}`);

  it('protects a small cell against its COLUMN total as well as its row total', () => {
    //            T1   T2
    //   Ops       3   20      <- Ops/T1 is small (S1)
    //   Dev      30   40
    //
    // Row-only S3 hides Ops/T2 too (Ops row now has two hidden). But the T1
    // COLUMN still has one hidden cell beside Dev/T1 = 30, so a reader with the
    // T1 total recovers 3. Column S3 must hide Dev/T1 as well — and that in
    // turn leaves the Dev row with one hidden cell, so Dev/T2 goes too.
    const result = applyGridSuppression(
      [cell('Ops', 'T1', 3), cell('Ops', 'T2', 20), cell('Dev', 'T1', 30), cell('Dev', 'T2', 40)],
      grid,
    );
    expect(hidden(result.rows).sort()).toEqual(['Dev/T1', 'Dev/T2', 'Ops/T1', 'Ops/T2']);
    expect(result.primarySuppressedRowCount).toBe(1);
    expect(result.complementarySuppressedRowCount).toBe(3);
  });

  it('leaves no row or column with exactly one hidden cell beside a visible one', () => {
    const rows = [
      cell('A', 'x', 2),
      cell('A', 'y', 50),
      cell('A', 'z', 60),
      cell('B', 'x', 40),
      cell('B', 'y', 45),
      cell('B', 'z', 3),
      cell('C', 'x', 70),
      cell('C', 'y', 80),
      cell('C', 'z', 90),
    ];
    const result = applyGridSuppression(rows, grid);
    const isHidden = (r: Record<string, unknown>) => r['learners'] === SUPPRESSED;
    for (const axis of ['department', 'topic'] as const) {
      const lines = new Map<string, Record<string, unknown>[]>();
      for (const r of result.rows) {
        const key = String(r[axis]);
        lines.set(key, [...(lines.get(key) ?? []), r]);
      }
      for (const line of lines.values()) {
        const h = line.filter(isHidden).length;
        const v = line.length - h;
        expect(h === 1 && v > 0, `${axis} line leaks a single hidden cell`).toBe(false);
      }
    }
  });

  it('hides nothing, and gives no reason, when every cell is large enough', () => {
    const result = applyGridSuppression([cell('A', 'x', 10), cell('B', 'x', 12)], grid);
    expect(result.suppressedCellCount).toBe(0);
    expect(suppressionReasonOf(result)).toBeNull();
  });

  it('states the reason, naming both rules when both fired', () => {
    const result = applyGridSuppression(
      [cell('Ops', 'T1', 3), cell('Ops', 'T2', 20), cell('Dev', 'T1', 30), cell('Dev', 'T2', 40)],
      grid,
    );
    expect(suppressionReasonOf(result)).toMatch(/fewer than 5 distinct learners \(S1\)/);
    expect(suppressionReasonOf(result)).toMatch(/\(S3\)/);
  });

  it('clamps a configured threshold below the floor, exactly as the flat engine does', () => {
    const result = applyGridSuppression([cell('A', 'x', 4)], { ...grid, minimumGroupSize: 2 });
    expect(result.minimumGroupSize).toBe(MINIMUM_GROUP_SIZE_FLOOR);
    expect(result.rows[0]?.learners).toBe(SUPPRESSED);
  });
});
