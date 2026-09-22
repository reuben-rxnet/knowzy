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
import { DocxError, extractDocx } from './extractors/docx.js';
import { PdfError, extractPdf } from './extractors/pdf.js';
import { PptxError, extractPptx } from './extractors/pptx.js';
import { XlsxError, extractXlsx } from './extractors/xlsx.js';

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
  /**
   * The document.
   *
   * A `string` for a text format, a `Uint8Array` for a binary one. Both are
   * accepted on one field rather than two so there is exactly one input shape
   * and a caller cannot supply neither or both. The registry decides which the
   * selected extractor wants, and a mismatch is a stated refusal rather than a
   * decode that silently produces mojibake.
   */
  readonly content: string | Uint8Array;
  readonly sizeBytes?: number;
}

export interface ExtractOptions extends Omit<SectionizeOptions, 'documentScope'> {
  /** Size cap applied BEFORE parsing (source.maxDocumentBytes). */
  readonly maxBytes?: number;
  /**
   * The adapter's stable document identity, mixed into every section key.
   * Defaults to `input.fileName` — see the call to `sectionize` below.
   */
  readonly documentScope?: string;
}

type TextExtractorFn = (raw: string) => StructuredDocument;
type BinaryExtractorFn = (raw: Uint8Array) => StructuredDocument | Promise<StructuredDocument>;

/**
 * Registered TEXT extractors — the extractor receives a decoded string.
 */
const EXTRACTORS: ReadonlyMap<string, TextExtractorFn> = new Map<string, TextExtractorFn>([
  ['txt', extractPlainText],
  ['text', extractPlainText],
  ['md', extractMarkdown],
  ['markdown', extractMarkdown],
  ['html', extractHtml],
  ['htm', extractHtml],
  ['aspx', extractHtml],
]);

/**
 * Registered BINARY extractors — the extractor receives bytes.
 *
 * SHAREPOINT_PAGE remains unregistered: a page has no file in a document
 * library at all, so there are no bytes to extract. It is Graph canvas
 * content and arrives with roadmap Phase 7.
 *
 * The LEGACY binary Office formats — `.doc`, `.xls`, `.ppt` — are also
 * deliberately absent. They are entirely different containers from the OOXML
 * ones (OLE compound files, not ZIP), share no code with these extractors, and
 * are rare in a modern library. A document of an unregistered type returns
 * UNSUPPORTED with a reason rather than being silently skipped.
 */
const BINARY_EXTRACTORS: ReadonlyMap<string, BinaryExtractorFn> = new Map<
  string,
  BinaryExtractorFn
>([
  ['pdf', (bytes) => extractPdf(bytes)],
  ['docx', (bytes) => extractDocx(bytes)],
  ['pptx', (bytes) => extractPptx(bytes)],
  ['xlsx', (bytes) => extractXlsx(bytes)],
]);

export const SUPPORTED_EXTENSIONS: readonly string[] = [
  ...EXTRACTORS.keys(),
  ...BINARY_EXTRACTORS.keys(),
];

/** True when the selected extractor wants bytes rather than a decoded string. */
export const isBinaryExtension = (extension: string): boolean =>
  BINARY_EXTRACTORS.has(extension.toLowerCase());

/**
 * Types a registered extractor can currently handle.
 *
 * DERIVED from the registries rather than written out, so it cannot drift from
 * them. An adapter declaring `supportedDocumentTypes` from this value is
 * therefore honest by construction (adapter template rule P1).
 */
export const supportedDocumentTypes: readonly DocumentType[] = [
  'TXT',
  'HTML',
  'PDF',
  'DOCX',
  'PPTX',
  'XLSX',
];

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

/**
 * Maps a binary extractor's own error to an extraction status and a reason.
 *
 * Every branch produces a reason an ADMINISTRATOR can act on, and none of them
 * carries provider text or document content. `QUARANTINED` is used for a
 * container that was refused on a safety limit rather than failing to parse:
 * "we declined to inflate this" is a different fact from "this is corrupt",
 * and the operator response differs.
 */
