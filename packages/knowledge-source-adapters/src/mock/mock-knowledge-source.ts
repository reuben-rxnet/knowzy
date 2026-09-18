// MockKnowledgeSourceAdapter — knowledge-source-adapters.md §6.
//
// "The entire pipeline must be exercisable with NO tenant credentials at all"
// is a design requirement, not a convenience. This adapter is what makes that
// true, and it is also the substrate for the conformance suite: every behaviour
// the suite asserts must hold for both implementations, so a contract violation
// in the SharePoint adapter is caught by a test that needs no tenant.
//
// It therefore does NOT take shortcuts a mock would be tempted to take. It runs
// the real extractors over real files, returns real offsets, honours the abort
// signal, pages its results, and answers a denied document with DENIED rather
// than quietly omitting it.

import { extractContent as extractFileContent } from '@knowzy/content-extraction';
import type { DocumentType, SourceType } from '@knowzy/shared-types';
import {
  SourceDocumentNotFoundError,
  type AccessDecision,
  type AdapterCapabilities,
  type AdapterContext,
  type ConnectionTestCheck,
  type ConnectionTestResult,
  type Container,
  type ExtractedContent,
  type ExtractedSection,
  type ExtractOptions,
  type KnowledgeSourceAdapter,
  type ListItemsQuery,
  type Page,
  type SearchHit,
  type SearchQuery,
  type SourceDocument,
  type SourceDocumentId,
  type SourceItem,
  type SyncEvent,
  type SyncRequest,
} from '../contract.js';
import {
  loadFixtureTree,
  readFixtureContent,
  type FixtureDocument,
  type FixtureTree,
} from './fixture-tree.js';

/**
 * All true except `supportsLiveSearch`.
 *
 * That one is false on purpose: it forces the "indexed vs live search"
 * labelling path to be exercised by the default local configuration, rather
 * than being a code path nobody sees until a real source declares it.
 */
export const MOCK_CAPABILITIES: AdapterCapabilities = {
  supportsContainers: true,
  supportsFolderHierarchy: true,
  supportsLiveSearch: false,
  supportsFullTextSearch: true,
  supportsIncrementalSync: true,
  supportsPermissionCheck: true,
  supportsDelegatedAccess: true,
  supportsVersionLabels: true,
  supportedDocumentTypes: ['TXT', 'HTML'] as readonly DocumentType[],
  writeCapable: false,
};

export interface MockAdapterOptions {
  /** Directory holding `{sourceKey}/...`, i.e. `fixtures/knowledge`. */
  readonly fixtureRoot: string;
  /** Deterministic fault injection (§6, "Fault injection"). */
  readonly faults?: readonly MockFault[];
}

export interface MockFault {
  /** Applies when the document's relative path matches exactly. */
  readonly relativePath: string;
  readonly kind: 'EXTRACTION_FAILED' | 'ACCESS_DENIED' | 'NOT_FOUND' | 'THROTTLED';
}

const DEFAULT_PAGE_SIZE = 50;

/** Every method starts here: a cancelled call must stop, not finish quietly. */
const assertNotAborted = (ctx: AdapterContext): void => {
  if (ctx.signal.aborted) {
    throw new Error('The operation was aborted before it completed.');
  }
};

const decodeCursor = (cursor: string | undefined): number => {
  if (cursor === undefined) return 0;
  const offset = Number.parseInt(cursor, 10);
  return Number.isFinite(offset) && offset >= 0 ? offset : 0;
};

const paginate = <T>(items: readonly T[], cursor: string | undefined, size: number): Page<T> => {
  const start = decodeCursor(cursor);
  const slice = items.slice(start, start + size);
  const end = start + slice.length;
  return {
    items: slice,
    ...(end < items.length ? { nextCursor: String(end) } : {}),
    totalCount: items.length,
  };
};

const toSourceItem = (document: FixtureDocument): SourceItem => ({
  kind: 'DOCUMENT',
  sourceDocumentId: document.sourceDocumentId,
  name: document.name,
  folderPath: document.folderPath,
  fileType: document.fileType,
  sizeBytes: document.sizeBytes,
  sourceModifiedAt: document.sourceModifiedAt,
  sourceVersion: document.sourceVersion,
  webUrl: `mock://${document.relativePath}`,
});

