// The extraction invariants, asserted one by one.
//
// knowledge-source-adapters.md §2.4 lists X1-X8. Every question Knowzy ever
// generates is grounded in a section produced here, and an evidence span is a
// pair of offsets into this text. If X2 breaks, every citation in the platform
// silently points at the wrong words — which is why these are tested as named
// invariants rather than as incidental assertions about output shape.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { normalizeForComparison, normalizeText } from '@knowzy/shared-types';
import { sectionize, type Section } from './sectionize.js';
import { extractHtml } from './extractors/html.js';
import { extractMarkdown, extractPlainText } from './extractors/text.js';
import { extractContent } from './extract.js';
import {
  buildXlsx,
  num,
  row,
  s,
  si,
  styled,
} from '../../testing/contracts/support/synthetic-xlsx.js';

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

const paragraph = (seed: string): string =>
  `${seed} `.repeat(40).trim() + ' Escalate to the duty manager within fifteen minutes.';

const MARKDOWN = [
  '# Support Operations Handbook',
  '',
  paragraph('The handbook governs frontline response.'),
  '',
  '## Escalation',
  '',
  paragraph('A severity one incident pages the on-call engineer immediately.'),
  '',
  '### Severity One',
  '',
  paragraph('Severity one means total loss of service for all customers.'),
  '',
  '## Revision History',
  '',
  paragraph('Version two replaced the pager rotation table.'),
  '',
].join('\n');

const PLAIN = [
  paragraph('Refund requests above five hundred euros need approval.'),
  paragraph('A chargeback must be answered within seven calendar days.'),
  paragraph('Goodwill credits are capped at fifty euros per customer per year.'),
].join('\n\n');

describe('X1 normalization', () => {
  it('unifies line endings, folds punctuation, and collapses horizontal space', async () => {
    const raw = 'The policy’s  \t“scope”\r\nis — clear…';
    expect(normalizeText(raw)).toBe('The policy\'s "scope"\nis - clear...');
  });

  it('preserves paragraph structure but collapses runs of blank lines', async () => {
    expect(normalizeText('one\n\n\n\n\ntwo')).toBe('one\n\ntwo');
  });

  it('rejoins a word hyphenated across a line break', async () => {
    expect(normalizeText('config-\nuration')).toBe('configuration');
  });

  it('leaves a genuine compound at a line end alone', async () => {
    expect(normalizeText('read-\nOnly mode')).toBe('read-\nOnly mode');
  });

  it('strips zero-width characters that would break span matching', async () => {
    expect(normalizeText('po​licy﻿')).toBe('policy');
  });

  it('uses one pipeline for comparison, differing only by case and wrapping', async () => {
    expect(normalizeForComparison('The  Policy\nis clear')).toBe('the policy is clear');
  });
});

describe('X2 offsets index the returned text and round-trip exactly', () => {
  const cases = [
    [
      'markdown with headings',
      sectionize(extractMarkdown(MARKDOWN), { documentScope: 'invariants-fixture' }),
    ],
    [
      'plain text windows',
      sectionize(extractPlainText(PLAIN), { documentScope: 'invariants-fixture' }),
    ],
    [
      'html',
      sectionize(
        extractHtml(
          `<html><body><h1>Returns</h1><p>${paragraph('Items ship back prepaid.')}</p>` +
            `<h2>Exceptions</h2><p>${paragraph('Perishables are not returnable.')}</p></body></html>`,
        ),
        { documentScope: 'invariants-fixture' },
      ),
    ],
  ] as const;

  for (const [label, result] of cases) {
    it(`round-trips every section (${label})`, async () => {
      expect(result.sections.length).toBeGreaterThan(0);
      for (const section of result.sections) {
        expect(result.normalizedText.slice(section.startOffset, section.endOffset)).toBe(
          section.text,
        );
      }
    });

    it(`hashes each section over its own text (${label})`, async () => {
      for (const section of result.sections) {
        expect(section.sectionContentHash).toBe(sha256(section.text));
      }
    });
  }
});

describe('X3 sections are ordered and non-overlapping', () => {
  const { sections } = sectionize(extractMarkdown(MARKDOWN), {
    documentScope: 'invariants-fixture',
  });

  it('numbers ordinals from one with no gaps', async () => {
    expect(sections.map((s) => s.ordinal)).toEqual(sections.map((_, i) => i + 1));
  });

  it('never overlaps and never runs backwards', async () => {
    let previousEnd = -1;
    for (const section of sections) {
      expect(section.startOffset).toBeGreaterThan(previousEnd);
      expect(section.endOffset).toBeGreaterThan(section.startOffset);
      previousEnd = section.endOffset;
    }
  });

  it('gives every section a distinct key', async () => {
    expect(new Set(sections.map((s) => s.sectionKey)).size).toBe(sections.length);
  });
});

