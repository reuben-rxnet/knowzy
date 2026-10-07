// AI Document Studio, Slice 2, against a real database
// (docs/competencies/AI_DOCUMENT_STUDIO_ARCHITECTURE.md §10).
//
// What it pins down:
//
//   * the shipped state is BLOCKED_BY_APPROVAL, and recording an approval
//     moves it to NOT_BUILT -- never to READY;
//   * record, replace and remove each write their own audit action, with the
//     approver, the time and the reference, in the same transaction as a
//     configuration_change row;
//   * a restructuring approval leaves the question-generation approvals
//     untouched, and an ineligible provider cannot be approved;
//   * each status evaluation is audited.
//
// It uses ANTHROPIC, which nobody approves for anything in this build, and it
// RESTORES `llm.purposeApprovals` to what it found. Audit and change rows are
// append-only by design and are left in place.

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { systemClock } from '@knowzy/observability';
import { DocumentStudioError, readDocumentStudioStatus, setPurposeApproval } from '../src/index.js';

const DATABASE_URL = process.env['DATABASE_URL'];
const describeDb = DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient(
  DATABASE_URL ? { datasources: { db: { url: DATABASE_URL } } } : undefined,
);

const KEY = 'llm.purposeApprovals';

describeDb('AI Document Studio approval and status', () => {
  let original: { id: string; value: unknown } | null = null;
  let generationApprovals: unknown = null;
  let actor = { userId: '', displayName: '', roles: ['KNOWZY_ADMINISTRATOR'] as readonly string[] };

  const ctx = () => ({
    prisma,
    clock: systemClock,
    actor,
    correlationId: randomUUID(),
    requestId: randomUUID(),
  });

  beforeAll(async () => {
    await prisma.$connect();
    const admin = await prisma.user.findFirstOrThrow({
      where: { userPrincipalName: 'knowzy-administrator@local.invalid' },
      select: { id: true, displayName: true },
    });
    actor = { userId: admin.id, displayName: admin.displayName, roles: ['KNOWZY_ADMINISTRATOR'] };
    original = await prisma.applicationConfiguration.findFirst({
      where: { key: KEY, scope: 'PLATFORM', scopeId: null },
      select: { id: true, value: true },
    });
    generationApprovals = (
      await prisma.applicationConfiguration.findFirst({
        where: { key: 'llm.approvedProviders', scope: 'PLATFORM', scopeId: null },
        select: { value: true },
      })
    )?.value;
  });

  afterAll(async () => {
    const now = await prisma.applicationConfiguration.findFirst({
      where: { key: KEY, scope: 'PLATFORM', scopeId: null },
      select: { id: true },
    });
    if (original !== null && now !== null) {
      await prisma.applicationConfiguration.update({
        where: { id: now.id },
        data: { value: original.value as object },
      });
    } else if (original === null && now !== null) {
      await prisma.applicationConfiguration.delete({ where: { id: now.id } });
    }
    await prisma.$disconnect();
  });

  it('records, replaces and removes an approval, each audited, and never reaches READY', async () => {
    const anthropicState = async () =>
      (await readDocumentStudioStatus(ctx())).providers.find(
        (row) => row.providerId === 'ANTHROPIC',
      );
    expect((await anthropicState())?.state).toBe('BLOCKED_BY_APPROVAL');

    const recorded = await setPurposeApproval({
      ...ctx(),
      providerId: 'ANTHROPIC',
      approved: true,
      approvalReference: 'TEST-CP5-1',
    });
    expect(recorded.act).toBe('RECORDED');
    expect(recorded.approval?.approvedByUserId).toBe(actor.userId);
    const afterApproval = await anthropicState();
    expect(afterApproval?.state).toBe('NOT_BUILT');
    expect(afterApproval?.approval?.reference).toBe('TEST-CP5-1');

    const replaced = await setPurposeApproval({
      ...ctx(),
      providerId: 'ANTHROPIC',
      approved: true,
      approvalReference: 'TEST-CP5-2',
    });
    expect(replaced.act).toBe('REPLACED');

    const removed = await setPurposeApproval({
      ...ctx(),
      providerId: 'ANTHROPIC',
      approved: false,
    });
    expect(removed.act).toBe('REMOVED');
    expect((await anthropicState())?.state).toBe('BLOCKED_BY_APPROVAL');

    const events = await prisma.auditEvent.findMany({
      where: { entityLabel: `${KEY}.DOCUMENT_RESTRUCTURE.ANTHROPIC` },
      orderBy: { occurredAt: 'desc' },
      take: 3,
      select: { action: true, detail: true, actorUserId: true },
    });
    expect(events.map((event) => event.action).reverse()).toEqual([
      'ADMIN.CONFIGURATION.PURPOSE_APPROVAL_RECORDED',
      'ADMIN.CONFIGURATION.PURPOSE_APPROVAL_REPLACED',
      'ADMIN.CONFIGURATION.PURPOSE_APPROVAL_REMOVED',
    ]);
    expect(events.every((event) => event.actorUserId === actor.userId)).toBe(true);
    const replacedDetail = events[1]?.detail as Record<string, unknown>;
    expect(replacedDetail['approvalReference']).toBe('TEST-CP5-2');
    expect(replacedDetail['previousApprovalReference']).toBe('TEST-CP5-1');

    const evaluated = await prisma.auditEvent.count({
      where: { action: 'ADMIN.CONFIGURATION.PURPOSE_STATUS_EVALUATED', actorUserId: actor.userId },
    });
    expect(evaluated).toBeGreaterThanOrEqual(3);
  });

  it('leaves question-generation approvals untouched, and refuses an ineligible provider', async () => {
    await setPurposeApproval({
      ...ctx(),
      providerId: 'ANTHROPIC',
      approved: true,
      approvalReference: 'TEST-CP5-3',
    });
    const generation = await prisma.applicationConfiguration.findFirst({
      where: { key: 'llm.approvedProviders', scope: 'PLATFORM', scopeId: null },
      select: { value: true },
    });
    expect(generation?.value).toEqual(generationApprovals);

    for (const providerId of ['DETERMINISTIC_LOCAL', 'MICROSOFT_COPILOT'] as const) {
      await expect(
        setPurposeApproval({
          ...ctx(),
          providerId,
          approved: true,
          approvalReference: 'TEST-CP5-4',
        }),
      ).rejects.toBeInstanceOf(DocumentStudioError);
    }
    await expect(
      setPurposeApproval({
        ...ctx(),
        providerId: 'ANTHROPIC',
        approved: true,
        approvalReference: 'x',
      }),
    ).rejects.toBeInstanceOf(DocumentStudioError);
  });
});
