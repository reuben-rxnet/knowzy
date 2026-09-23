// Schedule arithmetic, on a controlled clock.
//
// Every test drives a FIXED `now`. Nothing here waits, sleeps, or reads the
// ambient clock — a scheduler tested against wall-clock time is a test that
// passes on a fast machine and fails on a loaded one, and neither result says
// anything about the code.
//
// The properties under test are the ones an operator depends on: a manual
// source is never pending, a source that has never run is due immediately, an
// overdue run reports how late it is, and two ticks inside one window produce
// one job.

import { describe, expect, it } from 'vitest';
import {
  describeSchedule,
  dueRunKey,
  intervalMsOf,
  isDue,
  nextRunAt,
  requireSchedule,
  scheduleOf,
  ScheduleInvalidError,
} from './schedule.js';

const NOW = new Date('2026-09-23T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe('scheduleOf', () => {
  it('reads a stored schedule', () => {
    expect(scheduleOf({ mode: 'DAILY', timezone: 'UTC' }).mode).toBe('DAILY');
  });

  it('falls back to MANUAL for anything unreadable, rather than throwing', () => {
    // A malformed schedule must not make a source unreadable on the dashboard,
    // and MANUAL is the safe interpretation: it runs nothing.
    for (const stored of [null, undefined, {}, { mode: 'NONSENSE' }, 'daily', 42]) {
      expect(scheduleOf(stored).mode, JSON.stringify(stored)).toBe('MANUAL');
    }
  });

  it('defaults the timezone to UTC, because "02:00" alone means nothing', () => {
    expect(scheduleOf({ mode: 'DAILY' }).timezone).toBe('UTC');
  });
});

describe('requireSchedule', () => {
  it('accepts each mode the platform can execute', () => {
    for (const mode of ['MANUAL', 'HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY'] as const) {
      expect(requireSchedule({ mode }).mode, mode).toBe(mode);
    }
  });

  it('accepts a CRON schedule with a valid five-field expression', () => {
    expect(requireSchedule({ mode: 'CRON', cron: '0 3 * * *' }).cron).toBe('0 3 * * *');
    expect(requireSchedule({ mode: 'CRON', cron: '*/15 * * * 1-5' }).cron).toBe('*/15 * * * 1-5');
  });

  it('REFUSES a cron expression pg-boss would not read', () => {
    // The failure mode is invisible: a bad expression does not error at
    // runtime, it just never fires. So it is refused at the boundary.
    for (const cron of ['every day', '0 3 * *', '0 3 * * * *', 'bad bad bad bad bad']) {
      expect(() => requireSchedule({ mode: 'CRON', cron }), cron).toThrow(ScheduleInvalidError);
    }
  });

  it('refuses CRON with no expression, and an expression with no CRON mode', () => {
    expect(() => requireSchedule({ mode: 'CRON' })).toThrow(/requires a cron expression/);
    expect(() => requireSchedule({ mode: 'DAILY', cron: '0 3 * * *' })).toThrow(
      /only meaningful when the mode is CRON/,
    );
  });

  it('refuses an hour interval on a schedule that is not HOURLY', () => {
    expect(() => requireSchedule({ mode: 'DAILY', intervalHours: 6 })).toThrow(
      /only applies to an HOURLY schedule/,
    );
  });

  it('refuses an interval outside 1–24 hours', () => {
    expect(() => requireSchedule({ mode: 'HOURLY', intervalHours: 0 })).toThrow();
    expect(() => requireSchedule({ mode: 'HOURLY', intervalHours: 25 })).toThrow();
  });
});

describe('intervalMsOf', () => {
  it('maps each mode to its interval', () => {
    expect(intervalMsOf(scheduleOf({ mode: 'HOURLY' }))).toBe(HOUR);
    expect(intervalMsOf(scheduleOf({ mode: 'HOURLY', intervalHours: 6 }))).toBe(6 * HOUR);
    expect(intervalMsOf(scheduleOf({ mode: 'DAILY' }))).toBe(DAY);
    expect(intervalMsOf(scheduleOf({ mode: 'WEEKLY' }))).toBe(7 * DAY);
    expect(intervalMsOf(scheduleOf({ mode: 'MONTHLY' }))).toBe(30 * DAY);
  });

  it('has no interval for MANUAL or CRON', () => {
    expect(intervalMsOf(scheduleOf({ mode: 'MANUAL' }))).toBeNull();
    expect(intervalMsOf(scheduleOf({ mode: 'CRON', cron: '0 3 * * *' }))).toBeNull();
  });
});

