// The API's side of P-5: which secret sources this deployable has, and the
// audited resolver a request uses.
//
// THE API IS WHERE A PROVIDER CREDENTIAL RESOLVES, and nowhere else reads one
// on behalf of a provider: the MCP server never holds it (C6), the web apps
// never see it (B1), and the registry is given booleans. A resolved value
// lives for the duration of one readiness probe, inside a `SecretValue`, and
// is never returned, logged or audited.
//
// Every resolution writes `ADMIN.CONFIGURATION.SECRET_VALIDATED` -- source,
// reference fingerprint, status, purpose, duration -- through the resolver's
// observer. The observer is given no value and no reference by construction:
// `SecretResolutionEvent` has no field that could carry either.

import {
  createLocalSecureStore,
  createSecretResolver,
  keyVaultPlaceholderSource,
  localStoreSource,
  type SecretResolver,
  type SecretSourceProvider,
} from '@knowzy/configuration';
import { OPENAI_DEFAULT_HOSTS } from '@knowzy/claude-services';
import type { GenerationProviderId, KnowzyEnv } from '@knowzy/shared-types';
import { systemClock } from '@knowzy/observability';
import { createAuditWriter } from '@knowzy/database';
import type { RouteContext, RouteDeps } from '../http/route.js';
import type { SecretPlatform } from './secret-platform.js';

export type { SecretPlatform } from './secret-platform.js';

export const secretPlatformFromEnv = (
  environment: KnowzyEnv,
  rawEnv: Readonly<Record<string, string | undefined>>,
): SecretPlatform => ({
  environment,
  localSecretDir:
    environment === 'local' ? (rawEnv['KNOWZY_LOCAL_SECRET_DIR'] ?? null) || null : null,
  keyVaultUri: rawEnv['KEY_VAULT_URI'] ?? null,
  extraAllowedHosts: (rawEnv['LLM_ENDPOINT_ALLOWLIST'] ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0),
});

const sourcesFor = (platform: SecretPlatform | undefined): SecretSourceProvider[] => {
  const providers: SecretSourceProvider[] = [
    keyVaultPlaceholderSource(platform?.keyVaultUri ?? null),
  ];
  if (platform?.localSecretDir !== null && platform?.localSecretDir !== undefined) {
    providers.push(localStoreSource(createLocalSecureStore(platform.localSecretDir)));
  }
  return providers;
};

/** A resolver with no observer, for health reads. Health resolves nothing. */
export const healthResolver = (platform: SecretPlatform | undefined): SecretResolver =>
  createSecretResolver({
    environment: platform?.environment ?? 'local',
    providers: sourcesFor(platform),
  });

/**
 * The resolver one request uses, auditing every resolution as that request's
 * actor, for the named provider.
 */
export const auditedResolver = (
  ctx: RouteContext,
  deps: RouteDeps,
  providerId: GenerationProviderId,
): SecretResolver =>
  createSecretResolver({
    environment: deps.secrets?.environment ?? 'local',
    providers: sourcesFor(deps.secrets),
    onResolution: async (event) => {
      await createAuditWriter({ clock: systemClock }).write(deps.prisma, {
        action: 'ADMIN.CONFIGURATION.SECRET_VALIDATED',
        outcome: event.status === 'RESOLVED' ? 'SUCCESS' : 'FAILURE',
        actorType: 'USER',
        actorUserId: ctx.subject.userId,
        actorDisplayName: ctx.subject.displayName,
        actorRoles: [...ctx.subject.roles],
        entityType: 'SecretReference',
        entityId: event.referenceFingerprint,
        entityLabel: providerId,
        correlationId: ctx.correlationId,
        requestId: ctx.requestId,
        portal: 'AUTHORING',
        detail: {
          providerId,
          referenceSource: event.source ?? 'UNKNOWN',
          referenceFingerprint: event.referenceFingerprint,
          resolutionStatus: event.status,
          purpose: event.purpose,
          durationMs: event.durationMs,
        },
      });
    },
  });

/** Each provider's documented host(s). A provider not listed may be sent nothing. */
const DEFAULT_HOSTS: Readonly<Partial<Record<GenerationProviderId, readonly string[]>>> = {
  OPENAI: OPENAI_DEFAULT_HOSTS,
};

export const allowedHostsFor = (
  providerId: GenerationProviderId,
  platform: SecretPlatform | undefined,
): readonly string[] => [
  ...(DEFAULT_HOSTS[providerId] ?? []),
  ...(platform?.extraAllowedHosts ?? []),
];
