// Source navigation and document tools — mcp-tools.md §6 and §7.
//
// `list_source_containers` · `list_source_items` · `search_source_documents` ·
// `get_source_document` · `get_document_permissions` ·
// `extract_document_content` · `get_document_sections`
//
// T5 is the rule that shapes the extraction output: retrieved document content
// is returned as UNTRUSTED DATA with explicit provenance. The tool never
// returns content that claims authority, and framing is the caller's job.

import { z } from 'zod';
import { createAuditWriter } from '@knowzy/database';
import { registerTool } from './registry.js';
import {
  assertSourcePermitted,
  buildAdapterContext,
  loadSource,
  SourceNotFoundError,
} from './adapter-context.js';
import type { AuthorizationEnvelope } from './envelope.js';

const SourceScoped = z.object({ sourceId: z.string().uuid() });

const actor = (envelope: AuthorizationEnvelope) => ({
  actorType: envelope.portal === 'SYSTEM' ? ('SYSTEM' as const) : ('USER' as const),
  actorUserId: envelope.subject.userId,
  actorDisplayName: envelope.subject.displayName,
  actorRoles: envelope.effectiveRoles,
  correlationId: envelope.correlationId,
  requestId: envelope.requestId,
  portal: envelope.portal,
});

export const listSourceContainers = registerTool({
  name: 'list_source_containers',
  family: 'source-navigation',
  permission: 'document.browse',
  portals: ['AUTHORING'],
  auditAction: null,
  auditExemptionReason: 'audit-model.md §8: an individual list query is not audited.',
  timeoutMs: 15_000,
  writes: 'NONE',
  description: 'Lists the containers a source exposes.',
  input: SourceScoped.strict(),
  async handler({ envelope, input, deps, signal }) {
    const source = await loadSource(deps, envelope, input.sourceId);
    const adapter = deps.adapterFor(source.row);

    if (!adapter.capabilities.supportsContainers) {
      // Declared, not emulated: a flat source says so and the tree renders one
      // level, rather than the platform inventing a container.
      return { supportsContainers: false, containers: [] };
    }

    const context = buildAdapterContext({ deps, envelope, source, signal });
    const containers = await adapter.listContainers(context);
    const configured = new Set(source.paths.map((path) => path.containerId));

    return {
      supportsContainers: true,
      // Only configured containers are offered. A container the administrator
      // did not configure is not browsable, which is what keeps selection
      // inside the configured tree (T2).
      containers: containers
        .filter((container) => configured.has(container.containerId))
        .map((container) => ({
          containerId: container.containerId,
          containerName: container.containerName,
          itemCount: container.itemCount ?? null,
        })),
    };
  },
});

export const listSourceItems = registerTool({
  name: 'list_source_items',
  family: 'source-navigation',
  permission: 'document.browse',
  portals: ['AUTHORING'],
  auditAction: null,
  auditExemptionReason: 'audit-model.md §8: an individual list query is not audited.',
  timeoutMs: 20_000,
  writes: 'NONE',
  description: 'Lists folders and documents under a container path.',
  input: SourceScoped.extend({
    containerId: z.string().min(1),
    folderPath: z.string().default(''),
    recursive: z.boolean().default(false),
    cursor: z.string().optional(),
    pageSize: z.number().int().min(1).max(200).optional(),
  }).strict(),
  async handler({ envelope, input, deps, signal }) {
    const source = await loadSource(deps, envelope, input.sourceId);
    const adapter = deps.adapterFor(source.row);
    const context = buildAdapterContext({ deps, envelope, source, signal });

    const page = await adapter.listItems(context, {
      containerId: input.containerId,
      folderPath: input.folderPath,
      recursive: input.recursive,
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      ...(input.pageSize === undefined ? {} : { pageSize: input.pageSize }),
    });

    // Sync state is joined in so the browser can show which documents are
    // actually selectable: a document the platform has not extracted cannot be
    // generated from, and hiding that would make selection fail later (ADR-006).
    const documentIds = page.items
      .map((item) => item.sourceDocumentId)
      .filter((id): id is string => id !== undefined);
    const known = await deps.prisma.knowledgeDocument.findMany({
      where: { sourceId: source.row.id, sourceDocumentId: { in: documentIds } },
      select: {
        id: true,
        sourceDocumentId: true,
        extractionStatus: true,
        extractedCharCount: true,
        status: true,
        isExcludedFromGeneration: true,
        _count: { select: { sections: true } },
      },
    });
    const knownById = new Map(known.map((row) => [row.sourceDocumentId, row]));

    return {
      items: page.items.map((item) => {
        const row = item.sourceDocumentId ? knownById.get(item.sourceDocumentId) : undefined;
        return {
          kind: item.kind,
          name: item.name,
          folderPath: item.folderPath,
          sourceDocumentId: item.sourceDocumentId ?? null,
          fileType: item.fileType ?? null,
          sizeBytes: item.sizeBytes ?? null,
          sourceModifiedAt: item.sourceModifiedAt ?? null,
          sourceVersion: item.sourceVersion ?? null,
          documentId: row?.id ?? null,
          extractionStatus: row?.extractionStatus ?? 'PENDING',
          sectionCount: row?._count.sections ?? 0,
          extractedCharCount: row?.extractedCharCount ?? 0,
          isSelectable:
            row !== undefined &&
            row.status === 'ACTIVE' &&
            row.extractionStatus === 'EXTRACTED' &&
            !row.isExcludedFromGeneration,
        };
      }),
      nextCursor: page.nextCursor ?? null,
      totalCount: page.totalCount ?? null,
    };
  },
});

