// Shared by the Simple Studio's server page and its client review form. A plain
// module, because a value exported from a 'use client' file reaches a server
// component as a client reference, not as the value.

import { t } from '../copy';

/** "1 question", "3 questions": a count never reads "1 questions". */
export const questionsLabel = (count: number): string =>
  count === 1 ? t('n.question') : t('n.questions', { count });
export const attemptsLabel = (count: number): string =>
  count === 1 ? t('n.attempt') : t('n.attempts', { count });

/** Statuses "Approve selected" can move towards APPROVED. */
export const APPROVABLE: ReadonlySet<string> = new Set([
  'GENERATED',
  'DRAFT',
  'AUTHOR_REVIEW',
  'CHANGES_REQUESTED',
  'SUBMITTED_FOR_APPROVAL',
]);
