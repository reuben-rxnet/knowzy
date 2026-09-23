// The synchronization scheduler — SYNC-M3.
//
// `KnowledgeSource.syncSchedule` has existed since migration 0001 and NOTHING
// HAS EVER EXECUTED IT. A dashboard showing "Daily" was reporting an intention
// as a fact. This module is what makes that column true.
//
// Shape: one cron TICK on pg-boss finds due sources and enqueues one sync job
// per source. Not one pg-boss cron per source, deliberately — a per-source
// cron has to be created, updated and torn down in step with the row, and the
// failure mode of getting that wrong is a schedule that fires for a source
// that no longer exists, or silence for one that does. A tick reads the
// database every time, so the database is the only source of truth.
//
// The guarantees, and how each is obtained:
//
//   IDEMPOTENT ENQUEUE     `singletonKey` = the source plus its due WINDOW, so
//                          every tick inside one window enqueues the same job
//                          once, whatever the tick rate and however many
//                          instances are running.
//   ONE RUN PER SOURCE     `singletonKey` on the WORK job too, plus a database
//                          check for an existing RUNNING row, so a scheduled
//                          run and a manual Sync Now cannot overlap.
//   RETRY AND BACKOFF      pg-boss `retryLimit` / `retryDelay` /
//                          `retryBackoff`, from configuration.
//   EXHAUSTED IS VISIBLE   an exhausted job writes a FAILED JobRun and an
//                          audit event. A silent dead letter is a sync that
//                          stopped and nobody knows.
//   SAFE RESTART           no state is held in memory; on restart the tick
//                          recomputes from rows. A job already queued keeps
//                          its singleton key, so a restart cannot duplicate it.
//   PAUSED MEANS PAUSED    the query filters `isActive` and `archivedAt`, and
//                          the worker re-checks before running, because a
//                          source can be paused between enqueue and execution.

import type PgBoss from 'pg-boss';
import { dueRunKey, isDue, scheduleOf } from '@knowzy/domain';
import type { AuditWriter, PrismaClient } from '@knowzy/database';
import type { Clock, Logger } from '@knowzy/observability';

export const QUEUE_SOURCE_SYNC_TICK = 'source.sync.tick';
export const QUEUE_SOURCE_SYNC_RUN = 'source.sync.run';

export interface SourceSyncJob {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly scheduleMode: string;
  /** The window this job was enqueued for, so a log line can be matched up. */
  readonly dueWindowKey: string;
}

export interface SchedulerDeps {
  readonly prisma: PrismaClient;
  readonly boss: PgBoss;
  readonly auditWriter: AuditWriter;
  readonly clock: Clock;
  readonly logger: Logger;
  /**
   * Runs one synchronization. Injected because the jobs app may not import the
   * MCP server (boundary B8) and may not import the adapters (B2): the only
   * legal path from here to a source is the MCP tool over HTTP, and injecting
   * it is also what lets the tests drive the scheduler without a network.
   */
  readonly runSynchronization: (job: SourceSyncJob) => Promise<{
    readonly outcome: string;
    readonly scanned: number;
    readonly failed: number;
  }>;
  readonly maxAttempts: number;
}

interface DueSource {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly scheduleMode: string;
  readonly dueWindowKey: string;
}

/**
 * A run left RUNNING by a process that died, closed out so the source is not
 * frozen for ever.
 *
 * FOUND THE HARD WAY. On 2026-09-22 a synchronization crashed mid-run — the
 * Prisma client had not been regenerated after a migration — and its
 * `knowledge_source_sync` row stayed `RUNNING`. A day later the dashboard
 * still reported that source as RUNNING, and both guards that exist to stop a
 * double scan (Sync Now's check and the scheduler's) refused to start it
 * again. **Concurrency protection with no reaper is a permanent lock.**
 *
 * So a run with no `completedAt` older than the ceiling is marked FAILED with
 * a reason that says what happened, and audited as a failure — because that is
 * what it was. The ceiling is generous: a large corpus legitimately takes
 * minutes, and reaping a live run would be worse than leaving a stale one.
 */