describe('X4 headings are captured, never invented', () => {
  it('captures the heading path from markdown structure', async () => {
    const { sections } = sectionize(extractMarkdown(MARKDOWN), {
      documentScope: 'invariants-fixture',
    });
    expect(sections.map((s) => s.headingPath)).toEqual([
      'Support Operations Handbook',
      'Support Operations Handbook > Escalation',
      'Support Operations Handbook > Escalation > Severity One',
      'Support Operations Handbook > Revision History',
    ]);
  });

  it('labels plain-text sections honestly instead of guessing a heading', async () => {
    const { sections } = sectionize(extractPlainText(PLAIN), {
      documentScope: 'invariants-fixture',
    });
    expect(sections.length).toBeGreaterThan(0);
    for (const section of sections) {
      expect(section.heading).toBeNull();
      expect(section.headingPath).toBeNull();
      expect(section.label).toMatch(/^Segment \d+ of \d+$/);
    }
  });

  it('does not promote an ALL-CAPS line to a heading', async () => {
    const { sections } = sectionize(
      extractPlainText(`ESCALATION POLICY\n\n${paragraph('Page the on-call engineer.')}`),
      { documentScope: 'invariants-fixture' },
    );
    expect(sections.every((s) => s.heading === null)).toBe(true);
  });

  it('marks document furniture non-assessable', async () => {
    const { sections } = sectionize(extractMarkdown(MARKDOWN), {
      documentScope: 'invariants-fixture',
    });
    const furniture = sections.find((s) => s.heading === 'Revision History');
    expect(furniture?.isAssessable).toBe(false);
    expect(furniture?.nonAssessableReason).toContain('furniture');
    expect(sections.find((s) => s.heading === 'Escalation')?.isAssessable).toBe(true);
  });

  it('marks a section below the assessable minimum, with its length in the reason', async () => {
    const { sections } = sectionize(extractMarkdown('## Scope\n\nApplies to retail only.'), {
      documentScope: 'invariants-fixture',
      minAssessableChars: 300,
    });
    expect(sections[0]?.isAssessable).toBe(false);
    expect(sections[0]?.nonAssessableReason).toContain('minimum assessable length');
  });
});

describe('X5 an unextractable document returns a reason and no text', () => {
  const noText = (result: {
    normalizedText: string | null;
    sections: readonly Section[];
    reason: string | null;
  }): void => {
    expect(result.normalizedText).toBeNull();
    expect(result.sections).toEqual([]);
    expect(result.reason).not.toBeNull();
  };

  it('reports an unregistered file type as UNSUPPORTED', async () => {
    // `.doc` is the LEGACY binary Word format. It is deliberately not
    // registered — it is a different container from DOCX entirely — so it is
    // the honest example of an unsupported type now that DOCX is supported.
    const result = await extractContent({ fileName: 'runbook.doc', content: 'anything' });
    expect(result.status).toBe('UNSUPPORTED');
    expect(result.reason).toContain('.doc');
    noText(result);
  });

  it('refuses text supplied for a binary format rather than decoding it', async () => {
    // Coercing here would hand a PDF parser a re-encoded string, or decode
    // bytes as UTF-8 into mojibake that extracts "successfully" into nonsense.
    const result = await extractContent({ fileName: 'runbook.pdf', content: '%PDF-1.7' });
    expect(result.status).toBe('UNSUPPORTED');
    expect(result.reason).toContain('requires binary content');
    noText(result);
  });

  it('refuses bytes supplied for a text format', async () => {
    const result = await extractContent({
      fileName: 'notes.txt',
      content: new Uint8Array([1, 2, 3]),
    });
    expect(result.status).toBe('UNSUPPORTED');
    expect(result.reason).toContain('requires text content');
    noText(result);
  });

  it('reports a file with no extension rather than guessing', async () => {
    const result = await extractContent({ fileName: 'README', content: 'text' });
    expect(result.status).toBe('UNSUPPORTED');
    noText(result);
  });

  it('reports an oversize document before parsing it', async () => {
    const result = await extractContent(
      { fileName: 'big.txt', content: 'x'.repeat(5_000) },
      { maxBytes: 1_000 },
    );
    expect(result.status).toBe('TOO_LARGE');
    expect(result.reason).toContain('1000-byte limit');
    noText(result);
  });

  it('reports a document with no extractable text as EMPTY, not as success', async () => {
    const result = await extractContent({ fileName: 'blank.txt', content: '   \n\n\t\n' });
    expect(result.status).toBe('EMPTY');
    expect(result.reason).toContain('only images or no content');
    noText(result);
  });

  it('never returns EXTRACTED with empty text', async () => {
    for (const content of ['', '   ', '\n\n\n', '<html><body></body></html>']) {
      const result = await extractContent({ fileName: 'doc.html', content });
      expect(result.status).not.toBe('EXTRACTED');
      expect(result.charCount).toBe(0);
    }
  });

  it('carries text and a hash only on the success path', async () => {
    const result = await extractContent({ fileName: 'handbook.md', content: MARKDOWN });
    expect(result.status).toBe('EXTRACTED');
    expect(result.normalizedText).not.toBeNull();
    expect(result.charCount).toBe(result.normalizedText?.length);
    expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.reason).toBeNull();
  });
});