const toSourceDocument = (document: FixtureDocument, tree: FixtureTree): SourceDocument => ({
  ...toSourceItem(document),
  kind: 'DOCUMENT',
  sourceDocumentId: document.sourceDocumentId,
  sourceCreatedAt: document.sourceCreatedAt,
  mimeType: document.mimeType,
  sourceMetadata: document.metadata,
  containerSiteName: document.containerId,
  containerSiteId: `mock-container:${tree.sourceKey}/${document.containerId}`,
});

export const createMockKnowledgeSourceAdapter = (
  options: MockAdapterOptions,
): KnowledgeSourceAdapter => {
  const faultsByPath = new Map((options.faults ?? []).map((f) => [f.relativePath, f.kind]));
  const trees = new Map<string, FixtureTree>();

  const treeFor = (ctx: AdapterContext): FixtureTree => {
    const cached = trees.get(ctx.source.sourceKey);
    if (cached) return cached;
    const tree = loadFixtureTree(options.fixtureRoot, ctx.source.sourceKey);
    trees.set(ctx.source.sourceKey, tree);
    return tree;
  };

  const find = (ctx: AdapterContext, id: SourceDocumentId): FixtureDocument | undefined => {
    const document = treeFor(ctx).documents.find((d) => d.sourceDocumentId === id);
    if (document && faultsByPath.get(document.relativePath) === 'NOT_FOUND') return undefined;
    return document;
  };

  /**
   * Which documents a path configuration selects.
   *
   * Configuring a source is meaningless if the adapter ignores the paths, so
   * this is applied to browsing, sync, and search alike.
   */
  const withinConfiguredPaths = (ctx: AdapterContext, document: FixtureDocument): boolean => {
    if (ctx.paths.length === 0) return true;
    return ctx.paths.some((path) => {
      if (path.containerId !== document.containerId) return false;
      const folder = path.folderPath ?? '';
      if (folder.length > 0) {
        const matches = path.recursive
          ? document.folderPath === folder || document.folderPath.startsWith(`${folder}/`)
          : document.folderPath === folder;
        if (!matches) return false;
      } else if (!path.recursive && document.folderPath.length > 0) {
        return false;
      }
      const types = path.includeFileTypes ?? [];
      return types.length === 0 || types.includes(document.fileType);
    });
  };

  const accessFor = (ctx: AdapterContext, document: FixtureDocument): AccessDecision => {
    if (faultsByPath.get(document.relativePath) === 'ACCESS_DENIED') {
      return {
        decision: 'DENIED',
        enforcement: 'SOURCE',
        summary: 'Injected fault: the source refused access to this document.',
      };
    }

    const principal = ctx.onBehalfOf?.principalId;
    const override = principal ? document.access.principals?.[principal] : undefined;
    const decision = override ?? document.access.default ?? 'ALLOWED';

    return {
      decision,
      // The fixture's access map stands in for the source's own ACL, so the
      // enforcement label says SOURCE. A source that could not answer would
      // return UNKNOWN with PLATFORM, and the UI would say so.
      enforcement: 'SOURCE',
      ...(principal ? { callerRole: `mock-principal:${principal}` } : {}),
      ...(decision === 'DENIED'
        ? { summary: document.access.summary ?? 'The source denies access to this document.' }
        : {}),
    };
  };

  const visibleDocuments = (ctx: AdapterContext): readonly FixtureDocument[] =>
    treeFor(ctx)
      .documents.filter((d) => withinConfiguredPaths(ctx, d))
      .filter((d) => accessFor(ctx, d).decision === 'ALLOWED');

  const extract = (
    ctx: AdapterContext,
    document: FixtureDocument,
    extractOptions: ExtractOptions,
  ): ExtractedContent => {
    if (faultsByPath.get(document.relativePath) === 'EXTRACTION_FAILED') {
      return {
        status: 'FAILED',
        charCount: 0,
        sections: [],
        truncated: false,
        reason: 'Injected fault: extraction failed for this document.',
      };
    }

    const result = extractFileContent(
      {
        fileName: document.name,
        content: readFixtureContent(document),
        sizeBytes: document.sizeBytes,
      },
      {
        maxBytes: ctx.limits.maxBytes,
        maxChars: extractOptions.maxChars ?? ctx.limits.maxCharsPerDocument,
        ...(extractOptions.minAssessableChars !== undefined
          ? { minAssessableChars: extractOptions.minAssessableChars }
          : {}),
      },
    );

    if (result.status !== 'EXTRACTED' || result.normalizedText === null) {
      // X5: pass the status and reason through unchanged, with no text. The
      // adapter must not upgrade a failure into an empty success.
      return {
        status: result.status,
        charCount: 0,
        sections: [],
        truncated: result.truncated,
        ...(result.reason === null ? {} : { reason: result.reason }),
      };
    }

    const sections: ExtractedSection[] = result.sections.map((section) => ({
      ordinal: section.ordinal,
      sectionKey: section.sectionKey,
      ...(section.heading === null ? {} : { heading: section.heading }),
      ...(section.headingPath === null ? {} : { headingPath: section.headingPath }),
      ...(section.pageNumber === null ? {} : { pageNumber: section.pageNumber }),
      ...(section.slideNumber === null ? {} : { slideNumber: section.slideNumber }),
      ...(section.sheetName === null ? {} : { sheetName: section.sheetName }),
      startOffset: section.startOffset,
      endOffset: section.endOffset,
      sectionContentHash: section.sectionContentHash,
      text: section.text,
      isAssessable: section.isAssessable,
      ...(section.nonAssessableReason === null
        ? {}
        : { nonAssessableReason: section.nonAssessableReason }),
      label: section.label,
    }));

    return {
      status: 'EXTRACTED',
      normalizedText: result.normalizedText,
      charCount: result.charCount,
      sections,
      ...(result.contentHash === null ? {} : { contentHash: result.contentHash }),
      truncated: result.truncated,
      ...(result.reason === null ? {} : { reason: result.reason }),
    };
  };

  return {
    sourceType: 'MOCK' as SourceType,
    capabilities: MOCK_CAPABILITIES,

    async testConnection(ctx: AdapterContext): Promise<ConnectionTestResult> {
      assertNotAborted(ctx);
      const startedAt = ctx.clock.now().getTime();
      const checks: ConnectionTestCheck[] = [];

      let tree: FixtureTree | null = null;
      try {
        tree = treeFor(ctx);
        checks.push({
          name: 'Fixture tree readable',
          outcome: 'PASS',
          detail: `Read ${tree.documents.length} document(s) from ${tree.rootPath}.`,
        });
      } catch {
        checks.push({
          name: 'Fixture tree readable',
          outcome: 'FAIL',
          // Actionable, and it does not leak a raw filesystem error.
          detail: `No fixture tree for source key "${ctx.source.sourceKey}" under the configured fixture root.`,
        });
      }

      if (tree) {
        const configured = tree.documents.filter((d) => withinConfiguredPaths(ctx, d));
        checks.push({
          name: 'Configured paths resolve',
          outcome: configured.length > 0 ? 'PASS' : 'FAIL',
          detail:
            configured.length > 0
              ? `${configured.length} document(s) match the configured path(s).`
              : 'The configured paths match no documents. Check the container and folder path.',
        });

        const supported = configured.filter((d) => d.fileType.length > 0);
        checks.push({
          name: 'Document types supported',
          outcome: 'PASS',
          detail: `${supported.length} of ${configured.length} matched document(s) have a recognised extension.`,
        });
      }

      checks.push({
        name: 'Credential resolves',
        // The mock needs no credential, and says so rather than claiming a
        // passed check it did not perform.
        outcome: 'SKIP',
        detail: 'The mock source requires no credential.',
      });

      checks.push({
        name: 'Live search',
        outcome: 'SKIP',
        detail: 'This source does not support live search; results come from the platform index.',
      });

      return {
        ok: checks.every((check) => check.outcome !== 'FAIL'),
        checks,
        durationMs: Math.max(0, ctx.clock.now().getTime() - startedAt),
        capabilities: MOCK_CAPABILITIES,
      };
    },

    async listContainers(ctx: AdapterContext): Promise<readonly Container[]> {
      assertNotAborted(ctx);
      // Counted from the documents the caller can actually see, not from the
      // tree. A container advertising 3 items whose listing shows 2 invites the
      // reader to think something failed to load, when in fact the third is
      // correctly denied.
      const visible = visibleDocuments(ctx);
      return treeFor(ctx).containers.map((container) => ({
        containerId: container.containerId,
        containerName: container.containerId.length > 0 ? container.containerId : '(root)',
        itemCount: visible.filter((d) => d.containerId === container.containerId).length,
      }));
    },

    async listItems(ctx: AdapterContext, query: ListItemsQuery): Promise<Page<SourceItem>> {
      assertNotAborted(ctx);
      const folder = query.folderPath ?? '';
      const recursive = query.recursive ?? false;

      const documents = visibleDocuments(ctx).filter((d) => {
        if (d.containerId !== query.containerId) return false;
        if (folder.length === 0) return recursive || d.folderPath.length === 0;
        return recursive
          ? d.folderPath === folder || d.folderPath.startsWith(`${folder}/`)
          : d.folderPath === folder;
      });

      // Immediate subfolders are listed as FOLDER items so the tree renders one
      // level at a time, the way a source with a real hierarchy would.
      const folders = new Set<string>();
      if (!recursive) {
        for (const d of visibleDocuments(ctx)) {
          if (d.containerId !== query.containerId) continue;
          if (folder.length > 0 && !d.folderPath.startsWith(`${folder}/`)) continue;
          const remainder = folder.length > 0 ? d.folderPath.slice(folder.length + 1) : d.folderPath;
          if (remainder.length === 0) continue;
          folders.add(remainder.split('/')[0] ?? '');
        }
      }

      const folderItems: SourceItem[] = [...folders]
        .filter((name) => name.length > 0)
        .sort()
        .map((name) => ({
          kind: 'FOLDER',
          name,
          folderPath: folder.length > 0 ? `${folder}/${name}` : name,
        }));

      const items: SourceItem[] = [...folderItems, ...documents.map(toSourceItem)];
      return paginate(items, query.cursor, query.pageSize ?? ctx.limits.pageSize ?? DEFAULT_PAGE_SIZE);
    },

    async searchDocuments(ctx: AdapterContext, query: SearchQuery): Promise<Page<SearchHit>> {
      assertNotAborted(ctx);
      const needle = query.text.trim().toLowerCase();
      if (needle.length === 0) return { items: [], totalCount: 0 };

      const hits: SearchHit[] = [];
      for (const document of visibleDocuments(ctx)) {
        if (query.containerId !== undefined && document.containerId !== query.containerId) continue;

        const content = readFixtureContent(document).toLowerCase();
        const nameMatch = document.name.toLowerCase().includes(needle);
        const at = content.indexOf(needle);
        if (!nameMatch && at === -1) continue;

        hits.push({
          document: toSourceItem(document),
          // A name match ranks above a body match; within body matches an
          // earlier hit ranks higher. Deterministic, which matters because the
          // ordering is asserted by the conformance suite.
          score: nameMatch ? 1 : 0.5,
          ...(at === -1
            ? {}
            : {
                // A bounded window, never the whole document: an adapter that
                // returned full text here would be an exfiltration path.
                snippet: readFixtureContent(document)
                  .slice(Math.max(0, at - 60), at + needle.length + 60)
                  .replace(/\s+/g, ' ')
                  .trim(),
              }),
        });
      }

      hits.sort((a, b) => b.score - a.score || a.document.name.localeCompare(b.document.name));
      return paginate(hits, query.cursor, query.pageSize ?? ctx.limits.pageSize ?? DEFAULT_PAGE_SIZE);
    },

    async getDocument(ctx: AdapterContext, id: SourceDocumentId): Promise<SourceDocument | null> {
      assertNotAborted(ctx);
      const document = find(ctx, id);
      if (!document) return null;
      return toSourceDocument(document, treeFor(ctx));
    },

    async getEffectiveAccess(ctx: AdapterContext, id: SourceDocumentId): Promise<AccessDecision> {
      assertNotAborted(ctx);
      const document = find(ctx, id);
      if (!document) {
        // Not-found is answered DENIED rather than UNKNOWN: a caller asking
        // about an id the source does not have should not be told "maybe".
        return {
          decision: 'DENIED',
          enforcement: 'SOURCE',
          summary: 'No such document in this source.',
        };
      }
      return accessFor(ctx, document);
    },

    async extractContent(
      ctx: AdapterContext,
      id: SourceDocumentId,
      extractOptions: ExtractOptions,
    ): Promise<ExtractedContent> {
      assertNotAborted(ctx);
      const document = find(ctx, id);
      if (!document) throw new SourceDocumentNotFoundError(id);

      const access = accessFor(ctx, document);
      if (access.decision !== 'ALLOWED') {
        // Extraction is refused on a non-ALLOWED decision, including UNKNOWN.
        // Content is the thing worth protecting, so the cautious direction is
        // the default rather than a configuration choice.
        throw new Error(`Access to document ${id} is ${access.decision}.`);
      }

      return extract(ctx, document, extractOptions);
    },

    async *synchronize(ctx: AdapterContext, request: SyncRequest): AsyncIterable<SyncEvent> {
      assertNotAborted(ctx);
      const tree = treeFor(ctx);
      // The SAME visibility rule browsing uses. A document discovered by sync
      // but hidden from browsing would appear in the document list while being
      // unreachable, and an access-denied document is correctly out of scope
      // rather than a failure to report.
      const configured = tree.documents
        .filter((d) => withinConfiguredPaths(ctx, d))
        .filter((d) => accessFor(ctx, d).decision === 'ALLOWED');

      // The opaque state is a map of id → sourceVersion from the last run. The
      // platform persists it verbatim and replays it; the adapter owns its
      // shape, which is exactly what keeps delta tokens out of the contract.
      const previous = parseSyncState(request.state);
      const isIncremental = request.mode === 'INCREMENTAL' && previous !== null;

      let discovered = 0;
      let modified = 0;
      let failed = 0;
      let seenInPage = 0;
      const nextState: Record<string, string> = {};

      for (const document of configured) {
        if (ctx.signal.aborted) break;
        nextState[document.sourceDocumentId] = document.sourceVersion;
        seenInPage += 1;

        const fault = faultsByPath.get(document.relativePath);
        if (fault === 'THROTTLED' || fault === 'EXTRACTION_FAILED') {
          failed += 1;
          yield {
            type: 'ITEM_FAILED',
            sourceDocumentId: document.sourceDocumentId,
            reason:
              fault === 'THROTTLED'
                ? 'The source throttled the request.'
                : 'Extraction failed for this document.',
            retryable: fault === 'THROTTLED',
          };
        } else if (!isIncremental || previous[document.sourceDocumentId] === undefined) {
          discovered += 1;
          yield { type: 'ITEM_DISCOVERED', item: toSourceDocument(document, tree) };
        } else if (previous[document.sourceDocumentId] !== document.sourceVersion) {
          modified += 1;
          yield { type: 'ITEM_MODIFIED', item: toSourceDocument(document, tree) };
        }

        if (seenInPage >= (ctx.limits.pageSize || DEFAULT_PAGE_SIZE)) {
          yield { type: 'PAGE_COMPLETED', itemsSeen: seenInPage };
          yield { type: 'STATE_CHECKPOINT', state: JSON.stringify(nextState) };
          seenInPage = 0;
        }
      }

      let deleted = 0;
      if (isIncremental) {
        const present = new Set(configured.map((d) => d.sourceDocumentId));
        for (const id of Object.keys(previous).sort()) {
          if (present.has(id)) continue;
          deleted += 1;
          yield { type: 'ITEM_DELETED', sourceDocumentId: id };
        }
      }

      if (seenInPage > 0) yield { type: 'PAGE_COMPLETED', itemsSeen: seenInPage };
      yield { type: 'STATE_CHECKPOINT', state: JSON.stringify(nextState) };
      yield { type: 'RUN_COMPLETED', discovered, modified, deleted, failed };
    },
  };
};

const parseSyncState = (state: string | undefined): Record<string, string> | null => {
  if (state === undefined || state.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(state);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, string>;
  } catch {
    // An unreadable checkpoint degrades to a full run rather than failing the
    // sync: this is the delta-token-invalidation path a real source will hit.
    return null;
  }
};
