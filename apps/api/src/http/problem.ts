// problem+json construction — error-handling.md §3.
//
// Shared by the server's error handler and the route policy gate, so a
// denial and an unhandled error produce the same wire shape.

import {
  ERROR_REGISTRY,
  PROBLEM_TYPE_BASE,
  type ErrorCode,
  type ProblemDetails,
} from '@knowzy/shared-types';

/** Builds a problem+json body. E7: codes carry no dynamic content. */
export const toProblem = (args: {
  code: ErrorCode;
  correlationId: string;
  instance: string;
  detail?: string;
  details?: Record<string, unknown> | null;
  retryAfterSeconds?: number | null;
  /**
   * The full approval-gate checklist.
   *
   * error-handling.md §328: a VALIDATION failure shows "ALL failures at once,
   * each linking to the field that fixes it". The field existed in the shape
   * from Phase 1 and was always null; this is what fills it.
   */
  gateFailures?: ProblemDetails['gateFailures'];
}): ProblemDetails => {
  const definition = ERROR_REGISTRY[args.code];
  return {
    type: `${PROBLEM_TYPE_BASE}${args.code}`,
    title: args.code
      .toLowerCase()
      .split('_')
      .join(' ')
      .replace(/^./, (c) => c.toUpperCase()),
    status: definition.status,
    code: args.code,
    category: definition.category,
    detail: args.detail ?? definition.message,
    retryable: definition.retryable,
    retryAfterSeconds: args.retryAfterSeconds ?? null,
    correlationId: args.correlationId,
    instance: args.instance,
    details: args.details ?? null,
    fieldErrors: null,
    gateFailures: args.gateFailures ?? null,
  };
};
