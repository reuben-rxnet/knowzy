// Setting a per-provider token limit from the product — the administrator's
// half of the control layer.
//
// Configuration was read-only in this platform until now: every `llm.*` ceiling
// existed as a declared key with a code default and no way to change it without
// a deployment. That is not a usable control for a platform owner who needs to
// cap a provider on a Friday afternoon.
//
// The write goes where configuration writes already go — `ApplicationConfiguration`
// at PLATFORM scope, with a `ConfigurationChange` row and an audit event
// carrying previous and new value (H2). Nothing new was invented for it, and
// nothing is stored that the declared catalogue does not describe.

import { createAuditWriter, type PrismaClient } from '@knowzy/database';
import type { Clock } from '@knowzy/observability';
import type { GenerationProviderId, ProviderLimits } from '@knowzy/shared-types';

const CONFIG_KEY = 'llm.providerLimits';

/**
 * Prisma's JSON input type rejects `Record<string, unknown>` because a value
 * could be a function or a symbol. The record here is built from validated
 * numbers only, so the cast asserts what `assertSane` has already checked
 * rather than papering over an unknown shape.
 */
type JsonObject = Record<string, unknown>;
const asJson = (value: JsonObject): never => value as unknown as never;

export class ProviderLimitError extends Error {
  override readonly name = 'ProviderLimitError';
  constructor(
    readonly code: 'VALIDATION_FAILED',
    detail: string,
  ) {
    super(detail);
  }
}

export interface SetProviderLimitsArgs {
  readonly prisma: PrismaClient;
  readonly clock: Clock;
  readonly actor: {
    readonly userId: string;
    readonly displayName: string;
    readonly roles: readonly string[];
  };
  readonly correlationId: string;
  readonly requestId: string;
  readonly providerId: GenerationProviderId;
  /**
   * The override. An EMPTY object removes it, which is how an administrator
   * returns a provider to the platform ceiling — distinct from setting the
   * ceiling to zero, which forbids generation entirely. Both are legitimate and
   * they must not be the same gesture.
   */
  readonly limits: ProviderLimits;
}

const assertSane = (limits: ProviderLimits): void => {
  const entries: readonly [string, number | undefined][] = [
    ['perJobTokenBudget', limits.perJobTokenBudget],
    ['dailyTokenBudget', limits.dailyTokenBudget],
    ['weeklyTokenBudget', limits.weeklyTokenBudget],
    ['monthlyTokenBudget', limits.monthlyTokenBudget],
    ['concurrency', limits.concurrency],
  ];
  for (const [name, value] of entries) {
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value < 0) {
      throw new ProviderLimitError(
        'VALIDATION_FAILED',
        `${name} must be a whole number of 0 or more.`,
      );
    }
  }
  if (limits.concurrency !== undefined && (limits.concurrency < 1 || limits.concurrency > 32)) {
    throw new ProviderLimitError('VALIDATION_FAILED', 'concurrency must be between 1 and 32.');
  }
  // A per-job ceiling above the daily one is not an error the platform should
  // silently accept: it reads as a larger allowance than the day can fund, and
  // the first job would be refused by the daily budget with a confusing reason.
  if (
    limits.perJobTokenBudget !== undefined &&
    limits.dailyTokenBudget !== undefined &&
    limits.perJobTokenBudget > limits.dailyTokenBudget
  ) {
    throw new ProviderLimitError(
      'VALIDATION_FAILED',
      'The per-job ceiling cannot exceed the daily ceiling: no job could ever run.',
    );
  }
};

export interface SetProviderLimitsResult {
  readonly providerId: GenerationProviderId;
  readonly limits: Readonly<Partial<Record<GenerationProviderId, ProviderLimits>>>;
  readonly removed: boolean;
}

export const setProviderLimits = async (
  args: SetProviderLimitsArgs,
): Promise<SetProviderLimitsResult> => {
  assertSane(args.limits);
  const auditWriter = createAuditWriter({ clock: args.clock });
  const removing = Object.values(args.limits).every((value) => value === undefined);

  return args.prisma.$transaction(async (tx) => {
    const existing = await tx.applicationConfiguration.findFirst({
      where: { key: CONFIG_KEY, scope: 'PLATFORM', scopeId: null },
      select: { id: true, value: true },
    });

    const previous = (existing?.value ?? {}) as Record<string, unknown>;
    const next: Record<string, unknown> = { ...previous };
    if (removing) delete next[args.providerId];
    else next[args.providerId] = args.limits;

    if (existing) {
      await tx.applicationConfiguration.update({
        where: { id: existing.id },
        data: {
          value: asJson(next),
          updatedByUserId: args.actor.userId,
          version: { increment: 1 },
        },
      });
    } else {
      await tx.applicationConfiguration.create({
        data: {
          key: CONFIG_KEY,
          scope: 'PLATFORM',
          scopeId: null,
          value: asJson(next),
          valueType: 'object',
          updatedByUserId: args.actor.userId,
        },
      });
    }

    await tx.configurationChange.create({
      data: {
        key: CONFIG_KEY,
        scope: 'PLATFORM',
        scopeId: null,
        previousValue: asJson(previous),
        newValue: asJson(next),
        changedByUserId: args.actor.userId,
        correlationId: args.correlationId,
      },
    });

    await auditWriter.write(tx, {
      action: 'ADMIN.CONFIGURATION.UPDATED',
      outcome: 'SUCCESS',
      actorType: 'USER',
      actorUserId: args.actor.userId,
      actorDisplayName: args.actor.displayName,
      actorRoles: [...args.actor.roles],
      entityType: 'ApplicationConfiguration',
      entityId: CONFIG_KEY,
      entityLabel: `${CONFIG_KEY}.${args.providerId}`,
      correlationId: args.correlationId,
      requestId: args.requestId,
      portal: 'AUTHORING',
      previousValue: previous,
      newValue: next,
      detail: {
        key: CONFIG_KEY,
        scope: 'PLATFORM',
        valueType: 'object',
        providerId: args.providerId,
        changedFields: Object.entries(args.limits)
          .filter(([, value]) => value !== undefined)
          .map(([name]) => name),
      },
    });

    return {
      providerId: args.providerId,
      limits: next as Readonly<Partial<Record<GenerationProviderId, ProviderLimits>>>,
      removed: removing,
    };
  });
};
