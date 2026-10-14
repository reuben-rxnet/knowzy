// The PDF download of an assessment-prepared document (AI Document Studio M3,
// docs/competencies/AI_DOCUMENT_STUDIO_ARCHITECTURE.md §11.7).
//
// A small PDF 1.4 writer: A4 pages, the three standard Helvetica faces (no
// embedded font, so nothing to license and nothing to parse), WinAnsi text,
// word wrapping from the Helvetica metrics, tables drawn as ruled grids, and
// warnings and missing-information markers as tinted, labelled blocks so they
// read in black and white. Content streams are deflated; the bytes depend on
// the document only, so a test can compare two renders.
//
// What it does not do: characters outside WinAnsi (they print as "?", and the
// Word download keeps them), right-to-left text, or hyphenation.

import { deflateSync } from 'node:zlib';
import type { PreparedDocumentExport, PreparedNode } from '@knowzy/shared-types';
import { preparedNotice } from '@knowzy/shared-types';
import { provenanceLines } from './docx-writer.js';

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 56;
const CONTENT_W = PAGE_W - MARGIN * 2;

/** Helvetica advance widths (1/1000 em), characters 32-126, from the AFM. */
const WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

type Face = 'F1' | 'F2' | 'F3';

/** Width in points. Bold is wider than regular; 1.08 errs toward wrapping early. */
const widthOf = (text: string, size: number, face: Face): number => {
  let units = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 63;
    units += code >= 32 && code <= 126 ? (WIDTHS[code - 32] ?? 556) : 556;
  }
  return (units / 1000) * size * (face === 'F2' ? 1.08 : 1);
};

const WIN_ANSI: Readonly<Record<string, number>> = {
  '€': 0x80,
  '‚': 0x82,
  ƒ: 0x83,
  '„': 0x84,
  '…': 0x85,
  '†': 0x86,
  '‡': 0x87,
  ˆ: 0x88,
  '‰': 0x89,
  Š: 0x8a,
  '‹': 0x8b,
  Œ: 0x8c,
  Ž: 0x8e,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
  '˜': 0x98,
  '™': 0x99,
  š: 0x9a,
  '›': 0x9b,
  œ: 0x9c,
  ž: 0x9e,
  Ÿ: 0x9f,
};

/** A PDF string literal in WinAnsi, octal-escaped so the stream stays ASCII. */
export const pdfString = (text: string): string => {
  let out = '(';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 63;
    let byte: number;
    if (code >= 32 && code <= 126) byte = code;
    else if (code >= 160 && code <= 255) byte = code;
    else byte = WIN_ANSI[char] ?? 63;
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out += `\\${String.fromCharCode(byte)}`;
    else if (byte > 126) out += `\\${byte.toString(8).padStart(3, '0')}`;
    else out += String.fromCharCode(byte);
  }
  return `${out})`;
};

const wrap = (text: string, size: number, face: Face, width: number): string[] => {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line === '' ? word : `${line} ${word}`;
    if (widthOf(candidate, size, face) <= width || line === '') {
      // A single word wider than the column is broken by characters.
      if (line === '' && widthOf(word, size, face) > width) {
        let piece = '';
        for (const char of word) {
          if (widthOf(piece + char, size, face) > width && piece !== '') {
            lines.push(piece);
            piece = '';
          }
          piece += char;
        }
        line = piece;
      } else {
        line = candidate;
      }
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== '') lines.push(line);
  return lines.length === 0 ? [''] : lines;
};

class Layout {
  readonly pages: string[][] = [[]];
  private y = PAGE_H - MARGIN;

  private get ops(): string[] {
    return this.pages[this.pages.length - 1] as string[];
  }

  private ensure(height: number): void {
    if (this.y - height < MARGIN + 20) {
      this.pages.push([]);
      this.y = PAGE_H - MARGIN;
    }
  }

  gap(points: number): void {
    this.y -= points;
  }

  text(
    content: string,
    options: { size?: number; face?: Face; indent?: number; width?: number; color?: string } = {},
  ): void {
    const size = options.size ?? 10.5;
    const face = options.face ?? 'F1';
    const indent = options.indent ?? 0;
    const lineHeight = size * 1.35;
    for (const line of wrap(content, size, face, (options.width ?? CONTENT_W) - indent)) {
      this.ensure(lineHeight);
      this.y -= lineHeight;
      this.ops.push(
        `BT /${face} ${size} Tf ${options.color ?? '0 0 0'} rg ${(MARGIN + indent).toFixed(2)} ${(this.y + size * 0.3).toFixed(2)} Td ${pdfString(line)} Tj ET`,
      );
    }
  }

  /** A tinted, labelled block: warnings and markers. */
  callout(label: string, content: string, fill: string, bar: string, face: Face): void {
    const size = 10.5;
    const lineHeight = size * 1.35;
    const lines = wrap(content, size, face, CONTENT_W - 24);
    const height = (lines.length + 1) * lineHeight + 10;
    this.ensure(Math.min(height, PAGE_H - MARGIN * 2 - 40));
    const top = this.y;
    const blockHeight = Math.min(height, top - MARGIN - 20);
    this.ops.push(
      `${fill} rg ${MARGIN.toFixed(2)} ${(top - blockHeight).toFixed(2)} ${CONTENT_W.toFixed(2)} ${blockHeight.toFixed(2)} re f`,
      `${bar} rg ${MARGIN.toFixed(2)} ${(top - blockHeight).toFixed(2)} 3 ${blockHeight.toFixed(2)} re f`,
    );
    this.y -= 5;
    this.text(label, { face: 'F2', size: 9.5, indent: 12 });
    for (const line of lines) this.text(line, { face, indent: 12 });
    this.y -= 7;
  }

