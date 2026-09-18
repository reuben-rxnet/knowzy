// Generation governance tools — mcp-tools.md §9.
//
// `preflight_generation` is here rather than in the API because §9 puts it
// here, and because precondition 10 of workflows.md §2.1 makes the preflight
// unavoidable: job creation without a recorded preflight decision is refused.
//
// The tool RUNS the checks and persists the result with `chosenAction` null.
// §4.2: "The preflight has no 'proceed anyway' default; the author must
// choose." Recording the decision is a separate call, so the choice is a human
// act with its own audit event.

import { z } from 'zod';
import { createAuditWriter } from '@knowzy/database';
import { PREFLIGHT_TTL_MS, runPreflight } from '@knowzy/domain';
import { registerTool } from './registry.js';
import { loadSource, SourceNotFoundError } from './adapter-context.js';
import type { AuthorizationEnvelope } from './envelope.js';

const actor = (envelope: AuthorizationEnvelope) => ({
  actorType: envelope.portal === 'SYSTEM' ? ('SYSTEM' as const) : ('USER' as const),
  actorUserId: envelope.subject.userId,
  actorDisplayName: envelope.subject.displayName,
  actorRoles: envelope.effectiveRoles,
  correlationId: envelope.correlationId,
  requestId: envelope.requestId,
  portal: envelope.portal,
});

registerTool({
  name: 'preflight_generation',
  family: 'generation-governance',
  permission: 'question.generate',
  portals: ['AUTHORING'],
  auditAction: 'AUTHORING.GENERATION.PREFLIGHT_RUN',
  timeoutMs: 30_000,
  writes: 'LOCAL',
  description: 'Runs the six mandatory pre-generation checks and persists the result.',
  input: z
    .object({
      sourceId: z.string().uuid(),
      // 1-10, and non-empty: §1.1 rejects an empty list with
      // GENERATION_SELECTION_REQUIRED, and the schema is where that is cheapest
      // to enforce.
      documentIds: z.array(z.string().uuid()).min(1).max(10),
      objectiveIds: z.array(z.string().uuid()).default([]),
      targetAssessmentId: z.string().uuid().optional(),
    })
    .strict(),
  async handler({ envelope, input, deps }) {
    const source = await loadSource(deps, envelope, input.sourceId);
    if (!source.row.usableForGeneration) {
      throw new Error(
        `Source "${source.row.name}" is not marked usable for generation (SOURCE_NOT_GENERATION_ENABLED).`,
      );
    }

    const profile = await deps.prisma.generationProfile.findFirst({
      where: { name: 'Default' },
      select: { id: true, coverageSettings: true, promptVersionId: true },
    });
    if (!profile) {
      throw new Error('No generation profile is available (PROFILE_NOT_AVAILABLE).');
    }
    const coverage = profile.coverageSettings as { charsPerQuestion?: number };

    const result = await runPreflight({
      client: deps.prisma,
      sourceId: input.sourceId,
      documentIds: input.documentIds,
      ...(input.targetAssessmentId === undefined
        ? {}
        : { targetAssessmentId: input.targetAssessmentId }),
      charsPerQuestion: coverage.charsPerQuestion ?? 1_200,
    });

    const now = deps.clock.now();
    const auditWriter = createAuditWriter({ clock: deps.clock });

    const preflight = await deps.prisma.$transaction(async (tx) => {
      const created = await tx.generationPreflight.create({
        data: {
          sourceId: input.sourceId,
          documentIds: [...input.documentIds],
          objectiveIds: [...input.objectiveIds],
          targetAssessmentId: input.targetAssessmentId ?? null,
          // Round-tripped through JSON so the stored shape is exactly what a
          // reader gets back. The check results are evidence for an auditable
          // decision, so they are persisted whole rather than summarized.
          checkResults: JSON.parse(
            JSON.stringify({
              documents: result.documents,
              check5: result.check5,
              check6: result.check6,
              recommendationReason: result.recommendationReason,
            }),
          ) as object,
          recommendation: result.recommendation,
          // Null until a human chooses. This is the field job creation reads.
          chosenAction: null,
          expiresAt: new Date(now.getTime() + PREFLIGHT_TTL_MS),
          correlationId: envelope.correlationId,
          createdByUserId: envelope.subject.userId,
        },
        select: { id: true, expiresAt: true },
      });

      await auditWriter.write(tx, {
        ...actor(envelope),
        action: 'AUTHORING.GENERATION.PREFLIGHT_RUN',
        outcome: 'SUCCESS',
        entityType: 'GenerationPreflight',
        entityId: created.id,
        entityLabel: created.id,
        sourceId: input.sourceId,
        detail: {
          documentCount: input.documentIds.length,
          recommendation: result.recommendation,
        },
      });

      return created;
    });

    return {
      preflightId: preflight.id,
      expiresAt: preflight.expiresAt,
      recommendation: result.recommendation,
      recommendationReason: result.recommendationReason,
      offeredActions: result.offeredActions,
      documents: result.documents,
      check5: result.check5,
      check6: result.check6,
      // Stated so a caller cannot mistake a recommendation for authorization.
      decisionRequired:
        'A preflight authorizes nothing until an action is recorded against it.',
    };
  },
});

