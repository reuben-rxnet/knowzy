// XLSX → Blocks.
//
// Sheet order and sheet NAMES come from `xl/workbook.xml` plus its
// relationships, because a sheet's name is the only thing that makes its
// content interpretable — "30" in a cell means nothing; "Production renewal
// window — 30 days" on a row of the "Certificate policy" sheet states a rule.
// The sheet name is also carried on the block, so a section can cite it.
//
// Most cell text lives in `xl/sharedStrings.xml` and is referenced by index,
// so that part is read first. A cell whose shared-string index does not
// resolve is skipped rather than rendered as its index, which would put a
// bare integer into an evidence span.
//
// WHAT IS DELIBERATELY NOT READ:
//
//   Formulas        the CACHED RESULT is read (`<v>`), never the formula
//                   (`<f>`). A question must be grounded in the value a reader
//                   sees, not in `=VLOOKUP(...)`.
//   Number formats  not applied. A date serial (45000) is read as the number
//                   it is stored as. Applying formats would need the full
//                   numFmt table and locale rules, and getting it subtly wrong
//                   produces a confidently wrong date in a question. Recorded
//                   as a limitation.
//   Hidden rows,    not distinguished in this release. Recorded limitation.
//   hidden sheets
//   Charts, pivot   not read. Macros and embedded objects are never touched:
//   caches, VBA     only workbook and worksheet parts are read.
//
// A caution worth stating where it will be read: a spreadsheet of DATA states
// no testable rule. A row of order numbers generates nothing, and honestly
// reports insufficient evidence. XLSX is worth extracting when a sheet holds a
// policy table — thresholds, owners, windows — and not otherwise.

import { createHash } from 'node:crypto';
import type {
  DocumentType,
  WorkbookGrid,
  WorkbookGridCell,
  WorkbookGridMerge,
  WorkbookGridSheet,
} from '@knowzy/shared-types';
import { openZip, ZipError, type ZipLimits } from '../zip.js';
import { textBlock, type Block, type StructuredDocument } from '../structure.js';
import { CELL_SEPARATOR, decodeEntities, relationshipTargets, stripElements } from './ooxml.js';

export class XlsxError extends Error {
  constructor(
    readonly code: 'NOT_AN_XLSX' | 'ENCRYPTED' | 'MALFORMED' | 'LIMIT_EXCEEDED',
    message: string,
  ) {
    super(message);
    this.name = 'XlsxError';
  }
}

export interface XlsxOptions {
  readonly zipLimits?: ZipLimits;
  readonly maxSheets?: number;
  /** Rows read per sheet. A 200,000-row export is data, not a document. */
  readonly maxRowsPerSheet?: number;
}

const DEFAULT_MAX_SHEETS = 64;
const DEFAULT_MAX_ROWS = 2_000;

/** `xl/sharedStrings.xml` → the string table, in index order. */
const sharedStrings = (xml: string | null): string[] => {
  if (xml === null) return [];
  const table: string[] = [];
  const itemMatcher = /<si\b(?:\s[^>]*)?>([\s\S]*?)<\/si>/g;
  let item = itemMatcher.exec(xml);
  while (item !== null) {
    // `rPh` is a phonetic hint (furigana) and is not the string's text.
    const body = stripElements(item[1] ?? '', ['rPh']);
    let text = '';
    const runMatcher = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
    let run = runMatcher.exec(body);
    while (run !== null) {
      text += decodeEntities(run[1] ?? '');
      run = runMatcher.exec(body);
    }
    table.push(text.replace(/[\t\r\n]+/g, ' ').trim());
    item = itemMatcher.exec(xml);
  }
  return table;
};

interface SheetRef {
  readonly name: string;
  readonly path: string;
  /** `state="hidden"` or `veryHidden`. Not used by `extractXlsx` (a recorded limitation). */
  readonly hidden: boolean;
}

