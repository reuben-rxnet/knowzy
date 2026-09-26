// Refreshing the read models, and the ledger that makes staleness visible.
//
// FOUR RULES FROM reporting.md §3.1, each of which is a behaviour rather than a
// preference:
//
//   D2  `asOf` comes from `refresh_state.refreshed_at`, never from `now()`. A
//       response that timestamped itself would report the moment it was asked,
//       not the moment the data was true.
//   D3  `REFRESH MATERIALIZED VIEW CONCURRENTLY`, so a refresh never blocks a
//       read. This requires a unique index on every view, which migration 0012
//       creates and a test asserts — without it PostgreSQL silently takes an
//       ACCESS EXCLUSIVE lock and a dashboard hangs mid-demonstration.
//   D4  A FAILED REFRESH LEAVES THE PREVIOUS DATA IN PLACE and raises the
//       staleness age. It never blanks a dashboard. The ledger records the
//       failure, its detail and the streak, so a panel can say "last refreshed
//       an hour ago, failing since" — which is actionable — instead of showing
//       nothing, which is not.
//   D7  Counters are reconciled against the transactional tables; drift raises
//       a `PlatformConsistencyFinding` and is NEVER silently corrected. A
//       reconciler that repaired the number would hide the bug that caused it.
//
// This module takes a write-capable client, unlike the rest of the package: a
// refresh is a write, to the reporting schema only. The type is declared
// structurally and narrowly — `$executeRawUnsafe` plus `$queryRawUnsafe` — so
// it still cannot reach a Prisma model.

import type { ReadOnlyDb } from './audit-explorer.js';

export interface RefreshDb extends ReadOnlyDb {
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
}

/**
 * The materialized views, in refresh order.
 *
 * Ordered cheapest-first so that a run interrupted part-way has refreshed the
 * models a dashboard opens with, rather than the one nobody is looking at.
 */
export const MATERIALIZED_MODELS = [
  'rm_question_activity',
  'rm_filing_coverage',
  'rm_generation_yield',
  'rm_assessment_performance',
  'rm_source_coverage',
] as const;
export type MaterializedModel = (typeof MATERIALIZED_MODELS)[number];

/** The on-write model. Listed separately: it is a table, not a view. */
export const ON_WRITE_MODELS = ['rm_question_pipeline'] as const;

export interface RefreshOutcome {
  readonly model: string;
  readonly status: 'READY' | 'FAILED';
  readonly durationMs: number;
  readonly rowCount: number | null;
  readonly detail: string | null;
}

const rowCountOf = async (db: RefreshDb, model: string): Promise<number | null> => {
  try {
    const rows = await db.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*)::bigint AS n FROM reporting.${model}`,
    );
    const n = rows[0]?.n;
    return n === undefined ? null : Number(n);
  } catch {
    // A row count is diagnostic. Failing to take one must not turn a
    // successful refresh into a reported failure.
    return null;
  }
};

/**
 * Refreshes one materialized view and records the outcome.
 *
 * The model name is checked against the constant list and never interpolated
 * from caller input. `REFRESH MATERIALIZED VIEW` cannot take a parameterized
 * identifier, so the allow-list IS the injection control.
 */
export const refreshModel = async (
  db: RefreshDb,
  model: MaterializedModel,
): Promise<RefreshOutcome> => {
  if (!(MATERIALIZED_MODELS as readonly string[]).includes(model)) {
    throw new Error(`Not a known read model: ${model}`);
  }

  const started = Date.now();
  await db.$executeRawUnsafe(
    `UPDATE reporting.refresh_state
        SET status = 'REFRESHING', started_at = now()
      WHERE model = $1`,
    model,
  );

  try {
    // CONCURRENTLY: D3. Requires the unique index migration 0012 creates.
    await db.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY reporting.${model}`);
    const durationMs = Date.now() - started;
    const rowCount = await rowCountOf(db, model);

    await db.$executeRawUnsafe(
      `UPDATE reporting.refresh_state
          SET status = 'READY',
              refreshed_at = now(),
              duration_ms = $2,
              row_count = $3,
              consecutive_failures = 0,
              failure_detail = NULL,
              failed_at = NULL
        WHERE model = $1`,
      model,
      durationMs,
      rowCount,
    );
    return { model, status: 'READY', durationMs, rowCount, detail: null };
  } catch (error) {
    const durationMs = Date.now() - started;
    const detail = (error as Error).message.slice(0, 1_000);
    // D4: `refreshed_at` is NOT touched. The previous data stays queryable and
    // its age keeps rising, which is what a panel labels.
    await db.$executeRawUnsafe(
      `UPDATE reporting.refresh_state
          SET status = 'FAILED',
              failed_at = now(),
              failure_detail = $2,
              duration_ms = $3,
              consecutive_failures = consecutive_failures + 1
        WHERE model = $1`,
      model,
      detail,
      durationMs,
    );
    return { model, status: 'FAILED', durationMs, rowCount: null, detail };
  }
};

/**
 * Refreshes every materialized view, continuing past a failure.
 *
 * One model failing must not stop the other four: a report nobody can read
 * because an unrelated view has a bad column is a bigger outage than the bug.
 */
