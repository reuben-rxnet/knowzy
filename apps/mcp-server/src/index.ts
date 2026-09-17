// Knowzy MCP server — Phase 1.
//
// This is the only component that will hold Microsoft Graph credentials, and it
// is never internet-reachable (architecture.md §12.1, ADR-003). Phase 1 stands
// up the process and its health surface; the 36 typed tools, the
// portal-partitioned registry, and envelope verification arrive in Phase 3
// (mcp-tools.md).
//
// Registering a tool now would mean a tool with no declared policy, portal
// partition, or audit action, which repository-structure.md §5.3 G2 forbids.

import Fastify from 'fastify';
import {
  StartupFatalError,
  enforceStartup,
  formatStartupReport,
  readProcessEnv,
  resolveKnowzyEnv,
  validateStartup,
} from '@knowzy/configuration';
import { createLogger } from '@knowzy/observability';
import { createPrismaClient, probeDatabase } from '@knowzy/database';

const PORT = 8081;

/** The tool registry version the API negotiates against (startup check 7). */
export const TOOL_REGISTRY_VERSION = '0';

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

  const app = Fastify({ logger: false });

  app.get('/internal/health/live', async () => ({ status: 'live', environment }));
  app.get('/internal/health/ready', async () => ({
    status: 'ready',
    environment,
    toolRegistryVersion: TOOL_REGISTRY_VERSION,
    // Stated plainly so a caller cannot mistake an empty registry for a
    // working one.
    tools: 0,
    note: 'Tool registry is implemented in Phase 3 (mcp-tools.md).',
  }));

  process.on('SIGTERM', () => void app.close().then(() => process.exit(0)));

  // Internal ingress only. Binding is still 0.0.0.0 inside the container; the
  // network position is enforced by the Container Apps ingress configuration
  // and by compose not publishing this port.
  await app.listen({ port: PORT, host: '0.0.0.0' });
  logger.info('mcp server listening', { port: PORT, toolRegistryVersion: TOOL_REGISTRY_VERSION });
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