const sheetsOf = (
  workbookXml: string | null,
  relsXml: string | null,
  present: readonly string[],
): SheetRef[] => {
  if (workbookXml !== null && relsXml !== null) {
    const targets = relationshipTargets(relsXml, 'xl/');
    const sheets: SheetRef[] = [];
    const matcher = /<sheet\b[^>]*\/>/g;
    let match = matcher.exec(workbookXml);
    while (match !== null) {
      const element = match[0];
      const name = /\bname="([^"]*)"/.exec(element)?.[1];
      const relationshipId = /\br:id="([^"]+)"/.exec(element)?.[1];
      const path = relationshipId === undefined ? undefined : targets.get(relationshipId);
      if (name !== undefined && path !== undefined && present.includes(path)) {
        const state = /\bstate="([^"]*)"/.exec(element)?.[1];
        sheets.push({
          name: decodeEntities(name),
          path,
          hidden: state === 'hidden' || state === 'veryHidden',
        });
      }
      match = matcher.exec(workbookXml);
    }
    if (sheets.length > 0) return sheets;
  }
  // Deterministic fallback: numeric part order, with no sheet name available.
  return [...present]
    .sort(
      (a, b) =>
        Number(/sheet(\d+)\.xml$/.exec(a)?.[1] ?? 0) - Number(/sheet(\d+)\.xml$/.exec(b)?.[1] ?? 0),
    )
    .map((path) => ({ name: '', path, hidden: false }));
};

/**
 * Spreadsheet column index from a cell reference: `A1` is 0, `B1` is 1, `AA1`
 * is 26.
 *
 * Needed because a spreadsheet OMITS an empty cell entirely rather than
 * writing an empty one. Reading cells in document order therefore CLOSES the
 * gap, and every value after an empty cell shifts one column to the left. A
 * reader that ignores `r` cannot tell "Difficulty was blank" from "Question is
 * in the Difficulty column", which is exactly the kind of silent mis-mapping
 * that turns an import into wrong data.
 */
const columnIndex = (reference: string): number | null => {
  const letters = /^([A-Z]+)\d+$/.exec(reference.toUpperCase())?.[1];
  if (letters === undefined) return null;
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
};

/** A cell's visible text: the shared string, the inline string, or the cached value. */
const cellText = (attributes: string, body: string, strings: readonly string[]): string => {
  const type = /\bt="([^"]+)"/.exec(attributes)?.[1];

  let value = '';
  if (type === 's') {
    // Shared-string index. An unresolvable index contributes nothing
    // rather than leaking the index itself into the text.
    const index = Number(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '');
    value = Number.isInteger(index) ? (strings[index] ?? '') : '';
  } else if (type === 'inlineStr') {
    value = decodeEntities(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/.exec(body)?.[1] ?? '');
  } else {
    // Numeric, boolean, or a formula's cached result. `<f>` is ignored.
    value = decodeEntities(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '');
  }

  return value.replace(/[\t\r\n]+/g, ' ').trim();
};

/**
 * One line per row, cells joined as prose, WITH COLUMN POSITION PRESERVED.
 *
 * A gap becomes an empty cell, so the nth value on a line is the nth column of
 * the sheet. Trailing empties are still dropped — nothing in the file marks
 * where the used range ends on a given row — so a row can be SHORTER than its
 * header, and only ever at the tail. Anything consuming this text can rely on
 * that.
 */
const sheetLines = (xml: string, strings: readonly string[], maxRows: number): string[] => {
  const lines: string[] = [];
  const rowMatcher = /<row\b(?:\s[^>]*)?>([\s\S]*?)<\/row>/g;
  let row = rowMatcher.exec(xml);
  while (row !== null && lines.length < maxRows) {
    const cells: string[] = [];
    const cellMatcher = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g;
    let cell = cellMatcher.exec(row[1] ?? '');
    while (cell !== null) {
      const attributes = cell[1] ?? cell[3] ?? '';
      const trimmed = cellText(attributes, cell[2] ?? '', strings);
      // `r` places the cell; without it the only honest choice is the next
      // position, which is what a file with no references implies anyway.
      const at = columnIndex(/\br="([^"]+)"/.exec(attributes)?.[1] ?? '') ?? cells.length;
      while (cells.length < at) cells.push('');
      if (at < cells.length) cells[at] = trimmed;
      else cells.push(trimmed);
      cell = cellMatcher.exec(row[1] ?? '');
    }
    // Trailing empties carry nothing and are dropped, so a line never ends in
    // a run of separators.
    while (cells.length > 0 && (cells[cells.length - 1] ?? '') === '') cells.pop();
    if (cells.some((value) => value.length > 0)) lines.push(cells.join(CELL_SEPARATOR));
    row = rowMatcher.exec(xml);
  }
  return lines;
};

