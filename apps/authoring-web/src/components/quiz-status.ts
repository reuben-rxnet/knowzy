// Shared by the Simple Studio's server page and its client review form. A plain
// module, because a value exported from a 'use client' file reaches a server
// component as a client reference, not as the value.

/** Statuses "Approve selected" can move towards APPROVED. */
export const APPROVABLE: ReadonlySet<string> = new Set([
  'GENERATED',
  'DRAFT',
  'AUTHOR_REVIEW',
  'CHANGES_REQUESTED',
  'SUBMITTED_FOR_APPROVAL',
]);
