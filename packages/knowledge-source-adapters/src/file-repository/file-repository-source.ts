// The FILE_REPOSITORY knowledge-source adapter.
//
// Reads a locally synchronized directory — a mirrored SharePoint library, a
// mirrored OneDrive folder, or a managed upload directory — through the same
// `KnowledgeSourceAdapter` contract every other source implements, so
// generation, review, approval, publishing, assessment and scoring work
// unchanged (goal G8).
//
// THIS IS NOT THE MOCK ADAPTER, and must never become it.
// `startup.ts` fails check `MOCK_ISOLATION` outside `local` when
// `mockAdaptersRegistered()` is true. Re-pointing the mock at a real directory
// would make every deployed environment refuse to start — correctly.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE CAPABILITY DECLARATION IS THE WHOLE ARGUMENT FOR THIS ADAPTER
//
// Template rule P1: "Honest AdapterCapabilities. Emulating a capability is a
// contract violation." Four things are genuinely lost relative to reading
// SharePoint through Graph, and each is DECLARED rather than emulated:
//
//   supportsDelegatedAccess: false   there is no per-user decision to make.
//                                    DELEGATED_OBO is refused at configuration
//                                    time (P6) rather than silently accepted.
//   supportsVersionLabels: false     `mtime` moves on touch, copy and restore,
//                                    so it is not a version. The content hash
//                                    decides, and preflight can report
//                                    CONTENT_CHANGED_UNVERSIONED honestly.
//   enforcement: 'PLATFORM'          on every access decision. Access is
//                                    governed by the configured corpus
//                                    boundary, the operating system, and
//                                    Knowzy's own authorization — never by
//                                    SharePoint.
//   supportsPermissionCheck: true    and this one needs its reasoning stated,
//                                    because the obvious choice is wrong.
//
// `false` would seem more honest. It is unworkable: the contract specifies
// that `false` forces `getEffectiveAccess` to return `UNKNOWN`, and both
// `extractContent` and `synchronize` refuse on any non-`ALLOWED` decision
// INCLUDING `UNKNOWN` — "content is the thing worth protecting, so the
// cautious direction is the default". An adapter declaring `false` could
// therefore never serve a single document. That refusal rule is correct and is
// not weakened here.
//
// The capability asks "can you answer the question"; this adapter can, from
// the configured boundary and the operator-declared sidecar. `enforcement`
// answers "on whose authority", and it says PLATFORM. Nothing claims
// SharePoint enforced anything.

import { supportedDocumentTypes, SUPPORTED_EXTENSIONS } from '@knowzy/content-extraction';
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
  hashTreeBytes,
  loadDirectoryTree,
  readTreeBytes,
  TreeRootError,
  type DirectoryTree,
  type TreeDocument,
} from '../tree/directory-tree.js';
import { parseFileRepositoryConnection, type FileRepositoryConnection } from './connection.js';
import { canonicalDocumentUrl, normalizeWebUrlBase, provisionalDocumentUrl } from './web-url.js';

export const FILE_REPOSITORY_CAPABILITIES: AdapterCapabilities = {
  supportsContainers: true,
  supportsFolderHierarchy: true,
  // Indexed only. There is no live query surface over a directory, and the UI
  // already labels an indexed-search source as such.
  supportsLiveSearch: false,
  supportsFullTextSearch: true,
  supportsIncrementalSync: true,
  supportsPermissionCheck: true,
  supportsDelegatedAccess: false,
  supportsVersionLabels: false,
  // DERIVED from the extractor registry, so the declaration cannot drift from
  // what the platform can actually read (P1).
  supportedDocumentTypes: supportedDocumentTypes as readonly DocumentType[],
  writeCapable: false,
};

export class DelegatedAccessNotSupportedError extends Error {
  readonly code = 'DELEGATED_ACCESS_NOT_SUPPORTED';
  constructor() {
    super(
      'A file-repository source cannot honour DELEGATED_OBO: a directory carries no per-user ' +
        'SharePoint decision. Configure APP_ONLY_SITES_SELECTED and accept that trimming is ' +
        'platform-enforced, or use a Graph-backed source.',
    );
    this.name = 'DelegatedAccessNotSupportedError';
  }
}

