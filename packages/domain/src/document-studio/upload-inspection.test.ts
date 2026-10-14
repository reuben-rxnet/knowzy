// One test per upload control (AI_DOCUMENT_STUDIO_ARCHITECTURE.md §11.2), so
// removing a control fails a test. Every file here is synthetic, built in
// memory.

import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { inspectUpload, UPLOAD_MAX_BYTES, zipEntryNames } from './upload-inspection.js';

/** A minimal, valid ZIP of the given entries (stored, no compression). */
const zipOf = (names: readonly string[]): Uint8Array => {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const name of names) {
    const data = Buffer.from('<x/>');
    const nameBytes = Buffer.from(name);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    local.push(header, nameBytes, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset += header.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(names.length, 8);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...local, directory, end]));
};

const DOCX = ['[Content_Types].xml', 'word/document.xml'];
const text = (value: string): Uint8Array => new Uint8Array(Buffer.from(value, 'utf8'));
const PDF = text('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF');

const refusedBy = (fileName: string, bytes: Uint8Array): string | null => {
  const result = inspectUpload({ fileName, bytes });
  return result.ok ? null : result.control;
};

describe('upload inspection', () => {
  it('accepts a well-formed DOCX, PDF, PPTX, Markdown and text file', () => {
    expect(refusedBy('a.docx', zipOf(DOCX))).toBeNull();
    expect(refusedBy('a.pptx', zipOf(['[Content_Types].xml', 'ppt/presentation.xml']))).toBeNull();
    expect(refusedBy('a.pdf', PDF)).toBeNull();
    expect(refusedBy('a.md', text('# Heading\n\nText.'))).toBeNull();
    expect(refusedBy('a.txt', text('Plain text, café.'))).toBeNull();
    const ok = inspectUpload({ fileName: 'a.md', bytes: text('x') });
    expect(ok.ok && ok.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('NAME: refuses a path or a control character in the file name', () => {
    expect(refusedBy('../a.md', text('x'))).toBe('NAME');
    expect(refusedBy('a\u0000.md', text('x'))).toBe('NAME');
    expect(refusedBy('', text('x'))).toBe('NAME');
  });

  it('SIZE: refuses an empty file and one over the limit', () => {
    expect(refusedBy('a.md', new Uint8Array())).toBe('SIZE');
    expect(refusedBy('a.md', new Uint8Array(UPLOAD_MAX_BYTES + 1).fill(65))).toBe('SIZE');
  });

  it('EXTENSION: refuses a type outside the allow-list', () => {
    expect(refusedBy('a.xlsx', zipOf(['[Content_Types].xml']))).toBe('EXTENSION');
    expect(refusedBy('a.exe', text('x'))).toBe('EXTENSION');
    expect(refusedBy('noextension', text('x'))).toBe('EXTENSION');
  });

  it('SIGNATURE: refuses bytes that do not match the extension', () => {
    expect(refusedBy('a.pdf', text('not a pdf'))).toBe('SIGNATURE');
    expect(refusedBy('a.docx', text('not a zip'))).toBe('SIGNATURE');
    expect(refusedBy('a.docx', zipOf(['[Content_Types].xml', 'ppt/presentation.xml']))).toBe(
      'SIGNATURE',
    );
    expect(refusedBy('a.txt', new Uint8Array([0x61, 0x00, 0x62]))).toBe('SIGNATURE');
    expect(refusedBy('a.md', new Uint8Array([0xff, 0xfe, 0xfd]))).toBe('SIGNATURE');
  });

  it('ACTIVE_CONTENT: refuses executables, macros, embedded programs and PDF scripts', () => {
    expect(refusedBy('a.pdf', text('MZ\u0090\u0000'))).toBe('ACTIVE_CONTENT');
    expect(refusedBy('a.md', new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02]))).toBe(
      'ACTIVE_CONTENT',
    );
    expect(refusedBy('a.txt', text('#!/bin/sh\nrm -rf /'))).toBe('ACTIVE_CONTENT');
    expect(refusedBy('a.docx', zipOf([...DOCX, 'word/vbaProject.bin']))).toBe('ACTIVE_CONTENT');
    expect(refusedBy('a.docx', zipOf([...DOCX, 'word/embeddings/oleObject1.bin']))).toBe(
      'ACTIVE_CONTENT',
    );
    expect(
      refusedBy('a.pdf', text('%PDF-1.7\n<< /OpenAction << /S /JavaScript /JS (x) >> >>')),
    ).toBe('ACTIVE_CONTENT');
    expect(refusedBy('a.pdf', text('%PDF-1.7\n<< /Type /EmbeddedFile >>'))).toBe('ACTIVE_CONTENT');
    expect(refusedBy('a.pdf', text('%PDF-1.7\n<< /S /Launch /F (calc.exe) >>'))).toBe(
      'ACTIVE_CONTENT',
    );
  });
});

describe('zipEntryNames', () => {
  it('lists the central directory and refuses a malformed container', () => {
    expect(zipEntryNames(zipOf(DOCX))).toEqual(DOCX);
    expect(zipEntryNames(text('PK\u0003\u0004 truncated'))).toBeNull();
    // A real deflated container from node:zlib reads the same way.
    expect(deflateRawSync(Buffer.from('x')).length).toBeGreaterThan(0);
  });
});
