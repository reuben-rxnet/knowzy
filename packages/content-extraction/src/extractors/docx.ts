// DOCX → Blocks.
//
// The extractor's whole job is stated in structure.ts: "An extractor never
// computes an offset and never sees the final text. It answers one question:
// what are the headings and paragraphs?" So this module reads
// `word/document.xml` out of the OOXML container and emits headings,
// paragraphs and table rows. Offsets, section keys, hashing, assessability and
// truncation all belong to the sectionizer and are not touched here.
//
// WHAT IS DELIBERATELY NOT READ, and why — this is the "clear policy" the
// milestone asks for, written at the code rather than in a document:
//
//   Tracked changes   an INSERTION (`w:ins`) is read, because it is content the
//                     author intends. A DELETION (`w:del` / `w:delText`) is NOT
//                     read, because it is content the author removed. Reading
//                     deleted text would generate questions from a sentence the
//                     document no longer says — which is a wrong question that
//                     passes evidence verification, the worst possible outcome.
//   Comments          not read. A comment is a conversation about the document,
//                     not the document, and it frequently contains names.
//   Headers, footers  not read. Page furniture repeats on every page and states
//                     no rule.
//   Footnotes/endnotes not read in this release. They often DO carry rules, so
//                     this is a recorded limitation rather than a judgement.
//   Hidden text       `w:vanish` runs are not read. Hidden means the author did
//                     not intend it to be seen.
//   Fields            the cached result text is read; the field instruction is
//                     not. `{ DATE }` is not a rule.
//   Macros, embedded  never touched. Only `word/document.xml` is read, so a
//   objects, OLE      `vbaProject.bin` is inert: nothing opens it, and nothing
//                     in this package can execute anything.
//
// No XML library is used. The relevant subset of WordprocessingML is a handful
// of element names, and a focused scanner is auditable in a way a general
// parser configured with entity expansion disabled is not — XXE and billion-
// laughs are simply not reachable, because entities are never expanded.

import type { DocumentType } from '@knowzy/shared-types';
import { openZip, ZipError, type ZipLimits } from '../zip.js';
import { headingBlock, textBlock, type Block, type StructuredDocument } from '../structure.js';
import { CELL_SEPARATOR, runText as ooxmlRunText, stripElements } from './ooxml.js';

export class DocxError extends Error {
  constructor(
    readonly code: 'NOT_A_DOCX' | 'ENCRYPTED' | 'MALFORMED' | 'LIMIT_EXCEEDED',
    message: string,
  ) {
    super(message);
    this.name = 'DocxError';
  }
}

const DOCUMENT_PART = 'word/document.xml';

/**
 * The visible text of one paragraph or cell, concatenated across its runs.
 *
 * Word splits a single sentence across many `w:r` elements for reasons of its
 * own — a spell-check boundary, a formatting change, an rsid. Concatenating
 * without a separator is therefore correct and necessary: inserting spaces
 * between runs would break words in the middle, and a broken word fails
 * evidence verification later for a reason nobody could diagnose.
 */
const runText = (fragment: string): string => ooxmlRunText(fragment, 'w');

/** `Heading1`..`Heading9`, `heading 1`, and the `Title` style. */
const headingLevelOf = (paragraph: string): number | null => {
  const style = /<w:pStyle\s[^>]*w:val="([^"]+)"/.exec(paragraph)?.[1];
  if (style === undefined) return null;
  if (/^title$/i.test(style)) return 1;
  const level = /^heading\s*([1-9])$/i.exec(style)?.[1];
  return level === undefined ? null : Number(level);
};

