// Exit criterion (implementation-roadmap.md Phase 1):
// "An audit event written in a transaction rolls back with its state change,
//  verified by test."
//
// This is the test behind invariant U1 (audit-model.md §1): "The audit write
// shares the database transaction with the state change it describes. A
// transition that cannot be audited does not commit."
//
// Both directions are asserted, because only proving the happy path would
// leave the guarantee untested:
//   - audit fails  -> the state change is absent
//   - work fails   -> the audit event is absent
//
// Integration test: needs a migrated PostgreSQL. It SKIPS rather than fails
// when DATABASE_URL is absent, so `npm test` works on a machine with no
// database, and the CI integration stage runs it for real.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FixedClock, UnknownAuditActionError } from '@knowzy/observability';
import { readProcessEnv } from '@knowzy/configuration';
import { PrismaClient } from '@prisma/client';
import { createAuditWriter, transactWithAudit } from '../src/index.js';

const connectionString = readProcessEnv()['DATABASE_URL'];
const describeIfDb = connectionString ? describe : describe.skip;

const CORRELATION = 'c-00000000000000000000000000000001';
const clock = new FixedClock('2026-09-17T12:00:00.000Z');

describeIfDb('transactWithAudit — U1 audit/state coupling', () => {
  let prisma: PrismaClient;
  const auditWriter = createAuditWriter({ clock });

  // Unique per run so a leftover row from a failed run cannot mask a result.
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  const okCode = `TSTOK${suffix}`;
  const rollbackCode = `TSTRB${suffix}`;
  const workFailCode = `TSTWF${suffix}`;

  beforeAll(() => {
    prisma = new PrismaClient({ datasources: { db: { url: connectionString as string } } });
  });

  afterAll(async () => {
    await prisma.domain.deleteMany({
      where: { code: { in: [okCode, rollbackCode, workFailCode] } },
    });
    await prisma.$disconnect();
  });

  const auditEventsFor = (entityId: string) =>
    prisma.auditEvent.findMany({ where: { entityId } });

  // -------------------------------------------------------------------------

  it('commits the state change and its audit event together', async () => {
    const created = await transactWithAudit({
      prisma,
      auditWriter,
      action: 'ADMIN.TAXONOMY.DOMAIN_CREATED',
      work: (tx) =>
        tx.domain.create({
          data: { code: okCode, name: `Test domain ${okCode}`, isActive: true },
        }),
      audit: (domain) => ({
        action: 'ADMIN.TAXONOMY.DOMAIN_CREATED',
        entityType: 'Domain',
        entityId: domain.id,
        entityLabel: domain.code,
        domainId: domain.id,
        correlationId: CORRELATION,
        actorType: 'SYSTEM',
        detail: { code: domain.code, name: domain.name },
      }),
    });

    const domain = await prisma.domain.findUnique({ where: { code: okCode } });
    expect(domain).not.toBeNull();

    const events = await auditEventsFor(created.id);
    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe('ADMIN.TAXONOMY.DOMAIN_CREATED');
    expect(events[0]?.family).toBe('ADMIN.TAXONOMY');
    expect(events[0]?.category).toBe('ADMIN');
    // The clock is injected, so the timestamp is the one the test pinned.
    expect(events[0]?.occurredAt.toISOString()).toBe('2026-09-17T12:00:00.000Z');
  });

  // -------------------------------------------------------------------------
  // The criterion: a failed audit rolls back the state change.
  // -------------------------------------------------------------------------

  it('rolls back the state change when the audit write fails', async () => {
    let capturedDomainId: string | null = null;

    await expect(
      transactWithAudit({
        prisma,
        auditWriter,
        // Pre-validation catches this before any work runs, which is the
        // cheapest possible failure.
        action: 'ADMIN.TAXONOMY.NOT_A_REAL_ACTION',
        work: (tx) =>
          tx.domain.create({
            data: { code: rollbackCode, name: `Test domain ${rollbackCode}`, isActive: true },
          }),
        audit: (domain) => {
          capturedDomainId = domain.id;
          return {
            action: 'ADMIN.TAXONOMY.NOT_A_REAL_ACTION',
            entityType: 'Domain',
            entityId: domain.id,
            correlationId: CORRELATION,
            detail: {},
          };
        },
      }),
    ).rejects.toThrow(UnknownAuditActionError);

    // The transition did not commit.
    const domain = await prisma.domain.findUnique({ where: { code: rollbackCode } });
    expect(domain).toBeNull();
    expect(capturedDomainId).toBeNull();
  });

  it('rolls back the state change when the audit insert itself fails mid-transaction', async () => {
    // Forces the failure at INSERT time rather than at pre-validation, so the
    // rollback path — not the guard — is what is being exercised.
    const brokenWriter = {
      write: async () => {
        throw new Error('simulated audit insert failure');
      },
      writeMany: async () => 0,
    };

    await expect(
      transactWithAudit({
        prisma,
        auditWriter: brokenWriter,
        action: 'ADMIN.TAXONOMY.DOMAIN_CREATED',
        work: (tx) =>
          tx.domain.create({
            data: { code: rollbackCode, name: `Test domain ${rollbackCode}`, isActive: true },
          }),
        audit: (domain) => ({
          action: 'ADMIN.TAXONOMY.DOMAIN_CREATED',
          entityType: 'Domain',
          entityId: domain.id,
          correlationId: CORRELATION,
          detail: {},
        }),
      }),
    ).rejects.toThrow('simulated audit insert failure');

    const domain = await prisma.domain.findUnique({ where: { code: rollbackCode } });
    expect(domain).toBeNull();
  });

  // -------------------------------------------------------------------------
  // The other direction: a failed transition leaves no audit record.
  // -------------------------------------------------------------------------

  it('leaves no audit event when the state change fails', async () => {
    await expect(
      transactWithAudit({
        prisma,
        auditWriter,
        action: 'ADMIN.TAXONOMY.DOMAIN_CREATED',
        work: async (tx) => {
          const domain = await tx.domain.create({
            data: { code: workFailCode, name: `Test domain ${workFailCode}`, isActive: true },
          });
          throw new Error('simulated transition failure');
          // eslint-disable-next-line no-unreachable
          return domain;
        },
        audit: (domain) => ({
          action: 'ADMIN.TAXONOMY.DOMAIN_CREATED',
          entityType: 'Domain',
          entityId: domain.id,
          correlationId: CORRELATION,
          detail: {},
        }),
      }),
    ).rejects.toThrow('simulated transition failure');

    expect(await prisma.domain.findUnique({ where: { code: workFailCode } })).toBeNull();
    const orphans = await prisma.auditEvent.findMany({
      where: { entityLabel: workFailCode },
    });
    expect(orphans).toHaveLength(0);
  });

  it('refuses a mismatch between the pre-validated action and the written one', async () => {
    await expect(
      transactWithAudit({
        prisma,
        auditWriter,
        action: 'ADMIN.TAXONOMY.DOMAIN_CREATED',
        work: (tx) =>
          tx.domain.create({
            data: { code: rollbackCode, name: `Test domain ${rollbackCode}`, isActive: true },
          }),
        audit: (domain) => ({
          // A different action than the one pre-validated.
          action: 'ADMIN.TAXONOMY.DOMAIN_UPDATED',
          entityType: 'Domain',
          entityId: domain.id,
          correlationId: CORRELATION,
          detail: {},
        }),
      }),
    ).rejects.toThrow(/Audit action mismatch/);

    expect(await prisma.domain.findUnique({ where: { code: rollbackCode } })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// I13 — audit_event is append-only, enforced in the database.
// ---------------------------------------------------------------------------

describeIfDb('audit_event append-only enforcement (I13)', () => {
  let prisma: PrismaClient;
  const auditWriter = createAuditWriter({ clock });
  let eventId: string | null = null;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: connectionString as string } } });
    const row = await auditWriter.write(prisma, {
      action: 'PLATFORM.JOB.SUCCEEDED',
      entityType: 'JobRun',
      entityId: 'append-only-probe',
      correlationId: CORRELATION,
      actorType: 'SYSTEM',
      detail: { jobType: 'probe' },
    });
    expect(row.action).toBe('PLATFORM.JOB.SUCCEEDED');
    const stored = await prisma.auditEvent.findFirst({
      where: { entityId: 'append-only-probe' },
      orderBy: { occurredAt: 'desc' },
    });
    eventId = stored?.id ?? null;
    expect(eventId).not.toBeNull();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('refuses an UPDATE', async () => {
    await expect(
      prisma.$executeRaw`UPDATE audit_event SET action = 'tampered' WHERE entity_id = 'append-only-probe'`,
    ).rejects.toThrow(/append-only/i);
  });

  it('refuses a DELETE', async () => {
    await expect(
      prisma.$executeRaw`DELETE FROM audit_event WHERE entity_id = 'append-only-probe'`,
    ).rejects.toThrow(/append-only/i);
  });
});
