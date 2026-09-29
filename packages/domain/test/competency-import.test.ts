// Applying a structure-only competency import, against a real database —
// docs/competencies/COMPETENCY_IMPORT_PLAN.md §6.
//
// What each test pins down:
//
//   * apply writes the definitions, their aliases and their provenance, and
//     one audit event, in one transaction;
//   * a SECOND apply of the same file creates nothing and records NO_CHANGES;
//   * a plan with a blocking finding is refused before any write;
//   * a version label names one file: another file under it is refused;
//   * nothing person-level exists anywhere it could have been written.
//
// It touches only its own framework (a unique code) and deletes it afterwards.
// Audit rows are append-only by design and are left in place.

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { WorkbookGrid, WorkbookGridCell } from '@knowzy/shared-types';
import { systemClock } from '@knowzy/observability';
import {
  applyCompetencyImportPlan,
  buildCompetencyImportPlan,
  CompetencyImportError,
  RX_COMPETENCY_MATRIX_2024,
  type CompetencyImportPlan,
} from '../src/index.js';

const DATABASE_URL = process.env['DATABASE_URL'];
const describeDb = DATABASE_URL ? describe : describe.skip;

const prisma = new PrismaClient(
  DATABASE_URL ? { datasources: { db: { url: DATABASE_URL } } } : undefined,
);

const suffix = Date.now().toString(36).toUpperCase();
const FRAMEWORK_CODE = `TEST_COMPETENCY_${suffix}`;
const profile = {
  ...RX_COMPETENCY_MATRIX_2024,
  framework: { ...RX_COMPETENCY_MATRIX_2024.framework, code: FRAMEWORK_CODE },
};

const PLANTED_NAME = 'Integration Planted Person';

const cell = (row: number, column: number, text: string): WorkbookGridCell => ({
  row,
  column,
  text,
});

const gridOf = (hash: string, extraHeader: string | null = null): WorkbookGrid => ({
  contentSha256: hash,
  sheets: [
    {
      name: 'Team Synthetic',
      position: 0,
      hidden: false,
      retainedRowLimit: 6,
      rowsBeyondLimit: 12,
      merges: [{ firstRow: 2, firstColumn: 3, lastRow: 2, lastColumn: 5 }],
      cells: [
        cell(1, 2, 'Full Name'),
        cell(1, 3, 'Database'),
        cell(1, 6, 'Power Skills'),
        cell(3, 3, 'Postgress'),
        cell(3, 4, 'Oracle'),
        cell(3, 5, extraHeader ?? 'MySQL'),
        cell(3, 6, 'Leadership'),
        cell(4, 2, PLANTED_NAME),
        cell(4, 3, 'G'),
      ],
    },
    {
      name: 'DB',
      position: 1,
      hidden: false,
      retainedRowLimit: 6,
      rowsBeyondLimit: 0,
      merges: [],
      cells: [cell(3, 1, 'Limited competency'), cell(4, 1, 'Competent')],
    },
  ],
});

const planOf = (grid: WorkbookGrid): CompetencyImportPlan =>
  buildCompetencyImportPlan({ grid, profile, sourceFileName: 'synthetic-integration.xlsx' });