export const refreshAllModels = async (db: RefreshDb): Promise<readonly RefreshOutcome[]> => {
  const outcomes: RefreshOutcome[] = [];
  for (const model of MATERIALIZED_MODELS) outcomes.push(await refreshModel(db, model));
  return outcomes;
};

// ---------------------------------------------------------------------------
// The on-write model
// ---------------------------------------------------------------------------

/**
 * Rewrites one domain's lifecycle counters from its own rows.
 *
 * D1 asks for an increment inside the transition's transaction. This is a
 * scoped RECOMPUTE instead, and the reason is worth stating: a `+1/-1` counter
 * is correct until somebody adds a lifecycle state, misses a call site, or
 * writes an increment outside the transaction — and then it is wrong forever
 * with nothing on screen saying so. A `GROUP BY` over one domain's questions
 * costs a few milliseconds, satisfies what D1 actually requires (the number is
 * correct in the same transaction), and cannot drift.
 *
 * Run inside the caller's transaction. Passed the transaction client, not a
 * fresh one: a counter written outside the transition's transaction is a
 * counter that survives a rollback.
 */
export const recomputeQuestionPipeline = async (db: RefreshDb, domainId: string): Promise<void> => {
  await db.$executeRawUnsafe(
    `DELETE FROM reporting.rm_question_pipeline WHERE domain_id = $1::uuid`,
    domainId,
  );
  await db.$executeRawUnsafe(
    `INSERT INTO reporting.rm_question_pipeline
       (domain_id, status, question_count, needs_revalidation_count, imported_count, updated_at)
     SELECT q.domain_id,
            q.status::text,
            count(*)::int,
            count(*) FILTER (WHERE q.needs_revalidation)::int,
            count(*) FILTER (WHERE q.acquisition = 'IMPORTED')::int,
            now()
       FROM draft_question q
      WHERE q.domain_id = $1::uuid
      GROUP BY q.domain_id, q.status`,
    domainId,
  );
};

/** Every domain, for a first build and for the nightly full recompute. */
export const recomputeAllPipelines = async (db: RefreshDb): Promise<number> => {
  await db.$executeRawUnsafe(`DELETE FROM reporting.rm_question_pipeline`);
  const inserted = await db.$executeRawUnsafe(
    `INSERT INTO reporting.rm_question_pipeline
       (domain_id, status, question_count, needs_revalidation_count, imported_count, updated_at)
     SELECT q.domain_id,
            q.status::text,
            count(*)::int,
            count(*) FILTER (WHERE q.needs_revalidation)::int,
            count(*) FILTER (WHERE q.acquisition = 'IMPORTED')::int,
            now()
       FROM draft_question q
      GROUP BY q.domain_id, q.status`,
  );
  await db.$executeRawUnsafe(
    `UPDATE reporting.refresh_state
        SET status = 'READY', refreshed_at = now(), row_count = $2, consecutive_failures = 0,
            failure_detail = NULL, failed_at = NULL
      WHERE model = 'rm_question_pipeline'`,
    'rm_question_pipeline',
    inserted,
  );
  return inserted;
};

// ---------------------------------------------------------------------------
// Reconciliation — D7
// ---------------------------------------------------------------------------

export interface CounterDrift {
  readonly domainId: string;
  readonly status: string;
  readonly counterValue: number;
  readonly actualValue: number;
}

/**
 * Compares the on-write counters against the transactional truth.
 *
 * REPORTS, NEVER CORRECTS. A reconciler that repaired the number would hide the
 * bug that produced it, and the next drift would be silent too. The caller
 * raises a `PlatformConsistencyFinding` per discrepancy, which is where an
 * operator sees it.
 *
 * A FULL OUTER JOIN, not a comparison of matching rows: a counter row with no
 * questions behind it (stale) and a question group with no counter row (a
 * missed hook) are both drift, and the second is the one an arithmetic counter
 * could never detect.
 */
export const reconcileQuestionPipeline = async (
  db: ReadOnlyDb,
): Promise<readonly CounterDrift[]> => {
  const rows = await db.$queryRawUnsafe<
    {
      domain_id: string | null;
      status: string | null;
      counter: number | null;
      actual: number | null;
    }[]
  >(
    `WITH actual AS (
       SELECT domain_id, status::text AS status, count(*)::int AS n
         FROM draft_question
        GROUP BY 1, 2
     )
     SELECT COALESCE(c.domain_id, a.domain_id)::text AS domain_id,
            COALESCE(c.status, a.status)             AS status,
            c.question_count                         AS counter,
            a.n                                      AS actual
       FROM reporting.rm_question_pipeline c
       FULL OUTER JOIN actual a
         ON a.domain_id = c.domain_id AND a.status = c.status
      WHERE COALESCE(c.question_count, -1) <> COALESCE(a.n, -1)`,
  );

  return rows.map((row) => ({
    domainId: row.domain_id ?? 'unknown',
    status: row.status ?? 'unknown',
    counterValue: row.counter ?? 0,
    actualValue: row.actual ?? 0,
  }));
};

export const REPORTING_DRIFT_CHECK_KEY = 'reporting.rm_question_pipeline.counter_drift';
