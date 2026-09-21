// The question lifecycle — workflows.md §3.1 and §3.2.
//
// The table below IS the state machine. Declaring it as data rather than
// scattering `if (status === ...)` across handlers is what makes two things
// testable: that no undeclared transition exists, and that every declared one
// carries its permission, its comment requirement, and its gates.
//
// §3.2 closes with the rule that shapes the service: "Every transition writes
// QuestionReview / QuestionApproval rows plus an AuditEvent IN THE SAME
// DATABASE TRANSACTION as the state change. A transition that cannot be
// audited does not commit."

import type { PermissionKey, QuestionStatus } from '@knowzy/shared-types';

export interface TransitionRule {
  readonly from: QuestionStatus;
  readonly to: QuestionStatus;
  /** null means the platform performs it, not a user (GENERATED → DRAFT). */
  readonly permission: PermissionKey | null;
  readonly commentRequired: boolean;
  /** Whether the 13 gates are evaluated before the transition commits. */
  readonly gated: boolean;
  readonly summary: string;
}

export const TRANSITIONS: readonly TransitionRule[] = [
  {
    from: 'GENERATED',
    to: 'DRAFT',
    permission: null,
    commentRequired: false,
    gated: false,
    summary: 'Automatic on persistence.',
  },
  {
    from: 'DRAFT',
    to: 'AUTHOR_REVIEW',
    permission: 'question.edit',
    commentRequired: false,
    gated: false,
    summary: 'The author opens or claims the draft.',
  },
  {
    from: 'AUTHOR_REVIEW',
    to: 'DRAFT',
    permission: 'question.edit',
    commentRequired: false,
    gated: false,
    summary: 'Save without submitting.',
  },
  {
    from: 'AUTHOR_REVIEW',
    to: 'SUBMITTED_FOR_APPROVAL',
    permission: 'question.submit',
    commentRequired: false,
    // All 13 gates, at submit as well as at approval: an author should learn
    // that evidence is unverifiable before an approver's time is spent.
    gated: true,
    summary: 'Submit for approval.',
  },
  {
    from: 'AUTHOR_REVIEW',
    to: 'REJECTED',
    permission: 'question.edit',
    commentRequired: true,
    gated: false,
    summary: 'The author rejects their own draft.',
  },
  {
    from: 'AUTHOR_REVIEW',
    to: 'ARCHIVED',
    permission: 'question.archive',
    commentRequired: false,
    gated: false,
    summary: 'Archive a draft.',
  },
  {
    from: 'SUBMITTED_FOR_APPROVAL',
    to: 'APPROVED',
    permission: 'question.approve',
    commentRequired: false,
    gated: true,
    summary: 'Approve. All gates plus separation of duties.',
  },
  {
    from: 'SUBMITTED_FOR_APPROVAL',
    to: 'CHANGES_REQUESTED',
    permission: 'question.review',
    commentRequired: true,
    gated: false,
    summary: 'Request changes.',
  },
  {
    from: 'SUBMITTED_FOR_APPROVAL',
    to: 'REJECTED',
    permission: 'question.review',
    commentRequired: true,
    gated: false,
    summary: 'Reject.',
  },
  {
    from: 'CHANGES_REQUESTED',
    to: 'AUTHOR_REVIEW',
    permission: 'question.edit',
    commentRequired: false,
    gated: false,
    summary: 'The author resumes.',
  },
  {
    from: 'APPROVED',
    to: 'PUBLISHED',
    permission: 'question.publish',
    commentRequired: false,
    // G1: the gates are re-evaluated at the moment of the write, so an approval
    // from before a source change cannot carry a question into the bank.
    gated: true,
    summary: 'Publish to the Question Bank.',
  },
  {
    from: 'APPROVED',
    to: 'ARCHIVED',
    permission: 'question.archive',
    commentRequired: false,
    gated: false,
    summary: 'Archive before publication.',
  },
  {
    from: 'PUBLISHED',
    to: 'RETIRED',
    permission: 'question.retire',
    commentRequired: true,
    gated: false,
    summary: 'Retire a published question.',
  },
  {
    from: 'PUBLISHED',
    to: 'DRAFT',
    permission: 'question.edit',
    commentRequired: false,
    gated: false,
    summary: 'Edit a published question into a new draft version.',
  },
  {
    from: 'REJECTED',
    to: 'ARCHIVED',
    permission: 'question.archive',
    commentRequired: false,
    gated: false,
    summary: 'Archive a rejected question.',
  },
  {
    from: 'RETIRED',
    to: 'ARCHIVED',
    permission: 'question.archive',
    commentRequired: false,
    gated: false,
    summary: 'Archive a retired question.',
  },
];

export class TransitionNotPermittedError extends Error {
  readonly code = 'INVALID_STATE_TRANSITION';
  constructor(
    readonly from: QuestionStatus,
    readonly to: QuestionStatus,
    detail: string,
  ) {
    super(detail);
    this.name = 'TransitionNotPermittedError';
  }
}

export class CommentRequiredError extends Error {
  readonly code = 'COMMENT_REQUIRED';
  constructor(from: QuestionStatus, to: QuestionStatus) {
    super(
      `Moving a question from ${from} to ${to} requires a written comment. The person whose work it is has to be able to read why.`,
    );
    this.name = 'CommentRequiredError';
  }
}

export const findTransition = (
  from: QuestionStatus,
  to: QuestionStatus,
): TransitionRule | undefined => TRANSITIONS.find((rule) => rule.from === from && rule.to === to);

/**
 * Resolves a transition, or explains why there isn't one.
 *
 * `* → ARCHIVED` is deliberately NOT permitted from PUBLISHED (§3.2: "retire
 * first"), and that is expressed by the absence of a row rather than by a
 * special case here.
 */
export const requireTransition = (
  from: QuestionStatus,
  to: QuestionStatus,
  comment: string | null,
): TransitionRule => {
  const rule = findTransition(from, to);
  if (!rule) {
    const available = TRANSITIONS.filter((candidate) => candidate.from === from).map(
      (candidate) => candidate.to,
    );
    throw new TransitionNotPermittedError(
      from,
      to,
      available.length === 0
        ? `${from} is a terminal state; nothing follows it.`
        : `A question in ${from} cannot move to ${to}. Available: ${available.join(', ')}.`,
    );
  }
  if (rule.commentRequired && (comment === null || comment.trim().length === 0)) {
    throw new CommentRequiredError(from, to);
  }
  return rule;
};

/** Statuses that appear in the author review queue. */
export const AUTHOR_QUEUE_STATUSES: readonly QuestionStatus[] = [
  'DRAFT',
  'AUTHOR_REVIEW',
  'CHANGES_REQUESTED',
];

/** Statuses that appear in the approval queue. */
export const APPROVAL_QUEUE_STATUSES: readonly QuestionStatus[] = ['SUBMITTED_FOR_APPROVAL'];
