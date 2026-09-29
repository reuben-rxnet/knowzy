// readXlsxGrid — the reader half of the structure-only competency import
// (docs/competencies/COMPETENCY_IMPORT_PLAN.md §1).
//
// The workbook is built in memory, so no fixture on disk can drift from the
// assertion that reads it, and so no real person's row can ever end up in a
// fixture. Every "person" below is invented, and planted precisely so the test
// can prove it does not come out.

import { describe, expect, it } from 'vitest';
import { zipOf as zip } from '../../../testing/contracts/support/synthetic-xlsx.js';
import { extractXlsx, readXlsxGrid } from './xlsx.js';

const PLANTED_NAME = 'Zephyrine Quellbottom';
const PLANTED_EMPLOYEE_NUMBER = 'EMP-990017';

// Shared strings: 0 band, 1 header, 2 name header, 3 planted name, 4 rating.
const sharedStrings = [
  'Database',
  'Postgress',
  'Full Name',
  PLANTED_NAME,
  'G',
  'Notes',
  PLANTED_EMPLOYEE_NUMBER,
];

const sheet1 = `<worksheet><sheetData>
  <row r="1"><c r="A1" s="2"/><c r="B1" t="s"><v>2</v></c><c r="C1" t="s"><v>0</v></c></row>
  <row r="3"><c r="C3" t="s"><v>1</v></c><c r="D3" t="inlineStr"><is><t>MySQL</t></is></c></row>
  <row r="4"><c r="B4" t="s"><v>3</v></c><c r="C4" t="s"><v>4</v></c></row>
  <row r="5"><c r="B5" t="s"><v>6</v></c></row>
  <row r="6"><c r="B6" s="1"/></row>
</sheetData><mergeCells count="1"><mergeCell ref="C1:D1"/></mergeCells></worksheet>`;

const workbook = (sheets: string): Uint8Array =>
  zip({
    '[Content_Types].xml': '<Types/>',
    'xl/workbook.xml': `<workbook><sheets>${sheets}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels':
      '<Relationships>' +
      '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Target="worksheets/sheet2.xml"/>' +
      '</Relationships>',
    'xl/sharedStrings.xml': `<sst>${sharedStrings.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`,
    'xl/worksheets/sheet1.xml': sheet1,
    'xl/worksheets/sheet2.xml': '<worksheet><sheetData/></worksheet>',
    // A part that names a person, as the real workbook's does. The reader must
    // never open it; if it did, the planted name could reach the grid, and the
    // serialization assertions below would find it.
    'xl/persons/person.xml': `<personList><person displayName="${PLANTED_NAME}"/></personList>`,
  });

describe('readXlsxGrid', () => {
  const bytes = workbook(
    '<sheet name="Team &amp; Area" sheetId="1" r:id="rId1"/>' +
      '<sheet name="Hidden" sheetId="2" state="hidden" r:id="rId2"/>',
  );

  it('keeps header cells with their positions and merged ranges', () => {
    const grid = readXlsxGrid(bytes, { retainRows: 3 });
    const sheet = grid.sheets[0];
    expect(sheet?.name).toBe('Team & Area');
    expect(sheet?.cells).toEqual([
      { row: 1, column: 2, text: 'Full Name' },
      { row: 1, column: 3, text: 'Database' },
      { row: 3, column: 3, text: 'Postgress' },
      { row: 3, column: 4, text: 'MySQL' },
    ]);
    expect(sheet?.merges).toEqual([{ firstRow: 1, firstColumn: 3, lastRow: 1, lastColumn: 4 }]);
  });

  it('counts rows below the limit and never decodes them', () => {
    const grid = readXlsxGrid(bytes, { retainRows: 3 });
    // Rows 4 and 5 carry values; row 6 is a formatted empty cell and is not content.
    expect(grid.sheets[0]?.rowsBeyondLimit).toBe(2);
    const serialized = JSON.stringify(grid);
    expect(serialized).not.toContain(PLANTED_NAME);
    expect(serialized).not.toContain(PLANTED_EMPLOYEE_NUMBER);
  });

  it('does decode a row once the limit includes it, which is what the limit is for', () => {
    // The mutation this guards against: a limit that is not applied at all
    // would make the previous test pass only by accident of the fixture.
    const grid = readXlsxGrid(bytes, { retainRows: 4 });
    expect(JSON.stringify(grid)).toContain(PLANTED_NAME);
    expect(grid.sheets[0]?.rowsBeyondLimit).toBe(1);
  });

  it('reports hidden sheets as hidden rather than dropping them', () => {
    const grid = readXlsxGrid(bytes);
    expect(grid.sheets.map((sheet) => [sheet.name, sheet.hidden])).toEqual([
      ['Team & Area', false],
      ['Hidden', true],
    ]);
  });

  it('reads a styled empty cell as empty, not as the next cell', () => {
    // A1 is `<c r="A1" s="2"/>`. With the open-tag branch tried first, it
    // swallowed B1 and printed B1's shared-string index ("2") in column A.
    const first = readXlsxGrid(bytes, { retainRows: 1 }).sheets[0]?.cells;
    expect(first).toEqual([
      { row: 1, column: 2, text: 'Full Name' },
      { row: 1, column: 3, text: 'Database' },
    ]);
  });

  it('extractXlsx reads the same row the same way (fixed in XLSX-INTEGRITY-M1)', () => {
    // Recorded as an it.todo in COMPETENCY-M1: the generation extractor had
    // the same matcher. Both now share one row parser; xlsx-cells.test.ts
    // holds the full fixture matrix and the parity contract.
    const first = extractXlsx(bytes).blocks[0];
    // A1 is the styled blank, so column A is empty and the line starts with
    // the separator; the old matcher printed "2" there and lost "Full Name".
    const firstLine = first !== undefined && 'text' in first ? first.text.split('\n')[0] : null;
    expect(firstLine).toBe(' — Full Name — Database');
  });

  it('hashes the file bytes', () => {
    expect(readXlsxGrid(bytes).contentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(readXlsxGrid(bytes).contentSha256).toBe(readXlsxGrid(bytes).contentSha256);
  });
});
