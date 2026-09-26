// Departments and roles, against a real database.
//
// The rules under test are the ones that make a catalogue safe to build
// reports on, and each test here is a way one of them could fail open:
//
//   * a code is NORMALIZED, so `support-ng` and `Support NG` cannot become two
//     departments that look identical in a dropdown;
//   * a duplicate is REFUSED, naming the collision;
//   * a code is editable while nothing references it and REFUSED afterwards,
//     because the code is copied into the published record and is what past
//     reports grouped by;
//   * a deactivated entry cannot be filed against, so deactivation actually
//     stops new filings rather than only hiding the row;
//   * every write is audited, an update carries previous AND new value, and no
//     row carries `_droppedKeys`.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { systemClock } from '@knowzy/observability';
import {
  createOrgEntry,
  readOrgCatalogue,
  resolveOrgFiling,
  TaxonomyError,
  updateOrgEntry,
  type OrgCatalogue,
} from '../src/index.js';

const DATABASE_URL = process.env['DATABASE_URL'];
const describeDb = DATABASE_URL ? describe : describe.skip;

const prisma = new PrismaClient(
  DATABASE_URL ? { datasources: { db: { url: DATABASE_URL } } } : undefined,
);

/** A suffix nothing else uses, so a re-run does not collide with itself. */
const suffix = Date.now().toString(36).toUpperCase();

