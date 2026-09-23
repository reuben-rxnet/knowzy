// Source workflow administration, against a real database — SYNC-M2.
//
// The unit tests cover path validation. What needs a database is everything
// that depends on state: the duplicate name, the lineage guard, the activation
// pair, the audit rows, and the schedule round-trip.
//
// Each refusal is made to FIRE from a passing baseline, because a suite where
// the creates succeed proves creates work and says nothing about the five
// rules that are supposed to stop them.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { systemClock } from '@knowzy/observability';
import {
  addSourcePath,
  createSource,
  hasLineage,
  lineageOf,
  modifySourcePath,
  retireSource,
  scheduleOf,
  setSourceActive,
  updateSource,
  SourceAdminError,
  type SourceActor,
  type SourceAdminDeps,
} from '../src/index.js';

const DATABASE_URL = process.env['DATABASE_URL'];
const describeDb = DATABASE_URL ? describe : describe.skip;

const prisma = new PrismaClient(
  DATABASE_URL ? { datasources: { db: { url: DATABASE_URL } } } : undefined,
);

/** A prefix nothing else uses, so cleanup is exact. */
const PREFIX = 'ZZSYNC';
const ROOT = process.platform === 'win32' ? 'C:/knowzy-test-roots' : '/knowzy-test-roots';

