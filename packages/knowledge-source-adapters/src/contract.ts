// The KnowledgeSourceAdapter port — knowledge-source-adapters.md §2.
//
// Goal G8 holds only if this contract is narrow enough that a non-SharePoint
// source can satisfy it. So the vocabulary here is deliberately generic:
// `container`, not site or drive or space; `sourceVersion`, not eTag; an
// effective access DECISION, not an ACL. Graph field names live in the
// SharePoint adapter and nowhere else.

import type { DocumentType, ExtractionStatus, SourceType, SyncMode } from '@knowzy/shared-types';
import type { Clock } from '@knowzy/observability';

export type SourceDocumentId = string;

/**
 * Adapter-port vocabulary, defined HERE and not in @knowzy/shared-types.
 *
 * B3 keeps @knowzy/domain from reaching adapter vocabulary; putting this in
 * shared-types would hand it to the domain through the back door. UNKNOWN is a
 * first-class outcome, not an error: a source that cannot answer the question
 * must say so rather than have the platform assume either answer.
 */
export type AccessDecisionOutcome = 'ALLOWED' | 'DENIED' | 'UNKNOWN';

/**
 * Declared capabilities — §2.2.
 *
 * The honesty rule is the point: a capability a source lacks is `false` and the
 * UI states the consequence. It is never emulated with a guess, because a
 * guessed permission decision or a guessed version label is worse than a stated
 * unknown.
 */
export interface AdapterCapabilities {
  /** false → a flat source; the tree renders one level. */
  readonly supportsContainers: boolean;
  readonly supportsFolderHierarchy: boolean;
  /** false → indexed search only, labelled as such in the UI. */
  readonly supportsLiveSearch: boolean;
  readonly supportsFullTextSearch: boolean;
  /** false → every sync is FULL, and the sync screen says so. */
  readonly supportsIncrementalSync: boolean;
  /** false → getEffectiveAccess returns UNKNOWN, never ALLOWED. */
  readonly supportsPermissionCheck: boolean;
  /** false → DELEGATED_OBO is rejected at configuration time. */
  readonly supportsDelegatedAccess: boolean;
  /** false → change detection relies on contentHash alone. */
  readonly supportsVersionLabels: boolean;
  readonly supportedDocumentTypes: readonly DocumentType[];
  /**
   * The literal `false`, so a write-capable knowledge adapter cannot be
   * written. Writing is QuestionBankAdapter's job, with its own credential and
   * its own permission grant — which is what makes "knowledge documents are
   * read-only to the platform" structural rather than conventional.
   */
  readonly writeCapable: false;
}

/** Opaque credential. `resolve` returns a short-lived token, never a secret. */
export interface CredentialHandle {
  readonly kind: string;
  resolve(scope: string): Promise<string>;
}

export interface KnowledgeSourcePathConfig {
  readonly containerId: string;
  readonly folderPath?: string;
  readonly recursive: boolean;
  /** Extensions to include; empty means every supported type. */
  readonly includeFileTypes?: readonly string[];
}

export interface KnowledgeSourceConfig {
  readonly knowledgeSourceId: string;
  readonly sourceKey: string;
  readonly displayName: string;
  readonly sourceType: SourceType;
  /** Adapter-specific connection settings. Secrets are NOT resolved here. */
  readonly connection: Readonly<Record<string, unknown>>;
}

/**
 * Everything the adapter needs, and nothing it does not — §2.1.
 *
 * Notably absent: any database handle. An adapter receives configuration and
 * returns data; the MCP layer persists. That is what keeps adapters pure,
 * testable without a tenant, and unable to corrupt platform state.
 */
export interface AdapterContext {
  readonly source: KnowledgeSourceConfig;
  readonly paths: readonly KnowledgeSourcePathConfig[];
  readonly credential: CredentialHandle;
  readonly permissionMode: 'DELEGATED_OBO' | 'APP_ONLY_SITES_SELECTED';
  readonly onBehalfOf?: { readonly principalId: string };
  readonly correlationId: string;
  readonly limits: {
    readonly maxBytes: number;
    readonly maxCharsPerDocument: number;
    readonly pageSize: number;
  };
  readonly clock: Clock;
  /** Honours the calling tool's declared timeout. Every method must observe it. */
  readonly signal: AbortSignal;
}

export interface Container {
  readonly containerId: string;
  readonly containerName: string;
  readonly itemCount?: number;
}

export interface SourceItem {
  readonly kind: 'FOLDER' | 'DOCUMENT';
  readonly sourceDocumentId?: SourceDocumentId;
  readonly name: string;
  readonly folderPath: string;
  readonly fileType?: string;
  readonly sizeBytes?: number;
  readonly sourceModifiedAt?: Date;
  readonly sourceVersion?: string;
  readonly webUrl?: string;
}

