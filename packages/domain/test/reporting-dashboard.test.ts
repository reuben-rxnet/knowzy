// Phase 10 R2 — the dashboard's datasets and the coverage history, against a
// real database.
//
// The unit tests cover the comparison arithmetic, grid suppression and the
// trend buckets as tables. These cover what only PostgreSQL can show, and each
// is a rule that would otherwise be a comment:
//
//   R-1  a coverage snapshot is APPEND-ONLY: one per UTC day, a second capture
//        writes nothing, and the database refuses an UPDATE or a DELETE;
//   R-1  a comparison against a snapshot is made ONLY when a snapshot for the
//        start of the period exists, and never for a restricted scope;
//   S1   no visible heatmap cell and no visible completion row covers fewer
//        learners than the minimum group size;
//   B1   every dashboard dataset carries the reporting envelope — asOf, the
//        resolved window, the suppression count and its reason;
//   H3   the activity feed never says a provider was "verified".
//
// THIS SUITE WRITES NO FAKE HISTORY. It cannot: the snapshot table refuses
// DELETE, so a back-dated row planted by a test would be permanent in the
// shared development database — the fabricated history R-1 exists to prevent.
// Comparisons against a snapshot are asserted against whatever the table
// actually holds.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_COMPLETION_ACTION,
  DASHBOARD_DATASETS,
  MATERIALIZED_MODELS,
  MINIMUM_GROUP_SIZE_FLOOR,
  SNAPSHOT_BASE_TOLERANCE_DAYS,
  SUPPRESSED,
  addDays,
  captureCoverageSnapshot,
  listCoverageSnapshots,
  refreshModel,
  runDataset,
  utcDate,
  type RefreshDb,
} from '@knowzy/reporting';
import { AUDIT_ACTIONS, SOURCE_WORKFLOW_STATUSES } from '@knowzy/shared-types';

const DATABASE_URL = process.env['DATABASE_URL'];
const describeDb = DATABASE_URL ? describe : describe.skip;

const prisma = new PrismaClient(
  DATABASE_URL ? { datasources: { db: { url: DATABASE_URL } } } : undefined,
);
const db = prisma as unknown as RefreshDb;
const ALL = { domainIds: null, sourceIds: null } as const;

describe('the activity feed reads only actions the registry declares', () => {
  it('names real audit actions, including the one completions are recorded under', () => {
    // A feed keyed on an action nobody writes is empty forever and looks
    // quiet. The specification named LEARNING.SESSION.COMPLETED; the platform
    // writes LEARNING.RESULT.SCORED.
    for (const action of [...Object.keys(ACTIVITY_ACTIONS), ACTIVITY_COMPLETION_ACTION]) {
      expect(AUDIT_ACTIONS, action).toContain(action);
    }
  });
});