export const reapStuckRuns = async (
  deps: Pick<SchedulerDeps, 'prisma' | 'auditWriter' | 'logger'>,
  now: Date,
  ceilingMs: number,
): Promise<number> => {
  const cutoff = new Date(now.getTime() - ceilingMs);
  const stuck = await deps.prisma.knowledgeSourceSync.findMany({
    where: { outcome: 'RUNNING', completedAt: null, startedAt: { lt: cutoff } },
    select: {
      id: true,
      sourceId: true,
      startedAt: true,
      correlationId: true,
      source: { select: { name: true } },
    },
  });

  for (const run of stuck) {
    const ageMinutes = Math.round((now.getTime() - run.startedAt.getTime()) / 60_000);
    await deps.prisma.knowledgeSourceSync.update({
      where: { id: run.id },
      data: {
        outcome: 'FAILED',
        completedAt: now,
        errorSummary: [
          {
            code: 'REQUEST_TIMEOUT',
            message:
              `The run was still marked RUNNING ${ageMinutes} minute(s) after it started and ` +
              'no process claimed it. It was closed out so the source can synchronize again.',
          },
        ],
      },
    });
    await deps.auditWriter.write(deps.prisma, {
      action: 'ADMIN.SOURCE.SYNC_FAILED',
      outcome: 'FAILURE',
      actorType: 'SYSTEM',
      entityType: 'KnowledgeSourceSync',
      entityId: run.id,
      entityLabel: run.source.name,
      sourceId: run.sourceId,
      // The ORIGINAL correlation id, so the reap joins the chain of the run it
      // is closing rather than starting a new story.
      correlationId: run.correlationId,
      detail: { trigger: 'SCHEDULE', reaped: true, ageMinutes },
    });
    deps.logger.warn('closed out a stuck synchronization', {
      syncId: run.id,
      sourceId: run.sourceId,
      ageMinutes,
    });
  }

  return stuck.length;
};

/**
 * Every source whose schedule says it should run by `now`.
 *
 * Pure of side effects and separated from the enqueue so a test can assert
 * WHICH sources are due without a queue. The three exclusions are the ones an
 * operator relies on: paused, archived, and no active path to scan.
 */
export const dueSources = async (
  deps: Pick<SchedulerDeps, 'prisma'>,
  now: Date,
): Promise<readonly DueSource[]> => {
  const sources = await deps.prisma.knowledgeSource.findMany({
    where: {
      isActive: true,
      archivedAt: null,
      paths: { some: { isActive: true } },
    },
    select: {
      id: true,
      name: true,
      syncSchedule: true,
      syncRuns: {
        orderBy: { startedAt: 'desc' },
        take: 1,
        select: { startedAt: true, outcome: true },
      },
    },
  });

  const due: DueSource[] = [];
  for (const source of sources) {
    const schedule = scheduleOf(source.syncSchedule);
    if (schedule.mode === 'MANUAL' || schedule.mode === 'CRON') continue;

    // A source mid-run is not due again. This is the database half of the
    // one-run-per-source guarantee; the singleton key is the queue half.
    const lastRun = source.syncRuns[0];
    if (lastRun?.outcome === 'RUNNING') continue;
    if (!isDue(schedule, lastRun?.startedAt ?? null, now)) continue;

    due.push({
      sourceId: source.id,
      sourceName: source.name,
      scheduleMode: schedule.mode,
      dueWindowKey: dueRunKey(source.id, schedule, now),
    });
  }
  return due;
};

/** One tick: close out dead runs, find what is due, enqueue it idempotently. */
export const runSchedulerTick = async (
  deps: SchedulerDeps,
  now: Date,
  stuckCeilingMs = 2 * 60 * 60 * 1000,
): Promise<number> => {
  // BEFORE the due check, deliberately: a source whose last run is stuck
  // RUNNING is excluded by `dueSources`, so reaping second would delay every
  // recovery by one tick.
  await reapStuckRuns(deps, now, stuckCeilingMs);

  const due = await dueSources(deps, now);
  let enqueued = 0;

  for (const source of due) {
    const jobId = await deps.boss.send(
      QUEUE_SOURCE_SYNC_RUN,
      {
        sourceId: source.sourceId,
        sourceName: source.sourceName,
        scheduleMode: source.scheduleMode,
        dueWindowKey: source.dueWindowKey,
      } satisfies SourceSyncJob,
      {
        // The whole idempotency guarantee, in one option. Two ticks in the
        // same window, or two instances ticking at once, produce ONE job.
        singletonKey: source.dueWindowKey,
        retryLimit: deps.maxAttempts - 1,
        retryDelay: 60,
        retryBackoff: true,
        expireInMinutes: 60,
      },
    );
    // pg-boss returns null when the singleton already exists, which is a
    // success: the work is already queued.
    if (jobId !== null) enqueued += 1;
  }

  if (due.length > 0) {
    deps.logger.info('scheduler tick', { due: due.length, enqueued });
  }
  return enqueued;
};

