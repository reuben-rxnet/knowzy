// Knowzy job runner — Phase 1.
//
// pg-boss owns the queue on the existing PostgreSQL instance (ADR-007); JobRun
// is the queryable operational record. Phase 1 registers the infrastructure
// jobs the Foundation phase owns. Sync, generation, publish, export, and
// certificate rendering are registered by the phases that build them — a queue
// handler with no implementation would accept work it cannot do.

import PgBoss from 'pg-boss';
import {
  StartupFatalError,
  enforceStartup,
  formatStartupReport,
  readProcessEnv,
  resolveKnowzyEnv,
  validateStartup,
} from '@knowzy/configuration';
import { createLogger, startSystemCorrelation, systemClock } from '@knowzy/observability';
import { createAuditWriter, createPrismaClient, probeDatabase } from '@knowzy/database';
import { runAuditPartitionMaintenance } from './audit-partition-maintenance.js';
import {
  executeScheduledSync,
  recordExhaustedSync,
  runSchedulerTick,
  QUEUE_SOURCE_SYNC_RUN,
  QUEUE_SOURCE_SYNC_TICK,
  type SchedulerDeps,
  type SourceSyncJob,
} from './source-sync-scheduler.js';
import {
  runReportingReconcile,
  runReportingRefresh,
  QUEUE_COVERAGE_SNAPSHOT,
  QUEUE_REPORTING_RECONCILE,
  QUEUE_REPORTING_REFRESH,
  runCoverageSnapshot,
} from './reporting-refresh.js';

export const QUEUE_AUDIT_PARTITION_MAINTENANCE = 'audit.partition.maintenance';

