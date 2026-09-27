// Previous-period comparison, as a table.
//
// Each case is a rule from comparison.ts that a KPI card would otherwise
// quietly break: a percentage of a zero base, a percentage of a percentage, a
// direction read from a rounded figure, and a comparison made against nothing.

import { describe, expect, it } from 'vitest';
import { addDays, compareValues, noComparison, previousWindow, utcDate } from './comparison.js';
import { trendBuckets, trendLabel } from './dashboard.js';

const base = { basis: 'DATED_ROWS' as const, baseFrom: '2026-08-28', baseTo: null, note: 'n' };

describe('compareValues', () => {
  it('reports the absolute change, the percentage change and the direction', () => {
    const c = compareValues({ ...base, current: 120, previous: 100, unit: 'count' });
    expect(c.status).toBe('AVAILABLE');
    expect(c.change).toBe(20);
    expect(c.changePercent).toBe(20);
    expect(c.direction).toBe('UP');
    expect(c.previous).toBe(100);
  });

  it('never computes a percentage from a zero base, and still reports the change', () => {
    const c = compareValues({ ...base, current: 7, previous: 0, unit: 'count' });
    expect(c.changePercent).toBeNull();
    expect(c.change).toBe(7);
    expect(c.direction).toBe('UP');
  });

  it('reports a ratio in POINTS only — never a percentage of a percentage', () => {
    const c = compareValues({ ...base, current: 84, previous: 80, unit: 'points' });
    expect(c.change).toBe(4);
    expect(c.changePercent).toBeNull();
  });

  it('calls equal values FLAT, and a tiny real difference not flat', () => {
    expect(compareValues({ ...base, current: 5, previous: 5, unit: 'count' }).direction).toBe(
      'FLAT',
    );
    // 0.000001 of cost is a real difference. Direction comes from the values,
    // not from a display that rounds both to $0.00.
    expect(
      compareValues({ ...base, current: 0.000002, previous: 0.000001, unit: 'currency' }).direction,
    ).toBe('UP');
  });

  it('reports a fall as DOWN with a negative change', () => {
    const c = compareValues({ ...base, current: 40, previous: 50, unit: 'count' });
    expect(c.direction).toBe('DOWN');
    expect(c.change).toBe(-10);
    expect(c.changePercent).toBe(-20);
  });
});

describe('noComparison', () => {
  it('carries no number at all, only the reason', () => {
    const c = noComparison({
      status: 'NOT_YET_AVAILABLE',
      unit: 'count',
      basis: 'SNAPSHOT',
      note: 'No coverage snapshot has been recorded yet.',
    });
    expect(c.previous).toBeNull();
    expect(c.change).toBeNull();
    expect(c.changePercent).toBeNull();
    expect(c.direction).toBeNull();
    expect(c.note).toMatch(/no coverage snapshot/i);
  });
});

describe('windows and dates', () => {
  it('the previous window is the same length, immediately before, half-open', () => {
    const from = new Date('2026-09-01T00:00:00Z');
    const prev = previousWindow(from, 30);
    expect(prev.to.toISOString()).toBe(from.toISOString());
    expect(prev.from.toISOString()).toBe('2026-08-02T00:00:00.000Z');
  });

  it('dates are UTC calendar days', () => {
    expect(utcDate(new Date('2026-09-27T23:59:59Z'))).toBe('2026-09-27');
    expect(addDays('2026-09-27', 30)).toBe('2026-10-27');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('trendBuckets', () => {
  const to = new Date('2026-09-27T10:00:00Z'); // a Sunday

  it('is daily to 31 days, ending today', () => {
    const { unit, starts } = trendBuckets(to, 30);
    expect(unit).toBe('day');
    expect(starts).toHaveLength(30);
    expect(starts.at(-1)).toBe('2026-09-27');
    expect(starts[0]).toBe('2026-08-29');
  });

  it('is weekly to 120 days, Monday-start like PostgreSQL date_trunc', () => {
    const { unit, starts } = trendBuckets(to, 90);
    expect(unit).toBe('week');
    expect(starts).toHaveLength(13);
    // 2026-09-27 is a Sunday; its ISO week began on Monday the 21st.
    expect(starts.at(-1)).toBe('2026-09-21');
    for (const start of starts) expect(new Date(`${start}T00:00:00Z`).getUTCDay()).toBe(1);
  });

  it('is twelve calendar months for a year, ending in the current partial month', () => {
    const { unit, starts } = trendBuckets(to, 365);
    expect(unit).toBe('month');
    expect(starts).toHaveLength(12);
    expect(starts[0]).toBe('2025-10-01');
    expect(starts.at(-1)).toBe('2026-09-01');
  });

  it('labels each period as a reader would write it', () => {
    expect(trendLabel('month', '2026-09-01')).toBe('Sep 2026');
    expect(trendLabel('week', '2026-09-21')).toBe('w/c 21 Sep');
    expect(trendLabel('day', '2026-09-27')).toBe('27 Sep');
  });
});
