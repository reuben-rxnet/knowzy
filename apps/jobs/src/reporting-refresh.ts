// The reporting refresh job — reporting.md §3.1.
//
// TWO JOBS, ON DIFFERENT CLOCKS, FOR DIFFERENT REASONS.
//
//   REFRESH, every 15 minutes. The materialized views' stated latency target.
//   It refreshes CONCURRENTLY, continues past a failure, and records every
//   outcome in the ledger so a stale panel can say how stale (D2, D3, D4).
//
//   RECONCILE, nightly. It compares the ON-WRITE counters against the
//   transactional tables and RAISES A FINDING for any drift. It does not repair
//   anything (D7), and that restraint is the whole point: a reconciler that
//   silently corrected the number would hide the bug that produced it, and the
//   next drift would be silent too.
//
// The reconciler is also the only thing that can catch a MISSING write hook.
// The counters are maintained by a database trigger, so the failure mode it
// guards against is not a forgotten call site — it is a trigger dropped by a
// future migration, a manual `UPDATE` that bypassed it, or a bug in the
// recompute itself. None of those announces itself.
//
// A REFRESH FAILURE IS NOT A JOB FAILURE. If one view cannot refresh, the other
// four still should, and the job's own outcome records how many succeeded. A
// job that aborted on the first bad view would leave four correct models stale
// because of one broken one.

import {
  REPORTING_DRIFT_CHECK_KEY,
  pruneDatasetCache,
  reconcileQuestionPipeline,
  refreshAllModels,
  type RefreshDb,
  type RefreshOutcome,
} from '@knowzy/reporting';
import { findingRepository, type PrismaClient } from '@knowzy/database';

export const QUEUE_REPORTING_REFRESH = 'reporting-refresh';
export const QUEUE_REPORTING_RECONCILE = 'reporting-reconcile';

export interface RefreshSummary {
  readonly refreshed: number;
  readonly failed: number;
  readonly outcomes: readonly RefreshOutcome[];
  readonly cacheEntriesPruned: number;
}

export const runReportingRefresh = async (prisma: PrismaClient): Promise<RefreshSummary> => {
  const db = prisma as unknown as RefreshDb;
  const outcomes = await refreshAllModels(db);

  // Expired cache entries, swept here rather than in their own job. A stale
  // entry can never be SERVED — its key carries the `asOf` it was built from,
  // so a refresh misses it by construction — this only stops the table growing.
  const cacheEntriesPruned = await pruneDatasetCache(db);

  return {
    refreshed: outcomes.filter((outcome) => outcome.status === 'READY').length,
    failed: outcomes.filter((outcome) => outcome.status === 'FAILED').length,
    outcomes,
    cacheEntriesPruned,
  };
};

export interface ReconcileSummary {
  readonly checked: string;
  readonly driftCount: number;
  readonly findingsRaised: number;
}

export const runReportingReconcile = async (prisma: PrismaClient): Promise<ReconcileSummary> => {
  const drift = await reconcileQuestionPipeline(prisma as unknown as RefreshDb);

  // One finding per discrepancy, carrying expected and actual. An operator
  // needs to know WHICH domain and WHICH state disagreed; a single "counters
  // are wrong" finding is a finding nobody can act on.
  const findings = findingRepository(prisma);
  for (const row of drift) {
    await findings.raise({
      checkKey: REPORTING_DRIFT_CHECK_KEY,
      entityType: 'Domain',
      entityId: row.domainId,
      expected: { status: row.status, questionCount: row.actualValue },
      actual: { status: row.status, questionCount: row.counterValue },
      note:
        `The on-write reporting counter for ${row.status} disagrees with draft_question. ` +
        'NOT corrected automatically: the discrepancy is the signal, and repairing it would hide ' +
        'whatever produced it. Investigate, then rebuild the model.',
    });
  }

  return {
    checked: 'rm_question_pipeline',
    driftCount: drift.length,
    findingsRaised: drift.length,
  };
};
