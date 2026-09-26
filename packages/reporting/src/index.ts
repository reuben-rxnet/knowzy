// @knowzy/reporting
//
// Read-model queries, aggregation, suppression, export rendering.
//
// Boundary: The only package besides the similarity module permitted raw SQL, parameterized. No transactional writes.
//
// PHASE 10 STARTED 2026-09-26. The placeholder is gone: this package now holds
// real read models, beginning with the Audit Explorer, which had 64,479 real
// events waiting for it.
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
