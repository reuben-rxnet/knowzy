// The shape of this deployable's secret configuration, on its own so that
// `http/route.ts` can name it without importing the resolver wiring, which
// imports route types in turn (B9 refuses the cycle, even made of types).

import type { KnowzyEnv } from '@knowzy/shared-types';

export interface SecretPlatform {
  readonly environment: KnowzyEnv;
  /** `KNOWZY_LOCAL_SECRET_DIR`. Local only; null elsewhere. */
  readonly localSecretDir: string | null;
  /** `KEY_VAULT_URI`, for the source's health line. No client reads it yet. */
  readonly keyVaultUri: string | null;
  /** `LLM_ENDPOINT_ALLOWLIST`, parsed. Added to each provider's own host. */
  readonly extraAllowedHosts: readonly string[];
  /** Injected in tests; the global fetch otherwise. */
  readonly fetch?: typeof fetch;
}
