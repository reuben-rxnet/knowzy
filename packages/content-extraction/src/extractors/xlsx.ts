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

// ---------------------------------------------------------------------------
// ONE ELEMENT SCANNER — XLSX-INTEGRITY-M1.
//
// Every XLSX defect found so far had one shape: a regex of the form
// `<c\b([^>]*)>([\s\S]*?)<\/c>` also matches a SELF-CLOSING `<c r="G1" s="5"/>`,
// because `[^>]*` happily takes the `/`. The "open" tag's body then runs to
// the NEXT element's closing tag, and that element's content -- for a cell, a
// shared-string INDEX -- is read as this one's, under this one's column. It
// affected `<c>` (a styled empty cell), `<row>` (an empty row), `<t>` (an
// empty `xml:space="preserve"` run) and `<si>` (an empty shared string, which
// silently shifted EVERY later shared-string index by one).
//
// So nothing in this file matches an element with a body regex any more. An
// element is found by its opening tag; `/>` makes it empty; otherwise its body
// runs to ITS OWN closing tag. The elements scanned here never nest within
// themselves (`c`, `row`, `si`, `t`, `v`, `is`), which is what makes a plain
// `indexOf` of the closing tag correct.
// ---------------------------------------------------------------------------

interface XmlElement {
  readonly attributes: string;
  /** Null for a self-closing element: it has no content, by definition. */
  readonly body: string | null;
}

const elementsOf = (xml: string, tag: string): XmlElement[] => {
  const out: XmlElement[] = [];
  const open = new RegExp(`<${tag}\\b([^>]*)>`, 'g');
  const close = `</${tag}>`;
  let match = open.exec(xml);
  while (match !== null) {
    const raw = match[1] ?? '';
    if (raw.endsWith('/')) {
      out.push({ attributes: raw.slice(0, -1), body: null });
    } else {
      const end = xml.indexOf(close, open.lastIndex);
      // A truncated part: the element runs to the end, and nothing after it
      // can be attributed to anything.
      const stop = end === -1 ? xml.length : end;
      out.push({ attributes: raw, body: xml.slice(open.lastIndex, stop) });
      open.lastIndex = end === -1 ? xml.length : end + close.length;
    }
    match = open.exec(xml);
  }
  return out;
};

const attributeOf = (attributes: string, name: string): string | undefined =>
  new RegExp(`\\b${name}="([^"]*)"`).exec(attributes)?.[1];

/** The visible text of a string item: its `<t>` runs, without phonetic hints. */
const runText = (body: string | null): string => {
  if (body === null) return '';
  // `rPh` is a phonetic hint (furigana) and is not the string's text.
  return elementsOf(stripElements(body, ['rPh']), 't')
    .map((run) => decodeEntities(run.body ?? ''))
    .join('');
};

const oneLine = (value: string): string => value.replace(/[\t\r\n]+/g, ' ').trim();

/**
 * `xl/sharedStrings.xml` → the string table, in index order.
 *
 * EVERY `<si>` is an entry, including an empty `<si/>`. Skipping one would move
 * every later index down by one, and every shared-string cell after it would
 * then show the text of the NEXT entry -- a wrong word in the right place,
 * which is the hardest kind of error to see.
 */
const sharedStrings = (xml: string | null): string[] =>
  xml === null ? [] : elementsOf(xml, 'si').map((item) => oneLine(runText(item.body)));

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

/**
 * A cell's VISIBLE text.
 *
 *   empty (`<c .../>`)   ''
 *   `t="s"`              the shared string at the index; '' if it does not
 *                        resolve -- never the index itself
 *   `t="inlineStr"`      every `<t>` run of its `<is>`
 *   `t="b"`              TRUE / FALSE, which is what the cell shows; the stored
 *                        1 / 0 is not the visible value
 *   anything else        the cached `<v>`: a number, a formula's result, an
 *                        error such as #N/A. `<f>` is never read.
 */
