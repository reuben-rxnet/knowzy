import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { PreparedDocumentExport } from '@knowzy/shared-types';
import { writePreparedDocx, xmlEscape } from './docx-writer.js';
import { pdfString, writePreparedPdf } from './pdf-writer.js';
import { crc32 } from './zip-writer.js';

// Synthetic content only.
const DOC: PreparedDocumentExport = {
  title: 'Synthetic Lantern Returns — Assessment-prepared document',
  originalName: 'Synthetic Lantern Returns.docx',
  originalVersion: '3',
  preparedVersion: 2,
  preparedBy: 'Test preparation — not AI',
  preparedAt: '2026-10-14 09:00 UTC',
  nodes: [
    { type: 'heading', level: 2, text: 'Return window' },
    { type: 'paragraph', text: 'Customers should return a lantern within 14 days (café & shop).' },
    { type: 'warning', text: 'Never accept a cracked panel.' },
    { type: 'list', ordered: true, items: ['Check the receipt.', 'Inspect the lantern.'] },
    { type: 'table', header: ['Condition', 'Action'], rows: [['Under 14 days', 'Refund']] },
    { type: 'marker', marker: 'MISSING_INFORMATION', text: 'No reason is given for 14 days.' },
  ],
};

/** The named entry of a deflated ZIP, read with no library. */
const entry = (zip: Buffer, name: string): string | null => {
  let offset = 0;
  while (offset + 30 <= zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
    const size = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extra = zip.readUInt16LE(offset + 28);
    const entryName = zip.toString('utf8', offset + 30, offset + 30 + nameLength);
    const start = offset + 30 + nameLength + extra;
    if (entryName === name)
      return inflateRawSync(zip.subarray(start, start + size)).toString('utf8');
    offset = start + size;
  }
  return null;
};

describe('the Word download', () => {
  it('is a valid package carrying the notice, the provenance and every block', () => {
    const docx = writePreparedDocx(DOC);
    for (const part of [
      '[Content_Types].xml',
      '_rels/.rels',
      'word/styles.xml',
      'docProps/core.xml',
    ]) {
      expect(entry(docx, part), part).not.toBeNull();
    }
    const body = entry(docx, 'word/document.xml') ?? '';
    expect(body).toContain(
      'Assessment-prepared document derived from Synthetic Lantern Returns.docx. This document is intended for question generation and does not replace the authoritative original.',
    );
    expect(body).toContain('Prepared document version: 2');
    expect(body).toContain('version 3');
    expect(body).toContain('<w:pStyle w:val="Heading2"/>');
    expect(body).toContain('café &amp; shop');
    expect(body).toContain('<w:tbl>');
    expect(body).toContain('Missing information: ');
    expect(body).toContain('Warning: ');
  });

  it('is deterministic: the same document gives the same bytes', () => {
    expect(writePreparedDocx(DOC).equals(writePreparedDocx(DOC))).toBe(true);
  });

  it('drops characters XML cannot carry, rather than producing a corrupt file', () => {
    expect(xmlEscape('a\u0001b<c>"d"')).toBe('ab&lt;c&gt;&quot;d&quot;');
  });
});

describe('the PDF download', () => {
  it('is a well-formed PDF with a title, a cross-reference table and a trailer', () => {
    const pdf = writePreparedPdf(DOC).toString('latin1');
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(pdf).toMatch(/\/Title \(Synthetic Lantern Returns \\227 Assessment-prepared document\)/);
    expect(pdf).toMatch(/\nxref\n0 \d+\n/);
    // Each xref offset points at its object.
    const offsets = [...pdf.matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]));
    offsets.forEach((offset, index) => {
      expect(pdf.slice(offset, offset + 12)).toMatch(new RegExp(`^${index + 1} 0 obj`));
    });
  });

  it('is deterministic', () => {
    expect(writePreparedPdf(DOC).equals(writePreparedPdf(DOC))).toBe(true);
  });

  it('escapes PDF string syntax and encodes WinAnsi', () => {
    expect(pdfString('a(b)c\\')).toBe('(a\\(b\\)c\\\\)');
    expect(pdfString('café — “x”')).toBe('(caf\\351 \\227 \\223x\\224)');
  });

  it('paginates a long document', () => {
    const long: PreparedDocumentExport = {
      ...DOC,
      nodes: Array.from({ length: 200 }, (_, index) => ({
        type: 'paragraph' as const,
        text: `Paragraph ${index} of a long synthetic document that must wrap and paginate cleanly.`,
      })),
    };
    expect(writePreparedPdf(long).toString('latin1')).toMatch(/\/Count ([2-9]|\d{2,})/);
  });
});

describe('crc32', () => {
  it('matches the reference value', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });
});
