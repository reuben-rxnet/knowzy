// Permission keys (access-control.md §4.1) and the role catalogue (§2).
//
// The permission key union is closed: a typo is a compile error, not a
// permanently-denied route (§4.3 P6).
//
// ROLE_PERMISSIONS is the seeded matrix. access-control.md §2 lists each role's
// *notable* permissions rather than an exhaustive set; where this matrix grants
// more than the document enumerates, the addition is marked `// +` and is the
// minimum needed for the role to reach the routes the document assigns it.
// Role definitions are seeded configuration and read-only in release 1, so a
// change here is a deployment with a visible diff.

import { z } from 'zod';
import type { PortalScope } from './enums.js';

export const PERMISSION_KEYS = [
  // platform
  'platform.configure',
  // access
  'access.manage',
  'access.read',
  // taxonomy
  'taxonomy.manage',
  'taxonomy.read',
  // competency (COMPETENCY-M2). Held by KNOWZY_ADMINISTRATOR ONLY, by product
  // decision A2 (docs/competencies/COMPETENCY_ADMINISTRATION.md §2). Reading
  // the catalogue needs taxonomy.read. A contract test refuses another holder.
  'competency.manage',
  // source
  'source.read',
  'source.manage',
  'source.test',
  'source.sync',
  // document
  'document.browse',
  'document.section.manage',
  'document.exclude',
  // question
  'question.read',
  'question.generate',
  'question.import',
  'question.regenerate',
  'question.edit',
  'question.submit',
  'question.review',
  'question.review.edit',
  'question.approve',
  'question.approve.bulk',
  'question.publish',
  'question.retire',
  'question.archive',
  // question bank
  'questionbank.reconcile',
  // assessment
  'assessment.read',
  'assessment.manage',
  'assessment.approve',
  'assessment.publish',
  // report
  'report.read',
  'report.create',
  'report.export',
  'report.approve',
  'report.publish',
  // audit
  'audit.read',
  'audit.export',
  // authoring shell
  'authoring.dashboard.view',
  // learning
  'learning.access',
  'learning.assessment.list',
  'learning.session.create',
  'learning.session.own',
  'learning.result.own',
  'learning.result.team',
  'learning.recommendation.own',
  'learning.badge.own',
  'learning.certificate.own',
] as const;

export const PermissionKeySchema = z.enum(PERMISSION_KEYS);
export type PermissionKey = z.infer<typeof PermissionKeySchema>;

/** Family is the first dot-segment, used for grouping in the access UI and audit. */
export const permissionFamily = (key: PermissionKey): string => key.split('.')[0] ?? key;

export const ROLE_KEYS = [
  'KNOWZY_ADMINISTRATOR',
  'PLATFORM_ADMINISTRATOR',
  'SOURCE_ADMINISTRATOR',
  'AUTHOR',
  'SUBJECT_MATTER_EXPERT',
  'REVIEWER',
  'APPROVER',
  'PUBLISHER',
  'ASSESSMENT_MANAGER',
  'MANAGER',
  'REPORTING_USER',
  'REPORT_PUBLISHER',
  'AUDITOR',
  'LEARNER',
] as const;

export const RoleKeySchema = z.enum(ROLE_KEYS);
export type RoleKey = z.infer<typeof RoleKeySchema>;

/**
 * The roles in use since the Authoring Role Simplification (2026-10-07,
 * access-control.md §2.0): the Authoring Administrator and the Learner.
 *
 * Every other role stays DEFINED -- historical audit rows and grants name them
 * -- but is seeded inactive, and a grant on an inactive role confers no
 * permission (the identity read filters on `role.is_active`). A contract test
 * pins this list.
 */
export const ACTIVE_ROLE_KEYS: readonly RoleKey[] = ['KNOWZY_ADMINISTRATOR', 'LEARNER'];
export const isActiveRole = (key: RoleKey): boolean => ACTIVE_ROLE_KEYS.includes(key);

export interface RoleDefinition {
  readonly key: RoleKey;
  readonly name: string;
  readonly description: string;
  readonly portalScope: PortalScope;
  readonly permissions: readonly PermissionKey[];
}