const main = async (): Promise<void> => {
  const rawEnv = readProcessEnv();
  const environment = resolveKnowzyEnv(rawEnv) ?? 'unknown';
  const isLocal = environment === 'local';
  const connectionString = rawEnv['DATABASE_URL'] ?? '';

  const logger = createLogger({
    serviceName: rawEnv['OTEL_SERVICE_NAME'] ?? 'knowzy-jobs',
    environment,
    level: isLocal ? 'debug' : 'info',
    pretty: isLocal,
  });

  const prisma = createPrismaClient({ connectionString });
  const auditWriter = createAuditWriter({ clock: systemClock });

  const report = await validateStartup({
    deployable: 'jobs',
    rawEnv,
    expectedMigrationVersion: '0016_competency_administration',
    probes: {
      database: () => probeDatabase(prisma),
      mockAdaptersRegistered: () => isLocal,
    },
  });

  process.stdout.write(`${formatStartupReport(report)}\n`);
  enforceStartup(report);

  const boss = new PgBoss({ connectionString, schema: 'pgboss' });
  boss.on('error', (error: Error) => logger.error('pg-boss error', { errorName: error.name }));
  await boss.start();

  await boss.createQueue(QUEUE_AUDIT_PARTITION_MAINTENANCE);

  await boss.work(QUEUE_AUDIT_PARTITION_MAINTENANCE, async () => {
    // N5: scheduled work mints its own correlation ID with actorType SYSTEM; it
    // does not inherit one from a person.
    const correlation = startSystemCorrelation();
    const jobRun = await prisma.jobRun.create({
      data: {
        jobType: QUEUE_AUDIT_PARTITION_MAINTENANCE,
        state: 'RUNNING',
        startedAt: systemClock.now(),
        attemptCount: 1,
        correlationId: correlation.correlationId,
      },
    });

    try {
      const result = await runAuditPartitionMaintenance(prisma, systemClock);

      await prisma.jobRun.update({
        where: { id: jobRun.id },
        data: { state: 'SUCCEEDED', completedAt: systemClock.now() },
      });

      await auditWriter.write(prisma, {
        action: 'PLATFORM.JOB.SUCCEEDED',
        entityType: 'JobRun',
        entityId: jobRun.id,
        correlationId: correlation.correlationId,
        actorType: 'SYSTEM',
        detail: {
          jobType: QUEUE_AUDIT_PARTITION_MAINTENANCE,
          jobRunId: jobRun.id,
          itemsProcessed: result.ensured.length,
        },
      });

      logger.info('audit partition maintenance complete', {
        correlationId: correlation.correlationId,
        ensured: result.ensured.length,
        defaultPartitionRows: result.defaultPartitionRows,
      });
    } catch (error: unknown) {
      await prisma.jobRun.update({
        where: { id: jobRun.id },
        data: {
          state: 'FAILED',
          completedAt: systemClock.now(),
          lastError: { name: error instanceof Error ? error.name : 'Unknown' },
        },
      });
      await auditWriter.write(prisma, {
        action: 'PLATFORM.JOB.FAILED',
        entityType: 'JobRun',
        entityId: jobRun.id,
        correlationId: correlation.correlationId,
        actorType: 'SYSTEM',
        outcome: 'FAILURE',
        detail: { jobType: QUEUE_AUDIT_PARTITION_MAINTENANCE, jobRunId: jobRun.id },
      });
      throw error;
    }
  });

  // ------------------------------------------------- source synchronization
  //
  // Two queues: a TICK that finds due sources, and a RUN that synchronizes
  // one. Splitting them is what makes the schedule idempotent -- see
  // source-sync-scheduler.ts for the guarantees and how each is obtained.
  await boss.createQueue(QUEUE_SOURCE_SYNC_TICK);
  await boss.createQueue(QUEUE_SOURCE_SYNC_RUN);

  const mcpEndpoint = rawEnv['MCP_ENDPOINT'] ?? 'stdio';
  const maxAttempts = Number(rawEnv['SOURCE_SYNC_MAX_ATTEMPTS'] ?? '3');

  /**
   * The only path from this runner to a knowledge source.
   *
   * Over HTTP to the MCP server, because B8 forbids importing an app and B2
   * forbids importing the adapters. `stdio` means no HTTP endpoint is
   * configured, and the scheduler then refuses rather than pretending: a
   * scheduled run that silently does nothing is worse than one that errors.
   */
  /**
   * The only path from this runner to a knowledge source.
   *
   * Over HTTP to the MCP server, because B8 forbids importing an app and B2
   * forbids importing the adapter package. Three details that are not
   * incidental:
   *
   *   * The envelope is built HERE from the database, exactly as the API
   *     builds it (E2: roles and permissions come from rows, never from a
   *     token claim). There is no shared secret to hold.
   *   * `portal: 'SYSTEM'` is what makes the run record `trigger: SCHEDULE`.
   *     The MCP tool derives the trigger from the portal, so an AUTHORING
   *     envelope would file a scheduled run as MANUAL and the activity feed
   *     would say "triggered manually" about something nobody touched.
   *   * `stdio` means no HTTP endpoint is configured, and the scheduler then
   *     REFUSES rather than pretending: a scheduled run that silently does
   *     nothing is worse than one that errors.
   */
  const syncSubjectUpn = rawEnv['SOURCE_SYNC_SUBJECT'] ?? 'knowzy-administrator@local.invalid';

  const runSynchronization: SchedulerDeps['runSynchronization'] = async (job) => {
    if (mcpEndpoint === 'stdio') {
      throw new Error(
        'MCP_ENDPOINT is stdio, so the job runner has no HTTP path to the MCP server. ' +
          'A scheduled synchronization cannot run.',
      );
    }

    const subject = await prisma.user.findFirst({
      where: { userPrincipalName: syncSubjectUpn, status: 'ACTIVE' },
      select: {
        id: true,
        entraObjectId: true,
        displayName: true,
        roles: {
          where: { revokedAt: null },
          select: {
            role: {
              select: {
                key: true,
                permissions: { select: { permission: { select: { key: true } } } },
              },
            },
          },
        },
      },
    });
    if (subject === null) {
      throw new Error(
        `The scheduler's subject ${syncSubjectUpn} does not exist or is not active, so a ` +
          'scheduled synchronization cannot be authorized. Fail closed rather than run unowned.',
      );
    }

    const roles = subject.roles.map((assignment) => assignment.role.key);
    const permissions = [
      ...new Set(
        subject.roles.flatMap((assignment) =>
          assignment.role.permissions.map((entry) => entry.permission.key),
        ),
      ),
    ];
    const issuedAt = systemClock.now();
    const correlationId = `sched-${job.dueWindowKey}`;

    const response = await fetch(
      `${mcpEndpoint.replace(/\/+$/, '')}/internal/tools/synchronize_knowledge_source/invoke`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-correlation-id': correlationId },
        body: JSON.stringify({
          envelope: {
            subject: {
              userId: subject.id,
              entraObjectId: subject.entraObjectId,
              displayName: subject.displayName,
            },
            portal: 'SYSTEM',
            effectiveRoles: roles,
            permissions,
            // No scope restriction: the scheduler acts for the platform, and a
            // per-user allow-list would make a schedule depend on whose
            // account happened to be configured.
            dataScope: { domainIds: [], teamIds: [], sourceIds: [], denySourceIds: [] },
            delegation: { mode: 'NONE' },
            correlationId,
            requestId: `sched-${job.sourceId}`,
            issuedAt: issuedAt.toISOString(),
            expiresAt: new Date(issuedAt.getTime() + 120_000).toISOString(),
          },
          arguments: { sourceId: job.sourceId, mode: 'FULL' },
        }),
      },
    );

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`synchronize_knowledge_source -> ${response.status}: ${text.slice(0, 300)}`);
    }
    const parsed = JSON.parse(text) as {
      outcome?: string;
      scanned?: number;
      failed?: number;
      result?: { outcome?: string; scanned?: number; failed?: number };
    };
    const payload = parsed.result ?? parsed;
    return {
      outcome: payload.outcome ?? 'UNKNOWN',
      scanned: payload.scanned ?? 0,
      failed: payload.failed ?? 0,
    };
  };

  const schedulerDeps: SchedulerDeps = {
    prisma,
    boss,
    auditWriter,
    clock: systemClock,
    logger,
    runSynchronization,
    maxAttempts,
  };

  await boss.work(QUEUE_SOURCE_SYNC_TICK, async () => {
    await runSchedulerTick(schedulerDeps, systemClock.now());
  });

  await boss.work<SourceSyncJob>(QUEUE_SOURCE_SYNC_RUN, async ([job]) => {
    if (job === undefined) return;
    try {
      await executeScheduledSync(schedulerDeps, job.data);
    } catch (error) {
      // The LAST attempt is the one that records exhaustion. Earlier failures
      // are retried by pg-boss and must not write a dead-letter row, or every
      // transient blip would read as a permanent stop.
      const attempt = (job as unknown as { retryCount?: number }).retryCount ?? 0;
      if (attempt >= maxAttempts - 1) {
        await recordExhaustedSync(schedulerDeps, job.data, attempt + 1);
      }
      throw error;
    }
  });

  // The tick interval bounds how LATE a due run can start; it is not the
  // schedule. A daily source runs once a day whatever this is.
  const tickMinutes = Number(rawEnv['SOURCE_SYNC_TICK_MINUTES'] ?? '5');
  // ------------------------------------------------- reporting (Phase 10 R1)
  //
  // A refresh failure is NOT a job failure. One view that cannot refresh must
  // not leave the other four stale, so the worker reports how many succeeded
  // and throws only if every model failed -- which is an outage, not a bad
  // view.
  await boss.createQueue(QUEUE_REPORTING_REFRESH);
  await boss.createQueue(QUEUE_REPORTING_RECONCILE);
  await boss.createQueue(QUEUE_COVERAGE_SNAPSHOT);

  await boss.work(QUEUE_REPORTING_REFRESH, async () => {
    const correlation = startSystemCorrelation();
    const jobRun = await prisma.jobRun.create({
      data: {
        jobType: QUEUE_REPORTING_REFRESH,
        state: 'RUNNING',
        startedAt: systemClock.now(),
        attemptCount: 1,
        correlationId: correlation.correlationId,
      },
    });

    const summary = await runReportingRefresh(prisma);
    const everyModelFailed = summary.refreshed === 0 && summary.failed > 0;

    await prisma.jobRun.update({
      where: { id: jobRun.id },
      data: {
        state: everyModelFailed ? 'FAILED' : 'SUCCEEDED',
        completedAt: systemClock.now(),
        ...(everyModelFailed
          ? { lastError: { name: 'ReportingRefreshFailed', failed: summary.failed } }
          : {}),
      },
    });

    await auditWriter.write(prisma, {
      action: everyModelFailed ? 'PLATFORM.JOB.FAILED' : 'PLATFORM.JOB.SUCCEEDED',
      entityType: 'JobRun',
      entityId: jobRun.id,
      correlationId: correlation.correlationId,
      actorType: 'SYSTEM',
      ...(everyModelFailed ? { outcome: 'FAILURE' as const } : {}),
      detail: {
        jobType: QUEUE_REPORTING_REFRESH,
        jobRunId: jobRun.id,
        itemsProcessed: summary.refreshed,
        itemsFailed: summary.failed,
      },
    });

    logger.info('reporting refresh complete', {
      correlationId: correlation.correlationId,
      refreshed: summary.refreshed,
      failed: summary.failed,
      cacheEntriesPruned: summary.cacheEntriesPruned,
    });
  });

  await boss.work(QUEUE_REPORTING_RECONCILE, async () => {
    const correlation = startSystemCorrelation();
    const jobRun = await prisma.jobRun.create({
      data: {
        jobType: QUEUE_REPORTING_RECONCILE,
        state: 'RUNNING',
        startedAt: systemClock.now(),
        attemptCount: 1,
        correlationId: correlation.correlationId,
      },
    });

    const summary = await runReportingReconcile(prisma);

    await prisma.jobRun.update({
      where: { id: jobRun.id },
      data: { state: 'SUCCEEDED', completedAt: systemClock.now() },
    });

    // D7: drift is REPORTED, never corrected. The job succeeds even when it
    // finds drift -- the finding is the output, and failing the job would make
    // an operator chase a broken job instead of a broken counter.
    await auditWriter.write(prisma, {
      action: 'PLATFORM.JOB.SUCCEEDED',
      entityType: 'JobRun',
      entityId: jobRun.id,
      correlationId: correlation.correlationId,
      actorType: 'SYSTEM',
      detail: {
        jobType: QUEUE_REPORTING_RECONCILE,
        jobRunId: jobRun.id,
        itemsProcessed: summary.driftCount,
      },
    });

    if (summary.driftCount > 0) {
      logger.warn('reporting counter drift detected and reported, NOT corrected', {
        correlationId: correlation.correlationId,
        driftCount: summary.driftCount,
      });
    }
  });

  // R-1: the daily coverage snapshot. The first capture of a UTC day stands, so
  // a retry or a restart the same day writes nothing and reports that.
  await boss.work(QUEUE_COVERAGE_SNAPSHOT, async () => {
    const correlation = startSystemCorrelation();
    const jobRun = await prisma.jobRun.create({
      data: {
        jobType: QUEUE_COVERAGE_SNAPSHOT,
        state: 'RUNNING',
        startedAt: systemClock.now(),
        attemptCount: 1,
        correlationId: correlation.correlationId,
      },
    });

    const summary = await runCoverageSnapshot(prisma, 'SCHEDULE', correlation.correlationId);

    await prisma.jobRun.update({
      where: { id: jobRun.id },
      data: { state: 'SUCCEEDED', completedAt: systemClock.now() },
    });
    await auditWriter.write(prisma, {
      action: 'PLATFORM.JOB.SUCCEEDED',
      entityType: 'JobRun',
      entityId: jobRun.id,
      correlationId: correlation.correlationId,
      actorType: 'SYSTEM',
      detail: {
        jobType: QUEUE_COVERAGE_SNAPSHOT,
        jobRunId: jobRun.id,
        // 1 when today's row was written, 0 when today already had one.
        itemsProcessed: summary.written ? 1 : 0,
        itemsFailed: summary.inputsFailed,
      },
    });
    logger.info(
      summary.written
        ? 'coverage snapshot recorded'
        : 'coverage snapshot already recorded today; nothing written',
      { correlationId: correlation.correlationId, inputsFailed: summary.inputsFailed },
    );
  });

  await boss.schedule(QUEUE_SOURCE_SYNC_TICK, `*/${tickMinutes} * * * *`, undefined, {
    tz: 'UTC',
  });

  // Daily at 03:00 UTC, well ahead of any partition boundary.
  await boss.schedule(QUEUE_AUDIT_PARTITION_MAINTENANCE, '0 3 * * *', undefined, { tz: 'UTC' });
  // Every 15 minutes: the latency target the read models declare.
  await boss.schedule(QUEUE_REPORTING_REFRESH, '*/15 * * * *', undefined, { tz: 'UTC' });
  // Nightly, and deliberately AFTER the partition maintenance rather than
  // alongside it: two jobs contending on the same tables at 03:00 makes each
  // one's duration a function of the other's.
  await boss.schedule(QUEUE_REPORTING_RECONCILE, '30 3 * * *', undefined, { tz: 'UTC' });
  // Five past midnight UTC: the first capture of the new day.
  await boss.schedule(QUEUE_COVERAGE_SNAPSHOT, '5 0 * * *', undefined, { tz: 'UTC' });

  // Run once at start so a fresh environment has its runway immediately.
  await boss.send(QUEUE_AUDIT_PARTITION_MAINTENANCE, {});
  // Once at startup, so a fresh database has populated read models before
  // anybody opens the Reports screen. Five views that have never refreshed
  // render as "not yet built", which is honest and also unhelpful on the first
  // run of the day.
  await boss.send(QUEUE_REPORTING_REFRESH, {});
  // And a snapshot, so a runner started after 00:05 still records today. A
  // no-op when today already has one.
  await boss.send(QUEUE_COVERAGE_SNAPSHOT, {});

  logger.info('job runner started', {
    queues: [QUEUE_AUDIT_PARTITION_MAINTENANCE, QUEUE_SOURCE_SYNC_TICK, QUEUE_SOURCE_SYNC_RUN],
    syncTickMinutes: tickMinutes,
    syncMaxAttempts: maxAttempts,
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info('shutting down', { signal });
    await boss.stop({ graceful: true });
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
};

main().catch((error: unknown) => {
  if (error instanceof StartupFatalError) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
  process.stderr.write(
    `jobs failed to start: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
