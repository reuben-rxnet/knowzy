// Scoped data access — access-control.md §4.3 P3 and §5.
//
// "A policy returns a dataScope, and the handler is structurally required to
//  pass it to the repository. Repository methods take a DataScope parameter; a
//  query built without one does not compile."
//
// Two things make that true rather than aspirational:
//
//   1. every scoped read takes `scope: DataScope` as a REQUIRED parameter, so
//      omitting it is a type error (C9);
//   2. the scope is translated into a WHERE predicate here, not applied as a
//      post-filter — so row counts, pagination, and aggregates are all
//      computed within scope, and a suppressed row never affects a count the
//      caller can see.
//
// Empty means unrestricted (§5). Every predicate below is written
// "set is empty OR intersects", which is why an unscoped administrator works.

import type { DataScope } from '@knowzy/shared-types';

/** A Prisma `where` fragment. Intentionally loose: shapes differ per model. */
export type WherePredicate = Record<string, unknown>;

/**
 * Domain predicate for a model with a `domainId` column.
 * Returns `{}` when the scope is unrestricted on domain.
 */
export const domainPredicate = (scope: DataScope): WherePredicate =>
  scope.domainIds.length === 0 ? {} : { domainId: { in: [...scope.domainIds] } };

/** Team predicate for a model with a `teamId` column. */
export const teamPredicate = (scope: DataScope): WherePredicate =>
  scope.teamIds.length === 0 ? {} : { teamId: { in: [...scope.teamIds] } };

/**
 * Source predicate. DENY is evaluated first so it beats an allow-list and an
 * unrestricted scope alike.
 */
export const sourcePredicate = (scope: DataScope, column = 'sourceId'): WherePredicate => {
  const clauses: WherePredicate[] = [];
  if (scope.denySourceIds.length > 0) {
    clauses.push({ [column]: { notIn: [...scope.denySourceIds] } });
  }
  if (scope.sourceIds.length > 0) {
    clauses.push({ [column]: { in: [...scope.sourceIds] } });
  }
  if (clauses.length === 0) return {};
  if (clauses.length === 1) return clauses[0] as WherePredicate;
  return { AND: clauses };
};

/** Ownership predicate for an own-scoped resource — security.md §9 D2. */
export const ownerPredicate = (scope: DataScope, column = 'learnerUserId'): WherePredicate => ({
  [column]: scope.ownSubjectId,
});

/** Combines predicates, dropping the empty ones so the query stays readable. */
export const andPredicates = (...parts: readonly WherePredicate[]): WherePredicate => {
  const present = parts.filter((p) => Object.keys(p).length > 0);
  if (present.length === 0) return {};
  if (present.length === 1) return present[0] as WherePredicate;
  return { AND: present };
};

/**
 * A scoped read. The `scope` parameter is required, which is the compile-time
 * half of C9; the runtime half is that the implementation must build its WHERE
 * from the predicates above.
 */
export type ScopedRead<TArgs, TResult> = (scope: DataScope, args: TArgs) => Promise<TResult>;

/**
 * Marks a query as deliberately unscoped, with a written reason.
 *
 * Two legitimate cases exist: platform configuration (not person-scoped at
 * all), and audit reads, which are unscoped by design because redaction at
 * write time is what makes that safe and an auditor with partial visibility
 * cannot audit. Anything else using this is a finding in review.
 */
export const unscoped = <T>(reason: string, query: () => Promise<T>): Promise<T> => {
  if (reason.trim().length < 10) {
    throw new Error('unscoped() requires a written reason.');
  }
  return query();
};