/**
 * The opaque synchronization checkpoint: document id → content signature.
 *
 * The platform persists this verbatim and replays it, so its shape is the
 * adapter's own business — but it is deliberately the SAME shape the mock
 * uses, a flat map keyed by `sourceDocumentId`, because the conformance suite
 * replays a hand-written state of that form and expects a deletion keyed by
 * the id it contains. A bespoke envelope made a replayed state unparseable,
 * which silently degraded every incremental run to a full scan.
 *
 * The signature combines the content hash with any operator-declared version,
 * so re-declaring a version in a sidecar counts as a change even though the
 * bytes did not move.
 */
type SyncState = Readonly<Record<string, string>>;

const parseSyncState = (raw: string | undefined): SyncState | null => {
  if (raw === undefined || raw.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const entries = Object.entries(parsed as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    );
    return Object.fromEntries(entries);
  } catch {
    // An unreadable checkpoint falls back to a full scan rather than failing.
    return null;
  }
};

/** Content hash plus the declared version, so either changing is a change. */
const signatureOf = (contentHash: string, declaredVersion: string): string =>
  declaredVersion === '' ? contentHash : `${contentHash}:${declaredVersion}`;

const assertNotAborted = (ctx: AdapterContext): void => {
  if (ctx.signal.aborted) throw new Error('The operation was aborted.');
};

export interface FileRepositoryOptions {
  /** Overrides the configured root. Test seam only. */
  readonly rootOverride?: string;
}

