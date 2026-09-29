// XLSX cell placement — XLSX-INTEGRITY-M1.
//
// A value belongs in the column its `r` names, whatever else the row contains.
// Every fixture is synthetic, built in memory from the XML shown beside it,
// and the same fixture is read by BOTH readers: `extractXlsx` (generation) and
// `readXlsxGrid` (the competency importer). The parity test at the end holds
// them to one answer, because they share one row parser and must not drift.

import { describe, expect, it } from 'vitest';
import {
  buildXlsx,
  num,
  row,
  s,
  si,
  str,
  styled,
  zipOf,
  type SyntheticSheet,
} from '../../../testing/contracts/support/synthetic-xlsx.js';
import { CELL_SEPARATOR } from './ooxml.js';
import { extractXlsx, readXlsxGrid, XlsxError } from './xlsx.js';
import { openZip } from '../zip.js';

/** Each extracted line as its cells, so a column is an array index. */
const cellsOf = (bytes: Uint8Array): string[][] =>
  extractXlsx(bytes)
    .blocks.flatMap((block) => ('text' in block ? block.text.split('\n') : []))
    .map((line) => line.split(CELL_SEPARATOR));

const one = (
  rows: string,
  sharedStrings?: string[],
  extra: Partial<SyntheticSheet> = {},
): Uint8Array =>
  buildXlsx({
    sheets: [{ name: 'Policy', rows, ...extra }],
    ...(sharedStrings ? { sharedStrings } : {}),
  });

// ---------------------------------------------------------------- 1. contiguous

describe('placement by cell reference', () => {
  it('1. a contiguous row keeps its order', () => {
    expect(cellsOf(one(row(1, str('A1', 'Window'), str('B1', 'Days'), num('C1', 30))))).toEqual([
      ['Window', 'Days', '30'],
    ]);
  });

  it('2. an omitted middle cell leaves its column empty; D stays D', () => {
    expect(
      cellsOf(one(row(1, str('A1', 'Owner'), str('B1', 'L2'), str('D1', 'Escalate')))),
    ).toEqual([['Owner', 'L2', '', 'Escalate']]);
  });

  it('3. a STYLED EMPTY cell is empty, and does not take the next cell’s value', () => {
    // The defect: <c r="C1" s="1"/> matched as an OPENING tag, swallowed D1,
    // and printed D1's shared-string index ("1") in column C.
    const bytes = one(row(1, s('A1', 0), styled('C1'), s('D1', 1)), [si('Owner'), si('Escalate')]);
    expect(cellsOf(bytes)).toEqual([['Owner', '', '', 'Escalate']]);
  });

  it('3b. a styled empty cell FIRST in the row, before a numeric one', () => {
    expect(cellsOf(one(row(1, styled('A1'), num('B1', 45), styled('C1'), num('E1', 7))))).toEqual([
      ['', '45', '', '', '7'],
    ]);
  });

  it('4. several omitted cells in a row', () => {
    expect(
      cellsOf(one(row(1, str('A1', 'first'), str('F1', 'sixth'), str('J1', 'tenth')))),
    ).toEqual([['first', '', '', '', '', 'sixth', '', '', '', 'tenth']]);
  });

  it('places cells written out of order by their references', () => {
    expect(cellsOf(one(row(1, str('C1', 'third'), str('A1', 'first'))))).toEqual([
      ['first', '', 'third'],
    ]);
  });

  it('falls back to the next column only for a cell with no reference', () => {
    const bytes = one(
      '<row r="1"><c r="B1" t="inlineStr"><is><t>b</t></is></c><c t="inlineStr"><is><t>c</t></is></c></row>',
    );
    expect(cellsOf(bytes)).toEqual([['', 'b', 'c']]);
  });

  it('keeps the first non-empty value when two cells claim one column', () => {
    expect(cellsOf(one(row(1, str('A1', 'kept'), styled('A1'), str('B1', 'next'))))).toEqual([
      ['kept', 'next'],
    ]);
  });
});