/** `<w:tbl>` … one line per row, cells joined by a separator. */
const tableBlocks = (table: string): Block[] => {
  const rows: string[] = [];
  const rowMatcher = /<w:tr(?:\s[^>]*)?>([\s\S]*?)<\/w:tr>/g;
  let row = rowMatcher.exec(table);
  while (row !== null) {
    const cells: string[] = [];
    const cellMatcher = /<w:tc(?:\s[^>]*)?>([\s\S]*?)<\/w:tc>/g;
    let cell = cellMatcher.exec(row[1] ?? '');
    while (cell !== null) {
      const value = runText(cell[1] ?? '');
      if (value.length > 0) cells.push(value);
      cell = cellMatcher.exec(row[1] ?? '');
    }
    // A separator that reads as prose, so a table row can still state a rule a
    // question can be built from. A pipe would end up quoted verbatim in an
    // evidence span and look like markup to a reviewer.
    if (cells.length > 0) rows.push(cells.join(CELL_SEPARATOR));
    row = rowMatcher.exec(table);
  }
  return rows.length === 0 ? [] : [textBlock(rows.join('\n'))];
};

export interface DocxOptions {
  readonly zipLimits?: ZipLimits;
}

/**
 * Reads `word/document.xml` and emits blocks in document order.
 *
 * Throws `DocxError` for a container that cannot be read at all; a container
 * that reads but carries no text returns zero blocks, and the caller maps that
 * to `EMPTY` rather than to a failure.
 */
export const extractDocx = (bytes: Uint8Array, options: DocxOptions = {}): StructuredDocument => {
  let documentXml: string | null;
  try {
    const zip = openZip(bytes, options.zipLimits);
    documentXml = zip.readText(DOCUMENT_PART);
  } catch (error) {
    if (error instanceof ZipError) {
      if (error.code === 'ENCRYPTED') {
        throw new DocxError('ENCRYPTED', 'The document is encrypted or password-protected.');
      }
      if (error.code === 'LIMIT_EXCEEDED') {
        throw new DocxError('LIMIT_EXCEEDED', error.message);
      }
      if (error.code === 'NOT_A_ZIP') {
        throw new DocxError('NOT_A_DOCX', 'The file is not a DOCX container.');
      }
      throw new DocxError('MALFORMED', error.message);
    }
    // A zlib failure on a corrupt deflate stream arrives here.
    throw new DocxError('MALFORMED', 'The DOCX container could not be decompressed.');
  }

  if (documentXml === null) {
    throw new DocxError('NOT_A_DOCX', `The container has no ${DOCUMENT_PART} part.`);
  }

  // Everything that must not contribute text, removed before any scanning, so
  // no later step can accidentally pick it up.
  const body = stripElements(documentXml, [
    'w:del', // tracked deletion — removed content
    'w:commentRangeStart',
    'w:commentReference',
    'w:instrText', // field instruction, not its result
    'w:hdr',
    'w:ftr',
    'w:footnoteReference',
    'w:endnoteReference',
  ]);

  const blocks: Block[] = [];
  // One pass over paragraphs and tables, in document order. `w:p` and `w:tbl`
  // are matched together so a table between two paragraphs keeps its place.
  const matcher = /<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>|<w:tbl(?:\s[^>]*)?>([\s\S]*?)<\/w:tbl>/g;
  let match = matcher.exec(body);
  while (match !== null) {
    const paragraph = match[1];
    const table = match[2];

    if (table !== undefined) {
      blocks.push(...tableBlocks(table));
    } else if (paragraph !== undefined) {
      // A run marked `w:vanish` is hidden text. Dropping the whole paragraph
      // would lose visible siblings, so only the hidden runs are removed.
      const visible = paragraph.replace(
        /<w:r(?:\s[^>]*)?>(?:(?!<\/w:r>)[\s\S])*?<w:vanish\b[^>]*\/>[\s\S]*?<\/w:r>/g,
        '',
      );
      const text = runText(visible);
      if (text.length > 0) {
        const level = headingLevelOf(paragraph);
        blocks.push(level === null ? textBlock(text) : headingBlock(level, text));
      }
    }
    match = matcher.exec(body);
  }

  return {
    documentType: 'DOCX' as DocumentType,
    blocks,
    hasHeadingStructure: blocks.some((block) => block.kind === 'heading'),
  };
};
