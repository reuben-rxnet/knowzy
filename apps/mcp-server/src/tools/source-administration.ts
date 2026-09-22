// Source administration tools — mcp-tools.md §5.
//
// `list_knowledge_sources` · `get_knowledge_source` · `test_knowledge_source` ·
// `synchronize_knowledge_source` · `get_synchronization_history`
//
// T2: no tool here accepts a site URL, site ID, drive ID, or list ID. A caller
// names a source by its Knowzy id; every location comes from the configured
// KnowledgeSourcePath rows.

import { z } from 'zod';
import { createAuditWriter, transactWithAudit, type TransactionClient } from '@knowzy/database';
import type { SyncEvent } from '@knowzy/knowledge-source-adapters';
import { registerTool } from './registry.js';
import {
  assertSourcePermitted,
  attributePath,
  buildAdapterContext,
  loadSource,
} from './adapter-context.js';
import type { AuthorizationEnvelope } from './envelope.js';
import type { ToolDeps } from './deps.js';

const SourceIdInput = z.object({ sourceId: z.string().uuid() }).strict();

/** The actor fields every audit event in this family shares. */
const actor = (envelope: AuthorizationEnvelope) => ({
  actorType: envelope.portal === 'SYSTEM' ? ('SYSTEM' as const) : ('USER' as const),
  actorUserId: envelope.subject.userId,
  actorDisplayName: envelope.subject.displayName,
  actorRoles: envelope.effectiveRoles,
  correlationId: envelope.correlationId,
  requestId: envelope.requestId,
  portal: envelope.portal,
});

// ---------------------------------------------------------------------------

export const listKnowledgeSources = registerTool({
  name: 'list_knowledge_sources',
  family: 'source-administration',
  permission: 'source.read',
  portals: ['AUTHORING', 'SYSTEM'],
  auditAction: null,
  auditExemptionReason:
    'audit-model.md §8: individual list queries are deliberately not audited; volume would dwarf the meaningful signal.',
  timeoutMs: 10_000,
  writes: 'NONE',
  description: 'Lists the knowledge sources visible to the caller.',
  input: z.object({ includeInactive: z.boolean().default(false) }).strict(),
  async handler({ envelope, input, deps }) {
    const scope = envelope.dataScope;
    const sources = await deps.prisma.knowledgeSource.findMany({
      where: {
        archivedAt: null,
        ...(input.includeInactive ? {} : { isActive: true }),
        // DENY first and absolute; an empty allow list means unrestricted.
        ...(scope.denySourceIds.length > 0 ? { id: { notIn: scope.denySourceIds } } : {}),
        ...(scope.sourceIds.length > 0 ? { id: { in: scope.sourceIds } } : {}),
      },
      orderBy: { name: 'asc' },
      include: { _count: { select: { documents: true, paths: true } } },
    });

    return {
      sources: sources.map((source) => ({
        sourceId: source.id,
        name: source.name,
        description: source.description,
        sourceType: source.sourceType,
        isActive: source.isActive,
        usableForGeneration: source.usableForGeneration,
        permissionMode: source.permissionMode,
        // Always reported together: a status with no timestamp invites the
        // reader to assume it is current (§5.4 rule 1).
        connectionStatus: source.connectionStatus,
        connectionStatusAt: source.connectionStatusAt,
        pathCount: source._count.paths,
        documentCount: source._count.documents,
      })),
    };
  },
});

export const getKnowledgeSource = registerTool({
  name: 'get_knowledge_source',
  family: 'source-administration',
  permission: 'source.read',
  portals: ['AUTHORING', 'SYSTEM'],
  auditAction: null,
  auditExemptionReason: 'audit-model.md §8: an individual read request is not audited.',
  timeoutMs: 10_000,
  writes: 'NONE',
  description: 'Returns one knowledge source with its configured paths.',
  input: SourceIdInput,
  async handler({ envelope, input, deps }) {
    const { row, paths } = await loadSource(deps, envelope, input.sourceId);
    const adapter = deps.adapterFor(row);

    return {
      sourceId: row.id,
      name: row.name,
      sourceType: row.sourceType,
      isActive: row.isActive,
      usableForGeneration: row.usableForGeneration,
      permissionMode: row.permissionMode,
      // Declared, not assumed: the UI adapts to what this source can do.
      capabilities: adapter.capabilities,
      paths: paths.map((path) => ({
        containerId: path.containerId,
        folderPath: path.folderPath ?? '',
        recursive: path.recursive,
        includeFileTypes: path.includeFileTypes ?? [],
      })),
    };
  },
});

