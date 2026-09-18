// Policy registry — access-control.md §4.
//
// A policy is a named server-side check: (subject, action, resource?) ->
// allow | deny + dataScope. Every API route and every MCP tool declares exactly
// one (§4.3 P1), and the registry test asserts there are no undeclared
// handlers. Navigation filtering in a browser is a convenience and is never the
// enforcement point.
//
// Policy names match their permission key wherever §4.2 does the same, so a
// denial message names something an administrator can actually grant.

import type { PermissionKey, PortalContext } from '@knowzy/shared-types';

export interface PolicyDefinition {
  /** The permission the subject must hold. */
  readonly permission: PermissionKey;
  /** Portals whose subjects may invoke this policy at all (E5). */
  readonly portals: readonly PortalContext[];
  /** What the policy guards, for the denial audit record and for reviewers. */
  readonly description: string;
  /**
   * True when the resource is owned by the subject and ownership is the check
   * (security.md §9). The handler must compare inside the query, and a mismatch
   * returns 404 rather than 403 so the response is not an existence oracle.
   */
  readonly ownScoped?: true;
}

const AUTHORING: readonly PortalContext[] = ['AUTHORING', 'SYSTEM'];
const LIVE: readonly PortalContext[] = ['LIVE', 'SYSTEM'];

/**
 * The MVP policy set. Later phases extend this table alongside the routes that
 * need it; the registry test fails the build on a route without an entry, so
 * the table cannot silently fall behind.
 */
export const POLICIES = {
  // ----------------------------------------------------- source administration
  // Read-only taxonomy, so an authoring screen can offer a domain and topic by
  // NAME. Without it the UI would have to make someone paste a UUID, and a
  // pasted UUID is a wrong UUID.
  'taxonomy.read': {
    permission: 'taxonomy.read',
    portals: AUTHORING,
    description: 'Read the domain and topic catalogue.',
  },
  'source.read': {
    permission: 'source.read',
    portals: AUTHORING,
    description: 'Read knowledge source configuration and health.',
  },
  'source.manage': {
    permission: 'source.manage',
    portals: AUTHORING,
    description: 'Create, edit, activate, or archive a knowledge source.',
  },
  'source.test': {
    permission: 'source.test',
    portals: AUTHORING,
    description: 'Run the Test Connection probe against a source.',
  },
  'source.sync': {
    permission: 'source.sync',
    portals: AUTHORING,
    description: 'Synchronize source metadata and extracted text.',
  },

  // ------------------------------------------------------------- documents
  'document.browse': {
    permission: 'document.browse',
    portals: AUTHORING,
    description: 'Browse indexed documents and their extraction status.',
  },

  // ------------------------------------------------------------ generation
  'question.generate': {
    permission: 'question.generate',
    portals: AUTHORING,
    description: 'Run generation preflight and create a generation job.',
  },

  // ------------------------------------------------- question lifecycle
  'question.read': {
    permission: 'question.read',
    portals: AUTHORING,
    description: 'Read a question, its lineage, and its evidence.',
  },
  'question.edit': {
    permission: 'question.edit',
    portals: AUTHORING,
    description: 'Edit a draft question, creating a new version.',
  },
  'question.submit': {
    permission: 'question.submit',
    portals: AUTHORING,
    description: 'Submit a draft for approval.',
  },
  'question.review': {
    permission: 'question.review',
    portals: AUTHORING,
    description: 'Reject or request changes, with a mandatory comment.',
  },
  'question.approve': {
    permission: 'question.approve',
    portals: AUTHORING,
    description: 'Approve a question. Subject to 13 gates and separation of duties.',
  },
  'question.publish': {
    permission: 'question.publish',
    portals: AUTHORING,
    description: 'Publish an approved question to the Question Bank.',
  },
  'question.retire': {
    permission: 'question.retire',
    portals: AUTHORING,
    description: 'Retire a published question. The bank item is never deleted.',
  },
  'question.archive': {
    permission: 'question.archive',
    portals: AUTHORING,
    description: 'Archive a draft, rejected, or retired question.',
  },

  // ----------------------------------------------------------- assessments
  'assessment.read': {
    permission: 'assessment.read',
    portals: AUTHORING,
    description: 'Read assessment definitions and pool feasibility.',
  },
  'assessment.manage': {
    permission: 'assessment.manage',
    portals: AUTHORING,
    description: 'Create and configure an assessment version.',
  },
  'assessment.publish': {
    permission: 'assessment.publish',
    portals: AUTHORING,
    description: 'Publish an assessment version and pin its eligibility snapshot.',
  },

  // -------------------------------------------------------------- learning
  'learning.access': {
    permission: 'learning.access',
    portals: LIVE,
    description: 'Reach the Live Learning Portal at all.',
  },
  'learning.assessment.list': {
    permission: 'learning.assessment.list',
    portals: LIVE,
    description: 'Discover published assessments the learner is eligible for.',
  },
  'learning.session.create': {
    permission: 'learning.session.create',
    portals: LIVE,
    description: 'Start an attempt. Creates the server-side question snapshot.',
  },
  'learning.session.own': {
    permission: 'learning.session.own',
    portals: LIVE,
    description: 'Read or answer within the learner\u2019s own session.',
    ownScoped: true,
  },
  'learning.result.own': {
    permission: 'learning.result.own',
    portals: LIVE,
    description: 'Read the learner\u2019s own result.',
    ownScoped: true,
  },
} as const satisfies Record<string, PolicyDefinition>;

export type PolicyName = keyof typeof POLICIES;
export const POLICY_NAMES = Object.keys(POLICIES) as readonly PolicyName[];

export const policyDefinition = (name: PolicyName): PolicyDefinition => POLICIES[name];

export const isPolicyName = (value: string): value is PolicyName =>
  Object.prototype.hasOwnProperty.call(POLICIES, value);
