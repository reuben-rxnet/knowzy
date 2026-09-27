// The Secret Resolution Layer — P-5.
//
// Configuration carries REFERENCES. Until now nothing could turn one into a
// value, so every external provider's credential check read "recorded,
// unresolvable here". This is the layer that resolves one, built as an
// abstraction with the source chosen by the reference's scheme rather than
// hard-coded:
//
//   SecretSourceProvider   one per source: `resolve(name)` and `health()`
//   SecretResolver         parses a reference, routes it to its source,
//                          enforces the environment fence, and reports every
//                          resolution to an observer
//
// FOUR THINGS THIS LAYER NEVER DOES
//
//   * It never returns a value in anything but a `SecretValue`, which prints
//     `[redacted]` wherever it is turned into text by accident.
//   * It never passes a value, or a reference, to its observer. The observer
//     -- the API's audit hook -- receives the source, a FINGERPRINT of the
//     reference and the status. `audit_event` has never held a reference and
//     does not start now.
//   * It never falls back. A `keyvault://` reference with no Key Vault client
//     is SOURCE_UNAVAILABLE, not "try the local store"; a silent fallback is
//     how a production deployment ends up reading a developer's file.
//   * It never caches a value. A key rotated in the store is read on the next
//     resolution, and a value held in memory between requests is one more
//     place to find it.

import { createHash } from 'node:crypto';
import {
  parseSecretReference,
  type KnowzyEnv,
  type ParsedSecretReference,
  type SecretResolutionStatus,
  type SecretSource,
  type SecretSourceHealth,
} from '@knowzy/shared-types';
import { LocalStoreError, type LocalSecureStore } from './local-store.js';
import type { SecretValue } from './secret-value.js';

/** One source of secrets. The resolver knows nothing else about it. */
export interface SecretSourceProvider {
  readonly source: SecretSource;
  resolve(reference: ParsedSecretReference): Promise<SourceResolution>;
  health(): Promise<SecretSourceHealth>;
}

export type SourceResolution =
  | { readonly status: 'RESOLVED'; readonly value: SecretValue }
  | {
      readonly status: Exclude<SecretResolutionStatus, 'RESOLVED'>;
      readonly detail: string;
    };

export type SecretResolution =
  | {
      readonly status: 'RESOLVED';
      readonly source: SecretSource;
      readonly fingerprint: string;
      readonly value: SecretValue;
    }
  | {
      readonly status: Exclude<SecretResolutionStatus, 'RESOLVED'>;
      readonly source: SecretSource | null;
      readonly fingerprint: string;
      readonly detail: string;
    };

/** What the observer is told. Deliberately value-free and reference-free. */
export interface SecretResolutionEvent {
  readonly source: SecretSource | null;
  readonly referenceFingerprint: string;
  readonly status: SecretResolutionStatus;
  readonly purpose: string;
  readonly durationMs: number;
}

/**
 * A stable, non-reversible handle on a reference: the first 16 hex digits of
 * its SHA-256. Two audit rows about the same reference carry the same
 * fingerprint, so a rotation is traceable, and neither names the secret.
 */
export const referenceFingerprint = (reference: string): string =>
  createHash('sha256').update(reference, 'utf8').digest('hex').slice(0, 16);

// ---------------------------------------------------------------------------
// The sources
// ---------------------------------------------------------------------------

export const localStoreSource = (store: LocalSecureStore): SecretSourceProvider => ({
  source: 'LOCAL_SECURE_STORE',
  async resolve(reference) {
    try {
      const value = await store.get(reference.name);
      return value === null
        ? {
            status: 'NOT_FOUND',
            detail: `The local secure store has no secret named "${reference.name}". Add it with \`npm run secrets -- set ${reference.name}\`.`,
          }
        : { status: 'RESOLVED', value };
    } catch (error) {
      return {
        status: 'SOURCE_UNAVAILABLE',
        detail:
          error instanceof LocalStoreError
            ? error.message
            : 'The local secure store could not be read.',
      };
    }
  },
  health: () => store.health(),
});

/**
 * AZURE_KEY_VAULT — declared, not implemented.
 *
 * Reading a vault needs a managed identity and an SDK this build does not
 * carry, and both are tenant resources (ENTERPRISE_PILOT_READINESS §7). So the
 * source exists, parses its references, and answers every resolution with
 * SOURCE_UNAVAILABLE and that reason -- the day a client lands it replaces
 * this object and nothing else changes.
 */