export const searchSourceDocuments = registerTool({
  name: 'search_source_documents',
  family: 'source-navigation',
  permission: 'document.browse',
  portals: ['AUTHORING'],
  auditAction: null,
  auditExemptionReason: 'audit-model.md §8: an individual search query is not audited.',
  timeoutMs: 20_000,
  writes: 'NONE',
  description: 'Searches documents in a source.',
  input: SourceScoped.extend({
    text: z.string().min(2).max(200),
    containerId: z.string().optional(),
    cursor: z.string().optional(),
    pageSize: z.number().int().min(1).max(100).optional(),
  }).strict(),
  async handler({ envelope, input, deps, signal }) {
    const source = await loadSource(deps, envelope, input.sourceId);
    const adapter = deps.adapterFor(source.row);
    const context = buildAdapterContext({ deps, envelope, source, signal });

    const page = await adapter.searchDocuments(context, {
      text: input.text,
      ...(input.containerId === undefined ? {} : { containerId: input.containerId }),
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      ...(input.pageSize === undefined ? {} : { pageSize: input.pageSize }),
    });

    return {
      // Stated, not implied: the UI must label indexed results as indexed
      // rather than presenting them as a live source query.
      searchMode: adapter.capabilities.supportsLiveSearch ? 'LIVE' : 'INDEXED',
      hits: page.items.map((hit) => ({
        sourceDocumentId: hit.document.sourceDocumentId ?? null,
        name: hit.document.name,
        folderPath: hit.document.folderPath,
        score: hit.score,
        snippet: hit.snippet ?? null,
      })),
      nextCursor: page.nextCursor ?? null,
      totalCount: page.totalCount ?? null,
    };
  },
});

