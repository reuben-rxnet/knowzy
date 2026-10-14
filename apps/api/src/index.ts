// API bootstrap.
//
// Order matters: validate configuration, THEN accept traffic. A fail-fast
// check failing exits non-zero — environment-and-configuration.md §9.

import { createOpenAIForJob } from './generation/openai-provider.js';
import { loadControlLayer } from './generation/control-layer.js';
import { secretPlatformFromEnv } from './secrets/platform-secrets.js';
import { documentStudioPlatformFromEnv } from './document-studio/platform.js';
import {
  StartupFatalError,
  enforceStartup,
  formatStartupReport,
  readProcessEnv,
  resolveKnowzyEnv,
} from '@knowzy/configuration';
import { createLogger, systemClock } from '@knowzy/observability';
import { createSubjectResolver } from '@knowzy/authentication';
import { createAuditWriter, createPrismaClient, subjectLookupRepository } from '@knowzy/database';
import { createProviderRegistry } from './generation/provider-registry.js';
import { createMcpClient } from './mcp/client.js';
import { buildServer } from './server.js';
import { runApiStartupValidation } from './startup.js';

const PORT = 8080;

const main = async (): Promise<void> => {
  const rawEnv = readProcessEnv();
  const environment = resolveKnowzyEnv(rawEnv) ?? 'unknown';
  const isLocal = environment === 'local';

  const logger = createLogger({
    serviceName: rawEnv['OTEL_SERVICE_NAME'] ?? 'knowzy-api',
    environment,
    level: isLocal ? 'debug' : 'info',
    pretty: isLocal,
  });

  const prisma = createPrismaClient({
    connectionString: rawEnv['DATABASE_URL'] ?? '',
    logQueries: false,
  });

  // Phase 1 wires the probes it can honestly supply. The Key Vault, MCP, JWKS,
  // and blob probes are added by the phases that introduce those dependencies;
  // until then the validator reports NOT_RUN for them rather than a misleading
  // PASS (§9, and the honesty rule in knowledge-source-administration.md §5.4).
  const report = await runApiStartupValidation({
    prisma,
    mockAdaptersRegistered: () => isLocal,
  });

  process.stdout.write(`${formatStartupReport(report)}\n`);

  for (const finding of report.findings) {
    logger.warn('startup finding', { checkKey: finding.checkKey, reason: finding.detail });
  }
  for (const flag of report.forcedOffFlags) {
    logger.warn('feature flag forced off at startup', { key: flag });
  }

  enforceStartup(report);

  // Identity. In `local` this is the stub issuer, which reads a header naming
  // a seeded user; it refuses to construct in any other environment, so it
  // cannot become an authentication bypass in a deployed one.
  const resolver = createSubjectResolver({
    environment: environment === 'unknown' ? 'local' : environment,
    lookup: subjectLookupRepository(prisma),
  });
  logger.info('subject resolver ready', { kind: resolver.kind });

  const auditWriter = createAuditWriter({ clock: systemClock });
  const platformSecrets = secretPlatformFromEnv(
    environment === 'unknown' ? 'local' : environment,
    rawEnv,
  );

  const app = buildServer({
    logger,
    environment,
    startupReport: report,
    readiness: () => runApiStartupValidation({ prisma, mockAdaptersRegistered: () => isLocal }),
    routeDeps: {
      prisma,
      auditWriter,
      logger,
      mcp: createMcpClient({ baseUrl: rawEnv['MCP_ENDPOINT'] ?? 'http://mcp:8081' }),
      // Only the deterministic provider is registered. Every other provider is
      // DECLARED, so a request for one is refused with a specific reason
      // rather than silently served by a substitute.
      //
      // `credentialedProviders` stays empty until a provider is built: naming
      // a provider here without an implementation would make
      // PROVIDER_NOT_REGISTERED read as PROVIDER_CREDENTIAL_UNAVAILABLE, which
      // would send an operator looking for a missing key rather than a missing
      // integration.
      providers: createProviderRegistry({
        environment,
        // OPENAI-CODEX-01. Constructed per job, key resolved per call.
        openai: (args) =>
          createOpenAIForJob({
            prisma,
            secrets: platformSecrets,
            modelId: args.modelId,
            caller:
              args.caller === undefined
                ? undefined
                : { userId: args.requestingUserId, ...args.caller },
          }),
        credentialConfigured: async (providerId) =>
          (await loadControlLayer(prisma)).providerSettings[providerId]?.apiKeyRef !== undefined,
      }),
      // P-5: where secrets resolve. The local secure store in `local` only;
      // elsewhere a keyvault:// reference, which reports SOURCE_UNAVAILABLE
      // until a Key Vault client exists.
      secrets: platformSecrets,
      // AI Document Studio M3. An unknown environment is treated as the most
      // restrictive one, so the local-only test preparer cannot leak into it.
      documentStudio: documentStudioPlatformFromEnv(
        environment === 'unknown' ? 'prod' : environment,
        rawEnv,
      ),
      resolveSubject: (headers) => resolver.resolve(headers),
    },
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info('shutting down', { signal });
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: PORT, host: '0.0.0.0' });
  logger.info('api listening', { port: PORT, startedAt: systemClock.nowIso() });
};

main().catch((error: unknown) => {
  if (error instanceof StartupFatalError) {
    // The non-zero exit required by exit criterion 4. The decision that drives
    // it is asserted in @knowzy/configuration's startup test suite.
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
  process.stderr.write(
    `api failed to start: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