describe('nextRunAt', () => {
  it('is null for MANUAL, so a manual source is never pending', () => {
    expect(nextRunAt(scheduleOf({ mode: 'MANUAL' }), NOW, NOW)).toBeNull();
  });

  it('is null for CRON, because pg-boss owns cron evaluation', () => {
    // Re-implementing cron here to draw a label would be a second source of
    // truth, and the second one always drifts.
    expect(nextRunAt(scheduleOf({ mode: 'CRON', cron: '0 3 * * *' }), NOW, NOW)).toBeNull();
  });

  it('is NOW for a source that has never run', () => {
    // The alternative — one full interval after registration — means a daily
    // source configured on Monday does nothing until Tuesday, which reads as
    // broken to the person who just configured it.
    expect(nextRunAt(scheduleOf({ mode: 'DAILY' }), null, NOW)?.toISOString()).toBe(
      NOW.toISOString(),
    );
  });

  it('is lastRun + interval', () => {
    const last = new Date(NOW.getTime() - 2 * HOUR);
    expect(nextRunAt(scheduleOf({ mode: 'DAILY' }), last, NOW)?.getTime()).toBe(
      last.getTime() + DAY,
    );
  });

  it('reports an OVERDUE time rather than now, so lateness is visible', () => {
    const last = new Date(NOW.getTime() - 3 * DAY);
    const next = nextRunAt(scheduleOf({ mode: 'DAILY' }), last, NOW);
    expect(next?.getTime()).toBe(last.getTime() + DAY);
    expect(next!.getTime()).toBeLessThan(NOW.getTime());
  });

  it('accepts an ISO string, because that is what an API payload carries', () => {
    const last = new Date(NOW.getTime() - HOUR).toISOString();
    expect(nextRunAt(scheduleOf({ mode: 'HOURLY' }), last, NOW)?.getTime()).toBe(NOW.getTime());
  });

  it('treats an unparseable last run as "due now" rather than crashing', () => {
    expect(nextRunAt(scheduleOf({ mode: 'DAILY' }), 'not-a-date', NOW)?.getTime()).toBe(
      NOW.getTime(),
    );
  });
});

describe('isDue', () => {
  it('is false for MANUAL whatever the history', () => {
    expect(isDue(scheduleOf({ mode: 'MANUAL' }), null, NOW)).toBe(false);
    expect(isDue(scheduleOf({ mode: 'MANUAL' }), new Date(0), NOW)).toBe(false);
  });

  it('is true at the boundary, not one tick after it', () => {
    // Exactly one interval since the last run IS due. A `<` here would delay
    // every run by one tick, for ever.
    const last = new Date(NOW.getTime() - DAY);
    expect(isDue(scheduleOf({ mode: 'DAILY' }), last, NOW)).toBe(true);
  });

  it('is false one millisecond before the boundary', () => {
    const last = new Date(NOW.getTime() - DAY + 1);
    expect(isDue(scheduleOf({ mode: 'DAILY' }), last, NOW)).toBe(false);
  });

  it('is true for a source that has never run', () => {
    expect(isDue(scheduleOf({ mode: 'WEEKLY' }), null, NOW)).toBe(true);
  });
});

describe('dueRunKey', () => {
  it('is STABLE across every tick inside one due window', () => {
    // This is the whole idempotency guarantee: two ticks five minutes apart,
    // or two application instances ticking at once, produce ONE job.
    const schedule = scheduleOf({ mode: 'DAILY' });
    const first = dueRunKey('src', schedule, NOW);
    const later = dueRunKey('src', schedule, new Date(NOW.getTime() + 5 * 60 * 1000));
    const muchLater = dueRunKey('src', schedule, new Date(NOW.getTime() + 6 * HOUR));
    expect(later).toBe(first);
    expect(muchLater).toBe(first);
  });

  it('CHANGES in the next window, so the next run is a different job', () => {
    const schedule = scheduleOf({ mode: 'HOURLY' });
    const first = dueRunKey('src', schedule, NOW);
    const next = dueRunKey('src', schedule, new Date(NOW.getTime() + HOUR));
    expect(next).not.toBe(first);
  });

  it('differs per source, so two sources never share a singleton', () => {
    const schedule = scheduleOf({ mode: 'DAILY' });
    expect(dueRunKey('a', schedule, NOW)).not.toBe(dueRunKey('b', schedule, NOW));
  });
});

describe('describeSchedule', () => {
  it('says interval, never an invented weekday or hour', () => {
    // WEEKLY is a 7-day gap, not "every Monday". Saying "Mondays at 02:00"
    // would be a claim the implementation cannot keep.
    expect(describeSchedule(scheduleOf({ mode: 'WEEKLY' }))).toBe('Every 7 days');
    expect(describeSchedule(scheduleOf({ mode: 'MONTHLY' }))).toBe('Every 30 days');
    expect(describeSchedule(scheduleOf({ mode: 'DAILY' }))).toBe('Every 24 hours');
    expect(describeSchedule(scheduleOf({ mode: 'HOURLY' }))).toBe('Every hour');
    expect(describeSchedule(scheduleOf({ mode: 'HOURLY', intervalHours: 4 }))).toBe(
      'Every 4 hours',
    );
    expect(describeSchedule(scheduleOf({ mode: 'MANUAL' }))).toBe('Manual only');
    expect(describeSchedule(scheduleOf({ mode: 'CRON', cron: '0 3 * * *' }))).toBe(
      'On cron 0 3 * * *',
    );
  });
});
