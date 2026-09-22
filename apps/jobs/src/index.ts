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
    expectedMigrationVersion: '0004_grounding_integrity',
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

  // Daily at 03:00 UTC, well ahead of any partition boundary.
  await boss.schedule(QUEUE_AUDIT_PARTITION_MAINTENANCE, '0 3 * * *', undefined, { tz: 'UTC' });

  // Run once at start so a fresh environment has its runway immediately.
  await boss.send(QUEUE_AUDIT_PARTITION_MAINTENANCE, {});

  logger.info('job runner started', { queues: [QUEUE_AUDIT_PARTITION_MAINTENANCE] });

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