export const testKnowledgeSource = registerTool({
  name: 'test_knowledge_source',
  family: 'source-administration',
  permission: 'source.test',
  portals: ['AUTHORING', 'SYSTEM'],
  auditAction: 'ADMIN.SOURCE.CONNECTION_TESTED',
  timeoutMs: 30_000,
  writes: 'LOCAL',
  description: 'Runs the adapter connection probe and records the result.',
  input: SourceIdInput,
  async handler({ envelope, input, deps, signal }) {
    const source = await loadSource(deps, envelope, input.sourceId);
    const adapter = deps.adapterFor(source.row);
    const context = buildAdapterContext({ deps, envelope, source, signal });

    const result = await adapter.testConnection(context);
    const auditWriter = createAuditWriter({ clock: deps.clock });

    // §5.4 rule 1: only an EXECUTED probe may set connectionStatus. The write
    // and its audit event share one transaction (U1), so a recorded status can
    // never exist without the event that explains where it came from.
    await transactWithAudit({
      prisma: deps.prisma,
      auditWriter,
      action: 'ADMIN.SOURCE.CONNECTION_TESTED',
      work: async (tx: TransactionClient) =>
        tx.knowledgeSource.update({
          where: { id: source.row.id },
          data: {
            connectionStatus: result.ok ? 'HEALTHY' : 'FAILED',
            connectionStatusAt: deps.clock.now(),
          },
        }),
      audit: () => ({
        ...actor(envelope),
        action: 'ADMIN.SOURCE.CONNECTION_TESTED',
        outcome: result.ok ? 'SUCCESS' : 'FAILURE',
        entityType: 'KnowledgeSource',
        entityId: source.row.id,
        entityLabel: source.row.name,
        sourceId: source.row.id,
        detail: {
          ok: result.ok,
          durationMs: result.durationMs,
          // Check names and outcomes only. A raw provider body could carry a
          // token or a tenant identifier, and this row is kept for years.
          checks: result.checks.map((check) => ({ name: check.name, outcome: check.outcome })),
        },
      }),
    });

    return result;
  },
});

export const getSynchronizationHistory = registerTool({
  name: 'get_synchronization_history',
  family: 'source-administration',
  permission: 'source.read',
  portals: ['AUTHORING', 'SYSTEM'],
  auditAction: null,
  auditExemptionReason: 'audit-model.md §8: an individual read request is not audited.',
  timeoutMs: 10_000,
  writes: 'NONE',
  description: 'Returns recent synchronization runs for a source.',
  input: SourceIdInput.extend({ limit: z.number().int().min(1).max(50).default(10) }).strict(),
  async handler({ envelope, input, deps }) {
    assertSourcePermitted(envelope, input.sourceId);
    const runs = await deps.prisma.knowledgeSourceSync.findMany({
      where: { sourceId: input.sourceId },
      orderBy: { startedAt: 'desc' },
      take: input.limit,
    });

    return {
      runs: runs.map((run) => ({
        syncId: run.id,
        mode: run.mode,
        trigger: run.trigger,
        outcome: run.outcome,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        durationMs: run.durationMs,
        itemsScanned: run.itemsScanned,
        itemsAdded: run.itemsAdded,
        itemsModified: run.itemsModified,
        // Reported so the counts reconcile: without `unchanged`, scanned minus
        // the rest looks like documents silently went missing.
        itemsUnchanged: run.itemsUnchanged,
        itemsDeleted: run.itemsDeleted,
        itemsFailed: run.itemsFailed,
        extractedCharCount: run.extractedCharCount,
      })),
    };
  },
});

// ---------------------------------------------------------------------------

interface SyncTotals {
  scanned: number;
  added: number;
  modified: number;
  unchanged: number;
  deleted: number;
  failed: number;
  extractedChars: number;
}

