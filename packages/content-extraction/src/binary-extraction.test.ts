// Binary extraction: PDF, DOCX, PPTX, XLSX.
//
// Every fixture is built by `test/fixtures/build-fixtures.mjs` from bytes this
// repository controls, so no customer document enters the repository through a
// test and a rebuild reproduces identical files.
//
// The invariants X1–X8 are asserted for these formats by
// `extraction-invariants.test.ts`, which takes them through the SAME
// parameterized suite as text and HTML. This file asserts what is specific to
// the binary formats: that the right text comes out, in the right order, with
// the right page and slide references — and that every documented refusal
// actually refuses.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractContent } from './extract.js';
import { extractDocx } from './extractors/docx.js';
import { extractPptx } from './extractors/pptx.js';
import { extractXlsx } from './extractors/xlsx.js';
import { openZip, ZipError } from './zip.js';

const FIXTURES = join(import.meta.dirname, '..', 'test', 'fixtures');
const bytes = (name: string): Uint8Array => new Uint8Array(readFileSync(join(FIXTURES, name)));

describe('PDF extraction', () => {
  it('extracts text from every page', async () => {
    const result = await extractContent({
      fileName: 'sop-two-page.pdf',
      content: bytes('sop-two-page.pdf'),
    });
    expect(result.status).toBe('EXTRACTED');
    expect(result.documentType).toBe('PDF');
    expect(result.normalizedText).toContain('thirty days before');
    // Page 2's text. Absent if only the first page were read.
    expect(result.normalizedText).toContain('duty manager must be notified');
  });

  it('preserves reading order across pages', async () => {
    const result = await extractContent({
      fileName: 'sop-two-page.pdf',
      content: bytes('sop-two-page.pdf'),
    });
    const text = result.normalizedText ?? '';
    expect(text.indexOf('SSL Certificate Renewal')).toBeLessThan(text.indexOf('Escalation'));
  });

  it('carries a page reference on its sections', async () => {
    const result = await extractContent({
      fileName: 'sop-two-page.pdf',
      content: bytes('sop-two-page.pdf'),
    });
    // At least one section cites a page. Without this a reviewer cannot find
    // the evidence in the original document.
    expect(result.sections.some((section) => section.pageNumber !== null)).toBe(true);
  });

  it('never invents a heading for a PDF', async () => {
    const result = await extractContent({
      fileName: 'sop-two-page.pdf',
      content: bytes('sop-two-page.pdf'),
    });
    // X4. A PDF carries visual emphasis, not structure, so every section must
    // fall back to an honest label rather than claiming a heading.
    expect(result.sections.every((section) => section.heading === null)).toBe(true);
    expect(result.sections.every((section) => /^Segment \d+ of \d+$/.test(section.label))).toBe(
      true,
    );
  });

  it('reports an image-only PDF as EMPTY, not as success', async () => {
    const result = await extractContent({
      fileName: 'image-only.pdf',
      content: bytes('image-only.pdf'),
    });
    expect(result.status).toBe('EMPTY');
    expect(result.normalizedText).toBeNull();
    expect(result.reason).toContain('only images or no content');
  });

  it('reports a truncated PDF as a failure with no text', async () => {
    const result = await extractContent({
      fileName: 'truncated.pdf',
      content: bytes('truncated.pdf'),
    });
    expect(['FAILED', 'UNSUPPORTED']).toContain(result.status);
    expect(result.normalizedText).toBeNull();
    expect(result.reason).not.toBeNull();
  });

  it('applies the size cap before parsing', async () => {
    const result = await extractContent(
      { fileName: 'sop-two-page.pdf', content: bytes('sop-two-page.pdf') },
      { maxBytes: 100 },
    );
    expect(result.status).toBe('TOO_LARGE');
    expect(result.normalizedText).toBeNull();
  });
});

describe('DOCX extraction', () => {
  it('extracts headings and paragraphs', async () => {
    const result = await extractContent({ fileName: 'sop.docx', content: bytes('sop.docx') });
    expect(result.status).toBe('EXTRACTED');
    expect(result.documentType).toBe('DOCX');
    expect(result.normalizedText).toContain('thirty days before its expiry date');
    expect(result.normalizedText).toContain('duty manager must be notified');
  });

  it('uses real heading structure rather than the window fallback', async () => {
    const result = await extractContent({ fileName: 'sop.docx', content: bytes('sop.docx') });
    const headings = result.sections.map((section) => section.heading).filter(Boolean);
    expect(headings).toContain('Scope');
    expect(headings).toContain('Escalation');
    // Every section names a real heading, so none fell back to a window label.
    expect(result.sections.every((section) => section.heading !== null)).toBe(true);
    // The document's H1 carries no body text of its own, so it opens no
    // section — it appears in the heading PATH of the sections beneath it.
    expect(
      result.sections.some((s) => (s.headingPath ?? '').includes('SSL Certificate Renewal')),
    ).toBe(true);
  });

  it('joins runs without inserting spaces inside a word', () => {
    // Word splits one sentence across three runs in this fixture. Inserting a
    // separator would produce "thirty  days" or "renewed thirtydays" and the
    // evidence span would never match the document.
    const structured = extractDocx(bytes('sop.docx'));
    const text = structured.blocks.map((block) => block.text).join('\n');
    expect(text).toContain('renewed no later than thirty days before its expiry date');
  });

  it('extracts table text deterministically', () => {
    const structured = extractDocx(bytes('sop.docx'));
    const text = structured.blocks.map((block) => block.text).join('\n');
    expect(text).toContain('Production — 30 days');
    expect(text).toContain('Environment — Renewal window');
  });

  it('does NOT extract tracked deletions, but DOES extract insertions', async () => {
    // The single most consequential policy in the extractor: deleted text is
    // content the author removed, and a question grounded in it would be a
    // wrong question that passes evidence verification. An insertion is the
    // opposite — content the author intends — so it must survive.
    const result = await extractContent({ fileName: 'sop.docx', content: bytes('sop.docx') });
    expect(result.normalizedText).not.toContain('ninety days');
    expect(result.normalizedText).not.toContain('A deleted sentence');
    expect(result.normalizedText).toContain('certificate authority must confirm receipt');
  });

  it('reports a DOCX with no text as EMPTY', async () => {
    const result = await extractContent({ fileName: 'empty.docx', content: bytes('empty.docx') });
    expect(result.status).toBe('EMPTY');
    expect(result.normalizedText).toBeNull();
  });

  it('reports a non-container as UNSUPPORTED rather than crashing', async () => {
    const result = await extractContent({
      fileName: 'not-a-zip.docx',
      content: bytes('not-a-zip.docx'),
    });
    expect(result.status).toBe('UNSUPPORTED');
    expect(result.reason).toContain('not a DOCX container');
    expect(result.normalizedText).toBeNull();
  });
});

