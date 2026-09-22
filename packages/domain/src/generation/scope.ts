// ResolvedGenerationScope — generation-governance.md §1.1 and §7.
//
// The "structural guarantee" the document promises:
//
//   "GenerationService.run() accepts a ResolvedGenerationScope value object
//    that can only be constructed from an explicit, non-empty document ID list
//    plus a scope selector. The service has no injected adapter capable of
//    listing documents, so 'generate from everything' is not expressible in the
//    type system, not merely discouraged by policy."
//
// That is implemented literally here. The branded type cannot be produced by an
// object literal, so the only way to obtain one is `resolveGenerationScope`,
// which rejects an empty list. A caller cannot write
// `run({ documentIds: [] })` and have it typecheck.

import type { GenerationScope } from '@knowzy/shared-types';

/**
 * A phantom brand. It exists in the TYPE only — `declare` means there is no
 * runtime symbol — so the one place that produces a ResolvedGenerationScope
 * asserts the type rather than assigning the key.
 */
declare const scopeBrand: unique symbol;

export interface ScopedSection {
  readonly sectionId: string;
  readonly sectionKey: string;
  /**
   * The pre-0004 unscoped key, or null for a section extracted since.
   *
   * Questions published before migration 0004 carry v1 keys and CANNOT be
   * rewritten: a trigger enforces I15, and rewriting a published question's
   * lineage would change what the platform claims was published. So coverage
   * matches on either key rather than pretending the old ones do not exist.
   */
  readonly sectionKeyV1: string | null;
  readonly documentId: string;
  readonly ordinal: number;
  readonly label: string;
  readonly text: string;
  /** SHA-256 of the section text. The per-section revalidation comparator. */
  readonly sectionContentHash: string;
  /** Offset into the document's normalized text — keeps the span re-locatable. */
  readonly startOffset: number;
  readonly assessableCharCount: number;
}

export interface ScopedDocument {
  readonly documentId: string;
  readonly sourceDocumentId: string;
  readonly name: string;
  readonly sourceUrl: string;
  readonly folderPath: string | null;
  readonly containerName: string | null;
  readonly sourceVersion: string;
  readonly sourceETag: string | null;
  readonly contentHash: string;
  readonly localVersionCounter: number;
}

interface ScopeBrand {
  readonly [scopeBrand]: true;
}

export interface ScopeData {
  readonly scope: GenerationScope;
  /** 1-10 documents. Never empty, guaranteed by construction. */
  readonly documents: readonly ScopedDocument[];
  /** The pinned, ordered section list — the reproducible input to a run. */
  readonly sections: readonly ScopedSection[];
  readonly objectiveIds: readonly string[];
}

/**
 * The branded type. `ScopeBrand` is required and has no runtime representation,
 * so an object literal written anywhere else is not assignable — only
 * `resolveGenerationScope` can produce one.
 */
export type ResolvedGenerationScope = ScopeData & ScopeBrand;

export const MAX_DOCUMENTS_PER_JOB = 10;

export class GenerationSelectionRequiredError extends Error {
  readonly code = 'GENERATION_SELECTION_REQUIRED';
  constructor(detail: string) {
    super(detail);
    this.name = 'GenerationSelectionRequiredError';
  }
}

export class GenerationScopeEmptyError extends Error {
  readonly code = 'GENERATION_SCOPE_EMPTY';
  constructor(reason: string) {
    // The REASON matters: "all sections already covered" is a different
    // situation from "no assessable sections", and the author acts differently.
    super(reason);
    this.name = 'GenerationScopeEmptyError';
  }
}

export interface ResolveScopeArgs {
  readonly scope: GenerationScope;
  readonly documents: readonly ScopedDocument[];
  readonly sections: readonly ScopedSection[];
  readonly objectiveIds?: readonly string[];
}

/**
 * The only constructor for a ResolvedGenerationScope.
 *
 * Note what it does NOT accept: anything that could stand for "all documents" —
 * no wildcard, no path, no container. §1.1 rejects those with
 * GENERATION_SELECTION_REQUIRED, and here they are simply not parameters.
 */
export const resolveGenerationScope = (args: ResolveScopeArgs): ResolvedGenerationScope => {
  if (args.documents.length === 0) {
    throw new GenerationSelectionRequiredError(
      'Generation requires an explicit, non-empty document selection. There is no "all documents" option.',
    );
  }
  if (args.documents.length > MAX_DOCUMENTS_PER_JOB) {
    throw new GenerationSelectionRequiredError(
      `A job may span at most ${MAX_DOCUMENTS_PER_JOB} documents; ${args.documents.length} were selected.`,
    );
  }

  const documentIds = new Set(args.documents.map((document) => document.documentId));
  const stray = args.sections.filter((section) => !documentIds.has(section.documentId));
  if (stray.length > 0) {
    // A section from an unselected document would widen retrieval past the
    // author's choice, which is the thing §1.1 exists to prevent.
    throw new GenerationSelectionRequiredError(
      `${stray.length} resolved section(s) belong to documents that were not selected.`,
    );
  }

  if (args.sections.length === 0) {
    throw new GenerationScopeEmptyError(
      args.scope === 'UNCOVERED_SECTIONS_ONLY'
        ? 'No uncovered sections remain: every assessable section of the selected documents is already covered.'
        : args.scope === 'MODIFIED_SECTIONS_ONLY'
          ? 'No sections have changed since the last generation for these documents.'
          : 'The selected documents contain no assessable sections.',
    );
  }

  const data: ScopeData = {
    scope: args.scope,
    documents: args.documents,
    // Ordered by document then section ordinal, so the pinned list is
    // reproducible rather than dependent on query order.
    sections: [...args.sections].sort(
      (a, b) => a.documentId.localeCompare(b.documentId) || a.ordinal - b.ordinal,
    ),
    objectiveIds: args.objectiveIds ?? [],
  };

  // The ONE cast in the module, and the reason the brand works: it sits behind
  // the checks above, so obtaining the branded type and passing those checks
  // are the same act.
  return data as ResolvedGenerationScope;
};

export const scopeSectionKeys = (scope: ResolvedGenerationScope): readonly string[] =>
  scope.sections.map((section) => section.sectionKey);
