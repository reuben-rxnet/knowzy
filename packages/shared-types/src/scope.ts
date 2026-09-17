// Data scope — access-control.md §5.
//
// An EMPTY set on a dimension means UNRESTRICTED on that dimension, not
// "nothing". Every check is written "set is empty OR intersects", which is why
// an unscoped administrator works and an unscoped author is a configuration
// error caught at assignment time. Getting this backwards is the single most
// consequential mistake available in this file, so the helpers below are the
// only sanctioned way to evaluate it.

import { z } from 'zod';

export const DataScopeSchema = z.object({
  /** Empty = unrestricted on domain. */
  domainIds: z.array(z.string().uuid()),
  /** Empty = unrestricted on team. Managers receive their managed subtree. */
  teamIds: z.array(z.string().uuid()),
  /** Empty = no allow-list exists for sources. */
  sourceIds: z.array(z.string().uuid()),
  /** An explicit DENY always wins, including over unrestricted domain scope. */
  denySourceIds: z.array(z.string().uuid()),
  /** The subject itself, for own-scoped resources. */
  ownSubjectId: z.string().uuid(),
});
export type DataScope = z.infer<typeof DataScopeSchema>;

export const unrestrictedScope = (ownSubjectId: string): DataScope => ({
  domainIds: [],
  teamIds: [],
  sourceIds: [],
  denySourceIds: [],
  ownSubjectId,
});

/** True when the scope permits this domain. Empty means unrestricted. */
export const permitsDomain = (scope: DataScope, domainId: string | null): boolean => {
  if (scope.domainIds.length === 0) return true;
  if (domainId === null) return false;
  return scope.domainIds.includes(domainId);
};

/** True when the scope permits this team. Empty means unrestricted. */
export const permitsTeam = (scope: DataScope, teamId: string | null): boolean => {
  if (scope.teamIds.length === 0) return true;
  if (teamId === null) return false;
  return scope.teamIds.includes(teamId);
};

/**
 * Source access, with DENY evaluated first so it beats an allow-list and an
 * unrestricted scope alike.
 */
export const permitsSource = (scope: DataScope, sourceId: string): boolean => {
  if (scope.denySourceIds.includes(sourceId)) return false;
  if (scope.sourceIds.length === 0) return true;
  return scope.sourceIds.includes(sourceId);
};

export const ownsResource = (scope: DataScope, ownerUserId: string): boolean =>
  scope.ownSubjectId === ownerUserId;
