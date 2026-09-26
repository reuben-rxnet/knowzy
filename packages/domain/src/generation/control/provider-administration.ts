// Administration -> AI Providers: the write paths and the screen's read model.
//
// Before this, every `llm.*` value except the per-provider limits was
// read-only: a provider could be declared, priced and budgeted, and turning one
// on still meant a deployment. That is not a usable control for the person who
// owns the platform, and it is the reason the first external provider would
// have arrived as a code change under time pressure.
//
// FOUR WRITES, and they are separate on purpose:
//
//   1. SETTINGS      — enabled, endpoint, model, credential REFERENCE, sampling
//   2. APPROVAL      — the data-processing approval, with its reference
//   3. ACTIVE        — which provider generation actually uses
//   4. VALIDATION    — a recorded readiness check ("Test connection")
//
// Collapsing 1 and 2 into one form would have been the mistake that matters.
// `BLOCKED_BY_APPROVAL` is the control that makes T-29 real: a credential is
// not authorization. If "approved" were a checkbox beside "enabled", the
// control would be a formality an administrator ticks past on the way to
// enabling a provider. So granting an approval REQUIRES A REFERENCE -- a
// document, a ticket, a signed record -- it is audited with previous and new
// value, and it is a deliberate second act.
//
// NO SECRET IS EVER STORED OR RETURNED. Settings hold a keyvault:// reference,
// validated as a reference by the schema, and the read model reports only
// whether one is recorded and when it changed. A `credentialRef` never leaves
// this module.

import { createAuditWriter, type PrismaClient, type TransactionClient } from '@knowzy/database';
import type { Clock } from '@knowzy/observability';
import {
  ProviderSettingsSchema,
  type GenerationProviderId,
  type ProviderAdminRow,
  type ProviderAdministration,
  type ProviderHealthState,
  type ProviderLimits,
  type ProviderSettings,
  type ProviderState,
  type ProviderStateAssessment,
  type ProviderValidationOutcome,
  type ProviderValidationReport,
  type ProviderValidationStep,
} from '@knowzy/shared-types';

const SETTINGS_KEY = 'llm.providerSettings';
const APPROVED_KEY = 'llm.approvedProviders';
const ACTIVE_KEY = 'llm.activeProvider';

/**
 * Prisma's Json input type rejects `Record<string, unknown>` because a value
 * could be a function or a symbol. Everything written here has been through a
 * zod schema, so the cast asserts what was already checked.
 */
const asJson = (value: unknown): never => value as never;

export class ProviderAdminError extends Error {
  override readonly name = 'ProviderAdminError';
  constructor(
    readonly code: 'VALIDATION_FAILED' | 'PROVIDER_NOT_APPROVED' | 'PROVIDER_NOT_REGISTERED',
    detail: string,
  ) {
    super(detail);
  }
}

export interface AdminActor {
  readonly userId: string;
  readonly displayName: string;
  readonly roles: readonly string[];
}

interface WriteContext {
  readonly prisma: PrismaClient;
  readonly clock: Clock;
  readonly actor: AdminActor;
  readonly correlationId: string;
  readonly requestId: string;
}

/**
 * One configuration write: the row, the change record and the audit event, in
 * one transaction.
 *
 * Shared by all three configuration writes here so they cannot drift into
 * three slightly different ideas of what a configuration change is. U1: if the
 * audit insert fails, the value is not persisted.
 */