describe('X6 truncation ends at a section boundary and is reported', () => {
  let result: Awaited<ReturnType<typeof extractContent>>;
  beforeAll(async () => {
    result = await extractContent(
      { fileName: 'handbook.md', content: MARKDOWN },
      { maxChars: 400 },
    );
  });

  it('reports the truncation instead of silently shortening', async () => {
    expect(result.truncated).toBe(true);
    expect(result.reason).toContain('Truncated at a section boundary');
  });

  it('keeps whole sections only', async () => {
    expect(result.sections.length).toBeGreaterThan(0);
    const last = result.sections[result.sections.length - 1];
    expect(last?.endOffset).toBe(result.normalizedText?.length);
    for (const section of result.sections) {
      expect(result.normalizedText?.slice(section.startOffset, section.endOffset)).toBe(
        section.text,
      );
    }
  });

  it('does not report truncation when the document fits', async () => {
    const whole = await extractContent({ fileName: 'handbook.md', content: MARKDOWN });
    expect(whole.truncated).toBe(false);
    expect(whole.sections.length).toBeGreaterThan(result.sections.length);
  });
});

describe('X7 the content hash is SHA-256 of the normalized text', () => {
  it('matches an independently computed digest', async () => {
    const result = await extractContent({ fileName: 'handbook.md', content: MARKDOWN });
    expect(result.contentHash).toBe(sha256(result.normalizedText ?? ''));
  });

  it('is unchanged by differences normalization removes', async () => {
    const windows = await extractContent({
      fileName: 'handbook.md',
      content: MARKDOWN.replace(/\n/g, '\r\n'),
    });
    const unix = await extractContent({ fileName: 'handbook.md', content: MARKDOWN });
    expect(windows.contentHash).toBe(unix.contentHash);
  });

  it('changes when the text changes', async () => {
    const edited = await extractContent({
      fileName: 'handbook.md',
      content: MARKDOWN.replace('pager rotation table', 'escalation matrix'),
    });
    const original = await extractContent({ fileName: 'handbook.md', content: MARKDOWN });
    expect(edited.contentHash).not.toBe(original.contentHash);
  });
});

