// The extraction entry point.
//
// Enforces the outcome rules in knowledge-source-adapters.md §2.4:
//
//   X5  an unsupported or unextractable document returns a status and a reason
//       and NO TEXT. Returning empty text with a success status is prohibited,
//       because it is indistinguishable from a legitimately empty document and
//       would silently produce a zero-coverage source nobody investigates.
//   X6  truncation is reported, never silent.
//   X7  contentHash is SHA-256 of the normalized text.
//   X8  deterministic.
//
// architecture.md §8.4 also requires that unsupported binaries never reach
// Claude. That holds here by construction: there is no path through this
// function that returns bytes, and a type without a registered extractor
// returns UNSUPPORTED before anything is parsed.

import type { DocumentType, ExtractionStatus } from '@knowzy/shared-types';
import { sectionize, type Section, type SectionizeOptions } from './sectionize.js';
import type { StructuredDocument } from './structure.js';
import { extractHtml } from './extractors/html.js';
import { extractMarkdown, extractPlainText } from './extractors/text.js';

export interface ExtractedContent {
  readonly status: ExtractionStatus;
  /** Present only when status is EXTRACTED. */
  readonly normalizedText: string | null;
  readonly charCount: number;
  readonly sections: readonly Section[];
  readonly contentHash: string | null;
  readonly truncated: boolean;
  /** Why, when the status is not EXTRACTED. Safe for an administrator. */
  readonly reason: string | null;
  readonly documentType: DocumentType | null;
}

export interface ExtractInput {
  /** File name or path, used to choose an extractor. */
  readonly fileName: string;
  /** Decoded text. Binary formats are not supported yet (see below). */
  readonly content: string;
  readonly sizeBytes?: number;
}

export interface ExtractOptions extends SectionizeOptions {
  /** Size cap applied BEFORE parsing (source.maxDocumentBytes). */
  readonly maxBytes?: number;
}

type ExtractorFn = (raw: string) => StructuredDocument;

/**
 * Registered text extractors.
 *
 * PDF, DOCX, PPTX, XLSX, and SharePoint pages are declared in
 * architecture.md §8.4 and are NOT registered here yet: each needs a binary
 * parser, and every one of them must still satisfy X2 (offsets round-trip).
 * They are additive — a new entry in this map plus a conformance fixture — and
 * a document of an unregistered type returns UNSUPPORTED with a reason rather
 * than being silently skipped.
 */
const EXTRACTORS: ReadonlyMap<string, ExtractorFn> = new Map<string, ExtractorFn>([
  ['txt', extractPlainText],
  ['text', extractPlainText],
  ['md', extractMarkdown],
  ['markdown', extractMarkdown],
  ['html', extractHtml],
  ['htm', extractHtml],
  ['aspx', extractHtml],
]);

export const SUPPORTED_EXTENSIONS: readonly string[] = [...EXTRACTORS.keys()];

/** Types a registered extractor can currently handle. */
export const supportedDocumentTypes: readonly DocumentType[] = ['TXT', 'HTML'];

export const fileExtension = (fileName: string): string => {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase();
};

const failure = (status: ExtractionStatus, reason: string): ExtractedContent => ({
  status,
  // X5: no text, ever, on a non-success outcome.
  normalizedText: null,
  charCount: 0,
  sections: [],
  contentHash: null,
  truncated: false,
  reason,
  documentType: null,
});

export const extractContent = (
  input: ExtractInput,
  options: ExtractOptions = {},
): ExtractedContent => {
  const extension = fileExtension(input.fileName);
  const extractor = EXTRACTORS.get(extension);

  if (!extractor) {
    return failure(
      'UNSUPPORTED',
      extension.length === 0
        ? 'The file has no extension, so no extractor could be selected.'
        : `File type ".${extension}" is not supported for extraction.`,
    );
  }

  const sizeBytes = input.sizeBytes ?? Buffer.byteLength(input.content, 'utf8');
  if (options.maxBytes !== undefined && sizeBytes > options.maxBytes) {
    return failure(
      'TOO_LARGE',
      `The document is ${sizeBytes} bytes, above the ${options.maxBytes}-byte limit.`,
    );
  }

  const structured = extractor(input.content);
  const result = sectionize(structured, options);

  if (result.normalizedText.length === 0) {
    // An image-only PDF lands here once that extractor exists. The distinction
    // between "no text" and "not supported" matters: the administrator action
    // differs (re-scan with OCR vs. use a different format).
    return failure(
      'EMPTY',
      'No text could be extracted. The document may contain only images or no content.',
    );
  }

  return {
    status: 'EXTRACTED',
    normalizedText: result.normalizedText,
    charCount: result.normalizedText.length,
    sections: result.sections,
    contentHash: result.contentHash,
    truncated: result.truncated,
    reason: result.truncated
      ? 'Truncated at a section boundary because the document exceeded the character cap.'
      : null,
    documentType: structured.documentType,
  };
};
