// Phase 1 repositories.
//
// Only the repositories the Foundation phase needs: platform configuration,
// feature flags, consistency findings, identity provisioning, and one scoped
// read (knowledge sources) that establishes the DataScope pattern every later
// phase follows.
//
// Later phases add their own repositories against the same contract; C9 is
// asserted for all of them by the contract test, so a new unscoped read fails
// the build rather than review.

import type {
  ConfigurationScope,
  DataScope,
  PermissionKey,
  RoleKey,
  Subject,
} from '@knowzy/shared-types';
import type { Clock } from '@knowzy/observability';
import type { DbClient, PrismaClient } from './client.js';
import { andPredicates, sourcePredicate, unscoped } from './scoped.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ConfigurationRow {
  readonly key: string;
  readonly scope: ConfigurationScope;
  readonly scopeId: string | null;
  readonly value: unknown;
}

export const configurationRepository = (client: DbClient) => ({
  /** Platform configuration is not person-scoped, so this read is unscoped. */
  loadAll: (): Promise<ConfigurationRow[]> =>
    unscoped('platform configuration is not person-scoped', async () => {
      const rows = await (client as PrismaClient).applicationConfiguration.findMany({
        select: { key: true, scope: true, scopeId: true, value: true },
      });
      return rows.map((r) => ({
        key: r.key,
        scope: r.scope,
        scopeId: r.scopeId,
        value: r.value as unknown,
      }));
    }),

  /**
   * Upserts a value and records the change with previous and new value (§10).
   * The change row is what the configuration change log report reads.
   */
  async put(args: {
    key: string;
    scope: ConfigurationScope;
    scopeId: string | null;
    value: unknown;
    valueType: string;
    isSecretRef?: boolean;
    actorUserId: string | null;
    correlationId: string;
  }): Promise<{ previousValue: unknown }> {
    const db = client as PrismaClient;

    // findFirst + explicit create/update rather than upsert.
    //
    // Two reasons, both structural:
    //   1. Prisma's compound-unique input rejects a null component, so
    //      `findUnique({ key_scope_scopeId: { scopeId: null } })` does not
    //      typecheck for a PLATFORM-scoped row.
    //   2. PostgreSQL treats NULLs as DISTINCT in a unique index, so
    //      @@unique([key, scope, scopeId]) would not have prevented two
    //      PLATFORM rows for one key anyway. Migration 0003 adds a partial
    //      unique index for the scopeId IS NULL case, which is what actually
    //      enforces the uniqueness data-model.md §10 describes.
    const existing = await db.applicationConfiguration.findFirst({
      where: { key: args.key, scope: args.scope, scopeId: args.scopeId },
      select: { id: true, value: true },
    });

    if (existing) {
      await db.applicationConfiguration.update({
        where: { id: existing.id },
        data: {
          value: args.value as object,
          valueType: args.valueType,
          isSecretRef: args.isSecretRef ?? false,
          updatedByUserId: args.actorUserId,
        },
      });
    } else {
      await db.applicationConfiguration.create({
        data: {
          key: args.key,
          scope: args.scope,
          scopeId: args.scopeId,
          value: args.value as object,
          valueType: args.valueType,
          isSecretRef: args.isSecretRef ?? false,
          updatedByUserId: args.actorUserId,
        },
      });
    }

    await db.configurationChange.create({
      data: {
        key: args.key,
        scope: args.scope,
        scopeId: args.scopeId,
        previousValue: (existing?.value ?? undefined) as object | undefined,
        newValue: args.value as object,
        changedByUserId: args.actorUserId,
        correlationId: args.correlationId,
      },
    });

    return { previousValue: existing?.value ?? null };
  },
});

// ---------------------------------------------------------------------------
// Feature flags
// ---------------------------------------------------------------------------

export const featureFlagRepository = (client: DbClient) => ({
  /** Flags are per environment, not per person. */
  loadForEnvironment: (environment: string): Promise<Record<string, boolean>> =>
    unscoped('feature flags are per environment, not person-scoped', async () => {
      const rows = await (client as PrismaClient).featureFlag.findMany({
        where: { environment },
        select: { key: true, enabled: true },
      });
      return Object.fromEntries(rows.map((r) => [r.key, r.enabled]));
    }),

  async set(args: {
    key: string;
    environment: string;
    enabled: boolean;
    actorUserId: string | null;
  }): Promise<{ previousEnabled: boolean | null }> {
    const db = client as PrismaClient;
    const existing = await db.featureFlag.findUnique({
      where: { key_environment: { key: args.key, environment: args.environment } },
      select: { enabled: true },
    });

    await db.featureFlag.upsert({
      where: { key_environment: { key: args.key, environment: args.environment } },
      create: {
        key: args.key,
        environment: args.environment,
        enabled: args.enabled,
        updatedByUserId: args.actorUserId,
      },
      update: { enabled: args.enabled, updatedByUserId: args.actorUserId },
    });

    return { previousEnabled: existing?.enabled ?? null };
  },
});

