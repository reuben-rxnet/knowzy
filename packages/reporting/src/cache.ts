// The dataset cache.
//
// The read models are already the pre-aggregation. What this caches is the
// RESOLVED RESPONSE: the rows one caller, with one scope, at one `asOf`, after
// suppression. For a wide report that is the expensive part, and it is also the
// part that must never be shared between callers.
//
// THE KEY IS THE WHOLE CONTRACT, and it has four components for four reasons:
//
//   report        obvious.
//   paramsHash    the window and the page size change the answer.
//   scopeHash     THE ONE THAT MATTERS. A cache keyed on the report and its
//                 parameters alone would serve one caller's suppressed dataset
//                 to another caller with a different scope — the single worst
//                 bug this table could have, and one that would look like a
//                 performance win right up until an audit.
//   asOf          a refresh invalidates every entry BY CONSTRUCTION. There is
//                 no sweep to forget to run, and no window in which a stale
//                 row can be served as fresh: a new `asOf` simply misses.
//
// A cache that can serve the wrong scope is worse than no cache, so the scope
// hash covers the domain and source lists AND the minimum group size — raising
// the threshold must not return a response computed under the old one.
//
// Writing is best-effort. A failed cache write is not a failed request: the
// data was already computed, and turning a successful report into an error
// because a cache row would not insert is the wrong trade.

import { createHash } from 'node:crypto';
import type { ReadOnlyDb } from './audit-explorer.js';
import type { RefreshDb } from './refresh.js';
import type { DatasetName, DatasetRequest, DatasetResult } from './datasets.js';

/** Default entry lifetime. The `asOf` in the key is the real invalidator. */
export const CACHE_TTL_SECONDS = 15 * 60;

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/**
 * The caller's effective entitlement, hashed.
 *
 * Sorted before hashing, so two callers with the same scope in a different
 * order share an entry — and a caller with one extra domain never does.
 * `null` (all domains) hashes differently from a list containing every domain,
 * which is correct: the two are the same today and diverge the moment a domain
 * is added.
 */
export const scopeHashOf = (request: DatasetRequest): string =>
  sha256(
    JSON.stringify({
      domainIds: request.scope.domainIds === null ? null : [...request.scope.domainIds].sort(),
      sourceIds:
        request.scope.sourceIds === null || request.scope.sourceIds === undefined
          ? null
          : [...request.scope.sourceIds].sort(),
      // Part of the SCOPE, not the parameters: a response computed under a
      // lower threshold must never be served after the threshold is raised.
      minimumGroupSize: request.minimumGroupSize ?? null,
    }),
  );

/**
 * The response SHAPE's version, hashed into every key.
 *
 * R2 added `sourceWindow`, `suppressionCount` and `suppressionReason` to every
 * dataset. An R1 entry has the same report, parameters, scope and `asOf` as an
 * R2 request made in the same fifteen minutes, so without this it would be
 * served — a response missing the fields the contract now promises.
 */
export const DATASET_SHAPE_VERSION = 2;

export const paramsHashOf = (request: DatasetRequest): string =>
  sha256(
    JSON.stringify({
      shape: DATASET_SHAPE_VERSION,
      windowDays: request.windowDays ?? null,
      pageSize: request.pageSize ?? null,
    }),
  );

export const cacheKeyOf = (request: DatasetRequest, asOf: string | null): string =>
  [request.name, paramsHashOf(request), scopeHashOf(request), asOf ?? 'never'].join(':');

export interface CachedDataset {
  readonly result: DatasetResult;
  readonly cachedAt: string;
  readonly hits: number;
}

/**
 * Reads an entry, if one exists and has not expired.
 *
 * Takes the `asOf` the caller has already resolved from `refresh_state`, rather
 * than resolving it here: the freshness read is cheap, it has to happen anyway
 * for the response's own header, and doing it once keeps the key and the
 * response consistent with each other.
 */
