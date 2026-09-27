// The API's construction of the OpenAI GENERATION provider (OPENAI-CODEX-01).
//
// The provider in @knowzy/claude-services knows how to call OpenAI and nothing
// about where its settings or its key come from. This is where they come from,
// PER CALL:
//
//   * the settings -- base URL, model, API style, auth header, sampling --
//     from `llm.providerSettings.OPENAI`, read when the call is made, so an
//     administrator's change applies to the next job with no restart;
//   * the key, resolved through the audited Secret Resolution Layer
//     (`SECRET_VALIDATED`, purpose GENERATION, as the requesting user), and
//     never held after the call;
//   * the allow-list, from the deployment (`LLM_ENDPOINT_ALLOWLIST`).
//
// Nothing here decides whether OpenAI MAY run. The control registry does that
// inside `invokeWithControls` -- approval, enablement, credential, budgets,
// concurrency -- and refuses before this code is reached. A configuration that
// has changed underneath a running request (a reference removed, a store
// emptied) fails the call with a CLIENT-class error, which ends the job FAILED
// rather than retrying a key that is not there.

import {
  createOpenAIGenerationProvider,
  OpenAIGenerationError,
  type GenerationProvider,
} from '@knowzy/claude-services';
import { createSecretResolver } from '@knowzy/configuration';
import { createAuditWriter, type PrismaClient } from '@knowzy/database';
import { systemClock } from '@knowzy/observability';
import { loadControlLayer } from './control-layer.js';
import { allowedHostsFor, secretSourcesFor } from '../secrets/platform-secrets.js';
import type { SecretPlatform } from '../secrets/secret-platform.js';

export interface GenerationCaller {
  readonly userId: string;
  readonly displayName: string;
  readonly roles: readonly string[];
  readonly correlationId: string;
  readonly requestId: string;
}

export const createOpenAIForJob = (args: {
  readonly prisma: PrismaClient;
  readonly secrets: SecretPlatform | undefined;
  readonly modelId: string;
  readonly caller: GenerationCaller | undefined;
  readonly fetch?: typeof fetch;
}): GenerationProvider =>
  createOpenAIGenerationProvider({
    modelId: args.modelId,
    ...(args.fetch === undefined ? {} : { fetch: args.fetch }),
    configure: async () => {
      const control = await loadControlLayer(args.prisma);
      const settings = control.providerSettings.OPENAI;
      if (
        settings?.baseUrl === undefined ||
        settings.modelId === undefined ||
        settings.apiKeyRef === undefined
      ) {
        throw new OpenAIGenerationError(
          'OpenAI is not configured: base URL, model and credential reference are all required.',
          409,
          'NOT_CONFIGURED',
        );
      }

      const caller = args.caller;
      const resolver = createSecretResolver({
        environment: args.secrets?.environment ?? 'local',
        providers: secretSourcesFor(args.secrets),
        onResolution: async (event) => {
          await createAuditWriter({ clock: systemClock }).write(args.prisma, {
            action: 'ADMIN.CONFIGURATION.SECRET_VALIDATED',
            outcome: event.status === 'RESOLVED' ? 'SUCCESS' : 'FAILURE',
            actorType: caller === undefined ? 'SYSTEM' : 'USER',
            ...(caller === undefined
              ? {}
              : {
                  actorUserId: caller.userId,
                  actorDisplayName: caller.displayName,
                  actorRoles: [...caller.roles],
                  requestId: caller.requestId,
                }),
            entityType: 'SecretReference',
            entityId: event.referenceFingerprint,
            entityLabel: 'OPENAI',
            correlationId: caller?.correlationId ?? `generation-${Date.now()}`,
            portal: 'AUTHORING',
            detail: {
              providerId: 'OPENAI',
              referenceSource: event.source ?? 'UNKNOWN',
              referenceFingerprint: event.referenceFingerprint,
              resolutionStatus: event.status,
              purpose: event.purpose,
              durationMs: event.durationMs,
            },
          });
        },
      });
      const resolution = await resolver.resolve(settings.apiKeyRef, 'GENERATION');
      if (resolution.status !== 'RESOLVED') {
        throw new OpenAIGenerationError(resolution.detail, 409, 'CREDENTIAL_UNRESOLVED');
      }

      return {
        baseUrl: settings.baseUrl,
        modelId: settings.modelId,
        apiKey: resolution.value,
        allowedHosts: allowedHostsFor('OPENAI', args.secrets),
        apiStyle: settings.apiStyle ?? 'RESPONSES',
        authHeaderName: settings.authHeaderName ?? 'authorization',
        temperature: settings.temperature ?? null,
        maxOutputTokens: settings.maxOutputTokens ?? null,
      };
    },
  });