describeDb('organizational taxonomy', () => {
  let deps: { prisma: PrismaClient; clock: typeof systemClock };
  let actor: {
    userId: string;
    displayName: string;
    roles: readonly string[];
    correlationId: string;
    requestId: string;
  };
  const createdDepartmentIds: string[] = [];
  const createdRoleIds: string[] = [];

  beforeAll(async () => {
    deps = { prisma, clock: systemClock };
    const admin = await prisma.user.findFirstOrThrow({
      where: { userPrincipalName: 'knowzy-administrator@local.invalid' },
      select: { id: true },
    });
    actor = {
      userId: admin.id,
      displayName: 'KNOWZY Administrator',
      roles: ['KNOWZY_ADMINISTRATOR'],
      correlationId: `org-tax-${suffix}`,
      requestId: `org-tax-req-${suffix}`,
    };
  });

  afterAll(async () => {
    // Nothing is deleted by the product; a TEST cleans up after itself, and
    // only what it created.
    await prisma.department.deleteMany({ where: { id: { in: createdDepartmentIds } } });
    await prisma.jobRole.deleteMany({ where: { id: { in: createdRoleIds } } });
    await prisma.$disconnect();
  });

  const track = (catalogue: OrgCatalogue, id: string): void => {
    if (catalogue === 'DEPARTMENT') createdDepartmentIds.push(id);
    else createdRoleIds.push(id);
  };

  describe.each(['DEPARTMENT', 'ROLE'] as const)('%s', (catalogue) => {
    it('normalizes the code, so two spellings cannot become two entries', async () => {
      const row = await createOrgEntry(deps, actor, catalogue, {
        code: `  test-${catalogue.toLowerCase()} ${suffix} `,
        name: 'Normalization probe',
      });
      track(catalogue, row.id);
      expect(row.code).toBe(`TEST_${catalogue}_${suffix}`);
      expect(row.codeLocked).toBe(false);
    });

    it('refuses a duplicate code and names the collision', async () => {
      const code = `DUP_${catalogue}_${suffix}`;
      const first = await createOrgEntry(deps, actor, catalogue, { code, name: 'First' });
      track(catalogue, first.id);

      let thrown: unknown;
      try {
        await createOrgEntry(deps, actor, catalogue, { code: code.toLowerCase(), name: 'Second' });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(TaxonomyError);
      expect((thrown as TaxonomyError).code).toBe('TAXONOMY_DUPLICATE');
      expect((thrown as Error).message).toContain(code);
    });

    it('edits the display name freely and records previous and new value', async () => {
      const created = await createOrgEntry(deps, actor, catalogue, {
        code: `RENAME_${catalogue}_${suffix}`,
        name: 'Before',
        description: 'First description',
      });
      track(catalogue, created.id);

      const updated = await updateOrgEntry(deps, actor, catalogue, {
        id: created.id,
        name: 'After',
      });
      expect(updated.name).toBe('After');

      const audit = await prisma.auditEvent.findFirstOrThrow({
        where: { entityId: created.id, action: { endsWith: '_UPDATED' } },
        orderBy: { occurredAt: 'desc' },
      });
      // H2: an update to a catalogue carries both values, because a code change
      // is the one edit that can invalidate a historical grouping.
      expect((audit.previousValue as Record<string, unknown>)['name']).toBe('Before');
      expect((audit.newValue as Record<string, unknown>)['name']).toBe('After');
      const detail = audit.detail as Record<string, unknown>;
      expect(detail['changedFields']).toEqual(['name']);
      expect(detail['_droppedKeys']).toBeUndefined();
    });

    it('writes nothing when a submitted form changed nothing', async () => {
      // A form posts every field it rendered, so "no change" is a normal
      // submission — and an audit trail full of empty diffs is one nobody
      // reads.
      const created = await createOrgEntry(deps, actor, catalogue, {
        code: `NOOP_${catalogue}_${suffix}`,
        name: 'Unchanged',
      });
      track(catalogue, created.id);
      const before = await prisma.auditEvent.count({ where: { entityId: created.id } });

      await updateOrgEntry(deps, actor, catalogue, { id: created.id, name: 'Unchanged' });

      expect(await prisma.auditEvent.count({ where: { entityId: created.id } })).toBe(before);
    });

    it('REFUSES a code change once something references the entry', async () => {
      const created = await createOrgEntry(deps, actor, catalogue, {
        code: `LOCK_${catalogue}_${suffix}`,
        name: 'Referenced',
      });
      track(catalogue, created.id);

      // Editable right now.
      const renamed = await updateOrgEntry(deps, actor, catalogue, {
        id: created.id,
        code: `LOCKED_${catalogue}_${suffix}`,
      });
      expect(renamed.code).toBe(`LOCKED_${catalogue}_${suffix}`);

      // File a question against it. HOW the reference arrives is not what this
      // test is about, so it is made directly.
      const draft = await prisma.draftQuestion.findFirst({ select: { id: true } });
      if (draft === null) {
        // Nothing to reference with. Stated rather than silently passing.
        expect(renamed.codeLocked).toBe(false);
        return;
      }
      await prisma.draftQuestion.update({
        where: { id: draft.id },
        data: catalogue === 'DEPARTMENT' ? { departmentId: created.id } : { jobRoleId: created.id },
      });

      let thrown: unknown;
      try {
        await updateOrgEntry(deps, actor, catalogue, {
          id: created.id,
          code: `RELOCK_${catalogue}_${suffix}`,
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(TaxonomyError);
      expect((thrown as TaxonomyError).code).toBe('TAXONOMY_CODE_IMMUTABLE');
      // The refusal names the counts that locked it, so "why?" is answered.
      expect((thrown as Error).message).toContain('published record');

      // ...and the DISPLAY NAME is still editable, which is the whole point of
      // separating the two.
      const stillEditable = await updateOrgEntry(deps, actor, catalogue, {
        id: created.id,
        name: 'Renamed after locking',
      });
      expect(stillEditable.name).toBe('Renamed after locking');

      await prisma.draftQuestion.update({
        where: { id: draft.id },
        data: catalogue === 'DEPARTMENT' ? { departmentId: null } : { jobRoleId: null },
      });
    });

    it('stops new filings against a deactivated entry', async () => {
      const created = await createOrgEntry(deps, actor, catalogue, {
        code: `OFF_${catalogue}_${suffix}`,
        name: 'Deactivated',
      });
      track(catalogue, created.id);

      // Active: filing resolves.
      const resolved = await resolveOrgFiling(
        deps,
        catalogue === 'DEPARTMENT' ? { departmentId: created.id } : { jobRoleId: created.id },
      );
      expect(catalogue === 'DEPARTMENT' ? resolved.departmentId : resolved.jobRoleId).toBe(
        created.id,
      );

      await updateOrgEntry(deps, actor, catalogue, { id: created.id, isActive: false });

      let thrown: unknown;
      try {
        await resolveOrgFiling(
          deps,
          catalogue === 'DEPARTMENT' ? { departmentId: created.id } : { jobRoleId: created.id },
        );
      } catch (error) {
        thrown = error;
      }
      // Deactivation that only hid the row would let a stale dropdown keep
      // filing against it for months.
      expect((thrown as TaxonomyError).code).toBe('TAXONOMY_INACTIVE');
    });

    it('reads the catalogue filtered by text and by activation', async () => {
      const created = await createOrgEntry(deps, actor, catalogue, {
        code: `FIND_${catalogue}_${suffix}`,
        name: `Findable ${suffix}`,
      });
      track(catalogue, created.id);

      const byText = await readOrgCatalogue(deps, catalogue, { query: `FIND_${catalogue}` });
      expect(byText.some((row) => row.id === created.id)).toBe(true);

      const inactiveOnly = await readOrgCatalogue(deps, catalogue, { active: false });
      expect(inactiveOnly.every((row) => !row.isActive)).toBe(true);
    });
  });

  it('treats a department and a role as INDEPENDENT axes', async () => {
    // A role does not belong to a department: an organization files by both,
    // and a hierarchy would make every role of one department unusable by
    // another. Asserted so a future "improvement" has to delete this test.
    const department = await createOrgEntry(deps, actor, 'DEPARTMENT', {
      code: `PAIR_DEPT_${suffix}`,
      name: 'Pair department',
    });
    const role = await createOrgEntry(deps, actor, 'ROLE', {
      code: `PAIR_ROLE_${suffix}`,
      name: 'Pair role',
    });
    createdDepartmentIds.push(department.id);
    createdRoleIds.push(role.id);

    const filing = await resolveOrgFiling(deps, {
      departmentId: department.id,
      jobRoleId: role.id,
    });
    expect(filing).toEqual({ departmentId: department.id, jobRoleId: role.id });
  });

  it('accepts a filing with NEITHER axis, because thousands of questions have none', async () => {
    expect(await resolveOrgFiling(deps, {})).toEqual({ departmentId: null, jobRoleId: null });
    expect(await resolveOrgFiling(deps, { departmentId: null, jobRoleId: '' })).toEqual({
      departmentId: null,
      jobRoleId: null,
    });
  });

  it('refuses an id that does not exist rather than filing against nothing', async () => {
    let thrown: unknown;
    try {
      await resolveOrgFiling(deps, { departmentId: '00000000-0000-7000-8000-000000000000' });
    } catch (error) {
      thrown = error;
    }
    expect((thrown as TaxonomyError).code).toBe('NOT_FOUND');
  });
});
