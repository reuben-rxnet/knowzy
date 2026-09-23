// Scheduler behaviour against a real database, on a CONTROLLED CLOCK.
//
// The scheduler itself lives in `apps/jobs`, which a package may not import
// (boundary B8), so the functions under test here are the ones the scheduler
// is built from and the database state it reads: which sources are due, what a
// paused source does, and what happens to a run whose process died.
//
// Nothing waits. Every test passes an explicit `now`, because a scheduler
// tested against wall-clock time passes on an idle machine and fails on a busy
// one, and neither outcome says anything about the code.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { systemClock } from '@knowzy/observability';
import { createAuditWriter } from '@knowzy/database';
import {
  createSource,
  addSourcePath,
  dueRunKey,
  isDue,
  nextRunAt,
  retireSource,
  scheduleOf,
  setSourceActive,
  updateSource,
  type SourceActor,
  type SourceAdminDeps,
} from '../src/index.js';

const DATABASE_URL = process.env['DATABASE_URL'];
const describeDb = DATABASE_URL ? describe : describe.skip;

const prisma = new PrismaClient(
  DATABASE_URL ? { datasources: { db: { url: DATABASE_URL } } } : undefined,
);

const PREFIX = 'ZZSCHED';
const ROOT = process.platform === 'win32' ? 'C:/knowzy-test-roots' : '/knowzy-test-roots';
const NOW = new Date('2026-09-23T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * The scheduler's due query, reproduced against the same rows the runner
 * reads.
 *
 * Duplicated here on purpose rather than imported: `apps/jobs` cannot be
 * imported by a package, and the alternative — moving the query into the
 * domain — would put a pg-boss-shaped concern in the wrong package. The
 * behaviour it encodes (skip paused, archived, pathless, running, and
 * not-yet-due) is asserted below against real data.
 */
const dueNow = async (now: Date): Promise<readonly string[]> => {
  const sources = await prisma.knowledgeSource.findMany({
    where: { isActive: true, archivedAt: null, paths: { some: { isActive: true } } },
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
  const due: string[] = [];
  for (const source of sources) {
    const schedule = scheduleOf(source.syncSchedule);
    if (schedule.mode === 'MANUAL' || schedule.mode === 'CRON') continue;
    const lastRun = source.syncRuns[0];
    if (lastRun?.outcome === 'RUNNING') continue;
    if (!isDue(schedule, lastRun?.startedAt ?? null, now)) continue;
    due.push(source.name);
  }
  return due;
};

describeDb('synchronization scheduler', () => {
  let actor: SourceActor;
  let deps: SourceAdminDeps;
  const created: string[] = [];

  beforeAll(async () => {
    const user = await prisma.user.findFirstOrThrow({
      where: { userPrincipalName: 'knowzy-administrator@local.invalid' },
      select: { id: true, displayName: true },
    });
    actor = {
      userId: user.id,
      displayName: user.displayName,
      roles: ['KNOWZY_ADMINISTRATOR'],
      correlationId: 'sched-test',
      requestId: 'sched-request',
    };
    deps = {
      prisma,
      clock: systemClock,
      allowedLocalRoots: [ROOT],
      registeredSourceTypes: ['FILE_REPOSITORY', 'MOCK'],
    };

    const stale = await prisma.knowledgeSource.findMany({
      where: { name: { startsWith: PREFIX } },
      select: { id: true },
    });
    for (const source of stale) {
      await prisma.knowledgeSourceSync.deleteMany({ where: { sourceId: source.id } });
      await prisma.knowledgeSourcePath.deleteMany({ where: { sourceId: source.id } });
      await prisma.knowledgeSource.deleteMany({ where: { id: source.id } });
    }
  });

  afterAll(async () => {
    for (const sourceId of created) {
      await prisma.knowledgeSourceSync.deleteMany({ where: { sourceId } });
      await prisma.knowledgeSourcePath.deleteMany({ where: { sourceId } });
      await prisma.knowledgeSource.deleteMany({ where: { id: sourceId } });
    }
    await prisma.$disconnect();
  });

  /** A scheduled, active source with one path — the eligible baseline. */
  const scheduled = async (
    suffix: string,
    schedule: Record<string, unknown> = { mode: 'DAILY', timezone: 'UTC' },
  ) => {
    const source = await createSource(deps, actor, {
      name: `${PREFIX} ${suffix}`,
      sourceType: 'FILE_REPOSITORY',
      localRoot: `${ROOT}/${suffix}`,
      schedule,
    });
    created.push(source.sourceId);
    await addSourcePath(deps, actor, {
      sourceId: source.sourceId,
      containerName: 'SOPs',
    });
    await setSourceActive(deps, actor, { sourceId: source.sourceId, isActive: true });
    return source;
  };

  const runAt = async (sourceId: string, startedAt: Date, outcome: string) =>
    prisma.knowledgeSourceSync.create({
      data: {
        sourceId,
        pathIds: [],
        mode: 'FULL',
        trigger: 'SCHEDULE',
        outcome: outcome as never,
        startedAt,
        completedAt: outcome === 'RUNNING' ? null : new Date(startedAt.getTime() + 1000),
        correlationId: 'sched-test',
      },
      select: { id: true },
    });

  it('a scheduled source that has never run IS due', async () => {
    const source = await scheduled('NEVERRUN');
    expect(await dueNow(NOW)).toContain(`${PREFIX} NEVERRUN`);
    expect(nextRunAt(scheduleOf({ mode: 'DAILY' }), null, NOW)?.getTime()).toBe(NOW.getTime());
    await prisma.knowledgeSource.update({
      where: { id: source.sourceId },
      data: { isActive: false },
    });
  });

  it('is NOT due inside its interval, and IS due at the boundary', async () => {
    const source = await scheduled('BOUNDARY');
    await runAt(source.sourceId, new Date(NOW.getTime() - 2 * HOUR), 'SUCCEEDED');
    expect(await dueNow(NOW)).not.toContain(`${PREFIX} BOUNDARY`);

    // Exactly one day later, it is due. Asserted on the same rows rather than
    // by waiting a day.
    expect(await dueNow(new Date(NOW.getTime() + DAY))).toContain(`${PREFIX} BOUNDARY`);
    await prisma.knowledgeSource.update({
      where: { id: source.sourceId },
      data: { isActive: false },
    });
  });

  it('a PAUSED source is never due, however overdue its schedule is', async () => {
    const source = await scheduled('PAUSED');
    await runAt(source.sourceId, new Date(NOW.getTime() - 10 * DAY), 'SUCCEEDED');
    expect(await dueNow(NOW)).toContain(`${PREFIX} PAUSED`);

    await setSourceActive(deps, actor, { sourceId: source.sourceId, isActive: false });
    // Pause is a control, not a suggestion: ten days overdue and still not due.
    expect(await dueNow(NOW)).not.toContain(`${PREFIX} PAUSED`);
  });

  it('an ARCHIVED source is never due, and archiving stands its schedule down', async () => {
    const source = await scheduled('ARCHIVED');
    await retireSource(deps, actor, { sourceId: source.sourceId, intent: 'ARCHIVE' });
    expect(await dueNow(NOW)).not.toContain(`${PREFIX} ARCHIVED`);
    const row = await prisma.knowledgeSource.findUniqueOrThrow({
      where: { id: source.sourceId },
      select: { syncSchedule: true },
    });
    expect(scheduleOf(row.syncSchedule).mode).toBe('MANUAL');
  });

  it('a source with no ACTIVE path is not due, because it has nothing to scan', async () => {
    const source = await createSource(deps, actor, {
      name: `${PREFIX} NOPATH`,
      sourceType: 'FILE_REPOSITORY',
      localRoot: `${ROOT}/NOPATH`,
      schedule: { mode: 'DAILY', timezone: 'UTC' },
    });
    created.push(source.sourceId);
    await setSourceActive(deps, actor, { sourceId: source.sourceId, isActive: true });
    // "Synchronized 0 of 0" reads like a success, so it is not attempted.
    expect(await dueNow(NOW)).not.toContain(`${PREFIX} NOPATH`);
  });

  it('a source mid-RUN is not due again — one run per source', async () => {
    const source = await scheduled('CONCURRENT');
    await runAt(source.sourceId, new Date(NOW.getTime() - 5 * HOUR), 'RUNNING');
    expect(await dueNow(new Date(NOW.getTime() + 10 * DAY))).not.toContain(`${PREFIX} CONCURRENT`);
    await prisma.knowledgeSource.update({
      where: { id: source.sourceId },
      data: { isActive: false },
    });
  });

  it('a MANUAL source is never due, and a CRON source is left to pg-boss', async () => {
    const manual = await scheduled('MANUALONLY', { mode: 'MANUAL', timezone: 'UTC' });
    const cron = await scheduled('CRONONLY', { mode: 'CRON', cron: '0 3 * * *', timezone: 'UTC' });
    const due = await dueNow(NOW);
    expect(due).not.toContain(`${PREFIX} MANUALONLY`);
    // Not because it is not due — because re-implementing cron here would be a
    // second source of truth, and pg-boss owns the first.
    expect(due).not.toContain(`${PREFIX} CRONONLY`);
    for (const source of [manual, cron]) {
      await prisma.knowledgeSource.update({
        where: { id: source.sourceId },
        data: { isActive: false },
      });
    }
  });

  describe('the stuck-run reaper', () => {
    /**
     * The reaper, reproduced here for the same boundary reason as the due
     * query. What it protects against is real and was found in production
     * state: a run whose process died stays RUNNING, and the concurrency guard
     * then refuses to start that source EVER AGAIN.
     */
    const reap = async (now: Date, ceilingMs: number): Promise<number> => {
      const cutoff = new Date(now.getTime() - ceilingMs);
      const stuck = await prisma.knowledgeSourceSync.findMany({
        where: { outcome: 'RUNNING', completedAt: null, startedAt: { lt: cutoff } },
        select: { id: true, sourceId: true, startedAt: true, correlationId: true },
      });
      const auditWriter = createAuditWriter({ clock: systemClock });
      for (const run of stuck) {
        await prisma.knowledgeSourceSync.update({
          where: { id: run.id },
          data: {
            outcome: 'FAILED',
            completedAt: now,
            errorSummary: [{ code: 'REQUEST_TIMEOUT', message: 'Closed out by the reaper.' }],
          },
        });
        await auditWriter.write(prisma, {
          action: 'ADMIN.SOURCE.SYNC_FAILED',
          outcome: 'FAILURE',
          actorType: 'SYSTEM',
          entityType: 'KnowledgeSourceSync',
          entityId: run.id,
          sourceId: run.sourceId,
          correlationId: run.correlationId,
          detail: {
            trigger: 'SCHEDULE',
            reaped: true,
            ageMinutes: Math.round((now.getTime() - run.startedAt.getTime()) / 60_000),
          },
        });
      }
      return stuck.length;
    };

    it('closes out a run older than the ceiling and frees the source', async () => {
      const source = await scheduled('STUCK');
      const stuck = await runAt(source.sourceId, new Date(NOW.getTime() - 5 * HOUR), 'RUNNING');

      // Frozen: overdue by days and still not due, because of the RUNNING row.
      expect(await dueNow(new Date(NOW.getTime() + 5 * DAY))).not.toContain(`${PREFIX} STUCK`);

      const reaped = await reap(NOW, 2 * HOUR);
      expect(reaped).toBeGreaterThanOrEqual(1);

      const row = await prisma.knowledgeSourceSync.findUniqueOrThrow({
        where: { id: stuck.id },
        select: { outcome: true, completedAt: true, errorSummary: true },
      });
      expect(row.outcome).toBe('FAILED');
      expect(row.completedAt).not.toBeNull();
      // The row says WHY it was closed, so a reaped run is distinguishable
      // from one that genuinely failed mid-scan.
      expect(JSON.stringify(row.errorSummary)).toContain('REQUEST_TIMEOUT');

      // And the source can synchronize again.
      expect(await dueNow(new Date(NOW.getTime() + 5 * DAY))).toContain(`${PREFIX} STUCK`);
      await prisma.knowledgeSource.update({
        where: { id: source.sourceId },
        data: { isActive: false },
      });
    });

    it('leaves a run INSIDE the ceiling alone, because it is probably alive', async () => {
      const source = await scheduled('LIVERUN');
      const live = await runAt(
        source.sourceId,
        new Date(NOW.getTime() - 10 * 60 * 1000),
        'RUNNING',
      );
      await reap(NOW, 2 * HOUR);
      const row = await prisma.knowledgeSourceSync.findUniqueOrThrow({
        where: { id: live.id },
        select: { outcome: true },
      });
      // Reaping a live run would be worse than leaving a stale one: it would
      // let a second scan start over the top of the first.
      expect(row.outcome).toBe('RUNNING');
      await prisma.knowledgeSourceSync.update({
        where: { id: live.id },
        data: { outcome: 'FAILED', completedAt: NOW },
      });
      await prisma.knowledgeSource.update({
        where: { id: source.sourceId },
        data: { isActive: false },
      });
    });

    it('audits the reap with no dropped keys', async () => {
      const source = await scheduled('REAPAUDIT');
      const stuck = await runAt(source.sourceId, new Date(NOW.getTime() - 6 * HOUR), 'RUNNING');
      await reap(NOW, 2 * HOUR);

      const event = await prisma.auditEvent.findFirst({
        where: { action: 'ADMIN.SOURCE.SYNC_FAILED', entityId: stuck.id },
        orderBy: { occurredAt: 'desc' },
      });
      const detail = event?.detail as Record<string, unknown>;
      expect(detail['reaped']).toBe(true);
      expect(detail['ageMinutes']).toBe(360);
      expect(detail['_droppedKeys']).toBeUndefined();
      await prisma.knowledgeSource.update({
        where: { id: source.sourceId },
        data: { isActive: false },
      });
    });
  });

  it('the due-window key is stable within a window and changes across one', async () => {
    // The queue half of the idempotency guarantee, asserted on the same
    // schedule the database holds.
    const source = await scheduled('WINDOWKEY', { mode: 'HOURLY', timezone: 'UTC' });
    const row = await prisma.knowledgeSource.findUniqueOrThrow({
      where: { id: source.sourceId },
      select: { id: true, syncSchedule: true },
    });
    const schedule = scheduleOf(row.syncSchedule);
    const first = dueRunKey(row.id, schedule, NOW);
    expect(dueRunKey(row.id, schedule, new Date(NOW.getTime() + 60_000))).toBe(first);
    expect(dueRunKey(row.id, schedule, new Date(NOW.getTime() + HOUR))).not.toBe(first);
    await updateSource(deps, actor, {
      sourceId: source.sourceId,
      schedule: { mode: 'MANUAL', timezone: 'UTC' },
    });
  });
});