  table(header: readonly string[], rows: readonly (readonly string[])[]): void {
    const columns = Math.max(1, header.length);
    const cellWidth = CONTENT_W / columns;
    const size = 9;
    const lineHeight = size * 1.35;
    const drawRow = (cells: readonly string[], bold: boolean): void => {
      const wrapped = Array.from({ length: columns }, (_, i) =>
        wrap(cells[i] ?? '', size, bold ? 'F2' : 'F1', cellWidth - 8),
      );
      const height = Math.max(...wrapped.map((lines) => lines.length)) * lineHeight + 6;
      this.ensure(height);
      const top = this.y;
      if (bold) {
        this.ops.push(
          `0.906 0.902 0.902 rg ${MARGIN.toFixed(2)} ${(top - height).toFixed(2)} ${CONTENT_W.toFixed(2)} ${height.toFixed(2)} re f`,
        );
      }
      wrapped.forEach((lines, column) => {
        const x = MARGIN + column * cellWidth;
        this.ops.push(
          `0.6 0.6 0.6 RG 0.5 w ${x.toFixed(2)} ${(top - height).toFixed(2)} ${cellWidth.toFixed(2)} ${height.toFixed(2)} re S`,
        );
        lines.forEach((line, index) => {
          const baseline = top - 3 - (index + 1) * lineHeight + size * 0.3;
          this.ops.push(
            `BT /${bold ? 'F2' : 'F1'} ${size} Tf 0 0 0 rg ${(x + 4).toFixed(2)} ${baseline.toFixed(2)} Td ${pdfString(line)} Tj ET`,
          );
        });
      });
      this.y = top - height;
    };
    drawRow(header, true);
    for (const row of rows) drawRow(row, false);
    this.y -= 8;
  }
}

const MARKER_LABEL: Readonly<Record<string, string>> = {
  MISSING_INFORMATION: 'Missing information',
  UNCLEAR: 'Unclear',
  NOT_FOR_ASSESSMENT: 'Not suitable for assessment',
};

const render = (layout: Layout, node: PreparedNode): void => {
  switch (node.type) {
    case 'heading': {
      const size = node.level <= 1 ? 16 : node.level === 2 ? 13.5 : 11.5;
      layout.gap(size * 0.6);
      layout.text(node.text, { size, face: 'F2' });
      layout.gap(3);
      return;
    }
    case 'paragraph':
      layout.text(node.text);
      layout.gap(5);
      return;
    case 'list':
      node.items.forEach((item, index) => {
        layout.text(`${node.ordered ? `${index + 1}.` : '•'}  ${item}`, { indent: 14 });
      });
      layout.gap(5);
      return;
    case 'warning':
      layout.callout('Warning', node.text, '1 0.957 0.808', '0.8 0.6 0', 'F1');
      return;
    case 'marker':
      layout.callout(
        MARKER_LABEL[node.marker] ?? 'Note',
        node.text,
        '0.91 0.941 0.996',
        '0.2 0.4 0.8',
        'F3',
      );
      return;
    case 'table':
      layout.table(node.header, node.rows);
      return;
  }
};

export const writePreparedPdf = (doc: PreparedDocumentExport): Buffer => {
  const layout = new Layout();
  layout.text(doc.title, { size: 18, face: 'F2' });
  layout.gap(6);
  layout.callout(
    'Notice',
    preparedNotice(doc.originalName),
    '0.949 0.949 0.949',
    '0.4 0.4 0.4',
    'F1',
  );
  for (const line of provenanceLines(doc)) layout.text(line, { size: 8.5, color: '0.3 0.3 0.3' });
  layout.gap(8);
  for (const node of doc.nodes) render(layout, node);

  const total = layout.pages.length;
  const footer = (index: number): string =>
    `BT /F1 8 Tf 0.4 0.4 0.4 rg ${MARGIN} 30 Td ${pdfString(
      `Assessment-prepared document - not the authoritative original. Page ${index + 1} of ${total}`,
    )} Tj ET`;

  // Objects: 1 catalog, 2 pages, 3-5 fonts, 6 info, then a page and its stream each.
  const objects: (string | Buffer)[] = [];
  const pageIds = layout.pages.map((_, i) => 7 + i * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${total} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4] =
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  objects[5] =
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>';
  objects[6] = `<< /Title ${pdfString(doc.title)} /Subject ${pdfString(preparedNotice(doc.originalName))} /Producer (Knowzy) >>`;
  layout.pages.forEach((ops, index) => {
    const pageId = pageIds[index] as number;
    const stream = deflateSync(Buffer.from([...ops, footer(index)].join('\n'), 'latin1'));
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] = Buffer.concat([
      Buffer.from(`<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'),
      stream,
      Buffer.from('\nendstream', 'latin1'),
    ]);
  });

  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  const offsets: number[] = [];
  let length = parts[0]?.length ?? 0;
  for (let id = 1; id < objects.length; id += 1) {
    const body = objects[id];
    if (body === undefined) continue;
    offsets[id] = length;
    const chunk = Buffer.concat([
      Buffer.from(`${id} 0 obj\n`, 'latin1'),
      typeof body === 'string' ? Buffer.from(body, 'latin1') : body,
      Buffer.from('\nendobj\n', 'latin1'),
    ]);
    parts.push(chunk);
    length += chunk.length;
  }
  const xref = [
    'xref',
    `0 ${objects.length}`,
    '0000000000 65535 f ',
    ...Array.from(
      { length: objects.length - 1 },
      (_, i) => `${String(offsets[i + 1] ?? 0).padStart(10, '0')} 00000 n `,
    ),
    'trailer',
    `<< /Size ${objects.length} /Root 1 0 R /Info 6 0 R >>`,
    'startxref',
    String(length),
    '%%EOF',
    '',
  ].join('\n');
  parts.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(parts);
};