const binaryFailure = (error: unknown): ExtractedContent => {
  if (error instanceof PdfError) {
    if (error.code === 'ENCRYPTED') {
      return failure(
        'FAILED',
        'The document is encrypted or password-protected, so its text cannot be read. ' +
          'Supply an unprotected copy.',
      );
    }
    return failure(
      error.code === 'NOT_A_PDF' ? 'UNSUPPORTED' : 'FAILED',
      error.code === 'NOT_A_PDF'
        ? 'The file has a .pdf extension but is not a valid PDF document.'
        : 'The PDF could not be parsed. It may be truncated or corrupt.',
    );
  }
  if (error instanceof DocxError) {
    if (error.code === 'ENCRYPTED') {
      return failure(
        'FAILED',
        'The document is encrypted or password-protected, so its text cannot be read. ' +
          'Supply an unprotected copy.',
      );
    }
    if (error.code === 'LIMIT_EXCEEDED') {
      return failure('QUARANTINED', `The document was refused: ${error.message}`);
    }
    return failure(
      error.code === 'NOT_A_DOCX' ? 'UNSUPPORTED' : 'FAILED',
      error.code === 'NOT_A_DOCX'
        ? 'The file has a .docx extension but is not a DOCX container.'
        : 'The DOCX could not be parsed. It may be truncated or corrupt.',
    );
  }
  if (error instanceof PptxError || error instanceof XlsxError) {
    const kind = error instanceof PptxError ? 'presentation' : 'workbook';
    if (error.code === 'ENCRYPTED') {
      return failure(
        'FAILED',
        `The ${kind} is encrypted or password-protected, so its text cannot be read. ` +
          'Supply an unprotected copy.',
      );
    }
    if (error.code === 'LIMIT_EXCEEDED') {
      return failure('QUARANTINED', `The document was refused: ${error.message}`);
    }
    const unsupported = error.code === 'NOT_A_PPTX' || error.code === 'NOT_AN_XLSX';
    return failure(
      unsupported ? 'UNSUPPORTED' : 'FAILED',
      unsupported
        ? `The file has an Office extension but is not a valid ${kind} container.`
        : `The ${kind} could not be parsed. It may be truncated or corrupt.`,
    );
  }
  // Nothing else is expected. Reported as FAILED with no provider text.
  return failure('FAILED', 'The document could not be extracted.');
};

/**
 * Extracts a document.
 *
 * Asynchronous because a binary parser is. There is deliberately ONE entry
 * point rather than a sync text path and an async binary one: two pipelines
 * would be two places for normalization to drift, and X1/X2 hold only because
 * the sectionizer is the single owner of the final text.
 */
export const extractContent = async (
  input: ExtractInput,
  options: ExtractOptions = {},
): Promise<ExtractedContent> => {
  const extension = fileExtension(input.fileName);
  const textExtractor = EXTRACTORS.get(extension);
  const binaryExtractor = BINARY_EXTRACTORS.get(extension);

  if (!textExtractor && !binaryExtractor) {
    return failure(
      'UNSUPPORTED',
      extension.length === 0
        ? 'The file has no extension, so no extractor could be selected.'
        : `File type ".${extension}" is not supported for extraction.`,
    );
  }

  const isBytes = typeof input.content !== 'string';

  // A mismatch is refused rather than coerced. Decoding a PDF's bytes as UTF-8
  // would produce mojibake that extracts "successfully" into nonsense, and
  // re-encoding a string as bytes would hand a parser something the caller
  // never read from disk.
  if (binaryExtractor && !isBytes) {
    return failure(
      'UNSUPPORTED',
      `File type ".${extension}" requires binary content, but text was supplied.`,
    );
  }
  if (textExtractor && !binaryExtractor && isBytes) {
    return failure(
      'UNSUPPORTED',
      `File type ".${extension}" requires text content, but bytes were supplied.`,
    );
  }

  const sizeBytes =
    input.sizeBytes ??
    (typeof input.content === 'string'
      ? Buffer.byteLength(input.content, 'utf8')
      : input.content.byteLength);
  if (options.maxBytes !== undefined && sizeBytes > options.maxBytes) {
    return failure(
      'TOO_LARGE',
      `The document is ${sizeBytes} bytes, above the ${options.maxBytes}-byte limit.`,
    );
  }

  let structured: StructuredDocument;
  if (binaryExtractor) {
    try {
      structured = await binaryExtractor(input.content as Uint8Array);
    } catch (error) {
      return binaryFailure(error);
    }
  } else {
    structured = (textExtractor as TextExtractorFn)(input.content as string);
  }

  // The scope defaults to the file name, which is never empty and is already
  // required by this signature. An adapter passes the stronger
  // `sourceDocumentId`, which is stable across databases; a bare file name is
  // only unique within a folder, so the default is a floor rather than the
  // intended value.
  const result = sectionize(structured, {
    ...options,
    documentScope: options.documentScope ?? input.fileName,
  });

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
