// Separation of duties — workflows.md §3.4.
//
// | Policy                  | Default | Effect                                        |
// | authorMayApproveOwn     | false   | refused when approver = original author       |
// | editorMayApproveOwn     | false   | refused when approver = last editor            |
// | approverMayPublishOwn   | true    | approver may publish; false forces a Publisher |
// | smeMayApprove           | true    | SMEs holding question.approve may approve      |
// | Break-glass             | disabled| Platform Administrator override, MANDATORY
//                                       written justification, audited as
//                                       AUTHORING.QUESTION.APPROVAL_OVERRIDE
//
// The defaults matter: the two that default to FALSE are the ones that stop a
// single person from taking a question all the way to publication alone. This
// module returns a decision plus a reason, because the reason is what gets
// persisted in gateResults and shown to the approver.

export interface SeparationPolicies {
  readonly authorMayApproveOwn: boolean;
  readonly editorMayApproveOwn: boolean;
  readonly approverMayPublishOwn: boolean;
  readonly smeMayApprove: boolean;
  readonly breakGlassEnabled: boolean;
}

export const DEFAULT_SEPARATION_POLICIES: SeparationPolicies = {
  authorMayApproveOwn: false,
  editorMayApproveOwn: false,
  approverMayPublishOwn: true,
  smeMayApprove: true,
  breakGlassEnabled: false,
};

export interface SeparationDecision {
  readonly permitted: boolean;
  readonly reason: string;
  /** True when permitted only because break-glass was exercised. */
  readonly viaBreakGlass: boolean;
}

export interface ApprovalSeparationArgs {
  readonly approverUserId: string;
  readonly approverRoles: readonly string[];
  readonly approverPermissions: readonly string[];
  readonly authorUserId: string | null;
  readonly lastEditorUserId: string | null;
  readonly policies: SeparationPolicies;
  /** Present only when the approver explicitly invoked break-glass. */
  readonly breakGlass?: { readonly justification: string };
}

export class BreakGlassNotPermittedError extends Error {
  readonly code = 'BREAK_GLASS_NOT_PERMITTED';
  constructor(detail: string) {
    super(detail);
    this.name = 'BreakGlassNotPermittedError';
  }
}

/**
 * Decides whether this approver may approve this question.
 *
 * Break-glass is evaluated LAST and only when a violation was found, so an
 * override can never be recorded for an approval that did not need one — an
 * override in the standing exception report must always mean something.
 */
export const evaluateApprovalSeparation = (args: ApprovalSeparationArgs): SeparationDecision => {
  const violations: string[] = [];

  if (!args.policies.authorMayApproveOwn && args.authorUserId === args.approverUserId) {
    violations.push('the approver is the original author');
  }
  if (!args.policies.editorMayApproveOwn && args.lastEditorUserId === args.approverUserId) {
    violations.push('the approver is the last editor of this version');
  }
  if (
    !args.policies.smeMayApprove &&
    args.approverRoles.includes('SUBJECT_MATTER_EXPERT') &&
    !args.approverRoles.some((role) =>
      ['QUIZ_APPROVER', 'PLATFORM_ADMINISTRATOR', 'PUBLISHER'].includes(role),
    )
  ) {
    violations.push('subject matter experts are not permitted to approve in this configuration');
  }

  if (violations.length === 0) {
    return {
      permitted: true,
      reason:
        'Separation of duties is satisfied: the approver is neither the author nor the last editor.',
      viaBreakGlass: false,
    };
  }

  const blocked = `Separation of duties refused because ${violations.join(', and ')}.`;

  if (!args.breakGlass) {
    return { permitted: false, reason: blocked, viaBreakGlass: false };
  }

  // A break-glass request that cannot be honoured is an ERROR, not a silent
  // fall-through to refusal: the caller asked for an override and must learn
  // why it was not available.
  if (!args.policies.breakGlassEnabled) {
    throw new BreakGlassNotPermittedError(
      'Break-glass approval is disabled. Enable approval.breakGlass.enabled first; it is audited and appears in a standing exception report.',
    );
  }
  if (!args.approverPermissions.includes('platform.configure')) {
    throw new BreakGlassNotPermittedError(
      'Break-glass approval requires a Platform Administrator.',
    );
  }
  if (args.breakGlass.justification.trim().length < 30) {
    throw new BreakGlassNotPermittedError(
      'Break-glass approval requires a written justification of at least 30 characters. It is read by whoever reviews the exception report.',
    );
  }

  return {
    permitted: true,
    reason: `${blocked} Overridden by break-glass: ${args.breakGlass.justification.trim()}`,
    viaBreakGlass: true,
  };
};

export interface PublishSeparationArgs {
  readonly publisherUserId: string;
  readonly approverUserId: string | null;
  readonly policies: SeparationPolicies;
}

/**
 * `approverMayPublishOwn` defaults TRUE, so this normally permits.
 *
 * It exists as a distinct check because setting it false is how a tenant forces
 * a third distinct person onto the path, and that has to be enforceable without
 * touching the approval logic.
 */
export const evaluatePublishSeparation = (args: PublishSeparationArgs): SeparationDecision => {
  if (args.policies.approverMayPublishOwn) {
    return {
      permitted: true,
      reason: 'Configuration permits the approver to publish their own approval.',
      viaBreakGlass: false,
    };
  }
  if (args.approverUserId !== null && args.approverUserId === args.publisherUserId) {
    return {
      permitted: false,
      reason:
        'Separation of duties refused: this configuration requires a publisher distinct from the approver.',
      viaBreakGlass: false,
    };
  }
  return {
    permitted: true,
    reason: 'The publisher is distinct from the approver.',
    viaBreakGlass: false,
  };
};