const writeConfig = async <T>(
  ctx: WriteContext,
  key: string,
  action: string,
  nextOf: (previous: unknown) => T,
  detail: (previous: unknown, next: T) => Record<string, unknown>,
  entityLabel: string,
): Promise<T> => {
  const auditWriter = createAuditWriter({ clock: ctx.clock });

  return ctx.prisma.$transaction(async (tx: TransactionClient) => {
    const existing = await tx.applicationConfiguration.findFirst({
      where: { key, scope: 'PLATFORM', scopeId: null },
      select: { id: true, value: true },
    });
    const previous = existing?.value ?? null;
    const next = nextOf(previous);
    const valueType = Array.isArray(next)
      ? 'array'
      : typeof next === 'object'
        ? 'object'
        : 'string';

    if (existing) {
      await tx.applicationConfiguration.update({
        where: { id: existing.id },
        data: {
          value: asJson(next),
          updatedByUserId: ctx.actor.userId,
          version: { increment: 1 },
          // `isSecretRef` marks a row whose VALUE names a secret rather than
          // holding one, so a diagnostic export can redact the right rows
          // without knowing the key catalogue.
          ...(key === SETTINGS_KEY ? { isSecretRef: true } : {}),
        },
      });
    } else {
      await tx.applicationConfiguration.create({
        data: {
          key,
          scope: 'PLATFORM',
          scopeId: null,
          value: asJson(next),
          valueType,
          updatedByUserId: ctx.actor.userId,
          ...(key === SETTINGS_KEY ? { isSecretRef: true } : {}),
        },
      });
    }

    await tx.configurationChange.create({
      data: {
        key,
        scope: 'PLATFORM',
        scopeId: null,
        previousValue: asJson(redact(key, previous)),
        newValue: asJson(redact(key, next)),
        changedByUserId: ctx.actor.userId,
        correlationId: ctx.correlationId,
      },
    });

    await auditWriter.write(tx, {
      action,
      outcome: 'SUCCESS',
      actorType: 'USER',
      actorUserId: ctx.actor.userId,
      actorDisplayName: ctx.actor.displayName,
      actorRoles: [...ctx.actor.roles],
      entityType: 'ApplicationConfiguration',
      entityId: key,
      entityLabel,
      correlationId: ctx.correlationId,
      requestId: ctx.requestId,
      portal: 'AUTHORING',
      // H2: both sides. REDACTED at write time (audit-model.md §7), so an
      // auditor with an unscoped read still cannot recover a reference name.
      previousValue: redact(key, previous),
      newValue: redact(key, next),
      detail: detail(previous, next),
    });

    return next;
  });
};

/**
 * Removes credential references from anything durable.
 *
 * The reference is not itself a secret -- it is a vault path -- but it names
 * one, and audit-model.md §7 redacts at WRITE time rather than at read time so
 * that an unscoped auditor read is safe by construction. The boolean that
 * replaces it is what every screen actually shows.
 */
const redact = (key: string, value: unknown): unknown => {
  if (key !== SETTINGS_KEY || value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [providerId, settings] of Object.entries(value as Record<string, unknown>)) {
    if (settings === null || typeof settings !== 'object') {
      out[providerId] = settings;
      continue;
    }
    const { apiKeyRef, ...rest } = settings as Record<string, unknown>;
    out[providerId] = { ...rest, apiKeyRefConfigured: apiKeyRef !== undefined };
  }
  return out;
};

// ---------------------------------------------------------------------------
// 1. Settings
// ---------------------------------------------------------------------------

export interface SetProviderSettingsArgs extends WriteContext {
  readonly providerId: GenerationProviderId;
  /**
   * The new settings for this provider. An EMPTY object removes the entry and
   * returns the provider to its declared defaults -- the same "clear the
   * override" gesture the limits form has, and deliberately not the same as
   * `enabled: false`, which is an administrator saying "off".
   */
  readonly settings: ProviderSettings;
}

export const setProviderSettings = async (
  args: SetProviderSettingsArgs,
): Promise<{ providerId: GenerationProviderId; settings: ProviderSettings; removed: boolean }> => {
  const parsed = ProviderSettingsSchema.safeParse(args.settings);
  if (!parsed.success) {
    throw new ProviderAdminError(
      'VALIDATION_FAILED',
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
    );
  }
  const settings = parsed.data;
  const removing = Object.values(settings).every((value) => value === undefined);

  // Enabling a provider whose endpoint or model is unknown would produce a
  // BLOCKED_BY_CONFIGURATION the administrator cannot see the cause of, so it
  // is refused here with the field named. The deterministic provider needs
  // neither and is exempt.
  if (settings.enabled === true && args.providerId !== 'DETERMINISTIC_LOCAL') {
    const missing = (['baseUrl', 'modelId', 'apiKeyRef'] as const).filter(
      (field) => settings[field] === undefined,
    );
    if (missing.length > 0) {
      throw new ProviderAdminError(
        'VALIDATION_FAILED',
        `Set ${missing.join(', ')} before enabling this provider. An enabled provider with an incomplete configuration is refused at generation time, where the reason is harder to find.`,
      );
    }
  }

  await writeConfig(
    args,
    SETTINGS_KEY,
    'ADMIN.CONFIGURATION.PROVIDER_UPDATED',
    (previous) => {
      const record = { ...((previous ?? {}) as Record<string, unknown>) };
      if (removing) delete record[args.providerId];
      else record[args.providerId] = settings;
      return record;
    },
    () => ({
      key: SETTINGS_KEY,
      scope: 'PLATFORM',
      valueType: 'object',
      providerId: args.providerId,
      changedFields: Object.entries(settings)
        .filter(([, value]) => value !== undefined)
        .map(([name]) => name),
      enabled: settings.enabled === true,
      // WHETHER a reference is recorded, never which one.
      credentialConfigured: settings.apiKeyRef !== undefined,
    }),
    `${SETTINGS_KEY}.${args.providerId}`,
  );

  return { providerId: args.providerId, settings, removed: removing };
};

