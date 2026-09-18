// The QuestionBankAdapter port — knowledge-source-adapters.md §4.
//
// The second of the two independent ports. It has its own credential and its
// own permission grant, which is what makes "knowledge documents are read-only
// to the platform" a structural statement rather than a convention
// (architecture.md §8.1).
//
// It lives in @knowzy/shared-types, not in @knowzy/knowledge-source-adapters,
// because @knowzy/domain has to SPEAK this interface to publish — and B3
// forbids domain from reaching the adapter package even transitively. That rule
// is about EXTERNAL vocabulary: Graph types, SharePoint internal field names,
// drive and list identifiers. This port is deliberately none of those.
// `BankItemWrite` is keyed by the SEMANTIC keys of
// sharepoint-field-mapping.md §2, and "only SharePointQuestionBankAdapter ever
// sees a SharePoint internal name". So the port is platform vocabulary and the
// IMPLEMENTATIONS are the adapters, which is what ports and adapters means.
//
// The rule that shapes this file:
//
//   "No delete. The contract has no delete method, so governance rule G7 is
//    enforced by the type system rather than by policy."
//
// So there is no `deleteItem`, and there is no `remove`, `purge`, or `archive`
// that quietly means the same thing. Retirement sets flags on an item that
// stays in place, and the conformance suite asserts the absence.

/** A page of results. Declared here so the port needs no adapter import. */
export interface BankPage<T> {
  readonly items: readonly T[];
  /** Opaque; the platform passes it back verbatim. */
  readonly nextCursor?: string;
  readonly totalCount?: number;
}

/** Semantic keys — sharepoint-field-mapping.md §2. Never SharePoint names. */
export interface BankItemWrite {
  readonly questionId: string;
  readonly internalQuestionId: string;
  readonly questionType: string;
  readonly questionText: string;
  readonly optionA: string;
  readonly optionB: string;
  readonly optionC: string;
  readonly optionD: string;
  readonly correctAnswer: string;
  readonly explanation: string;
  readonly domain: string;
  readonly domainCode: string;
  readonly topic: string;
  readonly sourceDocumentName: string;
  readonly sourceUrl: string;
  readonly sourceDocumentId: string;
  readonly sourceSectionKey: string;
  readonly supportingEvidence: string;
  readonly sourceContentHash: string;
  readonly sourceVersion: string;
  readonly confidenceIndicator: number;
  readonly generationJobId: string | null;
  readonly claudeModel: string | null;
  readonly promptVersion: string | null;
  readonly status: string;
  readonly isActive: boolean;
  readonly isPublished: boolean;
  readonly version: number;
  readonly approvedBy: string | null;
  readonly approvalDate: string | null;
  readonly publishedBy: string | null;
  readonly publishedDate: string | null;
  readonly correlationId: string;
}

export interface BankItem {
  readonly itemId: string;
  /** Opaque; passed back verbatim as `ifMatch`. */
  readonly eTag: string;
  readonly questionId: string;
  readonly version: number;
  readonly isActive: boolean;
  readonly isPublished: boolean;
  readonly status: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

export interface BankWriteResult {
  readonly itemId: string;
  readonly eTag: string;
  readonly operationKey: string;
  /** What the write actually did, which is not always what was asked. */
  readonly outcome: 'CREATED' | 'UPDATED' | 'RETIRED' | 'ALREADY_CURRENT';
  /** Semantic keys actually written, for the audit record (G6). */
  readonly fieldsWritten: readonly string[];
}

export interface BankContext {
  readonly targetSiteId: string;
  readonly targetListId: string;
  readonly correlationId: string;
  readonly actorUserId: string;
  readonly signal: AbortSignal;
}

export interface BankQuery {
  readonly domainCode?: string;
  readonly isActive?: boolean;
  readonly cursor?: string;
  readonly pageSize?: number;
}

export interface BankCapabilities {
  /**
   * false → publishing is REFUSED for that bank. §4: "Blind overwrite is never
   * an acceptable fallback."
   */
  readonly supportsConditionalUpdate: boolean;
  readonly supportsNativeVersioning: boolean;
  readonly supportsIndexedFilter: boolean;
}

/** Thrown on a stale `ifMatch`. The caller re-reads; it never overwrites (G8). */
export class BankPreconditionFailedError extends Error {
  readonly code = 'REMOTE_PRECONDITION_FAILED';
  constructor(
    readonly itemId: string,
    readonly currentETag: string,
  ) {
    super(
      `The bank item ${itemId} changed since it was read. Re-read it and re-evaluate rather than overwriting.`,
    );
    this.name = 'BankPreconditionFailedError';
  }
}

export class BankItemNotFoundError extends Error {
  readonly code = 'QUESTIONBANK_ITEM_NOT_FOUND';
  constructor(readonly itemId: string) {
    super(`No bank item with id ${itemId}.`);
    this.name = 'BankItemNotFoundError';
  }
}

export interface QuestionBankAdapter {
  readonly bankType: string;
  readonly capabilities: BankCapabilities;

  findByQuestionId(ctx: BankContext, questionId: string): Promise<BankItem | null>;
  queryItems(ctx: BankContext, query: BankQuery): Promise<BankPage<BankItem>>;

  createItem(
    ctx: BankContext,
    item: BankItemWrite,
    operationKey: string,
  ): Promise<BankWriteResult>;

  /** `ifMatch` is required, not optional — that is the point (G8). */
  updateItem(
    ctx: BankContext,
    itemId: string,
    patch: Partial<BankItemWrite>,
    ifMatch: string,
    operationKey: string,
  ): Promise<BankWriteResult>;

  retireItem(
    ctx: BankContext,
    itemId: string,
    ifMatch: string,
    comment: string,
    operationKey: string,
  ): Promise<BankWriteResult>;

  // No deleteItem. The method does not exist (G7).
}