const AUTHORING_SHELL: readonly PermissionKey[] = ['authoring.dashboard.view', 'taxonomy.read'];

export const ROLE_DEFINITIONS: readonly RoleDefinition[] = [
  {
    key: 'KNOWZY_ADMINISTRATOR',
    // Shown as "Authoring Administrator" since the Authoring Role
    // Simplification. The KEY is unchanged on purpose: audit rows, grants and
    // tests name it, and a renamed key would make history read as two roles.
    name: 'Authoring Administrator',
    description:
      'Every authoring function, for the small team that operates the platform: sources, ' +
      'generation, review, approval, publication, assessments, reporting, taxonomy, ' +
      'competencies, AI providers, budgets and governance.',
    portalScope: 'BOTH',
    // DERIVED from the closed key union rather than enumerated, so the role
    // cannot fall behind when a permission is added.
    //
    // EVERY key, including `question.publish`, since the Authoring Role
    // Simplification (2026-10-07). Until then the role withheld publish and
    // the administrator user also held PUBLISHER, to keep access-control.md §2
    // rule 3 literally true. The product owner retired the specialist roles,
    // so the rule now binds only them (they are inactive), and this role holds
    // both approve and publish by recorded decision (§2.0).
    //
    // Separation of duties is NOT a permission and is not removed: it is the
    // `approval.*` settings, which the platform sets to permit self-approval
    // and which can be turned back on without a release.
    permissions: [...PERMISSION_KEYS],
  },
  {
    key: 'PLATFORM_ADMINISTRATOR',
    name: 'Platform Administrator',
    description:
      'Platform configuration, taxonomy, profiles, field mappings, feature flags, break-glass.',
    portalScope: 'AUTHORING',
    permissions: [
      ...AUTHORING_SHELL,
      'platform.configure',
      'access.manage',
      'access.read',
      'taxonomy.manage',
      'source.read',
      'source.manage',
      'source.test',
      'source.sync',
      'questionbank.reconcile',
      'document.browse', // +  reaching /documents to diagnose a source
      'question.read', // +  reading a question to resolve drift
      'audit.read', // +  authoring-portal.md §10 grants the Audit Explorer to this role
      'audit.export', // +
      'report.read', // +
    ],
  },
  {
    key: 'SOURCE_ADMINISTRATOR',
    name: 'Knowledge Source Administrator',
    description: 'Keep source paths accurate and connections healthy.',
    portalScope: 'AUTHORING',
    permissions: [
      ...AUTHORING_SHELL,
      'source.read',
      'source.manage',
      'source.test',
      'source.sync',
      'document.browse',
      'document.exclude', // +  §2.3 exclusion is a source-hygiene action
      'report.read', // +  the source health and extraction failure reports
    ],
  },
  {
    key: 'AUTHOR',
    name: 'Quiz Author',
    description: 'Turn a document into good draft questions quickly.',
    portalScope: 'AUTHORING',
    permissions: [
      ...AUTHORING_SHELL,
      'question.generate',
      // Importing an existing question bank is a DIFFERENT capability from
      // generating, not the same one by another route: it brings in content
      // written outside this platform, for a purpose the platform cannot see.
      // A tenant may reasonably allow one and not the other, so it is its own
      // key rather than a reuse of `question.generate`.
      'question.import',
      'question.edit',
      'question.submit',
      'question.read',
      'question.archive', // +  §5.3 "archive draft" is an author capability
      'document.browse',
      'document.section.manage',
      'document.exclude', // +
      'source.read', // +  the source picker on the generation form
    ],
  },
  {
    key: 'SUBJECT_MATTER_EXPERT',
    name: 'Subject Matter Expert',
    description: 'Confirm technical accuracy against the source.',
    portalScope: 'AUTHORING',
    permissions: [
      ...AUTHORING_SHELL,
      'question.read',
      'question.review',
      'question.review.edit',
      'source.read', // +  opening the source of the question under review
    ],
  },
  {
    key: 'REVIEWER',
    name: 'Reviewer',
    description: 'Confirm quality, clarity, and grounding.',
    portalScope: 'AUTHORING',
    permissions: [...AUTHORING_SHELL, 'question.read', 'question.review', 'source.read'],
  },
  {
    key: 'APPROVER',
    name: 'Approver',
    description: 'Accept accountability for release.',
    portalScope: 'AUTHORING',
    permissions: [
      ...AUTHORING_SHELL,
      'question.approve',
      'question.approve.bulk', // +  the capped bulk path in authoring-portal.md §5.6
      'question.review',
      'question.read',
      'source.read',
    ],
  },
  {
    key: 'PUBLISHER',
    name: 'Publisher',
    description: 'Move approved content into the Question Bank safely.',
    portalScope: 'AUTHORING',
    permissions: [
      ...AUTHORING_SHELL,
      'question.publish',
      'question.retire',
      'question.regenerate',
      'question.read',
      'source.read',
    ],
  },
  {
    key: 'ASSESSMENT_MANAGER',
    name: 'Assessment Manager',
    description: 'Build and publish assessments.',
    portalScope: 'AUTHORING',
    permissions: [
      ...AUTHORING_SHELL,
      'assessment.manage',
      'assessment.approve',
      'assessment.publish',
      'assessment.read',
      'question.read',
      'report.read', // +  the assessment pool health report
    ],
  },
  {
    key: 'MANAGER',
    name: 'Manager',
    description: 'Understand team readiness and risk. Aggregate views only.',
    portalScope: 'AUTHORING',
    permissions: [...AUTHORING_SHELL, 'report.read', 'learning.result.team'],
  },
  {
    key: 'REPORTING_USER',
    name: 'Reporting User',
    description: 'Build and export governed reports.',
    portalScope: 'AUTHORING',
    permissions: [...AUTHORING_SHELL, 'report.read', 'report.create', 'report.export'],
  },
  {
    key: 'REPORT_PUBLISHER',
    name: 'Report Publisher',
    description: 'Govern report publication.',
    portalScope: 'AUTHORING',
    permissions: [...AUTHORING_SHELL, 'report.read', 'report.approve', 'report.publish'],
  },
  {
    key: 'AUDITOR',
    name: 'Auditor',
    description:
      'Reconstruct who did what, when, and on what evidence. Read-only: this set contains no write key.',
    portalScope: 'AUTHORING',
    permissions: [
      ...AUTHORING_SHELL,
      'audit.read',
      'audit.export',
      'question.read',
      'source.read',
      'report.read',
      'access.read', // +  reconstructing who was permitted to approve, on that date
      'assessment.read', // +
    ],
  },
  {
    key: 'LEARNER',
    name: 'Learner',
    description: 'Prove and improve proficiency. Own-scoped only.',
    portalScope: 'LIVE',
    permissions: [
      'learning.access',
      'learning.assessment.list',
      'learning.session.create',
      'learning.session.own',
      'learning.result.own',
      'learning.recommendation.own',
      'learning.badge.own',
      'learning.certificate.own',
    ],
  },
];