// ---------------------------------------------------------------------------
// Consistency findings — M4: drift is reported, never silently corrected
// ---------------------------------------------------------------------------

export const findingRepository = (client: DbClient) => ({
  async raise(args: {
    checkKey: string;
    entityType: string;
    entityId?: string | null;
    expected?: unknown;
    actual?: unknown;
    note?: string;
  }): Promise<void> {
    await (client as PrismaClient).platformConsistencyFinding.create({
      data: {
        checkKey: args.checkKey,
        entityType: args.entityType,
        entityId: args.entityId ?? null,
        expected: (args.expected ?? undefined) as object | undefined,
        actual: (args.actual ?? undefined) as object | undefined,
        note: args.note ?? null,
      },
    });
  },

  openCount: (): Promise<number> =>
    unscoped('platform findings are operational, not person-scoped', () =>
      (client as PrismaClient).platformConsistencyFinding.count({ where: { state: 'OPEN' } }),
    ),
});

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const userRepository = (client: DbClient, clock: Clock) => ({
  findByEntraObjectId: (entraObjectId: string) =>
    (client as PrismaClient).user.findUnique({ where: { entraObjectId } }),

  /**
   * Just-in-time provisioning on first successful sign-in (§3.1). Account
   * status and portal access are checked per request, so provisioning grants
   * nothing by itself.
   */
  async provision(args: {
    entraObjectId: string;
    userPrincipalName: string;
    displayName: string;
    email?: string | null;
    jobTitle?: string | null;
    department?: string | null;
    businessFunction?: string | null;
    authoringPortalAccess?: boolean;
    livePortalAccess?: boolean;
    timeZone?: string;
  }) {
    const now = clock.now();
    return (client as PrismaClient).user.upsert({
      where: { entraObjectId: args.entraObjectId },
      create: {
        entraObjectId: args.entraObjectId,
        userPrincipalName: args.userPrincipalName,
        displayName: args.displayName,
        email: args.email ?? null,
        jobTitle: args.jobTitle ?? null,
        department: args.department ?? null,
        businessFunction: args.businessFunction ?? null,
        authoringPortalAccess: args.authoringPortalAccess ?? false,
        livePortalAccess: args.livePortalAccess ?? false,
        timeZone: args.timeZone ?? 'UTC',
        provisionedAt: now,
        lastReconciledAt: now,
      },
      update: {
        userPrincipalName: args.userPrincipalName,
        displayName: args.displayName,
        email: args.email ?? null,
        jobTitle: args.jobTitle ?? null,
        department: args.department ?? null,
        businessFunction: args.businessFunction ?? null,
        lastReconciledAt: now,
      },
    });
  },

  /**
   * Effective roles and permissions, resolved from the database — never from
   * token claims (ADR-011). Only grants with no revocation count.
   */
  async resolveEffectiveAccess(userId: string): Promise<{
    roles: RoleKey[];
    permissions: PermissionKey[];
    status: string;
    authoringPortalAccess: boolean;
    livePortalAccess: boolean;
  } | null> {
    const db = client as PrismaClient;
    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        status: true,
        authoringPortalAccess: true,
        livePortalAccess: true,
        roles: {
          // An INACTIVE role confers nothing (Authoring Role Simplification,
          // access-control.md §2.0). The grant row stays for history.
          where: { revokedAt: null, role: { isActive: true } },
          select: {
            role: {
              select: {
                key: true,
                permissions: { select: { permission: { select: { key: true } } } },
              },
            },
          },
        },
      },
    });
    if (!user) return null;

    const roles = user.roles.map((r) => r.role.key as RoleKey);
    const permissions = [
      ...new Set(
        user.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.key as PermissionKey)),
      ),
    ];

    return {
      roles,
      permissions,
      status: user.status,
      authoringPortalAccess: user.authoringPortalAccess,
      livePortalAccess: user.livePortalAccess,
    };
  },
});

// ---------------------------------------------------------------------------
// Knowledge sources — the representative scoped read
// ---------------------------------------------------------------------------

