// Authorization envelope — mcp-tools.md §3.
//
// Constructed by the API from the validated Entra token, never from request
// body fields. Signed by the API and verified by the MCP server, which then
// RE-RESOLVES roles and scope from the database and uses the intersection
// (E3) — a stale envelope can never grant more than current state allows.

import { z } from 'zod';
import { DataScopeSchema } from './scope.js';
import { PortalContextSchema } from './enums.js';

export const ENVELOPE_DEFAULT_TTL_SECONDS = 120;

export const EnvelopeSubjectSchema = z.object({
  userId: z.string().uuid(),
  entraObjectId: z.string(),
  /** For audit readability only. Never used in a decision. */
  displayName: z.string(),
});

export const DelegationSchema = z.object({
  mode: z.enum(['NONE', 'ON_BEHALF_OF']),
  /**
   * A broker handle, never a raw token. The on-behalf-of token never appears in
   * a tool argument, a log, or an audit record (E4).
   */
  oboTokenRef: z.string().optional(),
});

export const AuthorizationEnvelopeSchema = z.object({
  subject: EnvelopeSubjectSchema,
  portal: PortalContextSchema,
  /** Resolved from UserRole, not from token group claims (ADR-011). */
  effectiveRoles: z.array(z.string()),
  permissions: z.array(z.string()),
  dataScope: DataScopeSchema,
  delegation: DelegationSchema,
  correlationId: z.string(),
  requestId: z.string(),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});
export type AuthorizationEnvelope = z.infer<typeof AuthorizationEnvelopeSchema>;

/** The wire form: envelope plus detached signature and the signing key id. */
export const SignedEnvelopeSchema = z.object({
  envelope: AuthorizationEnvelopeSchema,
  signature: z.string(),
  signatureKeyId: z.string(),
});
export type SignedEnvelope = z.infer<typeof SignedEnvelopeSchema>;

/**
 * A one-time token minted by the API and immediately consumed, proving that
 * `get_quiz_questions` is being called during session creation — the single
 * guard on the one tool that returns answer keys (security.md §8 K6).
 */
export const SessionCreationTokenSchema = z.object({
  sessionId: z.string().uuid(),
  assessmentVersionId: z.string().uuid(),
  nonce: z.string().min(32),
  expiresAt: z.string().datetime(),
});
export type SessionCreationToken = z.infer<typeof SessionCreationTokenSchema>;