describeDb('source workflow administration', () => {
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
      correlationId: 'sync-admin-test',
      requestId: 'sync-admin-request',
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
      await prisma.knowledgeSourcePath.deleteMany({ where: { sourceId: source.id } });
      await prisma.knowledgeSource.deleteMany({ where: { id: source.id } });
    }
  });

  afterAll(async () => {
    for (const sourceId of created) {
      await prisma.knowledgeSourcePath.deleteMany({ where: { sourceId } });
      await prisma.knowledgeSourceSync.deleteMany({ where: { sourceId } });
      await prisma.knowledgeSource.deleteMany({ where: { id: sourceId } });
    }
    await prisma.$disconnect();
  });

  const newSource = async (suffix: string, overrides: Record<string, unknown> = {}) => {
    const source = await createSource(deps, actor, {
      name: `${PREFIX} ${suffix}`,
      sourceType: 'FILE_REPOSITORY',
      localRoot: `${ROOT}/${suffix}`,
      ...overrides,
    });
    created.push(source.sourceId);
    return source;
  };

  describe('creating a workflow', () => {
    it('creates it INACTIVE and UNTESTED, and stores the validated root', async () => {
      const source = await newSource('CREATE');
      expect(source.isActive).toBe(false);
      expect(source.schedule.mode).toBe('MANUAL');

      const row = await prisma.knowledgeSource.findUniqueOrThrow({
        where: { id: source.sourceId },
        select: { connectionStatus: true, connection: true, permissionMode: true },
      });
      // Inactive until tested, like the seed: an untested source that is
      // already live invites a first sync nobody asked for.
      expect(row.connectionStatus).toBe('UNTESTED');
      expect((row.connection as { localRoot?: string }).localRoot).toBe(`${ROOT}/CREATE`);
    });

    it('audits the creation with the adapter type and schedule mode', async () => {
      const source = await newSource('AUDITED', { schedule: { mode: 'DAILY', timezone: 'UTC' } });
      const event = await prisma.auditEvent.findFirst({
        where: { action: 'ADMIN.SOURCE.CREATED', entityId: source.sourceId },
        orderBy: { occurredAt: 'desc' },
      });
      expect(event).not.toBeNull();
      const detail = event?.detail as Record<string, unknown>;
      expect(detail['sourceType']).toBe('FILE_REPOSITORY');
      expect(detail['scheduleMode']).toBe('DAILY');
      // A dropped key would arrive here instead of the value.
      expect(detail['_droppedKeys']).toBeUndefined();
    });

    it('REFUSES an adapter type with no registered adapter', async () => {
      // SharePoint today. A source of an unregistered type could never
      // synchronize, and the failure would read as a connection problem.
      let thrown: unknown;
      try {
        await createSource(deps, actor, {
          name: `${PREFIX} SHAREPOINT`,
          sourceType: 'SHAREPOINT',
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(SourceAdminError);
      expect((thrown as SourceAdminError).code).toBe('SOURCE_TYPE_NOT_AVAILABLE');
      expect((thrown as Error).message).toContain('FILE_REPOSITORY');
    });

    it('REFUSES a root outside the allow-list', async () => {
      let thrown: unknown;
      try {
        await createSource(deps, actor, {
          name: `${PREFIX} ESCAPE`,
          sourceType: 'FILE_REPOSITORY',
          localRoot: process.platform === 'win32' ? 'C:/Windows' : '/etc',
        });
      } catch (error) {
        thrown = error;
      }
      expect((thrown as SourceAdminError).code).toBe('SOURCE_FORBIDDEN');
    });

    it('refuses a duplicate name, because it makes every audit row ambiguous', async () => {
      await newSource('DUPE');
      await expect(
        createSource(deps, actor, {
          name: `${PREFIX} DUPE`,
          sourceType: 'FILE_REPOSITORY',
          localRoot: `${ROOT}/DUPE2`,
        }),
      ).rejects.toThrow(/already exists/);
    });

    it('refuses an invalid schedule rather than storing one that never fires', async () => {
      await expect(
        createSource(deps, actor, {
          name: `${PREFIX} BADCRON`,
          sourceType: 'FILE_REPOSITORY',
          localRoot: `${ROOT}/BADCRON`,
          schedule: { mode: 'CRON', cron: 'every day at three' },
        }),
      ).rejects.toThrow(/schedule is invalid|cron/i);
    });
  });

  describe('editing and scheduling', () => {
    it('stores a schedule and reads it back', async () => {
      const source = await newSource('SCHEDULE');
      const updated = await updateSource(deps, actor, {
        sourceId: source.sourceId,
        schedule: { mode: 'HOURLY', intervalHours: 6, timezone: 'Europe/Paris' },
      });
      expect(updated.schedule.mode).toBe('HOURLY');
      expect(updated.schedule.intervalHours).toBe(6);
      expect(updated.schedule.timezone).toBe('Europe/Paris');

      const stored = await prisma.knowledgeSource.findUniqueOrThrow({
        where: { id: source.sourceId },
        select: { syncSchedule: true },
      });
      expect(scheduleOf(stored.syncSchedule).intervalHours).toBe(6);
    });

    it('audits a schedule change with the mode and the timezone', async () => {
      const source = await newSource('SCHEDAUDIT');
      await updateSource(deps, actor, {
        sourceId: source.sourceId,
        schedule: { mode: 'WEEKLY', timezone: 'UTC' },
      });
      const event = await prisma.auditEvent.findFirst({
        where: { action: 'ADMIN.SOURCE.UPDATED', entityId: source.sourceId },
        orderBy: { occurredAt: 'desc' },
      });
      const detail = event?.detail as Record<string, unknown>;
      expect(detail['changedFields']).toEqual(['syncSchedule']);
      expect(detail['scheduleMode']).toBe('WEEKLY');
      expect(detail['_droppedKeys']).toBeUndefined();
      // H2: the before and after belong in their own columns.
      expect(event?.previousValue).not.toBeNull();
    });

    it('refuses an edit that changes nothing', async () => {
      const source = await newSource('NOOP', { name: `${PREFIX} NOOP` });
      await expect(
        updateSource(deps, actor, { sourceId: source.sourceId, name: `${PREFIX} NOOP` }),
      ).rejects.toThrow(/Nothing was changed/);
    });
  });

  describe('pause and resume', () => {
    it('activates and deactivates, each with its OWN audit action', async () => {
      const source = await newSource('PAUSE');
      const resumed = await setSourceActive(deps, actor, {
        sourceId: source.sourceId,
        isActive: true,
      });
      expect(resumed.isActive).toBe(true);
      const paused = await setSourceActive(deps, actor, {
        sourceId: source.sourceId,
        isActive: false,
      });
      expect(paused.isActive).toBe(false);

      // Its own action, so "who paused this and when" is findable in seven
      // years of audit without parsing a field list.
      for (const action of ['ADMIN.SOURCE.ACTIVATED', 'ADMIN.SOURCE.DEACTIVATED']) {
        const event = await prisma.auditEvent.findFirst({
          where: { action, entityId: source.sourceId },
        });
        expect(event, action).not.toBeNull();
        expect((event?.detail as Record<string, unknown>)['_droppedKeys'], action).toBeUndefined();
      }
    });

    it('refuses to pause a source that is already paused', async () => {
      const source = await newSource('ALREADYPAUSED');
      await expect(
        setSourceActive(deps, actor, { sourceId: source.sourceId, isActive: false }),
      ).rejects.toThrow(/already paused/);
    });
  });

  describe('paths', () => {
    it('adds a path, audits it, and reports it as the scan scope', async () => {
      const source = await newSource('PATHS');
      const path = await addSourcePath(deps, actor, {
        sourceId: source.sourceId,
        containerName: 'SOPs',
        folderPath: 'SOPs/2026',
      });
      const row = await prisma.knowledgeSourcePath.findUniqueOrThrow({
        where: { id: path.pathId },
        select: { containerName: true, containerId: true, folderPath: true, isActive: true },
      });
      expect(row.containerName).toBe('SOPs');
      expect(row.containerId).toBe('SOPs');
      expect(row.isActive).toBe(true);

      const event = await prisma.auditEvent.findFirst({
        where: { action: 'ADMIN.SOURCE.PATH_MODIFIED', entityId: path.pathId },
      });
      expect((event?.detail as Record<string, unknown>)['change']).toBe('ADDED');
    });

    it('refuses a folder path containing traversal', async () => {
      const source = await newSource('PATHTRAVERSAL');
      await expect(
        addSourcePath(deps, actor, {
          sourceId: source.sourceId,
          containerName: 'SOPs',
          folderPath: '../../etc',
        }),
      ).rejects.toThrow(/may not contain/);
    });

    it('deactivates a path without deleting it', async () => {
      const source = await newSource('PATHDEACT');
      const path = await addSourcePath(deps, actor, {
        sourceId: source.sourceId,
        containerName: 'SOPs',
      });
      await modifySourcePath(deps, actor, { pathId: path.pathId, change: 'DEACTIVATED' });
      const row = await prisma.knowledgeSourcePath.findUniqueOrThrow({
        where: { id: path.pathId },
        select: { isActive: true },
      });
      expect(row.isActive).toBe(false);
    });
  });

  describe('retirement and lineage protection', () => {
    it('DELETES a source nothing references', async () => {
      const source = await newSource('DELETABLE');
      const lineage = await lineageOf(deps, source.sourceId);
      expect(hasLineage(lineage)).toBe(false);

      const result = await retireSource(deps, actor, {
        sourceId: source.sourceId,
        intent: 'DELETE',
      });
      expect(result.outcome).toBe('DELETED');
      expect(
        await prisma.knowledgeSource.findUnique({ where: { id: source.sourceId } }),
      ).toBeNull();

      // The audit row OUTLIVES the source, which is the point: it is the only
      // remaining evidence the source existed.
      const event = await prisma.auditEvent.findFirst({
        where: { action: 'ADMIN.SOURCE.DELETED', entityId: source.sourceId },
      });
      expect(event).not.toBeNull();
    });

    it('REFUSES a delete once anything references the source', async () => {
      const source = await newSource('HASLINEAGE');
      // A sync run is enough: it is history, and history is lineage.
      await prisma.knowledgeSourceSync.create({
        data: {
          sourceId: source.sourceId,
          pathIds: [],
          mode: 'FULL',
          trigger: 'MANUAL',
          outcome: 'SUCCEEDED',
          startedAt: new Date(),
          completedAt: new Date(),
          correlationId: 'sync-admin-test',
        },
      });

      let thrown: unknown;
      try {
        await retireSource(deps, actor, { sourceId: source.sourceId, intent: 'DELETE' });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(SourceAdminError);
      expect((thrown as SourceAdminError).code).toBe('SOURCE_HAS_LINEAGE');
      // The refusal names the remedy, not just the rule.
      expect((thrown as Error).message).toContain('Archive it instead');

      // And the source is still there.
      expect(
        await prisma.knowledgeSource.findUnique({ where: { id: source.sourceId } }),
      ).not.toBeNull();
    });

    it('ARCHIVES a referenced source, stands its schedule down, and keeps the rows', async () => {
      const source = await newSource('ARCHIVE', { schedule: { mode: 'DAILY', timezone: 'UTC' } });
      await prisma.knowledgeSourceSync.create({
        data: {
          sourceId: source.sourceId,
          pathIds: [],
          mode: 'FULL',
          trigger: 'MANUAL',
          outcome: 'SUCCEEDED',
          startedAt: new Date(),
          completedAt: new Date(),
          correlationId: 'sync-admin-test',
        },
      });

      const result = await retireSource(deps, actor, {
        sourceId: source.sourceId,
        intent: 'ARCHIVE',
      });
      expect(result.outcome).toBe('ARCHIVED');

      const row = await prisma.knowledgeSource.findUniqueOrThrow({
        where: { id: source.sourceId },
        select: { archivedAt: true, isActive: true, syncSchedule: true },
      });
      expect(row.archivedAt).not.toBeNull();
      expect(row.isActive).toBe(false);
      // A schedule on an archived source would keep firing, so archiving
      // stands it down here rather than being checked for everywhere later.
      expect(scheduleOf(row.syncSchedule).mode).toBe('MANUAL');
      // The history it had is untouched.
      expect(await prisma.knowledgeSourceSync.count({ where: { sourceId: source.sourceId } })).toBe(
        1,
      );
    });

    it('refuses to edit or resume an archived source', async () => {
      const source = await newSource('ARCHIVEDLOCK');
      await retireSource(deps, actor, { sourceId: source.sourceId, intent: 'ARCHIVE' });
      await expect(
        updateSource(deps, actor, { sourceId: source.sourceId, name: `${PREFIX} RENAMED` }),
      ).rejects.toThrow(/archived source cannot be edited/);
      await expect(
        setSourceActive(deps, actor, { sourceId: source.sourceId, isActive: true }),
      ).rejects.toThrow(/cannot be resumed/);
    });
  });
});