export const synchronizeKnowledgeSource = registerTool({
  name: 'synchronize_knowledge_source',
  family: 'source-administration',
  permission: 'source.sync',
  // E6: SYSTEM is the only portal permitted to call this on a schedule, and it
  // is declared here rather than checked by the scheduler.
  portals: ['AUTHORING', 'SYSTEM'],
  auditAction: 'ADMIN.SOURCE.SYNC_COMPLETED',
  timeoutMs: 300_000,
  writes: 'LOCAL',
  description: 'Discovers, extracts, and persists documents for a source.',
  input: SourceIdInput.extend({
    mode: z.enum(['FULL', 'INCREMENTAL']).default('FULL'),
  }).strict(),
  async handler({ envelope, input, deps, signal }) {
    const source = await loadSource(deps, envelope, input.sourceId);
    if (source.paths.length === 0) {
      throw new Error(
        `Source "${source.row.name}" has no active configured paths, so a sync would scan nothing.`,
      );
    }

    const adapter = deps.adapterFor(source.row);
    const context = buildAdapterContext({ deps, envelope, source, signal });
    const startedAt = deps.clock.now();

    const run = await deps.prisma.knowledgeSourceSync.create({
      data: {
        sourceId: source.row.id,
        pathIds: [...source.pathIdByKey.values()],
        mode: input.mode,
        trigger: envelope.portal === 'SYSTEM' ? 'SCHEDULE' : 'MANUAL',
        actorUserId: envelope.portal === 'SYSTEM' ? null : envelope.subject.userId,
        startedAt,
        outcome: 'RUNNING',
        correlationId: envelope.correlationId,
      },
    });

    const totals: SyncTotals = {
      scanned: 0,
      added: 0,
      modified: 0,
      unchanged: 0,
      deleted: 0,
      failed: 0,
      extractedChars: 0,
    };
    const failures: { sourceDocumentId: string; reason: string; retryable: boolean }[] = [];

    try {
      for await (const event of adapter.synchronize(context, { mode: input.mode })) {
        try {
          await applySyncEvent({ event, deps, source, adapter, context, totals, failures });
        } catch (error) {
          // FAILURE ISOLATION: one document that cannot be read or persisted
          // must leave the rest of the run synchronized with a per-item
          // outcome. Letting this propagate would mean a single denied or
          // corrupt document discards an entire successful sync — which is how
          // a platform ends up with no coverage and no explanation.
          totals.failed += 1;
          failures.push({
            sourceDocumentId: itemIdOf(event),
            reason: error instanceof Error ? error.message : 'The document could not be processed.',
            retryable: false,
          });
        }
      }
    } catch (error) {
      await deps.prisma.knowledgeSourceSync.update({
        where: { id: run.id },
        data: {
          outcome: 'FAILED',
          completedAt: deps.clock.now(),
          durationMs: deps.clock.now().getTime() - startedAt.getTime(),
          errorSummary: [
            {
              code: 'SYNC_FAILED',
              // A safe message only: this column is read by administrators and
              // kept with the run.
              message: error instanceof Error ? error.message : 'The synchronization failed.',
            },
          ],
        },
      });
      throw error;
    }

    const completedAt = deps.clock.now();
    const outcome = totals.failed > 0 ? 'PARTIAL' : 'SUCCEEDED';
    const auditWriter = createAuditWriter({ clock: deps.clock });

    await transactWithAudit({
      prisma: deps.prisma,
      auditWriter,
      action: 'ADMIN.SOURCE.SYNC_COMPLETED',
      work: async (tx: TransactionClient) => {
        for (const failure of failures) {
          await tx.syncDocumentFailure.create({
            data: {
              syncId: run.id,
              sourceDocumentId: failure.sourceDocumentId,
              phase: 'EXTRACTION',
              errorCode: 'EXTRACTION_FAILED',
              safeMessage: failure.reason,
              state: failure.retryable ? 'PENDING_RETRY' : 'QUARANTINED',
            },
          });
        }
        return tx.knowledgeSourceSync.update({
          where: { id: run.id },
          data: {
            outcome,
            completedAt,
            durationMs: completedAt.getTime() - startedAt.getTime(),
            itemsScanned: totals.scanned,
            itemsAdded: totals.added,
            itemsModified: totals.modified,
            itemsUnchanged: totals.unchanged,
            itemsDeleted: totals.deleted,
            itemsFailed: totals.failed,
            extractedCharCount: totals.extractedChars,
          },
        });
      },
      audit: () => ({
        ...actor(envelope),
        action: 'ADMIN.SOURCE.SYNC_COMPLETED',
        outcome: totals.failed > 0 ? 'FAILURE' : 'SUCCESS',
        entityType: 'KnowledgeSourceSync',
        entityId: run.id,
        entityLabel: `${source.row.name} (${input.mode})`,
        sourceId: source.row.id,
        detail: { mode: input.mode, ...totals },
      }),
    });

    return {
      syncId: run.id,
      outcome,
      mode: input.mode,
      startedAt,
      completedAt,
      ...totals,
      failures,
    };
  },
});