export interface SourceDocument extends SourceItem {
  readonly kind: 'DOCUMENT';
  readonly sourceDocumentId: SourceDocumentId;
  readonly sourceCreatedAt: Date;
  readonly mimeType: string;
  /** Only the columns the source configuration asked for. */
  readonly sourceMetadata: Readonly<Record<string, string>>;
  readonly containerSiteName?: string;
  readonly containerSiteId?: string;
}

export interface AccessDecision {
  readonly decision: AccessDecisionOutcome;
  readonly enforcement: 'SOURCE' | 'PLATFORM' | 'NONE';
  readonly callerRole?: string;
  readonly summary?: string;
}

export interface ExtractedSection {
  readonly ordinal: number;
  readonly sectionKey: string;
  readonly heading?: string;
  readonly headingPath?: string;
  readonly pageNumber?: number;
  readonly slideNumber?: number;
  readonly sheetName?: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly sectionContentHash: string;
  readonly text: string;
  readonly isAssessable: boolean;
  readonly nonAssessableReason?: string;
  /** Honest display label; "Segment 3 of 14" when there is no heading (X4). */
  readonly label: string;
}

export interface ExtractedContent {
  readonly status: ExtractionStatus;
  /** Absent unless status is EXTRACTED (X5). */
  readonly normalizedText?: string;
  readonly charCount: number;
  readonly sections: readonly ExtractedSection[];
  readonly contentHash?: string;
  readonly truncated: boolean;
  readonly reason?: string;
}

export interface ExtractOptions {
  readonly maxChars?: number;
  readonly minAssessableChars?: number;
}

export interface Page<T> {
  readonly items: readonly T[];
  /** Opaque; the platform passes it back verbatim. */
  readonly nextCursor?: string;
  readonly totalCount?: number;
}

export interface ListItemsQuery {
  readonly containerId: string;
  readonly folderPath?: string;
  readonly recursive?: boolean;
  readonly cursor?: string;
  readonly pageSize?: number;
}

export interface SearchQuery {
  readonly text: string;
  readonly containerId?: string;
  readonly cursor?: string;
  readonly pageSize?: number;
}

export interface SearchHit {
  readonly document: SourceItem;
  readonly score: number;
  /** Where the match was found. Never the whole document. */
  readonly snippet?: string;
}

export interface ConnectionTestCheck {
  readonly name: string;
  readonly outcome: 'PASS' | 'FAIL' | 'SKIP';
  /** Actionable for an administrator; never a raw provider error. */
  readonly detail: string;
}

export interface ConnectionTestResult {
  readonly ok: boolean;
  readonly checks: readonly ConnectionTestCheck[];
  readonly durationMs: number;
  readonly capabilities: AdapterCapabilities;
}

export interface SyncRequest {
  readonly mode: SyncMode;
  /** Opaque adapter state from the last run's STATE_CHECKPOINT. */
  readonly state?: string;
}

export type SyncEvent =
  | { readonly type: 'ITEM_DISCOVERED'; readonly item: SourceDocument }
  | { readonly type: 'ITEM_MODIFIED'; readonly item: SourceDocument }
  | { readonly type: 'ITEM_DELETED'; readonly sourceDocumentId: SourceDocumentId }
  | {
      readonly type: 'ITEM_FAILED';
      readonly sourceDocumentId: SourceDocumentId;
      readonly reason: string;
      readonly retryable: boolean;
    }
  | { readonly type: 'PAGE_COMPLETED'; readonly itemsSeen: number }
  /** Opaque state the platform persists and replays on the next run. */
  | { readonly type: 'STATE_CHECKPOINT'; readonly state: string }
  | {
      readonly type: 'RUN_COMPLETED';
      readonly discovered: number;
      readonly modified: number;
      readonly deleted: number;
      readonly failed: number;
    };

export interface KnowledgeSourceAdapter {
  readonly sourceType: SourceType;
  readonly capabilities: AdapterCapabilities;

  testConnection(ctx: AdapterContext): Promise<ConnectionTestResult>;

  listContainers(ctx: AdapterContext): Promise<readonly Container[]>;
  listItems(ctx: AdapterContext, query: ListItemsQuery): Promise<Page<SourceItem>>;
  searchDocuments(ctx: AdapterContext, query: SearchQuery): Promise<Page<SearchHit>>;
  getDocument(ctx: AdapterContext, id: SourceDocumentId): Promise<SourceDocument | null>;
  getEffectiveAccess(ctx: AdapterContext, id: SourceDocumentId): Promise<AccessDecision>;

  extractContent(
    ctx: AdapterContext,
    id: SourceDocumentId,
    options: ExtractOptions,
  ): Promise<ExtractedContent>;

  synchronize(ctx: AdapterContext, request: SyncRequest): AsyncIterable<SyncEvent>;
}

/** Thrown when a caller asks for a document the source does not have. */
export class SourceDocumentNotFoundError extends Error {
  constructor(public readonly sourceDocumentId: SourceDocumentId) {
    super(`No document with id ${sourceDocumentId} exists in this source.`);
    this.name = 'SourceDocumentNotFoundError';
  }
}