export const createFileRepositoryAdapter = (
  options: FileRepositoryOptions = {},
): KnowledgeSourceAdapter => {
  /** Parsed once per call, so a configuration change takes effect immediately. */
  const configOf = (ctx: AdapterContext): FileRepositoryConnection => {
    if (ctx.permissionMode === 'DELEGATED_OBO') {
      throw new DelegatedAccessNotSupportedError();
    }
    return parseFileRepositoryConnection(ctx.source.connection);
  };

  const rootOf = (config: FileRepositoryConnection): string => {
    const base = options.rootOverride ?? config.localRoot;
    return config.corpusSubfolder === undefined || config.corpusSubfolder === ''
      ? base
      : `${base.replace(/[\\/]+$/, '')}/${config.corpusSubfolder.replace(/^[\\/]+/, '')}`;
  };

  const treeOf = (
    ctx: AdapterContext,
  ): { tree: DirectoryTree; config: FileRepositoryConnection } => {
    const config = configOf(ctx);
    const extensions =
      config.supportedExtensions.length > 0 ? config.supportedExtensions : SUPPORTED_EXTENSIONS;
    const tree = loadDirectoryTree({ rootPath: rootOf(config), supportedExtensions: extensions });
    return { tree, config };
  };

  /**
   * The canonical provenance URL for a document.
   *
   * Never a local path. For a mirror it is the real SharePoint URL; for an
   * upload directory it is an explicit non-resolving scheme.
   */
  const urlFor = (config: FileRepositoryConnection, document: TreeDocument): string => {
    if (config.provenance === 'MANAGED_UPLOAD' || config.webUrlBase === undefined) {
      return provisionalDocumentUrl(config.provenance, document.relativePath);
    }
    const base = normalizeWebUrlBase(config.webUrlBase);
    const withinCorpus =
      config.corpusSubfolder === undefined || config.corpusSubfolder === ''
        ? document.relativePath
        : `${config.corpusSubfolder}/${document.relativePath}`;
    return canonicalDocumentUrl(base, withinCorpus);
  };

  const toItem = (config: FileRepositoryConnection, document: TreeDocument): SourceItem => ({
    kind: 'DOCUMENT',
    sourceDocumentId: document.sourceDocumentId,
    name: document.name,
    folderPath: document.folderPath,
    fileType: document.fileType,
    sizeBytes: document.sizeBytes,
    sourceModifiedAt: document.sourceModifiedAt,
    // Only when a sidecar supplied one. Absent, not fabricated from `mtime`.
    ...(document.sourceVersion === '' ? {} : { sourceVersion: document.sourceVersion }),
    webUrl: urlFor(config, document),
  });

  const toDocument = (
    config: FileRepositoryConnection,
    document: TreeDocument,
  ): SourceDocument => ({
    ...(toItem(config, document) as SourceItem & { kind: 'DOCUMENT' }),
    kind: 'DOCUMENT',
    sourceDocumentId: document.sourceDocumentId,
    sourceCreatedAt: document.sourceCreatedAt,
    mimeType: document.mimeType,
    sourceMetadata: document.metadata,
    ...(document.containerId === '' ? {} : { containerSiteName: document.containerId }),
  });

  /**
   * The access decision.
   *
   * `enforcement` is ALWAYS 'PLATFORM'. A sidecar may declare a denial, and a
   * placeholder is denied because its bytes are not present — reading one
   * would block on a network fetch the platform has no credential for.
   */
  const accessFor = (
    ctx: AdapterContext,
    config: FileRepositoryConnection,
    document: TreeDocument,
  ): AccessDecision => {
    const principal = ctx.onBehalfOf?.principalId;
    const declared =
      config.sidecarsEnabled && principal !== undefined
        ? document.access.principals?.[principal]
        : undefined;
    const fallback = config.sidecarsEnabled ? document.access.default : undefined;
    const outcome = declared ?? fallback ?? 'ALLOWED';

    if (document.isPlaceholder) {
      return {
        decision: 'DENIED',
        enforcement: 'PLATFORM',
        summary:
          'The file is a cloud placeholder with no local content. Mark the folder ' +
          '"Always keep on this device" and synchronize it before generating from it.',
      };
    }

    return {
      decision: outcome === 'UNKNOWN' ? 'DENIED' : outcome,
      enforcement: 'PLATFORM',
      summary:
        outcome === 'ALLOWED'
          ? `Within the configured corpus boundary of ${config.mirrorAccountUpn ?? 'this source'}. ` +
            'Access is enforced by Knowzy, not by SharePoint.'
          : (document.access.summary ??
            'Declared not accessible for this source. Enforced by Knowzy, not by SharePoint.'),
    };
  };

  const find = (
    ctx: AdapterContext,
    id: SourceDocumentId,
  ): { tree: DirectoryTree; config: FileRepositoryConnection; document: TreeDocument } => {
    const { tree, config } = treeOf(ctx);
    const document = tree.documents.find((candidate) => candidate.sourceDocumentId === id);
    if (document === undefined) throw new SourceDocumentNotFoundError(id);
    return { tree, config, document };
  };

  /** Extracted text, cached per call for search. Never the raw bytes. */
  const textOf = async (
    ctx: AdapterContext,
    tree: DirectoryTree,
    config: FileRepositoryConnection,
    document: TreeDocument,
  ): Promise<string | null> => {
    try {
      const bytes = readTreeBytes(tree, document, config.maxFileBytes);
      const isBinary = !['txt', 'text', 'md', 'markdown', 'html', 'htm', 'aspx'].includes(
        document.fileType,
      );
      const result = await extractFileContent(
        {
          fileName: document.name,
          content: isBinary ? bytes : Buffer.from(bytes).toString('utf8'),
          sizeBytes: document.sizeBytes,
        },
        { maxChars: ctx.limits.maxCharsPerDocument },
      );
      return result.normalizedText;
    } catch {
      return null;
    }
  };

  return {
    sourceType: 'FILE_REPOSITORY' as SourceType,
    capabilities: FILE_REPOSITORY_CAPABILITIES,

    async testConnection(ctx: AdapterContext): Promise<ConnectionTestResult> {
      assertNotAborted(ctx);
      const startedAt = ctx.clock.now().getTime();
      const checks: ConnectionTestCheck[] = [];

      // 1 — Credential. None is needed: the sync client already authenticated.
      checks.push({
        name: 'Credential resolves',
        outcome: 'SKIP',
        detail:
          'No credential is used. Microsoft authentication and file transfer are performed by ' +
          'the OneDrive synchronization client, not by Knowzy.',
      });

      // A declared-unavailable capability reports SKIP, never PASS (rule P3).
      checks.push({
        name: 'Live search',
        outcome: 'SKIP',
        detail:
          'This source does not support live search. Search runs over text Knowzy has already ' +
          'extracted, so a document added since the last synchronization is not yet findable.',
      });

      let config: FileRepositoryConnection | null = null;
      let tree: DirectoryTree | null = null;
      try {
        const loaded = treeOf(ctx);
        config = loaded.config;
        tree = loaded.tree;
        // 2 — Source reachable.
        checks.push({
          name: 'Source reachable',
          outcome: 'PASS',
          detail: `The synchronized root is readable and holds ${tree.documents.length} candidate document(s).`,
        });
      } catch (error) {
        checks.push({
          name: 'Source reachable',
          outcome: 'FAIL',
          detail:
            error instanceof TreeRootError || error instanceof DelegatedAccessNotSupportedError
              ? error.message
              : 'The synchronized root could not be read.',
        });
      }

      if (tree !== null && config !== null) {
        // 3 — Containers.
        const containers = new Set(
          tree.documents.map((document) => document.containerId).filter((id) => id !== ''),
        );
        checks.push({
          name: 'Container resolves',
          outcome: 'PASS',
          detail:
            containers.size === 0
              ? 'Documents sit at the root; one implicit container is used.'
              : `${containers.size} top-level folder(s) resolved as containers.`,
        });

        // 4 — Configured paths.
        checks.push({
          name: 'Configured paths resolve',
          outcome: tree.documents.length > 0 ? 'PASS' : 'FAIL',
          detail:
            tree.documents.length > 0
              ? `${tree.documents.length} document(s) matched the configured path(s).`
              : 'The configured root and subfolder match no supported documents.',
        });

        // 5 — Document types. The check that earns its place: it reports the
        // extractor gap at CONFIGURATION time rather than after a sync.
        const unsupported = tree.skipped.filter((skip) => skip.reason === 'UNSUPPORTED_TYPE');
        checks.push({
          name: 'Document types supported',
          outcome: tree.documents.length > 0 ? 'PASS' : 'FAIL',
          detail:
            `${tree.documents.length} document(s) have a registered extractor; ` +
            `${unsupported.length} file(s) do not and were skipped. ` +
            `Supported: ${supportedDocumentTypes.join(', ')}.`,
        });

        // 6 — Permission check. Available, and platform-enforced.
        checks.push({
          name: 'Permission check available',
          outcome: 'PASS',
          detail:
            'Access decisions are returned for every document, enforced by Knowzy rather than ' +
            'by SharePoint. Per-user SharePoint trimming is NOT available for this source.',
        });

        // 7 — Delegated access. Declared unsupported, so never claimed to pass.
        checks.push({
          name: 'Delegated access available',
          outcome: 'SKIP',
          detail:
            'Not supported by a file-repository source. DELEGATED_OBO is refused at ' +
            'configuration time rather than approximated.',
        });

        // 8 — Change detection.
        checks.push({
          name: 'Change detection available',
          outcome: 'PASS',
          detail:
            'Content-hash based. No version label is available, so preflight reports content ' +
            'changes without a version.',
        });

        // 9 — Write capability absent.
        checks.push({
          name: 'Write capability absent',
          outcome: 'PASS',
          detail: 'This source is read-only. The adapter exposes no write operation.',
        });

        // Reported as a check rather than buried: a placeholder-only mirror is
        // the single most likely operational failure and looks like a bug.
        const placeholders = tree.documents.filter((document) => document.isPlaceholder);
        if (placeholders.length > 0) {
          checks.push({
            name: 'Files are locally available',
            outcome: 'FAIL',
            detail:
              `${placeholders.length} of ${tree.documents.length} document(s) are cloud ` +
              'placeholders with no local content. Mark the folder "Always keep on this device".',
          });
        } else if (tree.documents.length > 0) {
          checks.push({
            name: 'Files are locally available',
            outcome: 'PASS',
            detail: 'Every matched document has local content.',
          });
        }
      }

      return {
        ok: checks.every((check) => check.outcome !== 'FAIL'),
        checks,
        durationMs: Math.max(0, ctx.clock.now().getTime() - startedAt),
        capabilities: FILE_REPOSITORY_CAPABILITIES,
      };
    },

    async listContainers(ctx: AdapterContext): Promise<readonly Container[]> {
      assertNotAborted(ctx);
      const { tree } = treeOf(ctx);
      const counts = new Map<string, number>();
      for (const document of tree.documents) {
        const id = document.containerId === '' ? '(root)' : document.containerId;
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      return [...counts.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([containerId, itemCount]) => ({
          containerId,
          containerName: containerId,
          itemCount,
        }));
    },

    async listItems(ctx: AdapterContext, query: ListItemsQuery): Promise<Page<SourceItem>> {
      assertNotAborted(ctx);
      const { tree, config } = treeOf(ctx);

      const matches = tree.documents.filter((document) => {
        // The SAME visibility rule extraction uses. A document listed but not
        // extractable would appear in the browser while being unreachable,
        // and a denied document is correctly out of scope rather than a
        // failure to report.
        if (accessFor(ctx, config, document).decision !== 'ALLOWED') return false;
        const container = document.containerId === '' ? '(root)' : document.containerId;
        if (query.containerId !== '' && container !== query.containerId) return false;
        if (query.folderPath === undefined || query.folderPath === '') return true;
        return query.recursive === true
          ? document.folderPath === query.folderPath ||
              document.folderPath.startsWith(`${query.folderPath}/`)
          : document.folderPath === query.folderPath;
      });

      const pageSize = query.pageSize ?? ctx.limits.pageSize;
      const start = query.cursor === undefined ? 0 : Number.parseInt(query.cursor, 10) || 0;
      const slice = matches.slice(start, start + pageSize);
      const next = start + pageSize;

      return {
        items: slice.map((document) => toItem(config, document)),
        ...(next < matches.length ? { nextCursor: String(next) } : {}),
        totalCount: matches.length,
      };
    },

    async searchDocuments(ctx: AdapterContext, query: SearchQuery): Promise<Page<SearchHit>> {
      assertNotAborted(ctx);
      const { tree, config } = treeOf(ctx);
      const needle = query.text.trim().toLowerCase();
      if (needle.length === 0) return { items: [], totalCount: 0 };

      const hits: SearchHit[] = [];
      for (const document of tree.documents) {
        assertNotAborted(ctx);
        if (accessFor(ctx, config, document).decision !== 'ALLOWED') continue;

        // Searched over EXTRACTED TEXT, never raw bytes. Reading a PDF as
        // UTF-8 and lowercasing it yields mojibake that would produce nonsense
        // matches and a snippet of binary garbage in the UI.
        const text = await textOf(ctx, tree, config, document);
        if (text === null) continue;
        const index = text.toLowerCase().indexOf(needle);
        if (index === -1) continue;

        hits.push({
          document: toItem(config, document),
          score: 1,
          snippet: text.slice(Math.max(0, index - 60), index + needle.length + 60).trim(),
        });
      }

      const pageSize = query.pageSize ?? ctx.limits.pageSize;
      const start = query.cursor === undefined ? 0 : Number.parseInt(query.cursor, 10) || 0;
      const slice = hits.slice(start, start + pageSize);
      const next = start + pageSize;
      return {
        items: slice,
        ...(next < hits.length ? { nextCursor: String(next) } : {}),
        totalCount: hits.length,
      };
    },

    async getDocument(ctx: AdapterContext, id: SourceDocumentId): Promise<SourceDocument | null> {
      assertNotAborted(ctx);
      try {
        const { config, document } = find(ctx, id);
        // A denied document is not visible, so it reads as absent rather than
        // as a document the caller may inspect the metadata of.
        if (accessFor(ctx, config, document).decision !== 'ALLOWED') return null;
        return toDocument(config, document);
      } catch (error) {
        if (error instanceof SourceDocumentNotFoundError) return null;
        throw error;
      }
    },

    async getEffectiveAccess(ctx: AdapterContext, id: SourceDocumentId): Promise<AccessDecision> {
      assertNotAborted(ctx);
      try {
        const { config, document } = find(ctx, id);
        return accessFor(ctx, config, document);
      } catch (error) {
        if (error instanceof SourceDocumentNotFoundError) {
          // A document this source does not have is DENIED, not UNKNOWN. An
          // unknown id is not an unanswerable question — the answer is that
          // there is nothing here to grant access to.
          return {
            decision: 'DENIED',
            enforcement: 'PLATFORM',
            summary: 'No such document exists in this source.',
          };
        }
        throw error;
      }
    },

    async extractContent(
      ctx: AdapterContext,
      id: SourceDocumentId,
      extractOptions: ExtractOptions,
    ): Promise<ExtractedContent> {
      assertNotAborted(ctx);
      const { tree, config, document } = find(ctx, id);

      // The shared refusal rule, unchanged and not weakened: extraction is
      // refused on any non-ALLOWED decision, including UNKNOWN.
      const access = accessFor(ctx, config, document);
      if (access.decision !== 'ALLOWED') {
        throw new Error(`Access to document ${id} is ${access.decision}.`);
      }

      let bytes: Uint8Array;
      try {
        bytes = readTreeBytes(tree, document, config.maxFileBytes);
      } catch (error) {
        return {
          status: error instanceof TreeRootError ? 'TOO_LARGE' : 'FAILED',
          charCount: 0,
          sections: [],
          truncated: false,
          reason:
            error instanceof TreeRootError
              ? error.message
              : // This is where a cloud placeholder actually manifests: the
                // file lists at its real size and the read fails. Said in
                // terms an administrator can act on, because the fix is a
                // OneDrive setting rather than anything in Knowzy.
                'The document could not be read from the synchronized folder. If the folder uses ' +
                'Files On-Demand, mark it "Always keep on this device" and let it finish ' +
                'synchronizing.',
        };
      }

      const isBinary = !['txt', 'text', 'md', 'markdown', 'html', 'htm', 'aspx'].includes(
        document.fileType,
      );
      const result = await extractFileContent(
        {
          fileName: document.name,
          content: isBinary ? bytes : Buffer.from(bytes).toString('utf8'),
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
        // X5: the status and reason pass through unchanged, with no text. A
        // failure is never upgraded into an empty success.
        return {
          status: result.status,
          charCount: 0,
          sections: [],
          truncated: result.truncated,
          ...(result.reason === null ? {} : { reason: result.reason }),
        };
      }

      return {
        status: 'EXTRACTED',
        normalizedText: result.normalizedText,
        charCount: result.charCount,
        sections: result.sections.map((section) => ({
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
        })),
        ...(result.contentHash === null ? {} : { contentHash: result.contentHash }),
        truncated: result.truncated,
        ...(result.reason === null ? {} : { reason: result.reason }),
      };
    },

    async *synchronize(ctx: AdapterContext, request: SyncRequest): AsyncIterable<SyncEvent> {
      assertNotAborted(ctx);
      const { tree, config } = treeOf(ctx);

      // The same visibility rule browsing uses. A document discovered by sync
      // but hidden from browsing would appear in a list while being
      // unreachable.
      const visible = tree.documents.filter(
        (document) => accessFor(ctx, config, document).decision === 'ALLOWED',
      );

      const previous = parseSyncState(request.state);
      const previousCount = previous === null ? 0 : Object.keys(previous).length;
      const isIncremental = request.mode === 'INCREMENTAL' && previous !== null;

      // ── The partial-sync guard ───────────────────────────────────────────
      // A paused, throttled or mid-run sync client presents a half-populated
      // directory. A naive scan reads that as mass deletion and would retire
      // documents that still exist. A run that refuses is recoverable; a run
      // that retires half the corpus is a cleanup job.
      //
      // Applied only when the previous run was large enough for the ratio to
      // mean anything, so a genuinely tiny corpus is not permanently stuck.
      if (previous !== null && previousCount >= 4) {
        const floor = Math.floor(previousCount * config.partialSyncFloor);
        if (visible.length < floor) {
          yield {
            type: 'ITEM_FAILED',
            sourceDocumentId: '(run)',
            reason:
              `The scan found ${visible.length} document(s), below the safety floor of ${floor} ` +
              `(previous run: ${previousCount}). The synchronized folder may be ` +
              'mid-synchronization or unavailable. No deletions were applied.',
            retryable: true,
          };
          yield { type: 'RUN_COMPLETED', discovered: 0, modified: 0, deleted: 0, failed: 1 };
          return;
        }
      }

      const signatures: Record<string, string> = {};
      let discovered = 0;
      let modified = 0;
      let failed = 0;
      let seenInPage = 0;

      for (const document of visible) {
        assertNotAborted(ctx);

        let signature: string;
        try {
          signature = signatureOf(
            hashTreeBytes(readTreeBytes(tree, document, config.maxFileBytes)),
            document.sourceVersion,
          );
        } catch (error) {
          failed += 1;
          yield {
            type: 'ITEM_FAILED',
            sourceDocumentId: document.sourceDocumentId,
            reason:
              error instanceof TreeRootError
                ? error.message
                : 'The document could not be read during synchronization. If the folder uses ' +
                  'Files On-Demand, mark it "Always keep on this device".',
            // Per-file isolation: one unreadable file must not fail the run.
            retryable: true,
          };
          continue;
        }

        signatures[document.sourceDocumentId] = signature;
        const previousSignature = previous?.[document.sourceDocumentId];

        if (previousSignature === undefined) {
          discovered += 1;
          yield { type: 'ITEM_DISCOVERED', item: toDocument(config, document) };
        } else if (previousSignature !== signature) {
          // The SIGNATURE decides, never `mtime`. A touch, copy or re-sync
          // moves `mtime` without changing content, and treating that as a
          // change would trigger mass re-extraction and regeneration
          // candidacy across the whole corpus.
          modified += 1;
          yield { type: 'ITEM_MODIFIED', item: toDocument(config, document) };
        } else if (!isIncremental) {
          // A FULL run re-reports an unchanged document so the platform can
          // reconcile its own record; an INCREMENTAL run stays silent, which
          // is what reporting unchanged documents correctly means here.
          discovered += 1;
          yield { type: 'ITEM_DISCOVERED', item: toDocument(config, document) };
        }

        seenInPage += 1;
        if (seenInPage >= ctx.limits.pageSize) {
          yield { type: 'PAGE_COMPLETED', itemsSeen: seenInPage };
          seenInPage = 0;
        }
      }

      if (seenInPage > 0) yield { type: 'PAGE_COMPLETED', itemsSeen: seenInPage };

      // Deletions, only because the guard above allowed the run to proceed.
      let deleted = 0;
      if (previous !== null) {
        for (const sourceDocumentId of Object.keys(previous)) {
          if (signatures[sourceDocumentId] === undefined) {
            deleted += 1;
            yield { type: 'ITEM_DELETED', sourceDocumentId };
          }
        }
      }

      yield { type: 'STATE_CHECKPOINT', state: JSON.stringify(signatures) };
      yield { type: 'RUN_COMPLETED', discovered, modified, deleted, failed };
    },
  };
};
