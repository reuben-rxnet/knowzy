// @knowzy/reporting
//
// Read-model queries, aggregation, suppression, export rendering.
//
// Boundary: The only package besides the similarity module permitted raw SQL, parameterized. No transactional writes.
//
// PHASE 10 R1, 2026-09-26. The placeholder is long gone: this package holds the
// report catalogue, the read-model queries, the suppression engine, the refresh
// runner, the dataset cache and the export renderer.
//
// The design that governs the surface is
// docs/ui/REPORTING_AND_ANALYTICS_UI_SOURCE_OF_TRUTH.md, and reporting.md is the
// authority on everything below it. Two module boundaries worth knowing:
//
//   * `suppression.ts` is PURE. Given rows and a threshold it returns rows and
//     a count. That is why the derivation attack S3 exists to stop can be
//     tested as a table rather than through a database.
//   * `refresh.ts` is the only module here that writes, and only to the
//     `reporting` schema. Everything else takes `ReadOnlyDb`, a structural type
//     with one method, so a read model cannot reach a Prisma model at all.
//
// Raw SQL lives here by permission (repository-structure.md §5 reserves it for
// this package and the similarity module) and is parameterized throughout. No
// transactional writes: a read model that could write would be a second,
// untested path into the same tables.

export const PACKAGE_NAME = '@knowzy/reporting' as const;

export {
  AUDIT_CSV_HEADER,
  DEFAULT_PAGE_SIZE,
  DEFAULT_WINDOW_DAYS,
  MAX_PAGE_SIZE,
  auditCsvCell,
  getAuditEvent,
  getAuditEvents,
  getAuditFacets,
  toAuditCsv,
  type AuditDetail,
  type AuditFilters,
  type AuditPage,
  type AuditRow,
  type ReadOnlyDb,
} from './audit-explorer.js';

export {
  MINIMUM_GROUP_SIZE_FLOOR,
  SUPPRESSED,
  applySuppression,
  effectiveMinimumGroupSize,
  isSuppressed,
  visibleTotals,
  type DatasetRow,
  type Measure,
  type SuppressionPolicy,
  type SuppressionResult,
} from './suppression.js';

export {
  DATASETS,
  DATASET_DEFINITIONS,
  MAX_DATASET_ROWS,
  isDatasetName,
  readAllFreshness,
  readFreshness,
  runDataset,
  type DatasetDefinition,
  type DatasetFreshness,
  type DatasetName,
  type DatasetRequest,
  type DatasetResult,
  type DatasetScope,
  type MetricDefinition,
} from './datasets.js';

export {
  MATERIALIZED_MODELS,
  ON_WRITE_MODELS,
  REPORTING_DRIFT_CHECK_KEY,
  recomputeAllPipelines,
  recomputeQuestionPipeline,
  reconcileQuestionPipeline,
  refreshAllModels,
  refreshModel,
  type CounterDrift,
  type MaterializedModel,
  type RefreshDb,
  type RefreshOutcome,
} from './refresh.js';

export {
  CACHE_TTL_SECONDS,
  cacheKeyOf,
  datasetCacheStats,
  paramsHashOf,
  pruneDatasetCache,
  readCachedDataset,
  recordCacheHit,
  scopeHashOf,
  writeCachedDataset,
  type CacheStat,
  type CachedDataset,
} from './cache.js';

export {
  captureSnapshot,
  csvCell,
  csvHeaderBlock,
  listSnapshots,
  readSnapshot,
  toDatasetCsv,
  type CaptureSnapshotArgs,
  type ExportContext,
  type SnapshotRow,
} from './export.js';
