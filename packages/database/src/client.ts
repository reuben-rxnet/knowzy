// Prisma client construction.
//
// The connection string arrives as a parameter rather than being read from the
// environment here: @knowzy/configuration is the only reader of process.env
// (C3), so this module takes what it is given.

import { PrismaClient, Prisma } from '@prisma/client';

export type { Prisma };
export { PrismaClient };

/**
 * The transaction-scoped client. Every repository and the audit writer accept
 * this type, so a call site cannot accidentally escape the caller's transaction
 * — which is what makes the audit/state coupling in U1 hold.
 */
export type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/** Either a pooled client or a transaction. Repositories accept both. */
export type DbClient = PrismaClient | TransactionClient;

export interface DatabaseOptions {
  readonly connectionString: string;
  readonly logQueries?: boolean;
  /** Statement timeout in milliseconds — error-handling.md §5. */
  readonly statementTimeoutMs?: number;
}

export const createPrismaClient = (options: DatabaseOptions): PrismaClient => {
  const client = new PrismaClient({
    datasources: { db: { url: options.connectionString } },
    log: options.logQueries
      ? [
          { emit: 'event', level: 'query' },
          { emit: 'stdout', level: 'warn' },
          { emit: 'stdout', level: 'error' },
        ]
      : [
          { emit: 'stdout', level: 'warn' },
          { emit: 'stdout', level: 'error' },
        ],
  });

  return client;
};

/**
 * Reads the applied migration at the head of `_prisma_migrations`, for startup
 * check 5. Returns null when the table is absent, which is itself the answer:
 * the database has never been migrated.
 */
export const readAppliedMigration = async (
  client: DbClient,
): Promise<string | null> => {
  const rows = await (client as PrismaClient).$queryRaw<{ migration_name: string }[]>`
    SELECT migration_name
    FROM _prisma_migrations
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    ORDER BY finished_at DESC
    LIMIT 1
  `;
  return rows[0]?.migration_name ?? null;
};

export const probeDatabase = async (
  client: DbClient,
): Promise<{ reachable: boolean; migrationVersion: string | null }> => {
  try {
    await (client as PrismaClient).$queryRaw`SELECT 1`;
  } catch {
    return { reachable: false, migrationVersion: null };
  }

  try {
    return { reachable: true, migrationVersion: await readAppliedMigration(client) };
  } catch {
    // Reachable but unmigrated: the distinction matters, because the operator
    // action differs.
    return { reachable: true, migrationVersion: null };
  }
};