export const keyVaultPlaceholderSource = (vaultUri: string | null): SecretSourceProvider => ({
  source: 'AZURE_KEY_VAULT',
  resolve: async () => ({
    status: 'SOURCE_UNAVAILABLE',
    detail:
      'No Azure Key Vault client exists in this build, so a keyvault:// reference cannot be read here. It needs a managed identity with read access to the vault.',
  }),
  health: async () => ({
    source: 'AZURE_KEY_VAULT',
    configured: vaultUri !== null,
    reachable: false,
    secretCount: null,
    detail:
      vaultUri === null
        ? 'No Key Vault is configured for this environment, and no Key Vault client exists in this build.'
        : 'A Key Vault URI is configured, but no Key Vault client exists in this build to read it.',
  }),
});

// ---------------------------------------------------------------------------
// The resolver
// ---------------------------------------------------------------------------

export interface SecretResolver {
  resolve(reference: string, purpose: string): Promise<SecretResolution>;
  health(): Promise<readonly SecretSourceHealth[]>;
  /** The sources in force here, and whether each is permitted. */
  readonly sources: readonly { readonly source: SecretSource; readonly permitted: boolean }[];
}

export interface CreateSecretResolverArgs {
  readonly environment: KnowzyEnv;
  readonly providers: readonly SecretSourceProvider[];
  /** Told about every resolution, successful or not. Never given a value. */
  readonly onResolution?: (event: SecretResolutionEvent) => void | Promise<void>;
  readonly now?: () => number;
}

/** Where each source may be read. The local store is a developer convenience. */
const PERMITTED_IN: Readonly<Record<SecretSource, readonly KnowzyEnv[]>> = {
  LOCAL_SECURE_STORE: ['local'],
  AZURE_KEY_VAULT: ['local', 'dev', 'test', 'prod'],
};

export const createSecretResolver = (args: CreateSecretResolverArgs): SecretResolver => {
  const now = args.now ?? Date.now;
  const bySource = new Map(args.providers.map((provider) => [provider.source, provider]));

  const report = async (event: SecretResolutionEvent): Promise<void> => {
    // The observer is an audit write. If it fails, the resolution still
    // happened and the caller still needs its answer; the failure is the
    // observer's to surface.
    try {
      await args.onResolution?.(event);
    } catch {
      /* see above */
    }
  };

  return {
    sources: (Object.keys(PERMITTED_IN) as SecretSource[]).map((source) => ({
      source,
      permitted: PERMITTED_IN[source].includes(args.environment),
    })),

    async resolve(reference, purpose) {
      const started = now();
      const fingerprint = referenceFingerprint(reference);
      const parsed = parseSecretReference(reference);

      const finish = async (result: SecretResolution): Promise<SecretResolution> => {
        await report({
          source: result.source,
          referenceFingerprint: fingerprint,
          status: result.status,
          purpose,
          durationMs: now() - started,
        });
        return result;
      };

      if (parsed === null) {
        return finish({
          status: 'INVALID_REFERENCE',
          source: null,
          fingerprint,
          detail:
            'This is not a secret reference. A reference is localstore://{name} or keyvault://{vault}/secrets/{name}.',
        });
      }
      if (!PERMITTED_IN[parsed.source].includes(args.environment)) {
        return finish({
          status: 'SOURCE_FORBIDDEN',
          source: parsed.source,
          fingerprint,
          detail: `${parsed.source} is not permitted in the ${args.environment} environment.`,
        });
      }
      const provider = bySource.get(parsed.source);
      if (provider === undefined) {
        return finish({
          status: 'SOURCE_UNAVAILABLE',
          source: parsed.source,
          fingerprint,
          detail: `No ${parsed.source} is configured for this deployable.`,
        });
      }

      const outcome = await provider.resolve(parsed);
      return finish(
        outcome.status === 'RESOLVED'
          ? { status: 'RESOLVED', source: parsed.source, fingerprint, value: outcome.value }
          : { status: outcome.status, source: parsed.source, fingerprint, detail: outcome.detail },
      );
    },

    async health() {
      const out: SecretSourceHealth[] = [];
      for (const source of Object.keys(PERMITTED_IN) as SecretSource[]) {
        const provider = bySource.get(source);
        const permitted = PERMITTED_IN[source].includes(args.environment);
        if (!permitted) {
          out.push({
            source,
            configured: false,
            reachable: false,
            secretCount: null,
            detail: `Not permitted in the ${args.environment} environment.`,
          });
        } else if (provider === undefined) {
          out.push({
            source,
            configured: false,
            reachable: false,
            secretCount: null,
            detail: 'Not configured for this deployable.',
          });
        } else {
          out.push(await provider.health());
        }
      }
      return out;
    },
  };
};