interface OpenWorkbook {
  readonly sheets: SheetRef[];
  readonly strings: string[];
  readonly read: (name: string) => string | null;
}

/**
 * Opens the four kinds of part both readers need, and NOTHING ELSE: the
 * workbook, its relationships, the shared-string table and the worksheets.
 * Comments, threaded comments, the `persons` part, document properties and
 * custom XML name people and are never opened.
 */
const openWorkbook = (bytes: Uint8Array, zipLimits: ZipLimits | undefined): OpenWorkbook => {
  try {
    const zip = openZip(bytes, zipLimits);
    const present = zip.names.filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
    if (present.length === 0) {
      throw new XlsxError('NOT_AN_XLSX', 'The container has no worksheet parts.');
    }
    return {
      read: (name) => zip.readText(name),
      strings: sharedStrings(zip.readText('xl/sharedStrings.xml')),
      sheets: sheetsOf(
        zip.readText('xl/workbook.xml'),
        zip.readText('xl/_rels/workbook.xml.rels'),
        present,
      ),
    };
  } catch (error) {
    if (error instanceof XlsxError) throw error;
    if (error instanceof ZipError) {
      if (error.code === 'ENCRYPTED') {
        throw new XlsxError('ENCRYPTED', 'The workbook is encrypted or password-protected.');
      }
      if (error.code === 'LIMIT_EXCEEDED') throw new XlsxError('LIMIT_EXCEEDED', error.message);
      if (error.code === 'NOT_A_ZIP') {
        throw new XlsxError('NOT_AN_XLSX', 'The file is not an XLSX container.');
      }
      throw new XlsxError('MALFORMED', error.message);
    }
    throw new XlsxError('MALFORMED', 'The XLSX container could not be decompressed.');
  }
};

export const extractXlsx = (bytes: Uint8Array, options: XlsxOptions = {}): StructuredDocument => {
  const { sheets, strings, read } = openWorkbook(bytes, options.zipLimits);

  const blocks: Block[] = [];
  const limit = Math.min(sheets.length, options.maxSheets ?? DEFAULT_MAX_SHEETS);

  for (let index = 0; index < limit; index += 1) {
    const sheet = sheets[index] as SheetRef;
    let xml: string | null;
    try {
      xml = read(sheet.path);
    } catch {
      continue; // per-part isolation
    }
    if (xml === null) continue;

    const lines = sheetLines(xml, strings, options.maxRowsPerSheet ?? DEFAULT_MAX_ROWS);
    if (lines.length === 0) continue;

    blocks.push(textBlock(lines.join('\n'), sheet.name === '' ? {} : { sheetName: sheet.name }));
  }

  return {
    documentType: 'XLSX' as DocumentType,
    blocks,
    hasHeadingStructure: false,
  };
};

// ---------------------------------------------------------------------------
// readXlsxGrid — header cells as a grid, for the structure-only competency
// importer (docs/competencies/COMPETENCY_IMPORT_PLAN.md §1).
//
// Different from `extractXlsx` in the one way that matters: it keeps CELL
// POSITIONS and MERGED RANGES, because a matrix's meaning is in which band a
// header sits under, and it keeps text for the first `retainRows` rows ONLY.
// Every row below that is counted and never decoded -- its cells are not
// resolved against the shared-string table -- so a person row of a competency
// matrix cannot leave this function, whatever the caller does next.
// ---------------------------------------------------------------------------

export interface XlsxGridOptions {
  readonly zipLimits?: ZipLimits;
  readonly maxSheets?: number;
  /** Rows whose text is kept. Everything below is counted only. Default 6. */
  readonly retainRows?: number;
}

