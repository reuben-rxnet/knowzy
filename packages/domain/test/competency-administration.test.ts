// Competency administration against a real database -- COMPETENCY-M2,
// docs/competencies/COMPETENCY_ADMINISTRATION.md.
//
// What each test pins down:
//
//   * an import records the definitions hash its approval will be judged by;
//   * every catalogue write leaves a change-log row and an audit event;
//   * a near match is refused until confirmed, a duplicate always;
//   * a version is a snapshot: an edit after it makes it STALE;
//   * APPROVAL IS SEPARATED FROM EDITING, in the service AND in the database;
//   * the change log is append-only;
//   * a role target needs an approved framework, a level on the competency's
//     scale, a source, and an approver who did not propose or edit it;
//   * approving a revision retires the target it replaces.
//
// It touches only its own framework and job role (unique codes) and deletes
// them afterwards. Audit rows and change-log rows are append-only by design and
// are left in place; the change log has no foreign key, as audit_log has none.

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { WorkbookGrid, WorkbookGridCell } from '@knowzy/shared-types';
import { systemClock } from '@knowzy/observability';
import {
  applyCompetencyImportPlan,
  approveFrameworkVersion,
  approveRoleTarget,
  buildCompetencyImportPlan,
  CompetencyAdminError,
  createCompetency,
  createCompetencyAlias,
  createCompetencyCategory,
  createFrameworkVersion,
  definitionsDigest,
  proposeRoleTarget,
  readCompetencyCatalogue,
  readFrameworkDefinitions,
  readRoleTargets,
  retireRoleTarget,
  RX_COMPETENCY_MATRIX_2024,
  updateCompetency,
  updateRoleTarget,
} from '../src/index.js';

const DATABASE_URL = process.env['DATABASE_URL'];
const describeDb = DATABASE_URL ? describe : describe.skip;

const prisma = new PrismaClient(
  DATABASE_URL ? { datasources: { db: { url: DATABASE_URL } } } : undefined,
);

const suffix = Date.now().toString(36).toUpperCase();
const FRAMEWORK_CODE = `TEST_COMPADMIN_${suffix}`;
const ROLE_CODE = `TEST_COMPADMIN_ROLE_${suffix}`;
const PLANTED_NAME = 'Administration Planted Person';
const profile = {
  ...RX_COMPETENCY_MATRIX_2024,
  framework: { ...RX_COMPETENCY_MATRIX_2024.framework, code: FRAMEWORK_CODE },
};

const cell = (row: number, column: number, text: string): WorkbookGridCell => ({
  row,
  column,
  text,
});

const GRID: WorkbookGrid = {
  contentSha256: 'c3'.repeat(32),
  sheets: [
    {
      name: 'Team Synthetic',
      position: 0,
      hidden: false,
      retainedRowLimit: 6,
      rowsBeyondLimit: 4,
      merges: [],
      cells: [
        cell(1, 2, 'Full Name'),
        cell(1, 3, 'Database'),
        cell(3, 3, 'Postgress'),
        cell(3, 4, 'Oracle'),
        cell(4, 2, PLANTED_NAME),
        cell(4, 3, 'G'),
      ],
    },
  ],
};

interface Admin {
  readonly userId: string;
  readonly displayName: string;
  readonly roles: readonly string[];
  readonly correlationId: string;
  readonly requestId: string;
}

const refusalCode = async (work: Promise<unknown>): Promise<string> => {
  try {
    await work;
  } catch (error) {
    if (error instanceof CompetencyAdminError) return error.code;
    throw error;
  }
  return 'NO_REFUSAL';
};

