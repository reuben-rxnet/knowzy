// PDF → Blocks, via pdf.js.
//
// pdf.js is used rather than hand-written parsing because correct PDF text
// extraction needs cross-reference tables, object streams, font encodings and
// ToUnicode CMaps. A partial implementation would silently return mojibake for
// any document with a subset font, and mojibake that passes evidence
// verification is worse than a refusal.
//
// Configured for EXTRACTION, not rendering, and deliberately locked down:
//
//   no eval                   earlier pdf.js could build glyph mappers with
//                             `eval` and exposed `isEvalSupported` to refuse it.
//                             Version 6 removed that path entirely, so the
//                             option no longer exists — nothing to disable.
//   useSystemFonts: false     no filesystem font probing from document content.
//   no worker                 one process, no worker script to resolve.
//   no canvas                 nothing is rendered, so no native dependency.
//   password: never supplied  an encrypted PDF is REFUSED, not guessed at.
//
// As with every extractor: no offsets are computed here. Blocks only.
// The sectionizer owns the final text (structure.ts).

import type * as PdfJs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { DocumentType } from '@knowzy/shared-types';
import { textBlock, type Block, type StructuredDocument } from '../structure.js';

export class PdfError extends Error {
  constructor(
    readonly code: 'NOT_A_PDF' | 'ENCRYPTED' | 'MALFORMED',
    message: string,
  ) {
    super(message);
    this.name = 'PdfError';
  }
}

/** Minimal shapes from pdf.js, declared locally so its types are not a dependency. */
interface TextItem {
  readonly str?: string;
  /** Present on a text item; absent on a marked-content item. */
  readonly transform?: readonly number[];
  readonly hasEOL?: boolean;
}

interface PdfPage {
  getTextContent(): Promise<{ readonly items: readonly unknown[] }>;
}

interface PdfDocument {
  readonly numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
}

/**
 * The loading task owns `destroy()`, not the document proxy.
 *
 * Calling `destroy()` on the proxy throws `TypeError: document.destroy is not
 * a function` in pdf.js 6 — and because that happened in a `finally`, it
 * discarded text that had already been extracted successfully. The task is
 * therefore held and destroyed instead.
 */
interface PdfLoadingTask {
  readonly promise: Promise<unknown>;
  destroy(): Promise<void>;
}

/**
 * Loaded lazily and cached.
 *
 * pdf.js is a large ESM module; importing it at module load would cost every
 * consumer of this package — including the many tests that only touch text
 * extraction — for a format most of them never use.
 */
let pdfjsPromise: Promise<typeof PdfJs> | null = null;
const loadPdfjs = (): Promise<typeof PdfJs> => {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
};

const isTextItem = (item: unknown): item is TextItem =>
  typeof item === 'object' && item !== null && typeof (item as TextItem).str === 'string';

/**
 * Groups a page's text items into lines using their baseline y coordinate.
 *
 * pdf.js returns items in content-stream order, which for a well-formed
 * document is reading order. It does not tell you where lines end, so items
 * are grouped by baseline: `transform[5]` is the y translation. Without this a
 * page arrives as one unbroken string and the sectionizer's fallback windows
 * split mid-sentence, which then truncates evidence spans.
 *
 * Two-column layouts are NOT reconstructed. That is a recorded limitation: a
 * two-column PDF yields interleaved lines, and the honest consequence is that
 * its sentences do not parse as rules and the section reports insufficient
 * evidence rather than producing a wrong question.
 */
const linesFrom = (items: readonly unknown[]): string[] => {
  const lines: string[] = [];
  let current = '';
  let currentY: number | null = null;

  for (const raw of items) {
    if (!isTextItem(raw)) continue;
    const text = raw.str ?? '';
    const y = raw.transform?.[5];

    if (typeof y === 'number' && currentY !== null && Math.abs(y - currentY) > 1) {
      if (current.trim().length > 0) lines.push(current.trim());
      current = '';
    }
    if (typeof y === 'number') currentY = y;

    current += text;

    if (raw.hasEOL === true) {
      if (current.trim().length > 0) lines.push(current.trim());
      current = '';
    }
  }
  if (current.trim().length > 0) lines.push(current.trim());
  return lines;
};

export interface PdfOptions {
  /** Upper bound on pages read. A 4,000-page manual is not a knowledge source. */
  readonly maxPages?: number;
}

const DEFAULT_MAX_PAGES = 500;

/**
 * Reads every page's text, emitting one block per page with its page number.
 *
 * No heading structure: a PDF carries visual emphasis, not semantic headings,
 * and promoting a large-font line to a heading would be inventing structure —
 * which X4 forbids. `hasHeadingStructure: false` sends the sectionizer to its
 * labelled-window fallback, and a section is honestly called "Segment 3 of 14".
 */
export const extractPdf = async (
  bytes: Uint8Array,
  options: PdfOptions = {},
): Promise<StructuredDocument> => {
  const pdfjs = await loadPdfjs();

  // A copy, because pdf.js transfers ownership of the buffer it is given and
  // the caller may still hold the original (the adapter hashes it).
  const data = new Uint8Array(bytes.length);
  data.set(bytes);

  const task = pdfjs.getDocument({
    data,
    useSystemFonts: false,
    useWorkerFetch: false,
    disableFontFace: true,
    // Deliberately no `password`. An encrypted document must fail.
  }) as unknown as PdfLoadingTask;

  let document: PdfDocument;
  try {
    document = (await task.promise) as PdfDocument;
  } catch (error) {
    await task.destroy().catch(() => undefined);
    const name = (error as { name?: string }).name;
    if (name === 'PasswordException') {
      throw new PdfError('ENCRYPTED', 'The document is encrypted or password-protected.');
    }
    if (name === 'InvalidPDFException') {
      throw new PdfError('NOT_A_PDF', 'The file is not a valid PDF document.');
    }
    throw new PdfError('MALFORMED', 'The PDF could not be parsed.');
  }

  try {
    const pageCount = Math.min(document.numPages, options.maxPages ?? DEFAULT_MAX_PAGES);
    const blocks: Block[] = [];

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const lines = linesFrom(content.items);
      if (lines.length === 0) continue;
      // One block per page, carrying the page number so a section can cite it.
      blocks.push(textBlock(lines.join('\n'), { pageNumber }));
    }

    return {
      documentType: 'PDF' as DocumentType,
      blocks,
      hasHeadingStructure: false,
    };
  } catch (error) {
    // A page that cannot be read is a real failure and is reported as one. It
    // must not fall through as an unexpected error, because the caller would
    // then report a generic reason an administrator cannot act on.
    if (error instanceof PdfError) throw error;
    throw new PdfError('MALFORMED', 'A page of the PDF could not be read.');
  } finally {
    // Releases pdf.js's internal caches. Without it a long synchronization run
    // retains every parsed document.
    await task.destroy().catch(() => undefined);
  }
};