// ---------------------------------------------------------------- 5-8. values

describe('cell values', () => {
  it('5. shared strings, including an EMPTY entry that must not shift later indexes', () => {
    // <si/> is entry 1. Dropping it made index 2 read as entry 3.
    const bytes = one(row(1, s('A1', 0), s('B1', 2), s('C1', 3)), [
      si('zero'),
      '<si/>',
      si('two'),
      '<si><r><t>th</t></r><r><t xml:space="preserve"/></r><r><t>ree</t></r></si>',
    ]);
    expect(cellsOf(bytes)).toEqual([['zero', 'two', 'three']]);
  });

  it('5b. an unresolvable shared-string index contributes nothing, never the index', () => {
    const text = cellsOf(one(row(1, str('A1', 'label'), s('B1', 99)), [si('only')]))
      .flat()
      .join('|');
    expect(text).toBe('label');
    expect(text).not.toContain('99');
  });

  it('5c. phonetic hints are not part of the string', () => {
    const bytes = one(row(1, s('A1', 0)), [
      '<si><t>Tokyo</t><rPh sb="0" eb="1"><t>とうきょう</t></rPh></si>',
    ]);
    expect(cellsOf(bytes)).toEqual([['Tokyo']]);
  });

  it('6. inline strings, including rich runs', () => {
    const bytes = one(
      row(
        1,
        str('A1', 'plain'),
        '<c r="B1" t="inlineStr"><is><r><t>ri</t></r><r><t>ch</t></r></is></c>',
      ),
    );
    expect(cellsOf(bytes)).toEqual([['plain', 'rich']]);
  });

  it('7. numeric, boolean and error cells show their visible value', () => {
    const bytes = one(
      row(
        1,
        num('A1', 30),
        num('B1', '0.5'),
        '<c r="C1" t="b"><v>1</v></c>',
        '<c r="D1" t="b"><v>0</v></c>',
        '<c r="E1" t="e"><v>#N/A</v></c>',
      ),
    );
    expect(cellsOf(bytes)).toEqual([['30', '0.5', 'TRUE', 'FALSE', '#N/A']]);
  });

  it('8. a formula shows its CACHED RESULT and never its formula', () => {
    const bytes = one(
      row(
        1,
        '<c r="A1"><f>SUM(B2:B9)</f><v>42</v></c>',
        '<c r="B1" t="str"><f>CONCAT("a","b")</f><v>ab</v></c>',
        '<c r="C1"><f>NOW()</f></c>',
        str('D1', 'after'),
      ),
    );
    const cells = cellsOf(bytes);
    expect(cells).toEqual([['42', 'ab', '', 'after']]);
    expect(JSON.stringify(cells)).not.toMatch(/SUM|CONCAT|NOW/);
  });

  it('treats explicit blank cells as empty', () => {
    const bytes = one(
      row(1, '<c r="A1" t="s"></c>', '<c r="B1"><v></v></c>', '<c r="C1"><v/></c>', str('D1', 'x')),
    );
    expect(cellsOf(bytes)).toEqual([['', '', '', 'x']]);
  });
});

// ------------------------------------------------------ 9-11. sheet structure

