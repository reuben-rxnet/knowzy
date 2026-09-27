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

// ---------------------------------------------------------------------------
// The workflow status an operator sees
// ---------------------------------------------------------------------------

export const SOURCE_WORKFLOW_STATUSES = [
  'RUNNING',
  'DISABLED',
  'PAUSED',
  'FAILED',
  'SCHEDULED',
  'SUCCESS',
  'NEVER_RUN',
] as const;
export type SourceWorkflowStatus = (typeof SOURCE_WORKFLOW_STATUSES)[number];

/**
 * The workflow status of a knowledge source, derived from state rather than stored.
 *
 * It lives HERE, rather than in the Sync Manager's route, because two surfaces
 * show it: the Sync Manager and Reports → Knowledge Source Health. The
 * reporting design (§8) requires the second to REUSE this derivation rather
 * than invent one, and a "Healthy" label computed a different way on each
 * screen is two screens that disagree about the same source.
 *
 * Order matters: a source that is RUNNING is running whatever its schedule
 * says, and a source that is inactive is PAUSED even if its last run
 * succeeded. `DISABLED` is reserved for a source that is both inactive and
 * archived, because those are different operator actions with different
 * remedies.
 */
export const sourceWorkflowStatus = (source: {
  readonly isActive: boolean;
  readonly archivedAt: Date | string | null;
  readonly runningCount: number;
  readonly lastOutcome: string | null;
  readonly scheduleMode: string;
}): SourceWorkflowStatus => {
  if (source.runningCount > 0) return 'RUNNING';
  if (source.archivedAt !== null) return 'DISABLED';
  if (!source.isActive) return 'PAUSED';
  if (source.lastOutcome === 'FAILED') return 'FAILED';
  if (source.lastOutcome === null) {
    return source.scheduleMode === 'MANUAL' ? 'NEVER_RUN' : 'SCHEDULED';
  }
  return source.scheduleMode === 'MANUAL' ? 'SUCCESS' : 'SCHEDULED';
};
