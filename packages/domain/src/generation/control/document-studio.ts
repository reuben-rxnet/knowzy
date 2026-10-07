// AI Document Studio, Slice 2 -- the DOCUMENT_RESTRUCTURE approval and the
// Studio's status (docs/competencies/AI_DOCUMENT_STUDIO_ARCHITECTURE.md §10).
//
// What this module does NOT do, and cannot: transform a document. There is no
// restructuring client anywhere in the build (RESTRUCTURING_CLIENTS is empty),
// so recording an approval moves the state from BLOCKED_BY_APPROVAL to
// NOT_BUILT and no further.
//
// Two rules a change here is most likely to break:
//
//   * THE PURPOSES ARE SEPARATE. This module reads and writes ONLY
//     `llm.purposeApprovals`. It never reads `llm.approvedProviders` (question
//     generation's approvals), so a generation approval cannot satisfy
//     restructuring -- and the generation path never reads this key, so the
//     reverse cannot happen either. A contract test checks both.
//
//   * EVERY ACT IS RECORDED: the configuration row, its configuration_change
//     row and the audit event in ONE transaction, the approver and time taken
//     from the request and the clock, never from the form.

import { createAuditWriter, type PrismaClient, type TransactionClient } from '@knowzy/database';
import type { Clock } from '@knowzy/observability';
import { evaluateRestructureReadiness, restructureCapability } from '@knowzy/claude-services';
import {
  PurposeApprovalsSchema,
  ProviderSettingsSchema,
  type DocumentStudioStatus,
  type GenerationProviderId,
  type PurposeApproval,
  type PurposeApprovals,
} from '@knowzy/shared-types';
import type { AdminActor } from './provider-administration.js';

const PURPOSE_KEY = 'llm.purposeApprovals';
const SETTINGS_KEY = 'llm.providerSettings';
const REFERENCE_MIN = 4;

export class DocumentStudioError extends Error {
  override readonly name = 'DocumentStudioError';
  constructor(
    readonly code: 'VALIDATION_FAILED',
    detail: string,
  ) {
    super(detail);
  }
}

export interface DocumentStudioContext {
  readonly prisma: PrismaClient;
  readonly clock: Clock;
  readonly actor: AdminActor;
  readonly correlationId: string;
  readonly requestId: string;
}

const asJson = (value: unknown): never => value as never;

const parseApprovals = (value: unknown): PurposeApprovals => {
  const parsed = PurposeApprovalsSchema.safeParse(value ?? {});
  // A malformed row reads as NO approvals -- never as an approval somebody did
  // not record.
  return parsed.success ? parsed.data : {};
};

const restructureApprovals = (
  approvals: PurposeApprovals,
): Partial<Record<GenerationProviderId, PurposeApproval>> =>
  (approvals.DOCUMENT_RESTRUCTURE ?? {}) as Partial<Record<GenerationProviderId, PurposeApproval>>;

/** Check 5: enabled, with an endpoint, a model and a credential reference. */
const configuredFrom =
  (settingsValue: unknown) =>
  (providerId: GenerationProviderId): boolean => {
    const all = (settingsValue ?? {}) as Record<string, unknown>;
    const parsed = ProviderSettingsSchema.safeParse(all[providerId] ?? {});
    if (!parsed.success) return false;
    const settings = parsed.data;
    return (
      settings.enabled === true &&
      settings.baseUrl !== undefined &&
      settings.modelId !== undefined &&
      settings.apiKeyRef !== undefined
    );
  };

const auditFields = (ctx: DocumentStudioContext) => ({
  outcome: 'SUCCESS' as const,
  actorType: 'USER' as const,
  actorUserId: ctx.actor.userId,
  actorDisplayName: ctx.actor.displayName,
  actorRoles: [...ctx.actor.roles],
  entityType: 'ApplicationConfiguration',
  entityId: PURPOSE_KEY,
  correlationId: ctx.correlationId,
  requestId: ctx.requestId,
  portal: 'AUTHORING' as const,
});

/**
 * The Studio's real state, computed from the catalogue, the (empty)
 * restructuring-client registry and configuration -- and the evaluation is
 * audited (PURPOSE_STATUS_EVALUATED), as a preflight view is.
 */