describe('sheet structure', () => {
  it('9. a merged range carries its value once, in its first cell', () => {
    const bytes = one(
      row(1, str('A1', 'Band'), styled('B1'), styled('C1'), str('D1', 'Next')),
      undefined,
      {
        merges: ['A1:C1'],
      },
    );
    expect(cellsOf(bytes)).toEqual([['Band', '', '', 'Next']]);
  });

  it('10. several worksheets, in workbook order, each its own block carrying its name', () => {
    const bytes = buildXlsx({
      sheets: [
        { name: 'First', rows: row(1, str('A1', 'one')) },
        { name: 'Second', rows: row(1, str('B1', 'two')) },
        { name: 'Hidden notes', rows: row(1, str('A1', 'three')), state: 'hidden' },
      ],
    });
    const blocks = extractXlsx(bytes).blocks;
    // Hidden sheets are extracted, unchanged from the existing (recorded) policy.
    expect(blocks.map((block) => ('sheetName' in block ? block.sheetName : null))).toEqual([
      'First',
      'Second',
      'Hidden notes',
    ]);
    expect(cellsOf(bytes)).toEqual([['one'], ['', 'two'], ['three']]);
  });

  it('11. an empty worksheet, or one of styled empty cells only, yields no block', () => {
    const bytes = buildXlsx({
      sheets: [
        { name: 'Empty', rows: '' },
        { name: 'Styled only', rows: row(1, styled('A1'), styled('B1')) + '<row r="2"/>' },
        { name: 'Real', rows: row(1, str('A1', 'kept')) },
      ],
    });
    expect(extractXlsx(bytes).blocks).toHaveLength(1);
    expect(cellsOf(bytes)).toEqual([['kept']]);
  });

  it('a self-closing <row/> does not swallow the row after it', () => {
    const bytes = one(
      '<row r="1" spans="1:3"/>' + row(2, str('A2', 'second')) + row(3, str('B3', 'third')),
    );
    expect(cellsOf(bytes)).toEqual([['second'], ['', 'third']]);
    expect(readXlsxGrid(bytes).sheets[0]?.cells).toEqual([
      { row: 2, column: 1, text: 'second' },
      { row: 3, column: 2, text: 'third' },
    ]);
  });
});

// ---------------------------------------------------------- 12-13. refusals

describe('malformed and hostile workbooks', () => {
  it('12. a file that is not a ZIP is refused, not guessed at', () => {
    expect(() => extractXlsx(new Uint8Array(Buffer.from('not a workbook at all')))).toThrow(
      XlsxError,
    );
  });

  it('12b. a ZIP with no worksheet part is not an XLSX', () => {
    const bytes = zipOf({ 'word/document.xml': '<w:document/>' });
    expect(() => extractXlsx(bytes)).toThrow(expect.objectContaining({ code: 'NOT_AN_XLSX' }));
  });

  it('12c. a truncated worksheet part extracts what precedes the cut and nothing invented', () => {
    const bytes = one(row(1, str('A1', 'whole')) + '<row r="2"><c r="A2" t="inlineStr"><is><t>cut');
    expect(cellsOf(bytes)[0]).toEqual(['whole']);
  });

  it('13. a decompression bomb is refused BEFORE it is inflated, and only that part is lost', () => {
    // The ZIP layer refuses on the DECLARED ratio, so the part is never
    // expanded; extractXlsx's per-part isolation then skips it and keeps the
    // other sheets. Both halves are existing behaviour, preserved.
    const bytes = buildXlsx({
      sheets: [
        { name: 'Bomb', rows: row(1, str('A1', ' '.repeat(4 * 1024 * 1024))) },
        { name: 'Honest', rows: row(1, str('A1', 'kept')) },
      ],
    });
    expect(() => openZip(bytes).readText('xl/worksheets/sheet1.xml')).toThrow(
      expect.objectContaining({ code: 'LIMIT_EXCEEDED' }),
    );
    expect(
      extractXlsx(bytes).blocks.map((block) => ('sheetName' in block ? block.sheetName : null)),
    ).toEqual(['Honest']);
  });

  it('13b. a workbook with too many parts is refused', () => {
    const entries = Object.fromEntries(
      Array.from({ length: 30 }, (_v, index) => [
        `xl/worksheets/sheet${index + 1}.xml`,
        '<worksheet/>',
      ]),
    );
    expect(() =>
      extractXlsx(zipOf(entries), {
        zipLimits: {
          maxEntries: 10,
          maxTotalInflatedBytes: 1e6,
          maxEntryInflatedBytes: 1e6,
          maxCompressionRatio: 200,
        },
      }),
    ).toThrow(expect.objectContaining({ code: 'LIMIT_EXCEEDED' }));
  });
});