registerTool({
  name: 'record_preflight_decision',
  family: 'generation-governance',
  permission: 'question.generate',
  portals: ['AUTHORING'],
  auditAction: 'AUTHORING.GENERATION.PREFLIGHT_VIEW',
  timeoutMs: 10_000,
  writes: 'LOCAL',
  description: 'Records the author’s chosen action against a preflight result.',
  input: z
    .object({
      preflightId: z.string().uuid(),
      chosenAction: z.enum([
        'VIEW_EXISTING',
        'REUSE_EXISTING',
        'GENERATE_ADDITIONAL',
        'REGENERATE',
        'GENERATE_NEW',
      ]),
    })
    .strict(),
  async handler({ envelope, input, deps }) {
    const preflight = await deps.prisma.generationPreflight.findUnique({
      where: { id: input.preflightId },
      select: { id: true, sourceId: true, chosenAction: true, expiresAt: true },
    });
    if (!preflight) throw new SourceNotFoundError(input.preflightId);

    if (preflight.expiresAt.getTime() <= deps.clock.now().getTime()) {
      // An expired preflight cannot authorize a job: the coverage, approved
      // counts, and content hash it recorded may all have moved.
      throw new Error(
        'This preflight has expired. Run it again so the decision rests on current state.',
      );
    }
    if (preflight.chosenAction !== null) {
      // Immutable once decided, so a recorded decision cannot be quietly
      // swapped for a more permissive one after the fact.
      throw new Error(
        `This preflight already records the decision ${preflight.chosenAction}. Run a new preflight to choose differently.`,
      );
    }

    const auditWriter = createAuditWriter({ clock: deps.clock });
    const updated = await deps.prisma.$transaction(async (tx) => {
      const row = await tx.generationPreflight.update({
        where: { id: input.preflightId },
        data: {
          chosenAction: input.chosenAction,
          chosenAt: deps.clock.now(),
          chosenByUserId: envelope.subject.userId,
        },
        select: { id: true, chosenAction: true, chosenAt: true },
      });

      await auditWriter.write(tx, {
        ...actor(envelope),
        action: 'AUTHORING.GENERATION.PREFLIGHT_VIEW',
        outcome: 'SUCCESS',
        entityType: 'GenerationPreflight',
        entityId: row.id,
        entityLabel: row.id,
        sourceId: preflight.sourceId,
        detail: { chosenAction: input.chosenAction },
      });

      return row;
    });

    return {
      preflightId: updated.id,
      chosenAction: updated.chosenAction,
      chosenAt: updated.chosenAt,
    };
  },
});
