// Synchronization schedules — parsing, validating, and computing the next run.
//
// `KnowledgeSource.syncSchedule` has held `{ mode, intervalHours?, cron? }`
// since migration 0001 and has NEVER BEEN EXECUTED. It is the same shape of
// defect as the generation profile's model knobs: a column that looks like
// configuration, is editable, and controls nothing. A screen that displayed
// "Daily" from it would have been reporting an intention as a fact.
//
// Everything here is PURE. Time arrives as an argument, never from the ambient
// clock, so the scheduler's arithmetic is testable without waiting: the tests
// drive a fixed `now` through every mode and every boundary.
//
// One deliberate limitation, stated rather than hidden: WEEKLY and MONTHLY are
// computed as fixed intervals from the last run (7 days, 30 days) rather than
// as calendar anchors ("every Monday 02:00"). Calendar anchoring needs a
// timezone-aware library and a stored anchor, and inventing "the 31st of
// February" behaviour is worse than an honest interval. The UI says interval,
// not weekday, for exactly this reason.

import {
  MANUAL_SCHEDULE,
  SyncScheduleSchema,
  SYNC_SCHEDULE_MODES,
  type SyncSchedule,
  type SyncScheduleMode,
} from '@knowzy/shared-types';

export { MANUAL_SCHEDULE, SyncScheduleSchema, SYNC_SCHEDULE_MODES };
export type { SyncSchedule, SyncScheduleMode };

/**
 * Reads a stored schedule, falling back to MANUAL.
 *
 * MANUAL rather than throwing: a malformed schedule must not make a source
 * unreadable on the dashboard, and MANUAL is the safe interpretation — it
 * runs nothing until a person asks.
 */
export const scheduleOf = (stored: unknown): SyncSchedule => {
  const parsed = SyncScheduleSchema.safeParse(stored ?? {});
  return parsed.success ? parsed.data : MANUAL_SCHEDULE;
};

export class ScheduleInvalidError extends Error {
  readonly code = 'VALIDATION_FAILED';
  constructor(detail: string) {
    super(detail);
    this.name = 'ScheduleInvalidError';
  }
}

/** Validates an operator's schedule, with a message naming what is wrong. */
export const requireSchedule = (input: unknown): SyncSchedule => {
  const parsed = SyncScheduleSchema.safeParse(input ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ScheduleInvalidError(
      `The schedule is invalid: ${issue?.path.join('.') ?? 'schedule'} — ${
        issue?.message ?? 'unrecognised'
      }.`,
    );
  }
  const schedule = parsed.data;
  if (schedule.mode === 'CRON' && schedule.cron === undefined) {
    throw new ScheduleInvalidError('A CRON schedule requires a cron expression.');
  }
  if (schedule.mode !== 'CRON' && schedule.cron !== undefined) {
    throw new ScheduleInvalidError(
      'A cron expression is only meaningful when the mode is CRON. ' +
        'Two schedules on one source is an ambiguity, not a feature.',
    );
  }
  if (schedule.intervalHours !== undefined && schedule.mode !== 'HOURLY') {
    throw new ScheduleInvalidError('An hour interval only applies to an HOURLY schedule.');
  }
  return schedule;
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** The interval a mode implies, in milliseconds. Null when it has none. */
export const intervalMsOf = (schedule: SyncSchedule): number | null => {
  switch (schedule.mode) {
    case 'HOURLY':
      return (schedule.intervalHours ?? 1) * HOUR_MS;
    case 'DAILY':
      return DAY_MS;
    case 'WEEKLY':
      return 7 * DAY_MS;
    case 'MONTHLY':
      return 30 * DAY_MS;
    case 'CRON':
    case 'MANUAL':
    default:
      return null;
  }
};

/**
 * When this source should next run, or null when nothing is scheduled.
 *
 * Rules, all of them consequences of one decision — a schedule describes a
 * GAP between runs, not a wall-clock appointment:
 *
 *   - MANUAL returns null. A manual source is never "pending".
 *   - A source that has never run is due NOW, so the next run is `now`. The
 *     alternative (one full interval after registration) means a daily source
 *     configured on Monday does nothing until Tuesday, which reads as broken.
 *   - Otherwise it is lastRun + interval, and a run already overdue reports
 *     the overdue time rather than `now` — an operator needs to see HOW LATE
 *     it is, not that it is due.
 *   - CRON returns null here. pg-boss owns cron evaluation, and re-implementing
 *     it to draw a label is exactly the kind of second source of truth that
 *     drifts. The dashboard says "on its cron expression" instead.
 */
export const nextRunAt = (
  schedule: SyncSchedule,
  lastRunAt: Date | string | null,
  now: Date,
): Date | null => {
  const interval = intervalMsOf(schedule);
  if (interval === null) return null;
  if (lastRunAt === null) return now;
  const last = lastRunAt instanceof Date ? lastRunAt : new Date(lastRunAt);
  if (Number.isNaN(last.getTime())) return now;
  return new Date(last.getTime() + interval);
};

/** Whether a run is due, which is the scheduler's whole decision. */
export const isDue = (
  schedule: SyncSchedule,
  lastRunAt: Date | string | null,
  now: Date,
): boolean => {
  const next = nextRunAt(schedule, lastRunAt, now);
  return next !== null && next.getTime() <= now.getTime();
};

/**
 * A stable key for one source's due run, so enqueueing twice is one job.
 *
 * The timestamp is floored to the interval, so every tick inside the same due
 * window produces the SAME key — which is what makes the scheduler idempotent
 * across a tick that overlaps, a restart, and a second application instance.
 */
export const dueRunKey = (sourceId: string, schedule: SyncSchedule, now: Date): string => {
  const interval = intervalMsOf(schedule) ?? HOUR_MS;
  const window = Math.floor(now.getTime() / interval);
  return `${sourceId}:${schedule.mode}:${window}`;
};

/** How the dashboard words a schedule. One sentence, no invented weekday. */
export const describeSchedule = (schedule: SyncSchedule): string => {
  switch (schedule.mode) {
    case 'MANUAL':
      return 'Manual only';
    case 'HOURLY':
      return schedule.intervalHours === undefined || schedule.intervalHours === 1
        ? 'Every hour'
        : `Every ${schedule.intervalHours} hours`;
    case 'DAILY':
      return 'Every 24 hours';
    case 'WEEKLY':
      return 'Every 7 days';
    case 'MONTHLY':
      return 'Every 30 days';
    case 'CRON':
      return `On cron ${schedule.cron ?? ''}`.trim();
    default:
      return 'Manual only';
  }
};