// ---------------------------------------------------------------------------

/** The document an event concerns, for failure reporting. */
const itemIdOf = (event: SyncEvent): string => {
  if (event.type === 'ITEM_DISCOVERED' || event.type === 'ITEM_MODIFIED') {
    return event.item.sourceDocumentId;
  }
  if (event.type === 'ITEM_DELETED' || event.type === 'ITEM_FAILED') {
    return event.sourceDocumentId;
  }
  return 'unknown';
};

interface ApplyArgs {
  readonly event: SyncEvent;
  readonly deps: ToolDeps;
  readonly source: Awaited<ReturnType<typeof loadSource>>;
  readonly adapter: ReturnType<ToolDeps['adapterFor']>;
  readonly context: ReturnType<typeof buildAdapterContext>;
  readonly totals: SyncTotals;
  readonly failures: { sourceDocumentId: string; reason: string; retryable: boolean }[];
}

/**
 * Persists one sync event.
 *
 * Failure isolation is the reason each document is handled on its own rather
 * than in one transaction for the run: one unreadable document must leave the
 * others synchronized, with a per-item outcome recorded.
 */
const applySyncEvent = async (args: ApplyArgs): Promise<void> => {
  const { event, deps, source, adapter, context, totals, failures } = args;

  if (event.type === 'ITEM_FAILED') {
    totals.scanned += 1;
    totals.failed += 1;
    failures.push({
      sourceDocumentId: event.sourceDocumentId,
      reason: event.reason,
      retryable: event.retryable,
    });
    return;
  }

  if (event.type === 'ITEM_DELETED') {
    const updated = await deps.prisma.knowledgeDocument.updateMany({
      where: { sourceId: source.row.id, sourceDocumentId: event.sourceDocumentId },
      // ADR-013: the platform never auto-modifies dependent questions on a
      // source change. Marking the document is the whole action; what happens
      // to its questions is a human decision.
      data: { status: 'DELETED', lastSynchronizedAt: deps.clock.now() },
    });
    totals.deleted += updated.count;
    return;
  }

  if (event.type !== 'ITEM_DISCOVERED' && event.type !== 'ITEM_MODIFIED') return;

  totals.scanned += 1;
  const item = event.item;
  const pathId = attributePath(source, item.containerSiteName ?? '', item.folderPath);
  if (pathId === undefined) {
    // Discovered outside every configured path. Recording it would attach a
    // document to a path that does not exist, so it is a failure, not a skip.
    totals.failed += 1;
    failures.push({
      sourceDocumentId: item.sourceDocumentId,
      reason: 'The document falls outside every configured path for this source.',
      retryable: false,
    });
    return;
  }

  const existing = await deps.prisma.knowledgeDocument.findUnique({
    where: {
      sourceId_sourceDocumentId: {
        sourceId: source.row.id,
        sourceDocumentId: item.sourceDocumentId,
      },
    },
    select: { id: true, contentHash: true, localVersionCounter: true, sourceVersion: true },
  });

  const extracted = await adapter.extractContent(context, item.sourceDocumentId, {});

  if (extracted.status !== 'EXTRACTED') {
    // X5 carried into persistence: no text is stored, and the reason is, so an
    // administrator can see WHY a document contributes no coverage.
    await upsertDocument({
      deps,
      sourceId: source.row.id,
      pathId,
      item,
      extracted,
      existingId: existing?.id,
      versionCounter: existing?.localVersionCounter ?? 1,
    });
    totals.failed += 1;
    failures.push({
      sourceDocumentId: item.sourceDocumentId,
      reason: extracted.reason ?? `Extraction returned ${extracted.status}.`,
      retryable: extracted.status === 'FAILED',
    });
    return;
  }

  // The dual change test: an unchanged hash means unchanged content even if the
  // version label moved, which is the METADATA_ONLY_CHANGE case.
  const contentUnchanged = existing?.contentHash === extracted.contentHash;
  const versionCounter = contentUnchanged
    ? (existing?.localVersionCounter ?? 1)
    : (existing?.localVersionCounter ?? 0) + 1;

  const documentId = await upsertDocument({
    deps,
    sourceId: source.row.id,
    pathId,
    item,
    extracted,
    existingId: existing?.id,
    versionCounter,
  });

  if (!contentUnchanged) {
    await deps.prisma.documentSection.deleteMany({
      where: { documentId, documentVersionCounter: versionCounter },
    });
    for (const section of extracted.sections) {
      await deps.prisma.documentSection.create({
        data: {
          documentId,
          sectionKey: section.sectionKey,
          // Kept so a question citing the pre-0004 key stays resolvable after
          // re-extraction, without rewriting immutable published lineage.
          sectionKeyV1: section.sectionKeyV1,
          ordinal: section.ordinal,
          heading: section.heading ?? null,
          headingPath: section.headingPath ?? null,
          pageNumber: section.pageNumber ?? null,
          slideNumber: section.slideNumber ?? null,
          sheetName: section.sheetName ?? null,
          startOffset: section.startOffset,
          endOffset: section.endOffset,
          sectionContentHash: section.sectionContentHash,
          assessableCharCount: section.text.length,
          isAssessable: section.isAssessable,
          nonAssessableReason: section.nonAssessableReason ?? null,
          // Set by generation governance in M3; a section with no target yet is
          // recorded as zero rather than guessed.
          targetQuestionCount: 0,
          coverageStatus: section.isAssessable ? 'NOT_COVERED' : 'NON_ASSESSABLE',
          documentVersionCounter: versionCounter,
        },
      });
    }
  }

  totals.extractedChars += extracted.charCount;
  if (existing === null) totals.added += 1;
  else if (contentUnchanged) totals.unchanged += 1;
  else totals.modified += 1;
};

