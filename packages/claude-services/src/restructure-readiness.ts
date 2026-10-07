// AI Document Studio readiness -- purpose DOCUMENT_RESTRUCTURE
// (docs/competencies/AI_DOCUMENT_STUDIO_ARCHITECTURE.md §10.3).
//
// PURE. It takes the catalogue, the restructuring-client registry, the
// recorded approvals and each provider's configuration, and says how far each
// provider is from being able to restructure a document -- checked most
// permanent first, the generation registry's own order:
//
//   1 exists   2 capability   3 purpose approval   4 client   5 configuration
//
// THE REGISTRY BELOW IS EMPTY. No restructuring client exists in this build,
// so no provider can reach READY, and a contract test fails if one is added
// without the client it would claim. Adding a provider id here is a claim
// that the transformation exists; it is not a setting.

import {
  GENERATION_PROVIDER,
  type DocumentStudioStatus,
  type GenerationProviderId,
  type PurposeApproval,
  type RestructureProviderReadiness,
  type RestructureState,
} from '@knowzy/shared-types';
import { PROVIDER_CATALOGUE } from './provider.js';

/** Providers with a registered restructuring client. EMPTY on this release. */
export const RESTRUCTURING_CLIENTS: readonly GenerationProviderId[] = Object.freeze([]);

/**
 * Check 2. A provider that retrieves its own context cannot be held to the
 * selected document; the deterministic local generator cannot rewrite text at
 * all. Neither can ever restructure, so neither can be approved for it.
 */
export const restructureCapability = (
  providerId: GenerationProviderId,
): { readonly capable: boolean; readonly reason: string } => {
  if (providerId === 'DETERMINISTIC_LOCAL') {
    return {
      capable: false,
      reason:
        'The built-in template generator writes questions from fixed patterns. It cannot rewrite a document, so it can never prepare one.',
    };
  }
  if (!PROVIDER_CATALOGUE[providerId].retrievalFree) {
    return {
      capable: false,
      reason:
        'This provider retrieves its own context, so a derivative could contain content that is not in the document being prepared.',
    };
  }
  return {
    capable: true,
    reason: 'A model that works only on the text it is given can restructure a document.',
  };
};

export interface RestructureReadinessInput {
  /** `llm.purposeApprovals.DOCUMENT_RESTRUCTURE`. Generation approvals are NOT an input. */
  readonly approvals: Readonly<Partial<Record<GenerationProviderId, PurposeApproval>>>;
  /** Check 5, decided by the caller from the provider settings. */
  readonly configured: (providerId: GenerationProviderId) => boolean;
  /** Defaults to the real, empty registry. A parameter so a test can prove READY is reachable only through it. */
  readonly clients?: readonly GenerationProviderId[];
  readonly evaluatedAt: string;
}

const RANK: Readonly<Record<RestructureState, number>> = {
  BLOCKED_BY_APPROVAL: 0,
  NOT_BUILT: 1,
  READY: 2,
};

export const evaluateRestructureReadiness = (
  input: RestructureReadinessInput,
): DocumentStudioStatus => {
  const clients = input.clients ?? RESTRUCTURING_CLIENTS;
  const providers: RestructureProviderReadiness[] = GENERATION_PROVIDER.map((providerId) => {
    const capability = restructureCapability(providerId);
    const approval = input.approvals[providerId] ?? null;
    const clientImplemented = clients.includes(providerId);
    const configured = input.configured(providerId);
    const base = {
      providerId,
      exists: true as const,
      capable: capability.capable,
      capabilityReason: capability.reason,
      approval,
      clientImplemented,
      configured,
    };
    if (!capability.capable) return { ...base, state: null, reason: capability.reason };
    if (approval === null) {
      return {
        ...base,
        state: 'BLOCKED_BY_APPROVAL' as const,
        reason:
          'No approval is recorded for sending whole documents to this provider for restructuring. An approval for question generation does not cover it.',
      };
    }
    if (!clientImplemented) {
      return {
        ...base,
        state: 'NOT_BUILT' as const,
        reason:
          'Approved for restructuring, but no restructuring client is built for this provider. Transformation capability is not yet implemented.',
      };
    }
    if (!configured) {
      return {
        ...base,
        state: 'NOT_BUILT' as const,
        reason:
          'A restructuring client exists, but the provider is not enabled with an endpoint, a model and a credential reference.',
      };
    }
    return { ...base, state: 'READY' as const, reason: 'Approved, built and configured.' };
  });

  const eligible = providers.filter((row) => row.state !== null);
  const best = eligible.reduce<RestructureState>(
    (state, row) => (row.state !== null && RANK[row.state] > RANK[state] ? row.state : state),
    'BLOCKED_BY_APPROVAL',
  );
  const stateReason =
    best === 'READY'
      ? 'At least one provider is approved, built and configured for restructuring.'
      : best === 'NOT_BUILT'
        ? 'At least one provider is approved for restructuring, but no restructuring client is built. Transformation capability is not yet implemented.'
        : 'No provider holds an approval for the DOCUMENT_RESTRUCTURE purpose. The approval recorded for question generation does not cover it.';

  return {
    purpose: 'DOCUMENT_RESTRUCTURE',
    state: best,
    stateReason,
    transformationImplemented: clients.length > 0,
    providers,
    evaluatedAt: input.evaluatedAt,
  };
};
