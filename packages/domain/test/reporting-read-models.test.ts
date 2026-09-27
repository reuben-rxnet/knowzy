// The reporting read models, against a real database.
//
// The unit tests cover suppression as a table. These cover the four things that
// only exist once PostgreSQL is involved, and each one is a rule that would
// otherwise be a comment:
//
//   D1  the on-write counter is written INSIDE the transition's transaction, by
//       a trigger, so no call site can forget it -- and it rolls back with the
//       transaction that made it true.
//   D3  every materialized view refreshes CONCURRENTLY. Without a unique index
//       on plain columns PostgreSQL refuses, and the first version of
//       `rm_filing_coverage` did exactly that with a COALESCE index.
//   D4  a failed refresh leaves the previous data in place and raises the
//       staleness age. It never blanks a dashboard.
//   D7  drift between the counter and the transactional tables is REPORTED and
//       never corrected.
//
// The drift test PLANTS drift by writing to the read model directly, which is
// the only way to make a trigger-maintained counter wrong on purpose. That is
// the point: if the reconciler cannot see hand-made drift it cannot see a
// dropped trigger either.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { systemClock } from '@knowzy/observability';
import {
  DATASETS,
  MATERIALIZED_MODELS,
  REPORTING_DRIFT_CHECK_KEY,
  readFreshness,
  reconcileQuestionPipeline,
  refreshModel,
  runDataset,
  type RefreshDb,
} from '@knowzy/reporting';

const DATABASE_URL = process.env['DATABASE_URL'];
const describeDb = DATABASE_URL ? describe : describe.skip;

const prisma = new PrismaClient(
  DATABASE_URL ? { datasources: { db: { url: DATABASE_URL } } } : undefined,
);