describeDb('competency import apply', () => {
  const deps = { prisma, clock: systemClock };
  const actor = (): { label: string; correlationId: string } => ({
    label: 'integration test',
    correlationId: randomUUID(),
  });
  const HASH_A = 'a1'.repeat(32);
  const HASH_B = 'b2'.repeat(32);

  const counts = async () => {
    const framework = await prisma.competencyFramework.findUnique({
      where: { code: FRAMEWORK_CODE },
    });
    if (framework === null) return null;
    const frameworkId = framework.id;
    return {
      versions: await prisma.competencyFrameworkVersion.count({ where: { frameworkId } }),
      categories: await prisma.competencyCategory.count({ where: { frameworkId } }),
      competencies: await prisma.competency.count({ where: { frameworkId } }),
      aliases: await prisma.competencyAlias.count({ where: { frameworkId } }),
      scales: await prisma.competencyLevelScale.count({ where: { frameworkId } }),
      provenance: await prisma.competencyImportProvenance.count({
        where: { frameworkVersion: { frameworkId } },
      }),
    };
  };

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    const framework = await prisma.competencyFramework.findUnique({
      where: { code: FRAMEWORK_CODE },
    });
    if (framework !== null) {
      const where = { frameworkVersion: { frameworkId: framework.id } };
      await prisma.competencyImportProvenance.deleteMany({ where });
      await prisma.competencyImportFinding.deleteMany({ where: { batch: where } });
      await prisma.competencyImportBatch.deleteMany({ where });
      await prisma.competencyAlias.deleteMany({ where: { frameworkId: framework.id } });
      await prisma.competency.deleteMany({ where: { frameworkId: framework.id } });
      await prisma.competencyCategory.deleteMany({ where: { frameworkId: framework.id } });
      await prisma.competencyLevel.deleteMany({ where: { scale: { frameworkId: framework.id } } });
      await prisma.competencyLevelScale.deleteMany({ where: { frameworkId: framework.id } });
      await prisma.competencyFrameworkVersion.deleteMany({ where: { frameworkId: framework.id } });
      await prisma.competencyFramework.delete({ where: { id: framework.id } });
    }
    await prisma.$disconnect();
  });

  it('applies definitions, aliases and provenance, with one audit event', async () => {
    const correlation = actor();
    const result = await applyCompetencyImportPlan(deps, correlation, {
      plan: planOf(gridOf(HASH_A)),
      versionLabel: '2024-05',
    });
    expect(result.outcome).toBe('APPLIED');
    expect(result.created).toMatchObject({
      framework: 1,
      version: 1,
      scales: 1,
      levels: 4,
      categories: 2,
    });
    expect(result.created.competencies).toBe(4); // PostgreSQL, Oracle Database, MySQL, Leadership

    const postgres = await prisma.competency.findFirst({
      where: { code: 'DATABASE.POSTGRESQL', framework: { code: FRAMEWORK_CODE } },
      include: { aliases: true, provenance: true, levelScale: true },
    });
    expect(postgres?.name).toBe('PostgreSQL');
    expect(postgres?.aliases.map((alias) => [alias.alias, alias.decision])).toEqual([
      ['Postgress', 'SPELLING_CORRECTION'],
    ]);
    expect(postgres?.provenance.map((ref) => [ref.sheetName, ref.cellReference])).toEqual([
      ['Team Synthetic', 'C3'],
    ]);
    expect(postgres?.levelScale.code).toBe('NI_R_A_G');

    const version = await prisma.competencyFrameworkVersion.findUniqueOrThrow({
      where: { id: result.frameworkVersionId },
    });
    expect(version.status).toBe('DRAFT'); // approval is a separate, recorded act

    const limited = await prisma.competencyLevel.findFirst({
      where: { code: 'R', scale: { framework: { code: FRAMEWORK_CODE } } },
    });
    expect(limited?.sourceLabels).toEqual(['Limited involvement', 'Limited competency']);

    const events = await prisma.auditEvent.findMany({
      where: { correlationId: correlation.correlationId },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe('ADMIN.COMPETENCY.IMPORT_APPLIED');
    expect(events[0]?.actorType).toBe('SYSTEM');
    expect(events[0]?.detail).toMatchObject({
      outcome: 'APPLIED',
      competenciesCreated: 4,
      personRowsSkipped: 13,
    });
    expect(JSON.stringify(events[0]?.detail)).not.toContain('_droppedKeys');
  });

  it('creates nothing on a second apply of the same file, and records NO_CHANGES', async () => {
    const before = await counts();
    const result = await applyCompetencyImportPlan(deps, actor(), {
      plan: planOf(gridOf(HASH_A)),
      versionLabel: '2024-05',
    });
    expect(result.outcome).toBe('NO_CHANGES');
    expect(Object.values(result.created).every((value) => value === 0)).toBe(true);
    expect(await counts()).toEqual(before);
    expect(
      await prisma.competencyImportBatch.count({
        where: { frameworkVersionId: result.frameworkVersionId },
      }),
    ).toBe(2);
  });

  it('refuses a different file under a version label already used', async () => {
    await expect(
      applyCompetencyImportPlan(deps, actor(), {
        plan: planOf(gridOf(HASH_B)),
        versionLabel: '2024-05',
      }),
    ).rejects.toMatchObject({ code: 'COMPETENCY_VERSION_LABEL_TAKEN' });
  });

  it('refuses a plan with a blocking finding before writing anything', async () => {
    const before = await counts();
    const plan = planOf(gridOf(HASH_B, 'MySQLL')); // an undeclared near match
    expect(plan.summary.blocking).toBeGreaterThan(0);
    await expect(
      applyCompetencyImportPlan(deps, actor(), { plan, versionLabel: '2024-06' }),
    ).rejects.toBeInstanceOf(CompetencyImportError);
    expect(await counts()).toEqual(before);
  });

  it('adds a new version for a new file and re-uses every definition it shares', async () => {
    const before = await counts();
    const result = await applyCompetencyImportPlan(deps, actor(), {
      plan: planOf(gridOf(HASH_B, 'Greenplum')),
      versionLabel: '2024-06',
    });
    expect(result.outcome).toBe('APPLIED');
    expect(result.created).toMatchObject({
      framework: 0,
      version: 1,
      competencies: 1,
      categories: 0,
    });
    const after = await counts();
    expect(after?.versions).toBe((before?.versions ?? 0) + 1);
    expect(after?.competencies).toBe((before?.competencies ?? 0) + 1);
  });

  it('wrote nothing person-level anywhere', async () => {
    const framework = await prisma.competencyFramework.findUniqueOrThrow({
      where: { code: FRAMEWORK_CODE },
    });
    const everything = JSON.stringify([
      await prisma.competencyImportFinding.findMany({
        where: { batch: { frameworkVersion: { frameworkId: framework.id } } },
      }),
      await prisma.competencyImportProvenance.findMany({
        where: { frameworkVersion: { frameworkId: framework.id } },
      }),
      await prisma.competencyImportBatch.findMany({
        where: { frameworkVersion: { frameworkId: framework.id } },
      }),
      await prisma.competencyAlias.findMany({ where: { frameworkId: framework.id } }),
    ]);
    expect(everything).not.toContain(PLANTED_NAME);
    expect(
      await prisma.roleCompetencyExpectation.count({
        where: { competency: { frameworkId: framework.id } },
      }),
    ).toBe(0);
  });
});