export const knowledgeSourceRepository = (client: DbClient) => ({
  /**
   * Scoped list. `scope` is required (C9), and it becomes part of the WHERE
   * clause rather than a post-filter, so the count the caller sees is the count
   * within their scope.
   *
   * Note what is NOT selected: `connection`. No tenant hostname, site URL, site
   * ID, or secret reference reaches a caller through this read
   * (mcp-tools.md §5).
   */
  listForScope: (
    scope: DataScope,
    args: { activeOnly?: boolean; take?: number; cursor?: string } = {},
  ) =>
    (client as PrismaClient).knowledgeSource.findMany({
      where: andPredicates(
        sourcePredicate(scope, 'id'),
        args.activeOnly === true ? { isActive: true } : {},
        { archivedAt: null },
      ),
      select: {
        id: true,
        name: true,
        description: true,
        sourceType: true,
        isActive: true,
        connectionStatus: true,
        connectionStatusAt: true,
        permissionMode: true,
        usableForGeneration: true,
        usableForRefreshers: true,
        usableForExplanations: true,
        ownerUserId: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { name: 'asc' },
      take: Math.min(args.take ?? 50, 200),
      ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
    }),

  countForScope: (scope: DataScope) =>
    (client as PrismaClient).knowledgeSource.count({
      where: andPredicates(sourcePredicate(scope, 'id'), { archivedAt: null }),
    }),
});

// ---------------------------------------------------------------------------
// Audit partitions
//
// The raw SQL lives here rather than in the job that calls it, because C4
// confines parameterized raw SQL to the data layer. A job reaching for
// $queryRaw would be the start of SQL spreading through the application.
// ---------------------------------------------------------------------------

export const auditPartitionRepository = (client: DbClient) => ({
  /**
   * Idempotently creates the monthly partition for the given month and returns
   * its name. Calls the function created by migration 0001.
   */
  async ensurePartition(monthIsoDate: string): Promise<string | null> {
    const rows = await (client as PrismaClient).$queryRaw<
      { knowzy_ensure_audit_partition: string }[]
    >`SELECT knowzy_ensure_audit_partition(${monthIsoDate}::date)`;
    return rows[0]?.knowzy_ensure_audit_partition ?? null;
  },

  /**
   * Rows in the DEFAULT partition. Non-zero means the monthly window fell
   * behind: the rows are intact, but the runway needs attention.
   */
  async countDefaultPartitionRows(): Promise<number> {
    const rows = await (client as PrismaClient).$queryRaw<{ count: bigint }[]>`
      SELECT count(*)::bigint AS count FROM audit_event_default
    `;
    return Number(rows[0]?.count ?? 0);
  },
});

// ---------------------------------------------------------------------------
// Subject lookup
//
// Implements the SubjectLookup port that @knowzy/authentication injects. Roles,
// permissions, and scopes all come from the database, never from token claims
// (ADR-011), and account status travels with the subject so the policy engine
// can refuse a suspended account on the current request (S5).
// ---------------------------------------------------------------------------

export const subjectLookupRepository = (client: DbClient) => ({
  /** Resolves by UPN or entraObjectId. Returns null rather than throwing. */
  async byIdentifier(identifier: string): Promise<Subject | null> {
    const db = client as PrismaClient;

    const user = await db.user.findFirst({
      where: {
        OR: [{ entraObjectId: identifier }, { userPrincipalName: identifier }],
      },
      select: {
        id: true,
        entraObjectId: true,
        displayName: true,
        status: true,
        authoringPortalAccess: true,
        livePortalAccess: true,
        roles: {
          // An INACTIVE role confers nothing (Authoring Role Simplification,
          // access-control.md §2.0). The grant row stays for history.
          where: { revokedAt: null, role: { isActive: true } },
          select: {
            role: {
              select: {
                key: true,
                permissions: { select: { permission: { select: { key: true } } } },
              },
            },
          },
        },
        domainScopes: { where: { revokedAt: null }, select: { domainId: true } },
        teams: { select: { teamId: true } },
        sourceAccess: {
          where: { revokedAt: null },
          select: { sourceId: true, mode: true },
        },
      },
    });

    if (!user) return null;

    const permissions = [
      ...new Set(
        user.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.key as PermissionKey)),
      ),
    ];

    return {
      userId: user.id,
      entraObjectId: user.entraObjectId,
      displayName: user.displayName,
      roles: user.roles.map((r) => r.role.key),
      permissions,
      status: user.status,
      authoringPortalAccess: user.authoringPortalAccess,
      livePortalAccess: user.livePortalAccess,
      // Empty arrays mean UNRESTRICTED on that dimension (access-control.md §5),
      // which is why the seeded users — who carry no explicit scopes — can act
      // across domains in local development.
      domainIds: user.domainScopes.map((d) => d.domainId),
      teamIds: user.teams.map((t) => t.teamId),
      allowSourceIds: user.sourceAccess.filter((s) => s.mode === 'ALLOW').map((s) => s.sourceId),
      denySourceIds: user.sourceAccess.filter((s) => s.mode === 'DENY').map((s) => s.sourceId),
    };
  },
});