export const getSourceDocument = registerTool({
  name: 'get_source_document',
  family: 'source-navigation',
  permission: 'document.browse',
  portals: ['AUTHORING'],
  auditAction: null,
  auditExemptionReason: 'audit-model.md §8: an individual read request is not audited.',
  timeoutMs: 15_000,
  writes: 'NONE',
  description: 'Returns one document with its source metadata and sync state.',
  input: SourceScoped.extend({ sourceDocumentId: z.string().min(1) }).strict(),
  async handler({ envelope, input, deps, signal }) {
    const source = await loadSource(deps, envelope, input.sourceId);
    const adapter = deps.adapterFor(source.row);
    const context = buildAdapterContext({ deps, envelope, source, signal });

    const access = await adapter.getEffectiveAccess(context, input.sourceDocumentId);
    if (access.decision !== 'ALLOWED') {
      // UNKNOWN is refused alongside DENIED: §2.2 rule 2 forbids treating an
      // unanswerable permission question as permission.
      throw new SourceNotFoundError(input.sourceDocumentId);
    }

    const document = await adapter.getDocument(context, input.sourceDocumentId);
    if (!document) throw new SourceNotFoundError(input.sourceDocumentId);

    const row = await deps.prisma.knowledgeDocument.findUnique({
      where: {
        sourceId_sourceDocumentId: {
          sourceId: source.row.id,
          sourceDocumentId: input.sourceDocumentId,
        },
      },
      select: {
        id: true,
        extractionStatus: true,
        extractionReason: true,
        extractedCharCount: true,
        contentHash: true,
        localVersionCounter: true,
        status: true,
        isExcludedFromGeneration: true,
        _count: { select: { sections: true } },
      },
    });

    return {
      sourceDocumentId: document.sourceDocumentId,
      documentId: row?.id ?? null,
      name: document.name,
      folderPath: document.folderPath,
      fileType: document.fileType ?? null,
      sizeBytes: document.sizeBytes ?? null,
      mimeType: document.mimeType,
      sourceCreatedAt: document.sourceCreatedAt,
      sourceModifiedAt: document.sourceModifiedAt ?? null,
      sourceVersion: document.sourceVersion ?? null,
      sourceMetadata: document.sourceMetadata,
      webUrl: document.webUrl ?? null,
      access: { decision: access.decision, enforcement: access.enforcement },
      extractionStatus: row?.extractionStatus ?? 'PENDING',
      extractionReason: row?.extractionReason ?? null,
      extractedCharCount: row?.extractedCharCount ?? 0,
      contentHash: row?.contentHash ?? null,
      sectionCount: row?._count.sections ?? 0,
      isSelectable:
        row !== null &&
        row !== undefined &&
        row.status === 'ACTIVE' &&
        row.extractionStatus === 'EXTRACTED' &&
        !row.isExcludedFromGeneration,
    };
  },
});

export const getDocumentPermissions = registerTool({
  name: 'get_document_permissions',
  family: 'source-navigation',
  permission: 'document.browse',
  portals: ['AUTHORING'],
  auditAction: null,
  auditExemptionReason:
    'audit-model.md §8: the effective-access read is not audited. A PRINCIPAL LISTING is an audited sensitive read, and requires source.manage; that path lands with the SharePoint adapter.',
  timeoutMs: 15_000,
  writes: 'NONE',
  description: 'Returns the effective access decision for a document.',
  input: SourceScoped.extend({ sourceDocumentId: z.string().min(1) }).strict(),
  async handler({ envelope, input, deps, signal }) {
    const source = await loadSource(deps, envelope, input.sourceId);
    const adapter = deps.adapterFor(source.row);
    const context = buildAdapterContext({ deps, envelope, source, signal });

    const access = await adapter.getEffectiveAccess(context, input.sourceDocumentId);

    return {
      decision: access.decision,
      enforcement: access.enforcement,
      summary: access.summary ?? null,
      // Honest about where the answer came from: a source that cannot check
      // permissions returns UNKNOWN, and the UI must say "unknown" rather than
      // rendering an empty allow list as "nobody is restricted".
      checkedBySource: adapter.capabilities.supportsPermissionCheck,
    };
  },
});

// -------------------------------------------------------------- authoring §7

