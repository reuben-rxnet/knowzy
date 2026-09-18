// @knowzy/authentication
//
// Token validation, subject resolution, and (later) the on-behalf-of broker —
// security.md §2.
//
// Boundary: owns authentication only. Policy decisions belong to
// @knowzy/authorization. The database lookup is injected, so this package
// performs no data access itself.

export * from './subject-resolver.js';
