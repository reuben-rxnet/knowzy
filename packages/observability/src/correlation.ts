// Correlation model — audit-model.md §4.
//
// N1: the API mints the correlation ID. A client-supplied value is accepted
// only as `clientTraceId` in detail, never as the correlation ID, so a client
// cannot merge its activity into someone else's trace.
//
// N9: IDs are opaque, non-guessable, and carry no embedded user or tenant data.

import { randomBytes } from 'node:crypto';

const PREFIX_CORRELATION = 'c-';
const PREFIX_REQUEST = 'r-';

const token = (bytes: number): string => randomBytes(bytes).toString('hex');

/** One per user action, propagated across every process hop (N2). */
export const newCorrelationId = (): string => `${PREFIX_CORRELATION}${token(16)}`;

/** One per HTTP request or job attempt. A retry keeps the correlation ID (N3). */
export const newRequestId = (): string => `${PREFIX_REQUEST}${token(8)}`;

export const isCorrelationId = (value: string): boolean =>
  /^c-[0-9a-f]{32}$/.test(value);

export interface CorrelationContext {
  readonly correlationId: string;
  readonly requestId: string;
  /** Present only when a client supplied its own trace id (N1). */
  readonly clientTraceId?: string;
}

/**
 * Builds the context for an inbound request. A client value never becomes the
 * correlation ID; it is carried alongside so a client-side trace can still be
 * joined to a server-side one for support purposes.
 */
export const startCorrelation = (clientSupplied?: string | null): CorrelationContext => ({
  correlationId: newCorrelationId(),
  requestId: newRequestId(),
  ...(clientSupplied && clientSupplied.length > 0 && clientSupplied.length <= 128
    ? { clientTraceId: clientSupplied }
    : {}),
});

/**
 * Continues an existing correlation into asynchronous work — N4: a generation
 * job's drafts trace back to the author's click months later. A new request ID
 * is minted so retries are distinguishable without losing the causal chain (N3).
 */
export const continueCorrelation = (correlationId: string): CorrelationContext => ({
  correlationId,
  requestId: newRequestId(),
});

/**
 * Scheduled work mints its own ID with actorType = SYSTEM; it does not inherit
 * a human's correlation (N5).
 */
export const startSystemCorrelation = (): CorrelationContext => ({
  correlationId: newCorrelationId(),
  requestId: newRequestId(),
});