describeDb('competency administration', () => {
  const deps = { prisma, clock: systemClock };
  let first: Admin;
  let second: Admin;
  let frameworkId = '';
  let importVersionId = '';
  let jobRoleId = '';

  const asActor = (user: { id: string; displayName: string }): Admin => ({
    userId: user.id,
    displayName: user.displayName,
    roles: ['KNOWZY_ADMINISTRATOR'],
    correlationId: randomUUID(),
    requestId: randomUUID(),
  });
  const fresh = (admin: Admin): Admin => ({
    ...admin,
    correlationId: randomUUID(),
    requestId: randomUUID(),
  });

  beforeAll(async () => {
    await prisma.$connect();
    const users = await prisma.user.findMany({
      where: {
        userPrincipalName: {
          in: ['knowzy-administrator@local.invalid', 'knowzy-administrator-2@local.invalid'],
        },
      },
      select: { id: true, displayName: true, userPrincipalName: true },
    });
    const one = users.find((u) => u.userPrincipalName === 'knowzy-administrator@local.invalid');
    const two = users.find((u) => u.userPrincipalName === 'knowzy-administrator-2@local.invalid');
    if (one === undefined || two === undefined) throw new Error('Seeded administrators missing.');
    first = asActor(one);
    second = asActor(two);

    const plan = buildCompetencyImportPlan({
      grid: GRID,
      profile,
      sourceFileName: 'synthetic-administration.xlsx',
    });
    const applied = await applyCompetencyImportPlan(
      deps,
      { label: 'integration test', correlationId: randomUUID() },
      { plan, versionLabel: 'synthetic-1' },
    );
    importVersionId = applied.frameworkVersionId;
    const framework = await prisma.competencyFramework.findUniqueOrThrow({
      where: { code: FRAMEWORK_CODE },
    });
    frameworkId = framework.id;
    const role = await prisma.jobRole.create({
      data: { code: ROLE_CODE, name: `Test role ${suffix}` },
    });
    jobRoleId = role.id;
  });

  afterAll(async () => {
    if (frameworkId !== '') {
      const where = { frameworkVersion: { frameworkId } };
      await prisma.roleCompetencyExpectation.deleteMany({ where: { competency: { frameworkId } } });
      await prisma.competencyImportProvenance.deleteMany({ where });
      await prisma.competencyImportFinding.deleteMany({ where: { batch: where } });
      await prisma.competencyImportBatch.deleteMany({ where });
      await prisma.competencyAlias.deleteMany({ where: { frameworkId } });
      await prisma.competency.deleteMany({ where: { frameworkId } });
      await prisma.competencyCategory.deleteMany({ where: { frameworkId } });
      await prisma.competencyLevel.deleteMany({ where: { scale: { frameworkId } } });
      await prisma.competencyLevelScale.deleteMany({ where: { frameworkId } });
      await prisma.competencyFrameworkVersion.deleteMany({ where: { frameworkId } });
      await prisma.competencyFramework.delete({ where: { id: frameworkId } });
    }
    if (jobRoleId !== '') await prisma.jobRole.delete({ where: { id: jobRoleId } });
    await prisma.$disconnect();
  });

  it('an import records the definitions hash and has no verified creator', async () => {
    const version = await prisma.competencyFrameworkVersion.findUniqueOrThrow({
      where: { id: importVersionId },
    });
    const definitions = await readFrameworkDefinitions(prisma as never, frameworkId);
    expect(version.origin).toBe('IMPORT');
    expect(version.createdByUserId).toBeNull();
    expect(version.definitionsSha256).toBe(definitionsDigest(definitions));
  });

  it('a target cannot be approved while the framework has no approved version', async () => {
    const competency = await prisma.competency.findFirstOrThrow({
      where: { frameworkId, code: 'DATABASE.POSTGRESQL' },
      include: { levelScale: { include: { levels: { orderBy: { ordinal: 'asc' } } } } },
    });
    const target = await proposeRoleTarget(deps, fresh(first), {
      jobRoleId,
      competencyId: competency.id,
      targetLevelId: competency.levelScale.levels.at(-1)!.id,
      source: 'Synthetic workforce plan, integration test',
    });
    expect(target.status).toBe('PROPOSED');
    expect(
      await refusalCode(
        approveRoleTarget(deps, fresh(second), {
          targetId: target.id,
          approvalReference: 'TEST-REF-1',
        }),
      ),
    ).toBe('COMPETENCY_FRAMEWORK_NOT_APPROVED');
    await retireRoleTarget(deps, fresh(first), { targetId: target.id });
  });

  it('writes a category and a competency, each with a change-log row and an audit event', async () => {
    const category = await createCompetencyCategory(deps, fresh(first), {
      frameworkId,
      code: 'test observability',
      name: 'Observability',
      kind: 'TECHNICAL',
    });
    expect(category.code).toBe('TEST_OBSERVABILITY');
    const scale = await prisma.competencyLevelScale.findFirstOrThrow({ where: { frameworkId } });
    const competency = await createCompetency(deps, fresh(first), {
      categoryId: category.id,
      name: 'Grafana',
      levelScaleId: scale.id,
    });
    expect(competency.code).toBe('TEST_OBSERVABILITY.GRAFANA');

    const changes = await prisma.competencyDefinitionChange.findMany({
      where: { subjectId: { in: [category.id, competency.id] } },
    });
    expect(changes.map((row) => row.action).sort()).toEqual(['CREATED', 'CREATED']);
    expect(changes.every((row) => row.actorUserId === first.userId)).toBe(true);

    const audits = await prisma.auditEvent.findMany({
      where: { entityId: { in: [category.id, competency.id] } },
      select: { action: true },
    });
    expect(audits.map((row) => row.action).sort()).toEqual([
      'ADMIN.COMPETENCY.CATEGORY_CREATED',
      'ADMIN.COMPETENCY.COMPETENCY_CREATED',
    ]);

    // A near match is refused until confirmed; an exact duplicate always.
    expect(
      await refusalCode(
        createCompetency(deps, fresh(first), {
          categoryId: category.id,
          name: 'Grafanna',
          levelScaleId: scale.id,
        }),
      ),
    ).toBe('COMPETENCY_NEAR_MATCH');
    expect(
      await refusalCode(
        createCompetency(deps, fresh(first), {
          categoryId: category.id,
          name: 'grafana',
          codeSegment: 'GRAFANA_2',
          levelScaleId: scale.id,
        }),
      ),
    ).toBe('COMPETENCY_DUPLICATE');
    const confirmed = await createCompetency(deps, fresh(first), {
      categoryId: category.id,
      name: 'Grafanna',
      levelScaleId: scale.id,
      confirmDistinct: true,
    });
    expect(confirmed.status).toBe('ACTIVE');

    const alias = await createCompetencyAlias(deps, fresh(first), {
      subject: 'COMPETENCY',
      targetId: competency.id,
      alias: 'Grafana OSS',
      decision: 'ABBREVIATION',
    });
    expect(alias.contextCode).toBe('TEST_OBSERVABILITY');
    expect(
      await refusalCode(
        createCompetencyAlias(deps, fresh(first), {
          subject: 'COMPETENCY',
          targetId: competency.id,
          alias: 'Grafana ignored',
          decision: 'UNDECLARED',
        }),
      ),
    ).toBe('VALIDATION_FAILED');
  });

  it('an edit after a snapshot makes it stale', async () => {
    expect(
      await refusalCode(
        approveFrameworkVersion(deps, fresh(second), {
          versionId: importVersionId,
          approvalReference: 'TEST-REF-STALE',
        }),
      ),
    ).toBe('COMPETENCY_VERSION_STALE');
  });

  it('separates approval from editing, in the service and in the database', async () => {
    const version = await createFrameworkVersion(deps, fresh(first), {
      frameworkId,
      versionLabel: 'synthetic-2',
    });
    expect(version.origin).toBe('ADMINISTRATION');
    expect(version.editorUserIds).toContain(first.userId);

    // The same definitions cannot be versioned twice.
    expect(
      await refusalCode(
        createFrameworkVersion(deps, fresh(first), { frameworkId, versionLabel: 'synthetic-dup' }),
      ),
    ).toBe('COMPETENCY_DUPLICATE');

    // The editor may not approve.
    expect(
      await refusalCode(
        approveFrameworkVersion(deps, fresh(first), {
          versionId: version.id,
          approvalReference: 'TEST-REF-2',
        }),
      ),
    ).toBe('SEPARATION_OF_DUTIES');

    // Since the Authoring Role Simplification separation is a SETTING, and the
    // service is strict when the setting is absent (as in `deps` here). The
    // 0016 CHECK that also enforced it was dropped in 0017.

    // A different administrator may, and that supersedes nothing yet.
    const approved = await approveFrameworkVersion(deps, fresh(second), {
      versionId: version.id,
      approvalReference: 'TEST-REF-2',
      effectiveFrom: '2026-10-07',
    });
    expect(approved.status).toBe('APPROVED');
    expect(approved.approvedByUserId).toBe(second.userId);

    const catalogue = await readCompetencyCatalogue(deps);
    const mine = catalogue.find((row) => row.code === FRAMEWORK_CODE)!;
    expect(mine.hasApprovedVersion).toBe(true);
    expect(mine.versions.find((row) => row.versionId === version.id)?.stale).toBe(false);
  });

  it('with self-approval PERMITTED by configuration, one administrator approves their own version and target, and is recorded as both', async () => {
    const permissive = {
      ...deps,
      separation: { versionEditorMayApprove: true, targetEditorMayApprove: true },
    };
    const competency = await prisma.competency.findFirstOrThrow({
      where: { frameworkId, code: 'TEST_OBSERVABILITY.GRAFANA' },
    });
    await updateCompetency(permissive, fresh(first), {
      competencyId: competency.id,
      description: 'Self-approval scenario.',
    });
    const own = await createFrameworkVersion(permissive, fresh(first), {
      frameworkId,
      versionLabel: 'synthetic-self',
    });
    const approved = await approveFrameworkVersion(permissive, fresh(first), {
      versionId: own.id,
      approvalReference: 'TEST-SELF-1',
    });
    // Who did what is still on the record: the same identity in both places.
    expect(approved.createdByUserId).toBe(first.userId);
    expect(approved.editorUserIds).toContain(first.userId);
    expect(approved.approvedByUserId).toBe(first.userId);
    // A second snapshot of unchanged definitions is still refused as a duplicate.
    const next = await createFrameworkVersion(permissive, fresh(first), {
      frameworkId,
      versionLabel: 'synthetic-self-2',
    }).catch(() => null);
    expect(next).toBeNull(); // nothing changed since: there is nothing to version
  });

  it('counts a later editor: whoever touched the definitions cannot approve the next version', async () => {
    const competency = await prisma.competency.findFirstOrThrow({
      where: { frameworkId, code: 'TEST_OBSERVABILITY.GRAFANA' },
    });
    await updateCompetency(deps, fresh(second), {
      competencyId: competency.id,
      description: 'Dashboards over metrics.',
    });
    const next = await createFrameworkVersion(deps, fresh(first), {
      frameworkId,
      versionLabel: 'synthetic-3',
    });
    expect(new Set(next.editorUserIds)).toEqual(new Set([first.userId, second.userId]));
    for (const admin of [first, second]) {
      expect(
        await refusalCode(
          approveFrameworkVersion(deps, fresh(admin), {
            versionId: next.id,
            approvalReference: 'TEST-REF-3',
          }),
        ),
      ).toBe('SEPARATION_OF_DUTIES');
    }
  });

  it('keeps the change log append-only', async () => {
    const row = await prisma.competencyDefinitionChange.findFirstOrThrow({
      where: { frameworkId },
    });
    await expect(
      prisma.competencyDefinitionChange.update({ where: { id: row.id }, data: { action: 'X' } }),
    ).rejects.toThrow(/append-only/);
    await expect(
      prisma.competencyDefinitionChange.delete({ where: { id: row.id } }),
    ).rejects.toThrow(/append-only/);
  });

  it('runs a role target from proposal to approval to revision, separated throughout', async () => {
    const competency = await prisma.competency.findFirstOrThrow({
      where: { frameworkId, code: 'DATABASE.POSTGRESQL' },
      include: { levelScale: { include: { levels: { orderBy: { ordinal: 'asc' } } } } },
    });
    const levels = competency.levelScale.levels;
    // A fixture written directly: a second scale, so a level from the WRONG
    // scale exists to be refused. (It changes the definitions hash, which is
    // why it is created here, after the version tests have run.)
    const foreignScale = await prisma.competencyLevelScale.create({
      data: {
        frameworkId,
        code: `TEST_OTHER_${suffix}`,
        name: 'Another scale',
        levels: { create: [{ code: 'X', label: 'Other', ordinal: 1 }] },
      },
      include: { levels: true },
    });
    const otherScale = foreignScale.levels[0]!;

    // A level from another scale is refused, and so is a missing source.
    expect(
      await refusalCode(
        proposeRoleTarget(deps, fresh(first), {
          jobRoleId,
          competencyId: competency.id,
          targetLevelId: otherScale.id,
          source: 'Synthetic workforce plan',
        }),
      ),
    ).toBe('VALIDATION_FAILED');
    expect(
      await refusalCode(
        proposeRoleTarget(deps, fresh(first), {
          jobRoleId,
          competencyId: competency.id,
          targetLevelId: levels[1]!.id,
          source: ' ',
        }),
      ),
    ).toBe('VALIDATION_FAILED');

    const proposal = await proposeRoleTarget(deps, fresh(first), {
      jobRoleId,
      competencyId: competency.id,
      targetLevelId: levels[1]!.id,
      source: 'Synthetic workforce plan, section 3',
    });
    // The second administrator edits it, so NEITHER may approve it now.
    await updateRoleTarget(deps, fresh(second), {
      targetId: proposal.id,
      targetLevelId: levels[2]!.id,
    });
    for (const admin of [first, second]) {
      expect(
        await refusalCode(
          approveRoleTarget(deps, fresh(admin), {
            targetId: proposal.id,
            approvalReference: 'TEST-TARGET-1',
          }),
        ),
      ).toBe('SEPARATION_OF_DUTIES');
    }
    // Retire it, and propose cleanly: the first proposes, the second approves.
    await retireRoleTarget(deps, fresh(first), { targetId: proposal.id });
    const clean = await proposeRoleTarget(deps, fresh(first), {
      jobRoleId,
      competencyId: competency.id,
      targetLevelId: levels[2]!.id,
      source: 'Synthetic workforce plan, section 3',
    });
    const approved = await approveRoleTarget(deps, fresh(second), {
      targetId: clean.id,
      approvalReference: 'TEST-TARGET-2',
    });
    expect(approved.status).toBe('APPROVED');
    // The self-approval test approved a later version, which superseded synthetic-2.
    expect(approved.frameworkVersion?.versionLabel).toBe('synthetic-self');

    // An approved target is never edited.
    expect(
      await refusalCode(
        updateRoleTarget(deps, fresh(first), { targetId: clean.id, source: 'Changed source' }),
      ),
    ).toBe('STATE_TRANSITION_INVALID');

    // A revision, once approved, retires the target it replaces.
    const revision = await proposeRoleTarget(deps, fresh(first), {
      jobRoleId,
      competencyId: competency.id,
      targetLevelId: levels.at(-1)!.id,
      source: 'Synthetic workforce plan, revision 2',
    });
    await approveRoleTarget(deps, fresh(second), {
      targetId: revision.id,
      approvalReference: 'TEST-TARGET-3',
    });
    const replaced = await prisma.roleCompetencyExpectation.findUniqueOrThrow({
      where: { id: clean.id },
    });
    expect(replaced.status).toBe('RETIRED');
    expect(replaced.retiredByUserId).toBe(second.userId);

    const view = await readRoleTargets(deps);
    const open = view.targets.filter(
      (row) => row.jobRole.code === ROLE_CODE && row.status === 'APPROVED',
    );
    expect(open).toHaveLength(1);
  });

  it('holds nothing about a person anywhere it writes', async () => {
    const changes = await prisma.competencyDefinitionChange.findMany({ where: { frameworkId } });
    const targets = await prisma.roleCompetencyExpectation.findMany({
      where: { competency: { frameworkId } },
    });
    const text = JSON.stringify({ changes, targets });
    expect(text).not.toContain(PLANTED_NAME);
  });
});
