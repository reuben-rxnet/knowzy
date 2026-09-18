// Knowzy MCP server.
//
// This is the only component that holds source credentials, and it is never
// internet-reachable (architecture.md §12.1, ADR-003).
//
// 12 of the 36 tools in mcp-tools.md §2 are registered: the source
// administration and navigation families plus the two extraction tools, which
// is what MVP steps 1-2 need. The registry declares policy, portal partition,
// timeout budget, and audit action for each (G2), and the contract test asserts
// the HTTP surface exposes exactly what the registry declares — so the
// remaining 24 arrive by registration, not by growing a handler.

import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import {
  StartupFatalError,
  enforceStartup,
  formatStartupReport,
  readProcessEnv,
  resolveKnowzyEnv,
  validateStartup,
} from '@knowzy/configuration';
import { createLogger, systemClock } from '@knowzy/observability';
import { createPrismaClient, probeDatabase } from '@knowzy/database';
import { createAdapterRegistry } from './adapters/registry.js';
import { registerToolRoutes } from './http/invoke.js';
import { toolNames } from './tools/registry.js';

// Importing the tool modules is what registers them. The registry is the only
// path to the HTTP surface, so an unimported module is an absent tool rather
// than an unreachable one.
import './tools/source-administration.js';
import './tools/source-navigation.js';
import './tools/generation.js';

const PORT = 8081;

/** The tool registry version the API negotiates against (startup check 7). */
export const TOOL_REGISTRY_VERSION = '1';

/** Fixture tree for the mock adapter. Registered in `local` only (§6). */
const FIXTURE_ROOT = fileURLToPath(new URL('../../../fixtures/knowledge', import.meta.url));

const main = async (): Promise<void> => {
  const rawEnv = readProcessEnv();
  const environment = resolveKnowzyEnv(rawEnv) ?? 'unknown';
  const isLocal = environment === 'local';

  const logger = createLogger({
    serviceName: rawEnv['OTEL_SERVICE_NAME'] ?? 'knowzy-mcp',
    environment,
    level: isLocal ? 'debug' : 'info',
    pretty: isLocal,
  });

  const prisma = createPrismaClient({ connectionString: rawEnv['DATABASE_URL'] ?? '' });

  const report = await validateStartup({
    deployable: 'mcp-server',
    rawEnv,
    expectedMigrationVersion: '0003_platform_constraints',
    probes: {
      database: () => probeDatabase(prisma),
      mockAdaptersRegistered: () => isLocal,
    },
  });

  process.stdout.write(`${formatStartupReport(report)}\n`);
  enforceStartup(report);

  // `environment` carries 'unknown' so the startup report can NAME the problem
  // rather than crashing before it prints. By here enforceStartup has passed,
  // so an unresolved environment is a contradiction, not a runtime case.
  const knowzyEnv = resolveKnowzyEnv(rawEnv);
  if (knowzyEnv === null) {
    throw new Error(
      'KNOWZY_ENV is not a recognised environment, yet startup validation passed. ' +
        'That is a defect in the startup checks, not a configuration error.',
    );
  }

  const app = Fastify({ logger: false });

  // The mock adapter is registered ONLY in local, and createAdapterRegistry
  // throws otherwise, so this cannot be turned into a production fallback.
  const adapterRegistry = createAdapterRegistry({
    environment: knowzyEnv,
    ...(isLocal ? { fixtureRoot: FIXTURE_ROOT } : {}),
  });

  registerToolRoutes(app, {
    logger,
    clock: systemClock,
    deps: {
      prisma,
      clock: systemClock,
      logger,
      environment: knowzyEnv,
      adapterFor: adapterRegistry.forSource,
      limits: { maxBytes: 25_000_000, maxCharsPerDocument: 200_000, pageSize: 50 },
    },
  });

  app.get('/internal/health/live', async () => ({ status: 'live', environment }));
  app.get('/internal/health/ready', async () => ({
    status: 'ready',
    environment,
    toolRegistryVersion: TOOL_REGISTRY_VERSION,
    // Counted from the registry rather than hardcoded, so the number cannot
    // claim more tools than are actually reachable.
    tools: toolNames().length,
    registeredAdapterTypes: adapterRegistry.registeredTypes,
    note: 'Source administration, navigation, and generation governance registered; see mcp-tools.md §2.',
  }));

  process.on('SIGTERM', () => void app.close().then(() => process.exit(0)));

  // Internal ingress only. Binding is still 0.0.0.0 inside the container; the
  // network position is enforced by the Container Apps ingress configuration
  // and by compose not publishing this port.
  await app.listen({ port: PORT, host: '0.0.0.0' });
  logger.info('mcp server listening', {
    port: PORT,
    toolRegistryVersion: TOOL_REGISTRY_VERSION,
    tools: toolNames().length,
  });
};

main().catch((error: unknown) => {
  if (error instanceof StartupFatalError) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
  process.stderr.write(
    `mcp-server failed to start: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