// ---------------------------------------------------------------------------
// 2. Approval
// ---------------------------------------------------------------------------

export interface SetProviderApprovalArgs extends WriteContext {
  readonly providerId: GenerationProviderId;
  readonly approved: boolean;
  /**
   * WHERE the approval is recorded: a document, a ticket, a signed decision.
   * REQUIRED when granting.
   *
   * This is the field that keeps the approval a control rather than a
   * checkbox. An approval nobody can trace is one nobody can revoke with
   * confidence, and the person asked in nine months whether Legal cleared a
   * provider needs the reference, not a boolean.
   */
  readonly approvalReference?: string;
  /**
   * The registry's verdict, when the caller has one.
   *
   * Used only to refuse an approval for a provider that is
   * BLOCKED_BY_CAPABILITY. Optional so a caller with no registry to hand can
   * still WITHDRAW an approval, which must never be blocked.
   */
  readonly assessment?: ProviderStateAssessment;
}

export const setProviderApproval = async (
  args: SetProviderApprovalArgs,
): Promise<{ providerId: GenerationProviderId; approvedProviders: readonly string[] }> => {
  const reference = (args.approvalReference ?? '').trim();
  if (args.approved && reference.length < 4) {
    throw new ProviderAdminError(
      'VALIDATION_FAILED',
      'Recording an approval requires a reference to where it is held — a document id, a ticket, or a signed decision. A data-processing approval with no record is not one.',
    );
  }
  // Capability outranks approval -- the registry's own order -- so approving a
  // provider that can never ground a question is refused rather than recorded.
  // It would otherwise create a durable record asserting something untrue, and
  // send somebody to chase a credential for a provider that can never be used.
  if (args.approved && args.assessment?.groundingSafe === false) {
    throw new ProviderAdminError(
      'VALIDATION_FAILED',
      `${args.providerId} performs its own retrieval, so it cannot produce a question grounded in the selected sections. An approval would not change that, so one cannot be recorded.`,
    );
  }

  const next = await writeConfig(
    args,
    APPROVED_KEY,
    'ADMIN.CONFIGURATION.PROVIDER_APPROVAL_CHANGED',
    (previous) => {
      const current = new Set(
        ((previous ?? []) as string[]).filter((id) => typeof id === 'string'),
      );
      if (args.approved) current.add(args.providerId);
      else current.delete(args.providerId);
      // Sorted, so a diff of two configuration snapshots shows a membership
      // change rather than a reordering.
      return [...current].sort();
    },
    () => ({
      key: APPROVED_KEY,
      scope: 'PLATFORM',
      valueType: 'array',
      providerId: args.providerId,
      approved: args.approved,
      approvalReference: args.approved ? reference : null,
    }),
    `${APPROVED_KEY}.${args.providerId}`,
  );

  return { providerId: args.providerId, approvedProviders: next };
};

// ---------------------------------------------------------------------------
// 3. The active provider
// ---------------------------------------------------------------------------

export interface SetActiveProviderArgs extends WriteContext {
  readonly providerId: GenerationProviderId;
  /**
   * The registry's verdict for that provider, resolved by the caller.
   *
   * Passed in rather than computed: the registry lives in
   * `@knowzy/claude-services`, which the domain does not depend on (B4), and
   * the API already holds one per request.
   */
  readonly assessment: ProviderStateAssessment;
}