export const readDocumentStudioStatus = async (
  ctx: DocumentStudioContext,
): Promise<DocumentStudioStatus> => {
  const rows = await ctx.prisma.applicationConfiguration.findMany({
    where: { key: { in: [PURPOSE_KEY, SETTINGS_KEY] }, scope: 'PLATFORM', scopeId: null },
    select: { key: true, value: true },
  });
  const status = evaluateRestructureReadiness({
    approvals: restructureApprovals(
      parseApprovals(rows.find((row) => row.key === PURPOSE_KEY)?.value),
    ),
    configured: configuredFrom(rows.find((row) => row.key === SETTINGS_KEY)?.value),
    evaluatedAt: ctx.clock.now().toISOString(),
  });

  const auditWriter = createAuditWriter({ clock: ctx.clock });
  await ctx.prisma.$transaction(async (tx: TransactionClient) => {
    await auditWriter.write(tx, {
      ...auditFields(ctx),
      action: 'ADMIN.CONFIGURATION.PURPOSE_STATUS_EVALUATED',
      entityLabel: 'DOCUMENT_RESTRUCTURE status',
      detail: {
        purpose: status.purpose,
        state: status.state,
        providerStates: Object.fromEntries(
          status.providers.map((row) => [row.providerId, row.state ?? 'INELIGIBLE']),
        ),
        transformationImplemented: status.transformationImplemented,
      },
    });
  });
  return status;
};

export interface SetPurposeApprovalArgs extends DocumentStudioContext {
  readonly providerId: GenerationProviderId;
  /** True records or replaces; false removes. */
  readonly approved: boolean;
  readonly approvalReference?: string;
}

export type PurposeApprovalAct = 'RECORDED' | 'REPLACED' | 'REMOVED' | 'UNCHANGED';

/**
 * Record, replace or remove the DOCUMENT_RESTRUCTURE approval for one
 * provider. Self-approval is permitted (Authoring Role Simplification); the
 * approver is whoever makes the request, recorded as such.
 */
export const setPurposeApproval = async (
  args: SetPurposeApprovalArgs,
): Promise<{ readonly act: PurposeApprovalAct; readonly approval: PurposeApproval | null }> => {
  const reference = (args.approvalReference ?? '').trim();
  if (args.approved) {
    if (reference.length < REFERENCE_MIN) {
      throw new DocumentStudioError(
        'VALIDATION_FAILED',
        'Recording an approval requires a reference to where it is held — a document id, a ticket, or a signed decision.',
      );
    }
    // Capability outranks approval, as for generation: a record clearing a
    // provider for something it can never do would be untrue.
    const capability = restructureCapability(args.providerId);
    if (!capability.capable) {
      throw new DocumentStudioError(
        'VALIDATION_FAILED',
        `${args.providerId} cannot restructure a document, so an approval cannot be recorded for it. ${capability.reason}`,
      );
    }
  }

  const auditWriter = createAuditWriter({ clock: args.clock });
  return args.prisma.$transaction(async (tx: TransactionClient) => {
    const existing = await tx.applicationConfiguration.findFirst({
      where: { key: PURPOSE_KEY, scope: 'PLATFORM', scopeId: null },
      select: { id: true, value: true },
    });
    const previousAll = parseApprovals(existing?.value);
    const previousMap = restructureApprovals(previousAll);
    const previous = previousMap[args.providerId] ?? null;

    let act: PurposeApprovalAct;
    let approval: PurposeApproval | null;
    const nextMap = { ...previousMap };
    if (args.approved) {
      approval = {
        reference,
        approvedByUserId: args.actor.userId,
        approvedByDisplayName: args.actor.displayName,
        approvedAt: args.clock.now().toISOString(),
      };
      nextMap[args.providerId] = approval;
      act = previous === null ? 'RECORDED' : 'REPLACED';
    } else {
      approval = null;
      if (previous === null) return { act: 'UNCHANGED' as const, approval: null };
      delete nextMap[args.providerId];
      act = 'REMOVED';
    }
    const next: PurposeApprovals = { ...previousAll, DOCUMENT_RESTRUCTURE: nextMap };

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
          key: PURPOSE_KEY,
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
        key: PURPOSE_KEY,
        scope: 'PLATFORM',
        scopeId: null,
        previousValue: asJson(previousAll),
        newValue: asJson(next),
        changedByUserId: args.actor.userId,
        correlationId: args.correlationId,
      },
    });
    await auditWriter.write(tx, {
      ...auditFields(args),
      action: `ADMIN.CONFIGURATION.PURPOSE_APPROVAL_${act}` as const,
      entityLabel: `${PURPOSE_KEY}.DOCUMENT_RESTRUCTURE.${args.providerId}`,
      previousValue: previous === null ? null : { ...previous },
      newValue: approval === null ? null : { ...approval },
      detail: {
        purpose: 'DOCUMENT_RESTRUCTURE',
        providerId: args.providerId,
        ...(approval === null ? {} : { approvalReference: approval.reference }),
        ...(previous === null ? {} : { previousApprovalReference: previous.reference }),
      },
    });
    return { act, approval };
  });
};