describeDb('reporting dashboard (Phase 10 R2)', () => {
  beforeAll(async () => {
    for (const model of MATERIALIZED_MODELS) await refreshModel(db, model);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ================================================== R-1: the snapshot table

  describe('coverage snapshots', () => {
    it('record ONE row per UTC day: a second capture writes nothing', async () => {
      await captureCoverageSnapshot(db, 'MANUAL', 'test-first');
      const before = await listCoverageSnapshots(db);
      const today = utcDate(new Date());
      expect(before.some((row) => row.snapshotDate === today)).toBe(true);

      const written = await captureCoverageSnapshot(db, 'MANUAL', 'test-second');
      expect(written).toBe(false);
      const after = await listCoverageSnapshots(db);
      expect(after).toHaveLength(before.length);
      // The first capture of the day stands, untouched.
      expect(after[0]?.capturedAt).toBe(before[0]?.capturedAt);
    });

    it('refuse an UPDATE and a DELETE — history is not rewritten', async () => {
      await expect(
        prisma.$executeRawUnsafe(`UPDATE reporting.coverage_snapshot SET source_count = 0`),
      ).rejects.toThrow(/append-only/);
      await expect(
        prisma.$executeRawUnsafe(`DELETE FROM reporting.coverage_snapshot`),
      ).rejects.toThrow(/append-only/);
    });

    it('store coverage as covered ÷ assessable, and NULL — never 0 — with no denominator', async () => {
      for (const row of await listCoverageSnapshots(db)) {
        expect(row.coveredSections).toBeLessThanOrEqual(row.assessableSections);
        if (row.assessableSections === 0) {
          expect(row.coveragePercent).toBeNull();
        } else {
          expect(row.coveragePercent).toBeCloseTo(
            (row.coveredSections * 100) / row.assessableSections,
            1,
          );
        }
        // The five buckets plus retired/archived partition the total.
        expect(
          row.publishedQuestions +
            row.approvedQuestions +
            row.inReviewQuestions +
            row.draftQuestions +
            row.rejectedQuestions +
            row.retiredOrArchivedQuestions,
        ).toBe(row.totalQuestions);
      }
    });

    it('report their latest capture as the ledger’s asOf', async () => {
      const [ledger] = await prisma.$queryRawUnsafe<{ refreshed_at: Date | null }[]>(
        `SELECT refreshed_at FROM reporting.refresh_state WHERE model = 'coverage_snapshot'`,
      );
      const [newest] = await listCoverageSnapshots(db, 1);
      expect(ledger?.refreshed_at?.toISOString()).toBe(newest?.capturedAt);
    });
  });

  // ================================================ B1: the reporting envelope

  describe('every dashboard dataset', () => {
    for (const name of DASHBOARD_DATASETS) {
      it(`${name}: carries asOf, the resolved window and the suppression count`, async () => {
        const result = await runDataset(db, { name, scope: ALL });
        expect(result).toHaveProperty('asOf');
        expect(result).toHaveProperty('sourceWindow');
        expect(typeof result.suppressionCount).toBe('number');
        expect(result.suppressionCount).toBe(result.suppressedCellCount);
        // A reason exactly when something was withheld: a reason for a
        // suppression that did not happen is its own small fabrication.
        expect(result.suppressionReason === null).toBe(result.suppressionCount === 0);
        if (result.windowDays !== null) {
          expect(result.sourceWindow.from).not.toBeNull();
          expect(result.sourceWindow.to).not.toBeNull();
        } else {
          expect(result.sourceWindow.from).toBeNull();
        }
        for (const metric of result.metrics) expect(metric.formula.length).toBeGreaterThan(5);
      });
    }
  });

  // ====================================================== KPIs and comparisons

  describe('headline figures', () => {
    it('are the eight the design draws, in its order', async () => {
      const result = await runDataset(db, { name: 'kpis', scope: ALL, windowDays: 30 });
      expect(result.rows.map((row) => row['kpi'])).toEqual([
        'totalQuestions',
        'publishedQuestions',
        'assessmentsCompleted',
        'passRate',
        'knowledgeSources',
        'coverage',
        'aiGenerations',
        'estimatedAiCost',
      ]);
      // Eight figures in four units have no total.
      expect(result.totals).toEqual({});
    });

    it('compare a STATE only against a snapshot that exists for the start of the period', async () => {
      const result = await runDataset(db, { name: 'kpis', scope: ALL, windowDays: 30 });
      const base = utcDate(new Date(Date.now() - 30 * 86_400_000));
      const snapshots = await listCoverageSnapshots(db);
      const hasBase = snapshots.some(
        (row) =>
          row.snapshotDate <= base &&
          row.snapshotDate >= addDays(base, -SNAPSHOT_BASE_TOLERANCE_DAYS),
      );

      for (const kpi of ['totalQuestions', 'publishedQuestions', 'knowledgeSources', 'coverage']) {
        const row = result.rows.find((r) => r['kpi'] === kpi);
        expect(row?.['basis'], kpi).toBe('SNAPSHOT');
        if (hasBase) {
          expect(['AVAILABLE', 'NOT_YET_AVAILABLE'], kpi).toContain(row?.['comparisonStatus']);
        } else {
          // No base, no number. The note says when one becomes available.
          expect(row?.['comparisonStatus'], kpi).toBe('NOT_YET_AVAILABLE');
          expect(row?.['previousValue'], kpi).toBeNull();
          expect(row?.['change'], kpi).toBeNull();
          expect(String(row?.['comparisonNote'])).toMatch(/snapshot/i);
        }
      }
    });

    it('compare a FLOW against the previous window of the same dated rows', async () => {
      const result = await runDataset(db, { name: 'kpis', scope: ALL, windowDays: 30 });
      const generations = result.rows.find((r) => r['kpi'] === 'aiGenerations');
      expect(generations?.['basis']).toBe('DATED_ROWS');
      expect(generations?.['comparisonStatus']).toBe('AVAILABLE');
      expect(typeof generations?.['previousValue']).toBe('number');
      // The previous window ends where this one begins.
      expect(generations?.['baseTo']).toBe(result.sourceWindow.from);
    });

    it('refuse a snapshot comparison to a RESTRICTED scope — snapshots are platform-wide', async () => {
      const domain = await prisma.domain.findFirstOrThrow({ select: { id: true } });
      const result = await runDataset(db, {
        name: 'kpis',
        scope: { domainIds: [domain.id], sourceIds: null },
        windowDays: 30,
      });
      const coverage = result.rows.find((r) => r['kpi'] === 'totalQuestions');
      expect(coverage?.['comparisonStatus']).toBe('SCOPE_RESTRICTED');
    });

    it('withhold a learner-derived figure below the minimum group size, never showing 0', async () => {
      const result = await runDataset(db, { name: 'kpis', scope: ALL, windowDays: 365 });
      const [window] = await prisma.$queryRawUnsafe<{ learners: number }[]>(
        `SELECT count(DISTINCT learner_user_id)::int AS learners
           FROM reporting.rm_assessment_attempt
          WHERE completed_at >= $1::timestamptz`,
        new Date(result.sourceWindow.from ?? 0),
      );
      const learners = window?.learners ?? 0;
      const completed = result.rows.find((r) => r['kpi'] === 'assessmentsCompleted');
      if (learners > 0 && learners < MINIMUM_GROUP_SIZE_FLOOR) {
        expect(completed?.['value']).toBe(SUPPRESSED);
        expect(completed?.['valueStatus']).toBe('SUPPRESSED');
        expect(result.suppressionCount).toBeGreaterThan(0);
      } else {
        expect(completed?.['value']).not.toBe(SUPPRESSED);
      }
    });
  });

  // ================================================================ the panels

  describe('question status', () => {
    it('partitions the whole bank: the buckets sum to the pipeline total', async () => {
      const status = await runDataset(db, { name: 'question-status', scope: ALL });
      const pipeline = await runDataset(db, { name: 'question-pipeline', scope: ALL });
      expect(status.totals['questionCount']).toBe(pipeline.totals['questionCount']);
      // Retired and archived are a bucket, not an omission.
      expect(status.rows.map((row) => row['bucket'])).toContain('Retired or archived');
    });
  });

  describe('question trend', () => {
    it('draws every period, zero-filled, and marks only the last one partial', async () => {
      const result = await runDataset(db, { name: 'question-trend', scope: ALL, windowDays: 365 });
      expect(result.rows).toHaveLength(12);
      expect(result.rows.filter((row) => row['partial'] === 'yes')).toHaveLength(1);
      expect(result.rows.at(-1)?.['partial']).toBe('yes');
      for (const row of result.rows) {
        expect(typeof row['generated']).toBe('number');
        expect(typeof row['published']).toBe('number');
      }
    });
  });

  describe('learner performance', () => {
    it('shows no visible cell covering fewer learners than the minimum group size', async () => {
      const result = await runDataset(db, {
        name: 'learner-performance',
        scope: ALL,
        windowDays: 365,
      });
      for (const row of result.rows) {
        const learners = row['learners'];
        if (learners === SUPPRESSED) {
          // The whole cell goes, not just its head count.
          expect(row['averageScore']).toBe(SUPPRESSED);
          expect(row['passRatePercent']).toBe(SUPPRESSED);
        } else {
          expect(Number(learners)).toBeGreaterThanOrEqual(result.minimumGroupSize);
        }
      }
    });
  });

  describe('source health', () => {
    it('uses the Sync Manager’s status vocabulary and nothing else', async () => {
      const result = await runDataset(db, { name: 'source-health', scope: ALL });
      for (const row of result.rows) {
        expect(SOURCE_WORKFLOW_STATUSES).toContain(row['status']);
      }
    });
  });

  describe('recent activity', () => {
    it('names no actor, shows no small learner group, and never claims a verified connection', async () => {
      const result = await runDataset(db, { name: 'activity', scope: ALL });
      expect(result.rows.length).toBeLessThanOrEqual(20);
      const json = JSON.stringify(result.rows);
      expect(json).not.toMatch(/actorDisplayName|actorUserId|learnerUserId/);
      expect(json.toLowerCase()).not.toContain('verified');
      for (const row of result.rows) {
        if (row['kind'] === 'ASSESSMENTS_COMPLETED') {
          expect(Number(row['learners'])).toBeGreaterThanOrEqual(result.minimumGroupSize);
        }
      }
    });
  });
});