export const extractDocumentContent = registerTool({
  name: 'extract_document_content',
  family: 'authoring',
  permission: 'question.generate',
  portals: ['AUTHORING'],
  auditAction: 'AUTHORING.DOCUMENT.CONTENT_EXTRACTED',
  timeoutMs: 60_000,
  writes: 'LOCAL',
  description: 'Extracts and returns normalized document content as untrusted data.',
  input: SourceScoped.extend({
    sourceDocumentId: z.string().min(1),
    maxChars: z.number().int().min(1_000).max(500_000).optional(),
  }).strict(),
  async handler({ envelope, input, deps, signal }) {
    const source = await loadSource(deps, envelope, input.sourceId);
    if (!source.row.usableForGeneration) {
      // The extra gate in §3.2 for this tool. Extraction for generation from a
      // source not marked usable would produce questions from content nobody
      // approved for that purpose.
      throw new Error(
        `Source "${source.row.name}" is not marked usable for generation, so its content cannot be extracted for question generation.`,
      );
    }

    const adapter = deps.adapterFor(source.row);
    const context = buildAdapterContext({ deps, envelope, source, signal });
    const extracted = await adapter.extractContent(context, input.sourceDocumentId, {
      ...(input.maxChars === undefined ? {} : { maxChars: input.maxChars }),
    });

    const auditWriter = createAuditWriter({ clock: deps.clock });
    await auditWriter.write(deps.prisma, {
      ...actor(envelope),
      action: 'AUTHORING.DOCUMENT.CONTENT_EXTRACTED',
      outcome: extracted.status === 'EXTRACTED' ? 'SUCCESS' : 'FAILURE',
      entityType: 'KnowledgeDocument',
      entityId: input.sourceDocumentId,
      entityLabel: input.sourceDocumentId,
      sourceId: source.row.id,
      detail: {
        status: extracted.status,
        charCount: extracted.charCount,
        sectionCount: extracted.sections.length,
        truncated: extracted.truncated,
        contentHash: extracted.contentHash ?? null,
      },
    });

    return {
      status: extracted.status,
      // T5: the payload declares its own trust level. A caller that forwards
      // this to Claude must apply the untrusted-content framing; the tool
      // states the fact rather than relying on the caller to remember it.
      trust: 'UNTRUSTED_RETRIEVED_CONTENT',
      provenance: {
        sourceId: source.row.id,
        sourceName: source.row.name,
        sourceDocumentId: input.sourceDocumentId,
      },
      normalizedText: extracted.normalizedText ?? null,
      charCount: extracted.charCount,
      contentHash: extracted.contentHash ?? null,
      truncated: extracted.truncated,
      reason: extracted.reason ?? null,
      sections: extracted.sections.map((section) => ({
        ordinal: section.ordinal,
        sectionKey: section.sectionKey,
        // Kept so a question citing the pre-0004 key stays resolvable after
        // re-extraction, without rewriting immutable published lineage.
        sectionKeyV1: section.sectionKeyV1,
        heading: section.heading ?? null,
        headingPath: section.headingPath ?? null,
        label: section.label,
        startOffset: section.startOffset,
        endOffset: section.endOffset,
        sectionContentHash: section.sectionContentHash,
        isAssessable: section.isAssessable,
        nonAssessableReason: section.nonAssessableReason ?? null,
      })),
    };
  },
});

export const getDocumentSections = registerTool({
  name: 'get_document_sections',
  family: 'authoring',
  permission: 'document.browse',
  portals: ['AUTHORING'],
  auditAction: null,
  auditExemptionReason: 'audit-model.md §8: an individual read request is not audited.',
  timeoutMs: 15_000,
  writes: 'NONE',
  description: 'Returns the persisted sections of a synchronized document.',
  input: z
    .object({
      sourceId: z.string().uuid(),
      documentId: z.string().uuid(),
      includeText: z.boolean().default(false),
    })
    .strict(),
  async handler({ envelope, input, deps }) {
    assertSourcePermitted(envelope, input.sourceId);

    const document = await deps.prisma.knowledgeDocument.findFirst({
      where: { id: input.documentId, sourceId: input.sourceId },
      select: {
        id: true,
        name: true,
        localVersionCounter: true,
        extractedText: true,
        extractionStatus: true,
        contentHash: true,
      },
    });
    if (!document) throw new SourceNotFoundError(input.documentId);

    const sections = await deps.prisma.documentSection.findMany({
      where: { documentId: document.id, documentVersionCounter: document.localVersionCounter },
      orderBy: { ordinal: 'asc' },
    });

    return {
      documentId: document.id,
      name: document.name,
      versionCounter: document.localVersionCounter,
      extractionStatus: document.extractionStatus,
      contentHash: document.contentHash,
      ...(input.includeText ? { trust: 'UNTRUSTED_RETRIEVED_CONTENT' as const } : {}),
      sections: sections.map((section) => ({
        sectionId: section.id,
        sectionKey: section.sectionKey,
        // Kept so a question citing the pre-0004 key stays resolvable after
        // re-extraction, without rewriting immutable published lineage.
        sectionKeyV1: section.sectionKeyV1,
        ordinal: section.ordinal,
        heading: section.heading,
        headingPath: section.headingPath,
        startOffset: section.startOffset,
        endOffset: section.endOffset,
        sectionContentHash: section.sectionContentHash,
        assessableCharCount: section.assessableCharCount,
        isAssessable: section.isAssessable,
        nonAssessableReason: section.nonAssessableReason,
        coverageStatus: section.coverageStatus,
        // The text is sliced from the STORED normalized text using the stored
        // offsets, so a round-trip failure surfaces here rather than silently
        // producing a wrong evidence span later.
        ...(input.includeText
          ? {
              text: (document.extractedText ?? '').slice(section.startOffset, section.endOffset),
            }
          : {}),
      })),
    };
  },
});