const cellText = (cell: XmlElement, strings: readonly string[]): string => {
  if (cell.body === null) return '';
  const type = attributeOf(cell.attributes, 't');
  const cached = elementsOf(cell.body, 'v')[0]?.body ?? '';

  let value: string;
  if (type === 's') {
    const index = Number(cached.trim());
    value = cached.trim() !== '' && Number.isInteger(index) ? (strings[index] ?? '') : '';
  } else if (type === 'inlineStr') {
    value = runText(elementsOf(cell.body, 'is')[0]?.body ?? null);
  } else if (type === 'b') {
    value = cached.trim() === '1' ? 'TRUE' : cached.trim() === '0' ? 'FALSE' : '';
  } else {
    value = decodeEntities(cached);
  }
  return oneLine(value);
};

/** A worksheet row: its number, and its cells placed by their declared reference. */
interface ParsedRow {
  readonly row: number;
  /** Non-empty cells only, by 0-based column, in column order. */
  readonly cells: readonly { readonly column: number; readonly text: string }[];
  /** True when the row holds a value, established WITHOUT decoding it. */
  readonly hasValue: boolean;
}

/**
 * THE ONE PLACE A CELL IS PLACED — shared by `extractXlsx` (generation) and
 * `readXlsxGrid` (the competency importer), so the two cannot disagree about
 * which column a value is in.
 *
 * A cell goes where its `r` says. `D1` is column D even when `C1` is absent
 * (omitted because it is empty) or present as a styled empty `<c r="C1"/>`.
 * Only a cell with NO reference falls back to "the column after the previous
 * one", which is what a file without references implies. If two cells claim
 * one column, the first NON-EMPTY one wins, so a stray empty duplicate cannot
 * erase a value.
 *
 * `decode(row)` decides which rows have their cells read at all. A row it
 * refuses is reported with `hasValue` only, and none of its cells is resolved
 * against the shared-string table -- that is what keeps a competency matrix's
 * person rows inside this function.
 */
const parseRows = (
  xml: string,
  strings: readonly string[],
  decode: (row: number) => boolean,
): ParsedRow[] => {
  const rows: ParsedRow[] = [];
  let previous = 0;
  for (const row of elementsOf(xml, 'row')) {
    const declared = Number(attributeOf(row.attributes, 'r') ?? '');
    const rowNumber = Number.isInteger(declared) && declared > 0 ? declared : previous + 1;
    previous = rowNumber;
    const cellElements = row.body === null ? [] : elementsOf(row.body, 'c');
    const hasValue = cellElements.some(
      (cell) => cell.body !== null && (/<v\b[^>]*>[^<]/.test(cell.body) || /<is\b/.test(cell.body)),
    );
    if (!decode(rowNumber)) {
      rows.push({ row: rowNumber, cells: [], hasValue });
      continue;
    }
    const placed = new Map<number, string>();
    let position = -1;
    for (const cell of cellElements) {
      const at = columnIndex(attributeOf(cell.attributes, 'r') ?? '') ?? position + 1;
      position = at;
      const text = cellText(cell, strings);
      if (text.length > 0 && !placed.has(at)) placed.set(at, text);
    }
    rows.push({
      row: rowNumber,
      cells: [...placed.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([column, text]) => ({ column, text })),
      hasValue,
    });
  }
  return rows;
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
  for (const row of parseRows(xml, strings, () => true)) {
    if (lines.length >= maxRows) break;
    if (row.cells.length === 0) continue;
    const width = (row.cells[row.cells.length - 1]?.column ?? 0) + 1;
    const values: string[] = Array.from({ length: width }, () => '');
    for (const cell of row.cells) values[cell.column] = cell.text;
    lines.push(values.join(CELL_SEPARATOR));
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
  // The same row parser extractXlsx uses. Rows past the limit are never
  // decoded: parseRows reports only whether they hold a value.
  for (const row of parseRows(xml, strings, (rowNumber) => rowNumber <= retainRows)) {
    if (row.row > retainRows) {
      if (row.hasValue) rowsBeyondLimit += 1;
      continue;
    }
    for (const cell of row.cells)
      cells.push({ row: row.row, column: cell.column + 1, text: cell.text });
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
