// AI Document Studio, Slice 2 -- the processing purpose, its approval record
// and the readiness states (docs/competencies/AI_DOCUMENT_STUDIO_ARCHITECTURE.md
// §10). Types only: nothing here transforms a document, and nothing can.

import { z } from 'zod';
import { GenerationProviderSchema, type GenerationProviderId } from './enums.js';

/**
 * The processing purposes a provider may be approved for. Separate approvals,
 * separate keys: neither satisfies the other (§10.1). QUESTION_GENERATION's
 * approvals live in `llm.approvedProviders`; DOCUMENT_RESTRUCTURE's in
 * `llm.purposeApprovals`.
 */
export const AI_PURPOSES = ['QUESTION_GENERATION', 'DOCUMENT_RESTRUCTURE'] as const;
export const AiPurposeSchema = z.enum(AI_PURPOSES);
export type AiPurpose = z.infer<typeof AiPurposeSchema>;

/** One recorded approval: who, when, and where the decision is held. */
export const PurposeApprovalSchema = z
  .object({
    reference: z.string().min(4).max(500),
    approvedByUserId: z.string().uuid(),
    approvedByDisplayName: z.string().min(1).max(200),
    approvedAt: z.string().datetime(),
  })
  .strict();
export type PurposeApproval = z.infer<typeof PurposeApprovalSchema>;

/**
 * `llm.purposeApprovals`: purpose -> provider -> approval. Only
 * DOCUMENT_RESTRUCTURE is written here; generation keeps its own key.
 */
export const PurposeApprovalsSchema = z
  .object({
    DOCUMENT_RESTRUCTURE: z.record(GenerationProviderSchema, PurposeApprovalSchema).optional(),
  })
  .strict();
export type PurposeApprovals = z.infer<typeof PurposeApprovalsSchema>;

/**
 * The three states (§10.3). READY needs a registered restructuring client, and
 * the registry is empty on this release, so READY is unreachable by
 * construction -- a contract test holds that.
 */
export const RESTRUCTURE_STATES = ['BLOCKED_BY_APPROVAL', 'NOT_BUILT', 'READY'] as const;
export type RestructureState = (typeof RESTRUCTURE_STATES)[number];

export interface RestructureProviderReadiness {
  readonly providerId: GenerationProviderId;
  /** Check 1: in the provider catalogue. Always true for a listed row. */
  readonly exists: true;
  /** Check 2. Ineligible rows carry no state and offer no approval control. */
  readonly capable: boolean;
  readonly capabilityReason: string;
  /** Check 3. */
  readonly approval: PurposeApproval | null;
  /** Check 4: a restructuring client is registered for this provider. */
  readonly clientImplemented: boolean;
  /** Check 5: enabled with an endpoint, a model and a credential reference. */
  readonly configured: boolean;
  /** Null for an ineligible provider. */
  readonly state: RestructureState | null;
  readonly reason: string;
}

export interface DocumentStudioStatus {
  readonly purpose: 'DOCUMENT_RESTRUCTURE';
  /** The most advanced state any eligible provider reaches. */
  readonly state: RestructureState;
  readonly stateReason: string;
  /** Always false on this release, and the screen says so. */
  readonly transformationImplemented: boolean;
  readonly providers: readonly RestructureProviderReadiness[];
  readonly evaluatedAt: string;
}