interface UpsertArgs {
  readonly deps: ToolDeps;
  readonly sourceId: string;
  readonly pathId: string;
  readonly item: Extract<SyncEvent, { type: 'ITEM_DISCOVERED' }>['item'];
  readonly extracted: {
    readonly status: string;
    readonly normalizedText?: string;
    readonly charCount: number;
    readonly contentHash?: string;
    readonly reason?: string;
  };
  readonly existingId?: string;
  readonly versionCounter: number;
}

const upsertDocument = async (args: UpsertArgs): Promise<string> => {
  const { deps, item, extracted } = args;
  const data = {
    sourceId: args.sourceId,
    pathId: args.pathId,
    sourceDocumentId: item.sourceDocumentId,
    name: item.name,
    containerSiteName: item.containerSiteName ?? null,
    containerSiteId: item.containerSiteId ?? null,
    containerName: item.containerSiteName ?? '',
    containerId: item.containerSiteName ?? '',
    folderPath: item.folderPath,
    sourceUrl: item.webUrl ?? '',
    fileType: item.fileType ?? '',
    fileSizeBytes: BigInt(item.sizeBytes ?? 0),
    sourceCreatedAt: item.sourceCreatedAt,
    sourceModifiedAt: item.sourceModifiedAt ?? null,
    sourceVersion: item.sourceVersion ?? '',
    localVersionCounter: args.versionCounter,
    contentHash: extracted.contentHash ?? null,
    extractedText: extracted.normalizedText ?? null,
    extractedCharCount: extracted.charCount,
    extractionStatus: extracted.status as 'EXTRACTED',
    extractionReason: extracted.reason ?? null,
    sourceMetadata: item.sourceMetadata as object,
    status: 'ACTIVE' as const,
    lastSynchronizedAt: deps.clock.now(),
  };

  const row = await deps.prisma.knowledgeDocument.upsert({
    where: {
      sourceId_sourceDocumentId: {
        sourceId: args.sourceId,
        sourceDocumentId: item.sourceDocumentId,
      },
    },
    create: data,
    update: data,
    select: { id: true },
  });
  return row.id;
};