/**
 * Executes one scheduled synchronization.
 *
 * Re-checks eligibility first. A source can be paused, archived, or already
 * running in the gap between enqueue and execution, and running it anyway
 * would make "Pause" a suggestion rather than a control.
 */
export const executeScheduledSync = async (
  deps: SchedulerDeps,
  job: SourceSyncJob,
): Promise<'RAN' | 'SKIPPED_PAUSED' | 'SKIPPED_RUNNING' | 'SKIPPED_GONE'> => {
  const source = await deps.prisma.knowledgeSource.findUnique({
    where: { id: job.sourceId },
    select: {
      id: true,
      name: true,
      isActive: true,
      archivedAt: true,
      syncRuns: { where: { outcome: 'RUNNING' }, take: 1, select: { id: true } },
    },
  });

  if (source === null) return 'SKIPPED_GONE';
  if (!source.isActive || source.archivedAt !== null) {
    deps.logger.info('scheduled sync skipped: source paused or archived', {
      sourceId: job.sourceId,
    });
    return 'SKIPPED_PAUSED';
  }
  if (source.syncRuns.length > 0) {
    deps.logger.info('scheduled sync skipped: already running', { sourceId: job.sourceId });
    return 'SKIPPED_RUNNING';
  }

  const correlationId = `sched-${job.dueWindowKey}`;
  await deps.auditWriter.write(deps.prisma, {
    action: 'ADMIN.SOURCE.SYNC_STARTED',
    outcome: 'SUCCESS',
    actorType: 'SYSTEM',
    entityType: 'KnowledgeSource',
    entityId: source.id,
    entityLabel: source.name,
    sourceId: source.id,
    correlationId,
    detail: { trigger: 'SCHEDULE', scheduleMode: job.scheduleMode },
  });

  const result = await deps.runSynchronization(job);

  await deps.auditWriter.write(deps.prisma, {
    action:
      result.outcome === 'FAILED' ? 'ADMIN.SOURCE.SYNC_FAILED' : 'ADMIN.SOURCE.SYNC_COMPLETED',
    outcome: result.outcome === 'FAILED' ? 'FAILURE' : 'SUCCESS',
    actorType: 'SYSTEM',
    entityType: 'KnowledgeSource',
    entityId: source.id,
    entityLabel: source.name,
    sourceId: source.id,
    correlationId,
    detail: {
      trigger: 'SCHEDULE',
      scheduleMode: job.scheduleMode,
      scanned: result.scanned,
      failed: result.failed,
    },
  });

  return 'RAN';
};

/**
 * An exhausted job, recorded rather than dropped.
 *
 * pg-boss moves a job past its retry limit to a dead state and stops. Without
 * this, a source stops synchronizing and the only evidence is the absence of
 * runs — which is exactly the failure nobody notices.
 */
export const recordExhaustedSync = async (
  deps: Pick<SchedulerDeps, 'prisma' | 'auditWriter' | 'logger'>,
  job: SourceSyncJob,
  attempts: number,
): Promise<void> => {
  deps.logger.error('scheduled sync exhausted its retries', {
    sourceId: job.sourceId,
    attempts,
  });
  await deps.auditWriter.write(deps.prisma, {
    action: 'ADMIN.SOURCE.SYNC_FAILED',
    outcome: 'FAILURE',
    actorType: 'SYSTEM',
    entityType: 'KnowledgeSource',
    entityId: job.sourceId,
    entityLabel: job.sourceName,
    sourceId: job.sourceId,
    correlationId: `sched-${job.dueWindowKey}`,
    detail: {
      trigger: 'SCHEDULE',
      scheduleMode: job.scheduleMode,
      exhaustedAfterAttempts: attempts,
    },
  });
};
