// Policy engine — access-control.md §1 and §5.
//
// Four independent layers, all of which must permit an action:
//   1. authentication  — a resolved subject with an active account
//   2. portal access   — authoringPortalAccess / livePortalAccess
//   3. permission      — the union of role permissions
//   4. data scope      — returned as a PREDICATE, not applied as a post-filter
//
// Layers 3 and 4 are separate on purpose: a permission check answers "may this
// kind of user do this kind of thing", a scope resolution answers "to THIS row".
// Conflating them is the usual source of authorization bugs, so the engine
// returns a boolean AND a DataScope and the caller is required to thread the
// scope into the repository.
//
// No database import: the subject and its scopes arrive already resolved. That
// keeps this package pure and testable, and keeps the single resolution path in
// @knowzy/database where the repositories live.

import {
  unrestrictedScope,
  type DataScope,
  type PortalContext,
  type Subject,
} from '@knowzy/shared-types';
import { POLICIES, type PolicyName } from './policies.js';

export type DenialCode = 'UNAUTHENTICATED' | 'PORTAL_ACCESS_DENIED' | 'FORBIDDEN';

export interface AllowDecision {
  readonly allowed: true;
  readonly policyName: PolicyName;
  readonly scope: DataScope;
}

export interface DenyDecision {
  readonly allowed: false;
  readonly policyName: PolicyName;
  readonly code: DenialCode;
  /** Safe for an audit record and for an operator log. Never leaks resource existence. */
  readonly reason: string;
}

export type Decision = AllowDecision | DenyDecision;

/**
 * Builds the data scope for a subject — §5.
 *
 * Empty means unrestricted, which is why every predicate downstream reads
 * "set is empty OR intersects". An unscoped administrator therefore works, and
 * an unscoped author is a configuration error caught at assignment time rather
 * than a silently-denied user.
 */
export const resolveDataScope = (subject: Subject): DataScope => ({
  ...unrestrictedScope(subject.userId),
  domainIds: [...subject.domainIds],
  teamIds: [...subject.teamIds],
  sourceIds: [...subject.allowSourceIds],
  denySourceIds: [...subject.denySourceIds],
});

export interface AuthorizeInput {
  readonly subject: Subject | null;
  readonly policy: PolicyName;
  readonly portal: PortalContext;
}

/**
 * Evaluates a policy. Order matters and follows §5.1: permission before data
 * scope, and neither before authentication.
 */
export const authorize = (input: AuthorizeInput): Decision => {
  const definition = POLICIES[input.policy];

  // 1 — authentication
  if (!input.subject) {
    return {
      allowed: false,
      policyName: input.policy,
      code: 'UNAUTHENTICATED',
      reason: 'No authenticated subject.',
    };
  }

  const subject = input.subject;

  if (subject.status !== 'ACTIVE') {
    // S5: account status is checked per request, so revocation does not wait
    // for a token to expire.
    return {
      allowed: false,
      policyName: input.policy,
      code: 'PORTAL_ACCESS_DENIED',
      reason: `Account status is ${subject.status}.`,
    };
  }

  // 2 — portal access. E5: a policy not declared for this portal is refused
  // outright, so a learner token cannot reach an authoring policy even if the
  // permission were somehow present.
  if (!definition.portals.includes(input.portal)) {
    return {
      allowed: false,
      policyName: input.policy,
      code: 'PORTAL_ACCESS_DENIED',
      reason: `Policy is not available from the ${input.portal} portal.`,
    };
  }

  const portalPermitted =
    input.portal === 'SYSTEM' ||
    (input.portal === 'AUTHORING' && subject.authoringPortalAccess) ||
    (input.portal === 'LIVE' && subject.livePortalAccess);

  if (!portalPermitted) {
    return {
      allowed: false,
      policyName: input.policy,
      code: 'PORTAL_ACCESS_DENIED',
      reason: `Account does not have ${input.portal} portal access.`,
    };
  }

  // 3 — permission
  if (!subject.permissions.includes(definition.permission)) {
    return {
      allowed: false,
      policyName: input.policy,
      code: 'FORBIDDEN',
      // Names the permission, not the resource: an unauthorized caller learns
      // what to ask for, not whether the thing exists.
      reason: `Requires permission ${definition.permission}.`,
    };
  }

  // 4 — data scope, returned as a predicate for the handler to thread through
  return { allowed: true, policyName: input.policy, scope: resolveDataScope(subject) };
};

/** Convenience for a handler that only needs the boolean. */
export const permits = (input: AuthorizeInput): boolean => authorize(input).allowed;
