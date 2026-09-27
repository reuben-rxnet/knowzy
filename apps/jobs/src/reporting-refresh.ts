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
  captureCoverageSnapshot,
  pruneDatasetCache,
  refreshModel,
  reconcileQuestionPipeline,
  refreshAllModels,
  type RefreshDb,
  type RefreshOutcome,
} from '@knowzy/reporting';
import { findingRepository, type PrismaClient } from '@knowzy/database';

export const QUEUE_REPORTING_REFRESH = 'reporting-refresh';
export const QUEUE_REPORTING_RECONCILE = 'reporting-reconcile';
export const QUEUE_COVERAGE_SNAPSHOT = 'reporting-coverage-snapshot';

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

// ---------------------------------------------------------------------------
// The daily coverage snapshot — decision R-1
// ---------------------------------------------------------------------------
//
// ONCE A DAY, and the first capture of the day stands. The database function
// refuses to overwrite a recorded day, so this job is idempotent by
// construction: a restart, a retry or a second scheduler firing on the same
// day writes nothing and says so.
//
// It REFRESHES ITS INPUTS FIRST. A snapshot reads the read models, not the
// transactional tables — so that it is compared later against a KPI computed
// the same way — and a snapshot of a model fifteen minutes stale would record
// a day's state as it was a quarter of an hour earlier. The two materialized
// inputs are refreshed immediately before the capture; the on-write pipeline
// counter is always current.
//
// NOTHING IS BACK-FILLED, ever. A missed day stays missed, and a comparison
// that needed it reads "Not Yet Available". Inventing the missing row from
// `created_at` arithmetic would be the fabricated history R-1 replaced.

export interface SnapshotSummary {
  readonly written: boolean;
  readonly inputsRefreshed: number;
  readonly inputsFailed: number;
}

export const runCoverageSnapshot = async (
  prisma: PrismaClient,
  trigger: 'SCHEDULE' | 'MANUAL',
  correlationId: string,
): Promise<SnapshotSummary> => {
  const db = prisma as unknown as RefreshDb;
  const inputs = await Promise.all([
    refreshModel(db, 'rm_source_coverage'),
    refreshModel(db, 'rm_platform_inventory'),
  ]);
  const inputsFailed = inputs.filter((outcome) => outcome.status === 'FAILED').length;
  // A failed input refresh does not block the capture: D4 leaves the previous
  // data in place, and `models_as_of` on the row records how old it was. A
  // day with a slightly stale snapshot is worth more than a day with none.
  const written = await captureCoverageSnapshot(db, trigger, correlationId);
  return { written, inputsRefreshed: inputs.length - inputsFailed, inputsFailed };
};