// ----------------------------------------------------- 14-15. real shapes

describe('the shapes that motivated the fix', () => {
  it('14. a question-bank row with blank optional columns keeps every column in place', () => {
    // Header: Question, A, B, C, D, Correct, Explanation, Difficulty, Topic.
    // Row 2 leaves Explanation and Difficulty blank -- one STYLED, one OMITTED.
    const header = [
      'Question',
      'A',
      'B',
      'C',
      'D',
      'Correct',
      'Explanation',
      'Difficulty',
      'Topic',
    ];
    const bytes = one(
      row(1, ...header.map((label, index) => str(`${String.fromCharCode(65 + index)}1`, label))) +
        row(
          2,
          str('A2', 'Within how many days must a production certificate be renewed?'),
          num('B2', 7),
          num('C2', 14),
          num('D2', 30),
          num('E2', 60),
          str('F2', 'D'),
          styled('G2'),
          str('I2', 'Certificates'),
        ),
    );
    const [headerCells, bankRow] = cellsOf(bytes);
    expect(headerCells).toEqual(header);
    expect(bankRow?.[header.indexOf('Correct')]).toBe('D');
    expect(bankRow?.[header.indexOf('Explanation')]).toBe('');
    expect(bankRow?.[header.indexOf('Difficulty')]).toBe('');
    expect(bankRow?.[header.indexOf('Topic')]).toBe('Certificates');
  });

  it('15. a competency-style band over a sparse header row', () => {
    // Band labels sit beside styled empty cells, exactly as on the reference
    // workbook, where this turned "Functional/Domain" into "6".
    const bytes = one(
      row(1, s('A1', 0), styled('B1'), styled('C1'), s('D1', 1), styled('E1')) +
        row(2, s('A2', 2), s('B2', 3), styled('C2'), s('D2', 4), s('E2', 5)),
      [
        si('Product'),
        si('Functional/Domain'),
        si('Alpha'),
        si('Beta'),
        si('Order Handling'),
        si('Pricing'),
      ],
    );
    expect(cellsOf(bytes)).toEqual([
      ['Product', '', '', 'Functional/Domain'],
      ['Alpha', 'Beta', '', 'Order Handling', 'Pricing'],
    ]);
  });
});

// --------------------------------------------------------------- parity

describe('one placement contract for both readers', () => {
  const fixtures: Record<string, Uint8Array> = {
    styled: one(row(1, s('A1', 0), styled('C1'), s('D1', 1)), [si('Owner'), si('Escalate')]),
    sparse: one(
      row(1, str('A1', 'a'), str('F1', 'f')) + row(3, styled('A3'), num('B3', 5), str('Z3', 'z')),
    ),
    band: one(
      row(1, s('A1', 0), styled('B1'), s('D1', 1)) + row(2, s('A2', 2), styled('B2'), s('C2', 3)),
      [si('Band'), si('Other band'), si('first'), si('third')],
    ),
  };

  it.each(Object.entries(fixtures))('extractXlsx and readXlsxGrid agree on %s', (_name, bytes) => {
    const fromGrid = (readXlsxGrid(bytes, { retainRows: 1000 }).sheets[0]?.cells ?? []).map(
      (cell) => `${cell.row}:${cell.column}:${cell.text}`,
    );
    // extractXlsx drops empty rows, so compare non-empty rows in order.
    const rowsWithCells = [
      ...new Set(
        (readXlsxGrid(bytes, { retainRows: 1000 }).sheets[0]?.cells ?? []).map((cell) => cell.row),
      ),
    ];
    const fromLines = cellsOf(bytes).flatMap((cells, index) =>
      cells.flatMap((text, column) =>
        text === '' ? [] : [`${rowsWithCells[index]}:${column + 1}:${text}`],
      ),
    );
    expect(fromLines).toEqual(fromGrid);
  });
});