describe('X8 extraction is deterministic', () => {
  it('produces identical output across runs', async () => {
    const first = await extractContent({ fileName: 'handbook.md', content: MARKDOWN });
    const second = await extractContent({ fileName: 'handbook.md', content: MARKDOWN });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('keeps section keys stable when unrelated content changes', async () => {
    const before = await extractContent({ fileName: 'handbook.md', content: MARKDOWN });
    const after = await extractContent({
      fileName: 'handbook.md',
      content: MARKDOWN.replace('pager rotation table', 'escalation matrix'),
    });
    expect(after.sections.map((s) => s.sectionKey)).toEqual(
      before.sections.map((s) => s.sectionKey),
    );
  });
});

describe('HTML is sanitized, not swept with a regex', () => {
  const html = [
    '<html><head><title>Ignored</title><style>.a{color:red}</style></head><body>',
    '<nav><a href="/x">Home</a></nav>',
    '<script>var policy = "SCRIPTLEAK"; if (a < b) { alert("x"); }</script>',
    '<h1>Returns &amp; Refunds</h1>',
    `<p>${paragraph('A refund is issued to the original payment method.')}</p>`,
    '<footer>Copyright notice</footer>',
    '</body></html>',
  ].join('');
  const result = sectionize(extractHtml(html), { documentScope: 'invariants-fixture' });

  it('discards script and style contents entirely', async () => {
    expect(result.normalizedText).not.toContain('SCRIPTLEAK');
    expect(result.normalizedText).not.toContain('color:red');
    expect(result.normalizedText).not.toContain('alert');
  });

  it('discards chrome that is not document content', async () => {
    expect(result.normalizedText).not.toContain('Home');
    expect(result.normalizedText).not.toContain('Copyright notice');
  });

  it('decodes entities so an evidence span from the rendered page matches', async () => {
    expect(result.sections[0]?.heading).toBe('Returns & Refunds');
  });
});

// ---------------------------------------------------------------------------
// The same invariants, for the BINARY formats.
//
// Parameterized over PDF, DOCX, PPTX and XLSX so each one inherits X1-X8
// rather than being spot-checked. A new binary extractor is added to this one
// array and immediately has to satisfy every invariant the text formats do,
// which is the point of holding them in a table.

describe('X1-X8 hold for the binary formats too', () => {
  const FIXTURES = join(import.meta.dirname, '..', 'test', 'fixtures');
  // XLSX-INTEGRITY-M1: policy.xlsx has no styled empty cell, so the invariants
  // never met the shape that broke placement. This synthetic workbook is ALL
  // that shape: styled empties before values, omitted cells, an empty <si/>,
  // a self-closing row, two sheets.
  const SPARSE_STYLED = buildXlsx({
    sheets: [
      {
        name: 'Renewal windows',
        rows:
          '<row r="1"/>' +
          row(2, styled('A2'), s('B2', 0), styled('C2'), s('E2', 2)) +
          row(3, s('A3', 3), styled('B3'), num('D3', 30), styled('E3'), s('F3', 4)),
      },
      { name: 'Owners', rows: row(1, styled('A1'), styled('B1'), s('C1', 5)) },
    ],
    sharedStrings: [
      si('Production certificates renew thirty days before expiry.'),
      '<si/>',
      si('Level two operations owns every renewal.'),
      si('Staging window'),
      si('Escalate a missed renewal to the platform duty manager.'),
      si('The platform duty manager approves an emergency renewal.'),
    ],
  });
  const SYNTHETIC: Record<string, Uint8Array> = { 'sparse-styled.xlsx': SPARSE_STYLED };
  const fixtureBytes = (name: string): Uint8Array =>
    SYNTHETIC[name] ?? new Uint8Array(readFileSync(join(FIXTURES, name)));

  const BINARY_CASES = [
    ['pdf', 'sop-two-page.pdf'],
    ['docx', 'sop.docx'],
    ['pptx', 'deck.pptx'],
    ['xlsx', 'policy.xlsx'],
    ['xlsx (sparse, styled empty cells)', 'sparse-styled.xlsx'],
  ] as const;

  it('the sparse styled workbook carries no shared-string index into its text', async () => {
    const text = (await extractContent({ fileName: 'sparse-styled.xlsx', content: SPARSE_STYLED }))
      .normalizedText;
    // The only visible number is "30"; indexes 0-5 would add others.
    expect(text?.replace('30', '')).not.toMatch(/\d/);
    expect(text).toContain('Staging window');
  });

  for (const [label, fileName] of BINARY_CASES) {
    describe(label, () => {
      let result: Awaited<ReturnType<typeof extractContent>>;
      beforeAll(async () => {
        result = await extractContent({ fileName, content: fixtureBytes(fileName) });
      });

      it('extracts successfully with text and a hash', () => {
        expect(result.status).toBe('EXTRACTED');
        expect(result.normalizedText).not.toBeNull();
        expect(result.contentHash).not.toBeNull();
        expect(result.sections.length).toBeGreaterThan(0);
      });

      it('X2 round-trips every section offset into the returned text', () => {
        for (const section of result.sections) {
          expect(result.normalizedText?.slice(section.startOffset, section.endOffset)).toBe(
            section.text,
          );
        }
      });

      it('X2 hashes each section over its own text', () => {
        for (const section of result.sections) {
          expect(section.sectionContentHash).toBe(sha256(section.text));
        }
      });

      it('X3 numbers ordinals from one with no gaps, and never overlaps', () => {
        expect(result.sections.map((s) => s.ordinal)).toEqual(
          result.sections.map((_, index) => index + 1),
        );
        for (let i = 1; i < result.sections.length; i += 1) {
          const previous = result.sections[i - 1];
          const current = result.sections[i];
          expect(current?.startOffset).toBeGreaterThanOrEqual(previous?.endOffset ?? 0);
        }
      });

      it('X3 gives every section a distinct key', () => {
        const keys = result.sections.map((s) => s.sectionKey);
        expect(new Set(keys).size).toBe(keys.length);
      });

      it('X4 never claims a heading the document does not have', () => {
        for (const section of result.sections) {
          if (section.heading === null) {
            expect(section.label).toMatch(/^Segment \d+ of \d+$/);
          } else {
            expect(section.label).toBe(section.heading);
          }
        }
      });

      it('X7 hashes the normalized text', () => {
        expect(result.contentHash).toBe(sha256(result.normalizedText ?? ''));
      });

      it('X8 is deterministic across runs', async () => {
        const again = await extractContent({ fileName, content: fixtureBytes(fileName) });
        expect(JSON.stringify(again)).toBe(JSON.stringify(result));
      });

      it('X1 leaves no zero-width or CRLF artifacts in the text', () => {
        const text = result.normalizedText ?? '';
        expect(text).not.toMatch(/[\u200b-\u200d\ufeff]/);
        expect(text).not.toContain('\r');
      });
    });
  }
});