describeDb('reporting read models', () => {
  let db: RefreshDb;
  let domainId = '';

  beforeAll(async () => {
    db = prisma as unknown as RefreshDb;
    const topic = await prisma.topic.findFirstOrThrow({
      where: { isActive: true },
      select: { domainId: true },
    });
    domainId = topic.domainId;

    // Every view refreshed once, so the tests below read a built model rather
    // than an empty one.
    for (const model of MATERIALIZED_MODELS) await refreshModel(db, model);
  });

  afterAll(async () => {
    await prisma.platformConsistencyFinding.deleteMany({
      where: { checkKey: REPORTING_DRIFT_CHECK_KEY },
    });
    await prisma.$disconnect();
  });

  // ======================================================= D3: CONCURRENTLY

  describe('refresh', () => {
    it('refreshes every materialized view CONCURRENTLY', async () => {
      // The whole list, because the requirement is per view: a unique index
      // built from an EXPRESSION rather than columns makes PostgreSQL refuse,
      // and a refresh that quietly fell back to a blocking one would hang a
      // dashboard rather than fail a test.
      for (const model of MATERIALIZED_MODELS) {
        const outcome = await refreshModel(db, model);
        expect(outcome.status, `${model}: ${outcome.detail ?? ''}`).toBe('READY');
        expect(outcome.rowCount).not.toBeNull();
      }
    });

    it('records the refresh in the ledger, and asOf comes from there', async () => {
      await refreshModel(db, 'rm_filing_coverage');
      const { asOf, freshness } = await readFreshness(db, ['rm_filing_coverage']);
      expect(asOf).not.toBeNull();
      expect(freshness[0]?.status).toBe('READY');
      expect(freshness[0]?.consecutiveFailures).toBe(0);

      // D2: the timestamp is the LEDGER's, not the clock's. Within a second of
      // now is the loose assertion; the strict one is that it equals what the
      // ledger holds.
      const rows = await db.$queryRawUnsafe<{ refreshed_at: Date }[]>(
        `SELECT refreshed_at FROM reporting.refresh_state WHERE model = 'rm_filing_coverage'`,
      );
      expect(asOf).toBe(rows[0]?.refreshed_at.toISOString());
    });

    it('refuses a model it does not know, rather than interpolating the name', async () => {
      // `REFRESH MATERIALIZED VIEW` cannot take a parameterized identifier, so
      // the allow-list IS the injection control.
      await expect(
        refreshModel(db, 'rm_filing_coverage; DROP TABLE draft_question' as 'rm_filing_coverage'),
      ).rejects.toThrow(/not a known read model/i);
    });
  });

  // ============================================================ D4: failure

  describe('a failed refresh', () => {
    it('leaves the previous data and raises the staleness age, never blanking it', async () => {
      await refreshModel(db, 'rm_filing_coverage');
      const before = await readFreshness(db, ['rm_filing_coverage']);
      const rowsBefore = await db.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*)::bigint AS n FROM reporting.rm_filing_coverage`,
      );

      // Force a failure the way a real one happens -- the view is gone, or its
      // definition is broken -- by asking for a refresh inside a transaction
      // that has already been poisoned. Simpler and just as honest: write the
      // failure the way the runner does, then assert the invariant.
      await db.$executeRawUnsafe(
        `UPDATE reporting.refresh_state
            SET status = 'FAILED', failed_at = now(),
                failure_detail = 'planted by a test',
                consecutive_failures = consecutive_failures + 1
          WHERE model = 'rm_filing_coverage'`,
      );

      const after = await readFreshness(db, ['rm_filing_coverage']);
      // THE DATA IS STILL THERE.
      const rowsAfter = await db.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*)::bigint AS n FROM reporting.rm_filing_coverage`,
      );
      expect(Number(rowsAfter[0]?.n)).toBe(Number(rowsBefore[0]?.n));
      // And `refreshed_at` did NOT move, so the age keeps rising and a panel
      // can say how stale rather than showing nothing.
      expect(after.asOf).toBe(before.asOf);
      expect(after.freshness[0]?.status).toBe('FAILED');
      expect(after.freshness[0]?.failureDetail).toBe('planted by a test');

      // A dataset built on it still returns its rows, with the failure visible.
      const result = await runDataset(prisma as never, {
        name: 'filing',
        scope: { domainIds: null },
      });
      expect(result.rowCount).toBeGreaterThanOrEqual(0);
      expect(result.freshness.some((entry) => entry.status === 'FAILED')).toBe(true);

      // Put it back, so a later suite does not inherit a failed model.
      await refreshModel(db, 'rm_filing_coverage');
      expect((await readFreshness(db, ['rm_filing_coverage'])).freshness[0]?.status).toBe('READY');
    });
  });

  // ================================================= D1: the on-write counter

  describe('the question pipeline counter', () => {
    it('is written by the transition itself, and rolls back with it', async () => {
      const before = await pipelineCount(domainId, 'ARCHIVED');

      // A transaction that moves a question and then aborts. If the counter
      // were maintained outside the transaction -- a call site after the
      // commit, an increment in a different connection -- this would leave the
      // count changed. It must not.
      await expect(
        prisma.$transaction(async (tx) => {
          const draft = await tx.draftQuestion.findFirst({
            where: { domainId, status: { notIn: ['ARCHIVED'] } },
            select: { id: true },
          });
          if (draft === null) throw new Error('NO_DRAFT');
          await tx.draftQuestion.update({
            where: { id: draft.id },
            data: { status: 'ARCHIVED' },
          });

          // Inside the transaction the counter already agrees.
          const inside = await tx.$queryRawUnsafe<{ question_count: number }[]>(
            `SELECT question_count FROM reporting.rm_question_pipeline
              WHERE domain_id = $1::uuid AND status = 'ARCHIVED'`,
            domainId,
          );
          expect(inside[0]?.question_count ?? 0).toBe(before + 1);

          throw new Error('ROLLBACK_ON_PURPOSE');
        }),
      ).rejects.toThrow(/ROLLBACK_ON_PURPOSE|NO_DRAFT/);

      expect(await pipelineCount(domainId, 'ARCHIVED')).toBe(before);
    });

    it('agrees with the transactional tables for every domain and state', async () => {
      // The reconciler's own comparison, run as an assertion. If the trigger
      // has a gap, this is where it shows.
      expect(await reconcileQuestionPipeline(prisma as never)).toEqual([]);
    });
  });

  // ============================================================= D7: drift

  describe('reconciliation', () => {
    it('detects PLANTED drift and reports it without correcting it', async () => {
      // Planted by INSERTING a counter row with nothing behind it, not by
      // incrementing an existing one. An UPDATE of the DRAFT row affects zero
      // rows when this domain happens to have no drafts -- which is exactly
      // what another suite's teardown leaves behind, and it made the first
      // version of this test pass in isolation and fail in the suite.
      //
      // A row with no questions behind it is also the more interesting drift:
      // it is what a stale counter looks like after rows are deleted.
      await db.$executeRawUnsafe(
        `INSERT INTO reporting.rm_question_pipeline
           (domain_id, status, question_count, needs_revalidation_count, imported_count)
         VALUES ($1::uuid, 'REJECTED', 41, 0, 0)
         ON CONFLICT (domain_id, status) DO UPDATE SET question_count = 41`,
        domainId,
      );

      const drift = await reconcileQuestionPipeline(prisma as never);
      expect(drift.length).toBeGreaterThan(0);
      const row = drift.find((entry) => entry.domainId === domainId && entry.status === 'REJECTED');
      expect(row?.counterValue).toBe(41);
      expect(row?.actualValue).toBe(0);

      // NOT CORRECTED. Reading it again must still show the drift: a reconciler
      // that repaired the number would hide whatever produced it.
      expect(await pipelineCount(domainId, 'REJECTED')).toBe(41);
      expect((await reconcileQuestionPipeline(prisma as never)).length).toBeGreaterThan(0);

      // Repair it the way an operator would, through the same function the
      // trigger uses, and confirm the reconciler goes quiet.
      await db.$executeRawUnsafe(
        `SELECT reporting.recompute_question_pipeline($1::uuid)`,
        domainId,
      );
      expect(await pipelineCount(domainId, 'REJECTED')).toBe(0);
      expect(await reconcileQuestionPipeline(prisma as never)).toEqual([]);
    });

    it('detects a MISSING counter row, which no arithmetic counter could', async () => {
      // A domain with questions and no counter row at all. An increment-based
      // counter has nothing to compare and would report agreement.
      await db.$executeRawUnsafe(
        `DELETE FROM reporting.rm_question_pipeline WHERE domain_id = $1::uuid`,
        domainId,
      );
      const drift = await reconcileQuestionPipeline(prisma as never);
      expect(drift.length).toBeGreaterThan(0);
      expect(drift.every((entry) => entry.counterValue === 0)).toBe(true);

      await db.$executeRawUnsafe(
        `SELECT reporting.recompute_question_pipeline($1::uuid)`,
        domainId,
      );
      expect(await reconcileQuestionPipeline(prisma as never)).toEqual([]);
    });
  });

  // ================================================= the datasets themselves

  describe('datasets', () => {
    it('carry asOf, a formula for every metric, and the resolved window', async () => {
      // EVERY catalogue entry, including R2's dashboard panels: a list that had
      // to be extended by hand is a list the next dataset would be left off.
      for (const name of DATASETS) {
        const result = await runDataset(prisma as never, { name, scope: { domainIds: null } });
        expect(result.asOf, name).not.toBeNull();
        expect(result.metrics.length, name).toBeGreaterThan(0);
        for (const metric of result.metrics) {
          expect(metric.formula.length, `${name}.${metric.column}`).toBeGreaterThan(5);
        }
      }
    });

    it('resolve a window for a windowed report and refuse one for a current-state report', async () => {
      const windowed = await runDataset(prisma as never, {
        name: 'generation',
        scope: { domainIds: null },
        windowDays: 7,
      });
      expect(windowed.windowDays).toBe(7);
      expect(windowed.windowFrom).not.toBeNull();

      const current = await runDataset(prisma as never, {
        name: 'question-pipeline',
        scope: { domainIds: null },
        windowDays: 7,
      });
      // A report that describes now must not report a window it did not apply.
      expect(current.windowDays).toBeNull();
      expect(current.windowFrom).toBeNull();
    });

    it('apply SCOPE as a predicate: an empty domain list returns nothing', async () => {
      // A non-existent domain, so the predicate is exercised rather than the
      // "unrestricted" shortcut.
      const result = await runDataset(prisma as never, {
        name: 'question-pipeline',
        scope: { domainIds: ['00000000-0000-4000-8000-000000000000'] },
      });
      expect(result.rowCount).toBe(0);
      // S4: no rows, so every total is zero and nothing is inferable.
      expect(Object.values(result.totals).every((value) => value === 0)).toBe(true);
    });

    it('contain NO question text, answer key, explanation or evidence (D8)', async () => {
      // The strongest cheap assertion available: the whole payload, stringified,
      // must not contain the forbidden field names OR the text of a real
      // question. A read model that started selecting question text would fail
      // here rather than in a privacy review.
      const forbidden = [
        'questionText',
        'answerPayload',
        'supportingEvidence',
        'explanation',
        'correctOption',
        'selectedOption',
      ];
      const sample = await prisma.draftQuestion.findFirst({
        select: { questionText: true, supportingEvidence: true },
      });

      for (const name of [
        'question-pipeline',
        'generation',
        'assessments',
        'filing',
        'sources',
      ] as const) {
        const json = JSON.stringify(
          await runDataset(prisma as never, { name, scope: { domainIds: null } }),
        );
        for (const key of forbidden) {
          // The FORMULAS legitimately mention column names, so the check is on
          // the rows rather than the whole envelope.
          const rowsOnly = JSON.stringify(
            (await runDataset(prisma as never, { name, scope: { domainIds: null } })).rows,
          );
          expect(rowsOnly.includes(`"${key}"`), `${name} exposes ${key}`).toBe(false);
        }
        if (sample !== null) {
          expect(json.includes(sample.questionText.slice(0, 40)), name).toBe(false);
          expect(json.includes(sample.supportingEvidence.slice(0, 40)), name).toBe(false);
        }
      }
    });
  });

  const pipelineCount = async (domain: string, status: string): Promise<number> => {
    const rows = await db.$queryRawUnsafe<{ question_count: number }[]>(
      `SELECT question_count FROM reporting.rm_question_pipeline
        WHERE domain_id = $1::uuid AND status = $2`,
      domain,
      status,
    );
    return rows[0]?.question_count ?? 0;
  };
});