const DEFAULT_RETAIN_ROWS = 6;

const parseRange = (reference: string): WorkbookGridMerge | null => {
  const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(reference.toUpperCase());
  if (match === null) return null;
  const first = columnIndex(`${match[1]}${match[2]}`);
  const last = columnIndex(`${match[3]}${match[4]}`);
  if (first === null || last === null) return null;
  return {
    firstRow: Number(match[2]),
    firstColumn: first + 1,
    lastRow: Number(match[4]),
    lastColumn: last + 1,
  };
};

const gridOfSheet = (
  xml: string,
  strings: readonly string[],
  retainRows: number,
): { cells: WorkbookGridCell[]; rowsBeyondLimit: number } => {
  const cells: WorkbookGridCell[] = [];
  let rowsBeyondLimit = 0;
  const rowMatcher = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
  let row = rowMatcher.exec(xml);
  let ordinal = 0;
  while (row !== null) {
    ordinal += 1;
    // `r` is optional in the format; without it the row is the next one.
    const declared = Number(/\br="(\d+)"/.exec(row[1] ?? '')?.[1] ?? '');
    const rowNumber = Number.isInteger(declared) && declared > 0 ? declared : ordinal;
    ordinal = rowNumber;
    const body = row[2] ?? '';

    if (rowNumber > retainRows) {
      // Presence only. A value element or an inline string means the row has
      // content; nothing is decoded to find that out.
      if (/<v>|<is>/.test(body)) rowsBeyondLimit += 1;
    } else {
      // SELF-CLOSING FIRST. With the open-tag branch first, `<c r="G1" s="5"/>`
      // matches as an OPENING tag (`[^>]*` happily takes the `/`) whose body
      // runs to the NEXT cell's `</c>`, so that cell's shared-string index is
      // printed as text under the wrong column. Found on the reference
      // workbook, where a styled empty cell beside every band label turned
      // "Functional/Domain" into "6". A self-closing cell has no value.
      const cellMatcher = /<c\b([^>]*?)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g;
      let cell = cellMatcher.exec(body);
      let position = 0;
      while (cell !== null) {
        const selfClosing = cell[1] !== undefined;
        const attributes = (selfClosing ? cell[1] : cell[2]) ?? '';
        const at = columnIndex(/\br="([^"]+)"/.exec(attributes)?.[1] ?? '') ?? position;
        position = at + 1;
        const text = selfClosing ? '' : cellText(attributes, cell[3] ?? '', strings);
        if (text.length > 0) cells.push({ row: rowNumber, column: at + 1, text });
        cell = cellMatcher.exec(body);
      }
    }
    row = rowMatcher.exec(xml);
  }
  return { cells, rowsBeyondLimit };
};

export const readXlsxGrid = (bytes: Uint8Array, options: XlsxGridOptions = {}): WorkbookGrid => {
  const { sheets, strings, read } = openWorkbook(bytes, options.zipLimits);
  const retainRows = options.retainRows ?? DEFAULT_RETAIN_ROWS;
  const limit = Math.min(sheets.length, options.maxSheets ?? DEFAULT_MAX_SHEETS);
  const out: WorkbookGridSheet[] = [];

  for (let index = 0; index < limit; index += 1) {
    const sheet = sheets[index] as SheetRef;
    let xml: string | null;
    try {
      xml = read(sheet.path);
    } catch {
      continue; // per-part isolation, as in extractXlsx
    }
    if (xml === null) continue;

    const { cells, rowsBeyondLimit } = gridOfSheet(xml, strings, retainRows);
    const merges = [...xml.matchAll(/<mergeCell\b[^>]*\bref="([^"]+)"/g)]
      .map((match) => parseRange(match[1] ?? ''))
      .filter((range): range is WorkbookGridMerge => range !== null);

    out.push({
      name: sheet.name,
      position: index,
      hidden: sheet.hidden,
      cells,
      merges,
      retainedRowLimit: retainRows,
      rowsBeyondLimit,
    });
  }

  return {
    sheets: out,
    contentSha256: createHash('sha256').update(bytes).digest('hex'),
  };
};