export const ROLE_DEFINITION_BY_KEY: Readonly<Record<RoleKey, RoleDefinition>> = Object.freeze(
  Object.fromEntries(ROLE_DEFINITIONS.map((r) => [r.key, r])) as Record<RoleKey, RoleDefinition>,
);

/**
 * Write keys an AUDITOR must never hold — asserted by a contract test (§2 rule 4).
 *
 * Enumerated explicitly rather than derived by pattern: `question.approve.bulk`
 * does not end in a write verb, and a clever regex that missed it would make the
 * read-only guarantee silently false.
 */
export const WRITE_PERMISSION_KEYS: readonly PermissionKey[] = [
  'platform.configure',
  'access.manage',
  'taxonomy.manage',
  'competency.manage',
  'source.manage',
  'source.test',
  'source.sync',
  'document.section.manage',
  'document.exclude',
  'question.generate',
  'question.import',
  'question.regenerate',
  'question.edit',
  'question.submit',
  'question.review',
  'question.review.edit',
  'question.approve',
  'question.approve.bulk',
  'question.publish',
  'question.retire',
  'question.archive',
  'questionbank.reconcile',
  'assessment.manage',
  'assessment.approve',
  'assessment.publish',
  'report.create',
  'report.approve',
  'report.publish',
  'learning.session.create',
];
