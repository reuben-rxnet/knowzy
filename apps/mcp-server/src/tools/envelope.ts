// The authorization envelope — mcp-tools.md §3.
//
// Every tool call carries an envelope the API constructs FROM THE VALIDATED
// ENTRA TOKEN, never from request body fields. The MCP server re-checks
// authorization rather than trusting it (T1), so a compromised or buggy API
// handler cannot widen access.

import { z } from 'zod';
import type { Clock } from '@knowzy/observability';

export const AuthorizationEnvelopeSchema = z
  .object({
    subject: z.object({
      userId: z.string().uuid(),
      entraObjectId: z.string().min(1),
      /** For audit readability only; never used for a decision. */
      displayName: z.string().min(1),
    }),
    portal: z.enum(['AUTHORING', 'LIVE', 'SYSTEM']),
    /** Resolved from UserRole rows, not from token group claims (E2). */
    effectiveRoles: z.array(z.string()),
    permissions: z.array(z.string()),
    dataScope: z.object({
      /** Empty means unrestricted on this dimension. */
      domainIds: z.array(z.string().uuid()),
      teamIds: z.array(z.string().uuid()),
      sourceIds: z.array(z.string().uuid()),
      denySourceIds: z.array(z.string().uuid()),
    }),
    delegation: z.object({
      mode: z.enum(['NONE', 'ON_BEHALF_OF']),
      /** A broker handle, never a raw token (E4). */
      oboTokenRef: z.string().optional(),
    }),
    correlationId: z.string().min(1),
    requestId: z.string().min(1),
    issuedAt: z.string().datetime(),
    /** Short-lived; default 120 s. */
    expiresAt: z.string().datetime(),
  })
  .strict();

export type AuthorizationEnvelope = z.infer<typeof AuthorizationEnvelopeSchema>;

export class EnvelopeInvalidError extends Error {
  readonly code = 'ENVELOPE_INVALID';
  constructor(reason: string) {
    super(`The authorization envelope was rejected: ${reason}`);
    this.name = 'EnvelopeInvalidError';
  }
}

/**
 * DEVIATION from E1, recorded deliberately.
 *
 * E1 requires the envelope to be SIGNED by the API with a key held in Key Vault
 * and verified here. Signing needs a key-management story (Key Vault, rotation,
 * a local development key) that the MVP does not have yet, so it is deferred.
 *
 * The deviation is contained rather than hidden:
 *   - the MCP server is not internet-reachable, and compose does not publish
 *     its port, so the trust boundary is the container network;
 *   - the signature is the ONLY part of E1 deferred — expiry, structure, and
 *     E3's fresh re-resolution of roles and scope are all enforced below;
 *   - this constant is what the test asserts against, so turning signing on is
 *     a visible change rather than a silent one.
 *
 * Tracked in MVP-Plan.md under deferred items.
 */
export const ENVELOPE_SIGNING_ENFORCED = false;

export interface EnvelopeVerification {
  readonly envelope: AuthorizationEnvelope;
}

export const verifyEnvelope = (raw: unknown, deps: { clock: Clock }): EnvelopeVerification => {
  const parsed = AuthorizationEnvelopeSchema.safeParse(raw);
  if (!parsed.success) {
    // The reason names the failing field but never echoes the value, so a
    // rejected envelope cannot be used to read back what was sent.
    const field = parsed.error.issues[0]?.path.join('.') ?? 'envelope';
    throw new EnvelopeInvalidError(`the field "${field}" is missing or malformed`);
  }

  const envelope = parsed.data;
  const now = deps.clock.now().getTime();

  if (Number.isNaN(Date.parse(envelope.expiresAt))) {
    throw new EnvelopeInvalidError('expiresAt is not a valid timestamp');
  }
  if (Date.parse(envelope.expiresAt) <= now) {
    throw new EnvelopeInvalidError('it has expired');
  }
  if (Date.parse(envelope.issuedAt) > now + 60_000) {
    // A future issuedAt means clock skew or a forged envelope. Either way it is
    // not something to accept silently.
    throw new EnvelopeInvalidError('issuedAt is in the future');
  }
  if (envelope.delegation.mode === 'NONE' && envelope.delegation.oboTokenRef !== undefined) {
    throw new EnvelopeInvalidError('an on-behalf-of reference was supplied without delegation');
  }

  return { envelope };
};