export const setActiveProvider = async (
  args: SetActiveProviderArgs,
): Promise<{ activeProvider: string }> => {
  // NO SILENT DOWNGRADE, and no silent upgrade either: selecting a provider
  // that cannot run would make every generation fail with a refusal the
  // administrator did not connect to this click. The refusal carries the
  // registry's own reason so the next step is obvious.
  if (args.assessment.state !== 'AVAILABLE') {
    throw new ProviderAdminError(
      args.assessment.registered ? 'PROVIDER_NOT_APPROVED' : 'PROVIDER_NOT_REGISTERED',
      `${args.providerId} is ${args.assessment.state}: ${args.assessment.reason} Generation would be refused for every job, so it cannot be made the active provider.`,
    );
  }

  const next = await writeConfig(
    args,
    ACTIVE_KEY,
    'ADMIN.CONFIGURATION.PROVIDER_ACTIVATED',
    () => args.providerId as string,
    (previous) => ({
      key: ACTIVE_KEY,
      scope: 'PLATFORM',
      valueType: 'string',
      providerId: args.providerId,
      previousProviderId: typeof previous === 'string' ? previous : null,
    }),
    `${ACTIVE_KEY}=${args.providerId}`,
  );

  return { activeProvider: next };
};

// ---------------------------------------------------------------------------
// 4. Validation
// ---------------------------------------------------------------------------

export interface RecordValidationArgs {
  readonly prisma: PrismaClient;
  readonly clock: Clock;
  readonly actor: AdminActor;
  readonly correlationId: string;
  readonly requestId: string;
  readonly providerId: GenerationProviderId;
  readonly state: ProviderState;
  readonly outcome: ProviderValidationOutcome;
  readonly steps: readonly ProviderValidationStep[];
}

/**
 * Records what a readiness check found.
 *
 * It does not DO the check -- `validateProvider` in `@knowzy/claude-services`
 * decides, and it is pure. This writes the result, because "what did it say
 * last time, and has anybody checked since" is a question a mutable column
 * cannot answer.
 */
export const recordProviderValidation = async (
  args: RecordValidationArgs,
): Promise<ProviderValidationReport> => {
  const auditWriter = createAuditWriter({ clock: args.clock });
  const failed = args.steps.filter((step) => step.result === 'FAILED');
  const notAttempted = args.steps.filter((step) => step.result === 'NOT_ATTEMPTED');
  const summary =
    failed.length > 0
      ? `${failed.length} of ${args.steps.length} checks failed: ${failed.map((step) => step.check).join(', ')}.`
      : notAttempted.length > 0
        ? `Every check that could run passed. Not attempted: ${notAttempted.map((step) => step.check).join(', ')}.`
        : 'Every check passed.';

  // OVER_BUDGET is not a persisted state (migration 0011), and the caller
  // should never produce one here -- it is derived per request. Mapped rather
  // than trusted, so a future caller cannot write a value the column forbids.
  const persistedState: ProviderState = args.state === 'OVER_BUDGET' ? 'AVAILABLE' : args.state;

  const row = await args.prisma.$transaction(async (tx: TransactionClient) => {
    const created = await tx.generationProviderValidation.create({
      data: {
        providerId: args.providerId,
        state: persistedState as 'AVAILABLE',
        outcome: args.outcome,
        steps: asJson(args.steps.map((step) => ({ ...step }))),
        summary: summary.slice(0, 500),
        validatedByUserId: args.actor.userId,
        correlationId: args.correlationId,
      },
      select: { id: true, validatedAt: true },
    });

    await auditWriter.write(tx, {
      action: 'ADMIN.CONFIGURATION.PROVIDER_VALIDATED',
      outcome: args.outcome === 'FAILED' ? 'FAILURE' : 'SUCCESS',
      actorType: 'USER',
      actorUserId: args.actor.userId,
      actorDisplayName: args.actor.displayName,
      actorRoles: [...args.actor.roles],
      entityType: 'GenerationProviderValidation',
      entityId: created.id,
      entityLabel: args.providerId,
      correlationId: args.correlationId,
      requestId: args.requestId,
      portal: 'AUTHORING',
      detail: {
        providerId: args.providerId,
        validationOutcome: args.outcome,
        providerState: persistedState,
        failedChecks: failed.map((step) => step.check),
        notAttemptedChecks: notAttempted.map((step) => step.check),
      },
    });

    return created;
  });

  return {
    providerId: args.providerId,
    outcome: args.outcome,
    state: args.state,
    steps: args.steps,
    validatedAt: row.validatedAt.toISOString(),
    validatedByDisplayName: args.actor.displayName,
  };
};

// ---------------------------------------------------------------------------
// The read model
// ---------------------------------------------------------------------------