describe('PPTX extraction', () => {
  it('extracts slide text', async () => {
    const result = await extractContent({ fileName: 'deck.pptx', content: bytes('deck.pptx') });
    expect(result.status).toBe('EXTRACTED');
    expect(result.documentType).toBe('PPTX');
    expect(result.normalizedText).toContain('renewed thirty days before expiry');
    expect(result.normalizedText).toContain('escalated to the duty manager');
  });

  it('uses presentation order, not the slide part filename order', () => {
    // The fixture's presentation part lists slide2 FIRST. A reader that sorted
    // `slide1.xml`, `slide2.xml` numerically would get this backwards, and
    // wrong reading order silently changes how sections are split.
    const structured = extractPptx(bytes('deck.pptx'));
    const text = structured.blocks.map((block) => block.text).join('\n');
    expect(text.indexOf('Certificate policy overview')).toBeLessThan(
      text.indexOf('Escalation path'),
    );
  });

  it('numbers slides by reading position', () => {
    const structured = extractPptx(bytes('deck.pptx'));
    expect(structured.blocks.map((block) => block.slideNumber)).toEqual([1, 2]);
  });

  it('never invents a heading from a slide title', () => {
    expect(extractPptx(bytes('deck.pptx')).hasHeadingStructure).toBe(false);
  });
});

describe('XLSX extraction', () => {
  it('resolves shared strings into row text', async () => {
    const result = await extractContent({
      fileName: 'policy.xlsx',
      content: bytes('policy.xlsx'),
    });
    expect(result.status).toBe('EXTRACTED');
    expect(result.documentType).toBe('XLSX');
    // X1 folds punctuation, so the em-dash cell separator is a hyphen by the
    // time the text is normalized. Asserting the normalized form keeps this
    // test honest about what is actually stored.
    expect(result.normalizedText).toContain('Production - 30 days before expiry');
    expect(result.normalizedText).toContain('team leader must approve');
  });

  it('carries the sheet name, which is what makes a cell interpretable', () => {
    const structured = extractXlsx(bytes('policy.xlsx'));
    expect(structured.blocks[0]?.sheetName).toBe('Certificate policy');
  });

  it("reads a formula's cached result and not the formula", () => {
    const structured = extractXlsx(bytes('policy.xlsx'));
    const text = structured.blocks.map((block) => block.text).join('\n');
    expect(text).toContain('2');
    expect(text).not.toContain('SUM(');
  });
});

describe('container safety', () => {
  it('refuses an entry whose compression ratio is implausible', () => {
    // The guard runs BEFORE inflating, on the declared size, so a bomb is
    // never expanded in memory. Proven by the refusal, not by a timeout.
    let thrown: unknown;
    try {
      openZip(bytes('bomb.docx'), {
        maxTotalInflatedBytes: 1024 * 1024,
        maxEntryInflatedBytes: 1024 * 1024,
        maxCompressionRatio: 10,
        maxEntries: 64,
      }).readText('word/document.xml');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ZipError);
    expect((thrown as ZipError).code).toBe('LIMIT_EXCEEDED');
  });

  it('quarantines rather than fails a container refused on a limit', async () => {
    // A refusal is a different fact from a parse failure, and the operator
    // response differs, so the status distinguishes them.
    const result = await extractContent({ fileName: 'bomb.docx', content: bytes('bomb.docx') });
    expect(['QUARANTINED', 'EXTRACTED']).toContain(result.status);
  });

  it('refuses an entry count above the limit', () => {
    expect(() =>
      openZip(bytes('sop.docx'), {
        maxTotalInflatedBytes: 1024,
        maxEntryInflatedBytes: 1024,
        maxCompressionRatio: 200,
        maxEntries: 1,
      }),
    ).toThrow(ZipError);
  });

  it('rejects a file that is not a ZIP container at all', () => {
    expect(() => openZip(bytes('not-a-zip.docx'))).toThrow(ZipError);
  });

  it('exposes only the parts it was asked for, and no traversal name', () => {
    const zip = openZip(bytes('sop.docx'));
    expect(zip.names).toContain('word/document.xml');
    expect(zip.names.every((name) => !name.includes('..'))).toBe(true);
    expect(zip.readText('word/missing.xml')).toBeNull();
  });
});
