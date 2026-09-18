// Subject resolution — security.md §2, access-control.md §3.
//
// Produces a Subject from an inbound request. Two implementations:
//
//   * the LOCAL STUB ISSUER, which trusts a header naming a seeded user. It is
//     the path implementation-roadmap.md Phase 2 explicitly permits ("the dev
//     tenant OR the local stub issuer") and is what lets the whole pipeline run
//     with no tenant credentials.
//   * Entra JWT validation, which arrives with Phase 2 proper.
//
// Whichever is used, roles and permissions are resolved from the DATABASE, not
// from claims (ADR-011), and account status is checked per request (S5) so
// revoking access does not wait for a token to expire.
//
// The lookup is injected rather than imported, so this package performs no
// database access of its own and stays testable without one.

import type { KnowzyEnv, Subject } from '@knowzy/shared-types';

/** Header the stub issuer reads. A UPN or a seeded entraObjectId. */
export const STUB_SUBJECT_HEADER = 'x-knowzy-subject';

export interface SubjectLookup {
  /** Resolves a seeded user by UPN or entraObjectId, with roles and scopes. */
  byIdentifier(identifier: string): Promise<Subject | null>;
}

export interface SubjectResolver {
  readonly kind: 'stub-issuer' | 'entra';
  resolve(
    headers: Readonly<Record<string, string | string[] | undefined>>,
  ): Promise<Subject | null>;
}

export class StubIssuerNotPermittedError extends Error {
  constructor(environment: string) {
    super(
      `The local stub issuer is not permitted in "${environment}". It exists for local ` +
        `development only; deployed environments must validate an Entra token.`,
    );
    this.name = 'StubIssuerNotPermittedError';
  }
}

const headerValue = (
  headers: Readonly<Record<string, string | string[] | undefined>>,
  name: string,
): string | null => {
  const raw = headers[name];
  if (raw === undefined) return null;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value !== undefined && value.trim().length > 0 ? value.trim() : null;
};

/**
 * The local stub issuer.
 *
 * Constructing it outside `local` throws. That is deliberate: a stub issuer
 * reachable in a deployed environment would be a complete authentication
 * bypass, so it fails closed at construction rather than relying on a
 * configuration check somewhere downstream. Startup check 4 already refuses to
 * run mocks outside local; this is the same principle applied to identity.
 */
export const createStubIssuerResolver = (deps: {
  readonly environment: KnowzyEnv;
  readonly lookup: SubjectLookup;
}): SubjectResolver => {
  if (deps.environment !== 'local') {
    throw new StubIssuerNotPermittedError(deps.environment);
  }

  return {
    kind: 'stub-issuer',
    async resolve(headers) {
      const identifier = headerValue(headers, STUB_SUBJECT_HEADER);
      if (identifier === null) return null;
      return deps.lookup.byIdentifier(identifier);
    },
  };
};

/**
 * Entra token validation. Phase 2 implements it: JWKS caching, signature,
 * iss/aud/exp/nbf/tid, then subject resolution from the database.
 *
 * It throws rather than returning null so that a deployed environment cannot
 * silently treat "no authentication implemented" as "no subject", which would
 * read as an anonymous request rather than a misconfiguration.
 */
export const createEntraResolver = (): SubjectResolver => ({
  kind: 'entra',
  async resolve() {
    throw new Error(
      'Entra token validation is not implemented yet (implementation-roadmap.md Phase 2). ' +
        'Local development uses the stub issuer.',
    );
  },
});

/** Picks the resolver for the environment. */
export const createSubjectResolver = (deps: {
  readonly environment: KnowzyEnv;
  readonly lookup: SubjectLookup;
}): SubjectResolver =>
  deps.environment === 'local' ? createStubIssuerResolver(deps) : createEntraResolver();