export interface ReadProviderAdministrationArgs {
  readonly prisma: PrismaClient;
  readonly clock: Clock;
  /** Every DECLARED provider with its state, from the registry. */
  readonly assessments: readonly ProviderStateAssessment[];
  readonly activeProvider: string;
  readonly settings: Readonly<Record<string, unknown>>;
  /** When `llm.providerSettings` was last written, or null if never. */
  readonly settingsUpdatedAt: string | null;
  readonly limits: Readonly<Record<string, unknown>>;
  readonly defaults: ProviderAdministration['defaults'];
  readonly health: Readonly<Record<string, { state: ProviderHealthState; reason: string }>>;
  readonly canManage: boolean;
}

export const readProviderAdministration = async (
  args: ReadProviderAdministrationArgs,
): Promise<ProviderAdministration> => {
  // The LATEST validation per provider, and its author's name. Two queries
  // rather than one per provider: six round trips to render a six-row table is
  // the shape that turns into sixty when a provider is added.
  const validations = await args.prisma.generationProviderValidation.findMany({
    where: { providerId: { in: args.assessments.map((a) => a.providerId as 'OPENAI') } },
    orderBy: { validatedAt: 'desc' },
    select: {
      providerId: true,
      state: true,
      outcome: true,
      steps: true,
      validatedAt: true,
      validatedByUserId: true,
    },
  });
  const latest = new Map<string, (typeof validations)[number]>();
  for (const row of validations) if (!latest.has(row.providerId)) latest.set(row.providerId, row);

  const validatorIds = [
    ...new Set([...latest.values()].map((row) => row.validatedByUserId)),
  ].filter((id): id is string => id !== null);
  const validators =
    validatorIds.length === 0
      ? []
      : await args.prisma.user.findMany({
          where: { id: { in: validatorIds } },
          select: { id: true, displayName: true },
        });
  const nameOf = new Map(validators.map((user) => [user.id, user.displayName]));

  const providers: ProviderAdminRow[] = args.assessments.map((assessment) => {
    const settings = (args.settings[assessment.providerId] ?? {}) as ProviderSettings;
    const limits = (args.limits[assessment.providerId] ?? {}) as ProviderLimits;
    const validation = latest.get(assessment.providerId);
    const health = args.health[assessment.providerId];

    return {
      providerId: assessment.providerId,
      displayName: settings.displayName ?? assessment.providerId,
      state: assessment.state,
      stateReason: assessment.reason,
      // The deterministic provider is always on: it is the floor, and there is
      // no configuration in which the platform has no generator at all.
      enabled: assessment.providerId === 'DETERMINISTIC_LOCAL' ? true : settings.enabled === true,
      registered: assessment.registered,
      approved: assessment.approved,
      groundingSafe: assessment.groundingSafe,
      supportedExecutionModes: assessment.supportedExecutionModes,
      providerVersion: assessment.providerVersion,
      // WHETHER, never which. The reference itself never leaves this module.
      credentialConfigured: settings.apiKeyRef !== undefined,
      // The CONFIGURATION ROW's timestamp, which covers the whole
      // `llm.providerSettings` value -- so it answers "when was any provider's
      // configuration last changed", never "when was this credential rotated".
      // The screen labels it that way. A per-credential timestamp would need a
      // column nothing writes, and deriving one from this would be a fabricated
      // fact about a secret.
      settingsUpdatedAt: args.settingsUpdatedAt,
      baseUrl: settings.baseUrl ?? null,
      modelId: settings.modelId ?? null,
      temperature: settings.temperature ?? null,
      maxOutputTokens: settings.maxOutputTokens ?? null,
      limits,
      health: health?.state ?? 'UNKNOWN',
      healthReason: health?.reason ?? 'No calls have been recorded for this provider.',
      lastValidation:
        validation === undefined
          ? null
          : {
              providerId: validation.providerId,
              outcome: validation.outcome,
              state: validation.state,
              steps: validation.steps as unknown as readonly ProviderValidationStep[],
              validatedAt: validation.validatedAt.toISOString(),
              validatedByDisplayName:
                validation.validatedByUserId === null
                  ? null
                  : (nameOf.get(validation.validatedByUserId) ?? null),
            },
    };
  });

  return {
    asOf: args.clock.now().toISOString(),
    activeProvider: args.activeProvider,
    providers,
    defaults: args.defaults,
    canManage: args.canManage,
  };
};
