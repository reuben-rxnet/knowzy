// Synthetic XLSX workbooks, built in memory — XLSX-INTEGRITY-M1.
//
// Test support only (under contracts/, so never compiled into a package dist). Every test
// that needs a workbook builds it here from literal worksheet XML, so the
// exact bytes under test are visible in the test itself, and no fixture can
// ever contain a real person's row.
//
// Deliberately minimal: [Content_Types], the workbook, its relationships, an
// optional shared-string table and the worksheets -- the parts the readers
// open. `extraParts` adds anything else (a `persons` part, a comment) that a
// test needs to prove is NOT read.

import { deflateRawSync } from 'node:zlib';

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

/** A deflate ZIP of the given text entries. `store: true` writes them uncompressed. */
export const zipOf = (entries: Record<string, string | Buffer>, store = false): Uint8Array => {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const raw = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
    const data = store ? raw : deflateRawSync(raw);
    const method = store ? 0 : 8;
    const nameBytes = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    chunks.push(local, nameBytes, data);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(method, 10);
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

export interface SyntheticSheet {
  readonly name: string;
  /** The `<sheetData>` content: `<row>` elements, verbatim. */
  readonly rows: string;
  /** `<mergeCell ref="…"/>` ranges. */
  readonly merges?: readonly string[];
  readonly state?: 'hidden' | 'veryHidden';
}

export interface SyntheticWorkbook {
  readonly sheets: readonly SyntheticSheet[];
  /** Entries of `xl/sharedStrings.xml`, verbatim `<si>` bodies or elements. */
  readonly sharedStrings?: readonly string[];
  readonly extraParts?: Record<string, string>;
}

const escape = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A shared-string item for a plain string. */
export const si = (text: string): string => `<si><t>${escape(text)}</t></si>`;

/** A cell whose value is shared string `index`. */
export const s = (ref: string, index: number): string => `<c r="${ref}" t="s"><v>${index}</v></c>`;
/** An inline-string cell. */
export const str = (ref: string, text: string): string =>
  `<c r="${ref}" t="inlineStr"><is><t>${escape(text)}</t></is></c>`;
/** A numeric cell. */
export const num = (ref: string, value: number | string): string =>
  `<c r="${ref}"><v>${value}</v></c>`;
/** A STYLED EMPTY cell: the shape that triggered the defect. */
export const styled = (ref: string, style = 1): string => `<c r="${ref}" s="${style}"/>`;
/** A row element. */
export const row = (number: number, ...cells: string[]): string =>
  `<row r="${number}">${cells.join('')}</row>`;

export const buildXlsx = (workbook: SyntheticWorkbook): Uint8Array => {
  const sheetEntries = workbook.sheets.map((sheet, index) => {
    const merges =
      sheet.merges !== undefined && sheet.merges.length > 0
        ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((ref) => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>`
        : '';
    return [
      `xl/worksheets/sheet${index + 1}.xml`,
      `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet.rows}</sheetData>${merges}</worksheet>`,
    ] as const;
  });
  const sheetList = workbook.sheets
    .map(
      (sheet, index) =>
        `<sheet name="${escape(sheet.name)}" sheetId="${index + 1}"${sheet.state === undefined ? '' : ` state="${sheet.state}"`} r:id="rId${index + 1}"/>`,
    )
    .join('');
  const rels = workbook.sheets
    .map(
      (_sheet, index) =>
        `<Relationship Id="rId${index + 1}" Target="worksheets/sheet${index + 1}.xml"/>`,
    )
    .join('');
  return zipOf({
    '[Content_Types].xml': '<?xml version="1.0"?><Types/>',
    'xl/workbook.xml': `<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetList}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0"?><Relationships>${rels}</Relationships>`,
    ...(workbook.sharedStrings === undefined
      ? {}
      : {
          'xl/sharedStrings.xml': `<?xml version="1.0"?><sst>${workbook.sharedStrings.join('')}</sst>`,
        }),
    ...Object.fromEntries(sheetEntries),
    ...(workbook.extraParts ?? {}),
  });
};
