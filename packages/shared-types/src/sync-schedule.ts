// The synchronization schedule contract.
//
// It lives here rather than in @knowzy/domain because three deployables read
// it — the API, the job runner and the Sync Manager's forms — and because zod
// belongs to this package: @knowzy/domain declares no zod dependency, and
// boundary rule `no-non-package-json` refuses an undeclared import rather than
// letting one drift in.
//
// The arithmetic (next run, due, window key) is domain logic and stays in
// @knowzy/domain. This file is only the SHAPE and its validation.

import { z } from 'zod';

export const SYNC_SCHEDULE_MODES = [
  'MANUAL',
  'HOURLY',
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'CRON',
] as const;
export type SyncScheduleMode = (typeof SYNC_SCHEDULE_MODES)[number];

/**
 * A five-field cron expression, in the narrow form the platform can honestly
 * promise: pg-boss reads it, so anything it rejects is a schedule that
 * silently never runs — and a schedule that never runs looks identical to one
 * that is working.
 */
const CRON_FIELD = String.raw`(\*|\d+|\d+-\d+|\*\/\d+|\d+(,\d+)*)`;
export const CRON_PATTERN = new RegExp(`^${CRON_FIELD}( ${CRON_FIELD}){4}$`);

export const SyncScheduleSchema = z
  .object({
    mode: z.enum(SYNC_SCHEDULE_MODES).default('MANUAL'),
    /** HOURLY only: 1–24. Absent means every hour. */
    intervalHours: z.number().int().min(1).max(24).optional(),
    cron: z.string().trim().min(9).max(120).regex(CRON_PATTERN).optional(),
    /** IANA name. Recorded because "02:00" is meaningless without it. */
    timezone: z.string().trim().min(3).max(64).default('UTC'),
  })
  .strict();

export type SyncSchedule = z.infer<typeof SyncScheduleSchema>;

export const MANUAL_SCHEDULE: SyncSchedule = { mode: 'MANUAL', timezone: 'UTC' };
