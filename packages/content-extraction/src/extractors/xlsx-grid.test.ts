// readXlsxGrid — the reader half of the structure-only competency import
// (docs/competencies/COMPETENCY_IMPORT_PLAN.md §1).
//
// The workbook is built in memory, so no fixture on disk can drift from the
// assertion that reads it, and so no real person's row can ever end up in a
// fixture. Every "person" below is invented, and planted precisely so the test
// can prove it does not come out.

import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readXlsxGrid } from './xlsx.js';

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (buffer: Buffer): number => {
  let c = 0xffffffff;
  for (const byte of buffer) c = (crcTable[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** A minimal deflate ZIP writer: enough for the reader, nothing more. */
const zip = (entries: Record<string, string>): Uint8Array => {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const raw = Buffer.from(text, 'utf8');
    const data = deflateRawSync(raw);
    const nameBytes = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    chunks.push(local, nameBytes, data);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(8, 10);
    header.writeUInt32LE(crc32(raw), 16);
    header.writeUInt32LE(data.length, 20);
    header.writeUInt32LE(raw.length, 24);
    header.writeUInt16LE(nameBytes.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(header, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...chunks, centralBytes, end]));
};

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
  <row r="1"><c r="B1" t="s"><v>2</v></c><c r="C1" t="s"><v>0</v></c></row>
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

  it('hashes the file bytes', () => {
    expect(readXlsxGrid(bytes).contentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(readXlsxGrid(bytes).contentSha256).toBe(readXlsxGrid(bytes).contentSha256);
  });
});