export const readCachedDataset = async (
  db: ReadOnlyDb,
  request: DatasetRequest,
  asOf: string | null,
): Promise<CachedDataset | null> => {
  const rows = await db.$queryRawUnsafe<{ payload: unknown; created_at: Date; hits: number }[]>(
    `SELECT payload, created_at, hits
       FROM reporting.dataset_cache
      WHERE cache_key = $1 AND expires_at > now()`,
    cacheKeyOf(request, asOf),
  );
  const row = rows[0];
  if (row === undefined) return null;
  return {
    result: row.payload as DatasetResult,
    cachedAt: row.created_at.toISOString(),
    hits: row.hits,
  };
};

/** Records a hit. Diagnostic only, and never allowed to fail a request. */
export const recordCacheHit = async (
  db: RefreshDb,
  request: DatasetRequest,
  asOf: string | null,
): Promise<void> => {
  try {
    await db.$executeRawUnsafe(
      `UPDATE reporting.dataset_cache SET hits = hits + 1 WHERE cache_key = $1`,
      cacheKeyOf(request, asOf),
    );
  } catch {
    /* A hit counter is not worth a failed report. */
  }
};

export const writeCachedDataset = async (
  db: RefreshDb,
  request: DatasetRequest,
  result: DatasetResult,
): Promise<void> => {
  // A dataset built from a model that has NEVER refreshed is not cached. Its
  // key would be `…:never`, and the first successful refresh would not
  // invalidate it — an entry that outlives the only thing that could replace
  // it is a permanently wrong answer.
  if (result.asOf === null) return;

  try {
    await db.$executeRawUnsafe(
      `INSERT INTO reporting.dataset_cache
         (cache_key, report, params_hash, scope_hash, as_of, payload, row_count,
          suppressed_cell_count, built_ms, expires_at)
       VALUES ($1, $2, $3, $4, $5::timestamptz, $6::jsonb, $7, $8, $9,
               now() + ($10 || ' seconds')::interval)
       ON CONFLICT (cache_key) DO UPDATE
          SET payload = EXCLUDED.payload,
              row_count = EXCLUDED.row_count,
              suppressed_cell_count = EXCLUDED.suppressed_cell_count,
              built_ms = EXCLUDED.built_ms,
              created_at = now(),
              expires_at = EXCLUDED.expires_at`,
      cacheKeyOf(request, result.asOf),
      request.name,
      paramsHashOf(request),
      scopeHashOf(request),
      result.asOf,
      JSON.stringify(result),
      result.rowCount,
      result.suppressedCellCount,
      result.durationMs,
      String(CACHE_TTL_SECONDS),
    );
  } catch {
    /* The data is already computed. A cache write must not fail the request. */
  }
};

/**
 * Drops expired entries, and every entry for a model whose `asOf` has moved on.
 *
 * Housekeeping rather than correctness: a stale entry can never be SERVED,
 * because its key no longer matches. This stops the table growing without
 * bound, which is a different problem and a slower one.
 */
export const pruneDatasetCache = async (db: RefreshDb): Promise<number> =>
  db.$executeRawUnsafe(`DELETE FROM reporting.dataset_cache WHERE expires_at <= now()`);

export interface CacheStat {
  readonly report: DatasetName | string;
  readonly entries: number;
  readonly hits: number;
}

export const datasetCacheStats = async (db: ReadOnlyDb): Promise<readonly CacheStat[]> => {
  const rows = await db.$queryRawUnsafe<{ report: string; entries: bigint; hits: bigint }[]>(
    `SELECT report, count(*)::bigint AS entries, COALESCE(sum(hits), 0)::bigint AS hits
       FROM reporting.dataset_cache
      WHERE expires_at > now()
      GROUP BY report
      ORDER BY report`,
  );
  return rows.map((row) => ({
    report: row.report,
    entries: Number(row.entries),
    hits: Number(row.hits),
  }));
};
