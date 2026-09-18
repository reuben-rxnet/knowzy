// The extraction invariants, asserted one by one.
//
// knowledge-source-adapters.md §2.4 lists X1-X8. Every question Knowzy ever
// generates is grounded in a section produced here, and an evidence span is a
// pair of offsets into this text. If X2 breaks, every citation in the platform
// silently points at the wrong words — which is why these are tested as named
// invariants rather than as incidental assertions about output shape.

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { normalizeForComparison, normalizeText } from './normalize.js';
import { sectionize, type Section } from './sectionize.js';
import { extractHtml } from './extractors/html.js';
import { extractMarkdown, extractPlainText } from './extractors/text.js';
import { extractContent } from './extract.js';

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
  it('unifies line endings, folds punctuation, and collapses horizontal space', () => {
    const raw = 'The policy’s  \t“scope”\r\nis — clear…';
    expect(normalizeText(raw)).toBe('The policy\'s "scope"\nis - clear...');
  });

  it('preserves paragraph structure but collapses runs of blank lines', () => {
    expect(normalizeText('one\n\n\n\n\ntwo')).toBe('one\n\ntwo');
  });

  it('rejoins a word hyphenated across a line break', () => {
    expect(normalizeText('config-\nuration')).toBe('configuration');
  });

  it('leaves a genuine compound at a line end alone', () => {
    expect(normalizeText('read-\nOnly mode')).toBe('read-\nOnly mode');
  });

  it('strips zero-width characters that would break span matching', () => {
    expect(normalizeText('po​licy﻿')).toBe('policy');
  });

  it('uses one pipeline for comparison, differing only by case and wrapping', () => {
    expect(normalizeForComparison('The  Policy\nis clear')).toBe('the policy is clear');
  });
});

describe('X2 offsets index the returned text and round-trip exactly', () => {
  const cases = [
    ['markdown with headings', sectionize(extractMarkdown(MARKDOWN))],
    ['plain text windows', sectionize(extractPlainText(PLAIN))],
    [
      'html',
      sectionize(
        extractHtml(
          `<html><body><h1>Returns</h1><p>${paragraph('Items ship back prepaid.')}</p>` +
            `<h2>Exceptions</h2><p>${paragraph('Perishables are not returnable.')}</p></body></html>`,
        ),
      ),
    ],
  ] as const;

  for (const [label, result] of cases) {
    it(`round-trips every section (${label})`, () => {
      expect(result.sections.length).toBeGreaterThan(0);
      for (const section of result.sections) {
        expect(result.normalizedText.slice(section.startOffset, section.endOffset)).toBe(
          section.text,
        );
      }
    });

    it(`hashes each section over its own text (${label})`, () => {
      for (const section of result.sections) {
        expect(section.sectionContentHash).toBe(sha256(section.text));
      }
    });
  }
});

describe('X3 sections are ordered and non-overlapping', () => {
  const { sections } = sectionize(extractMarkdown(MARKDOWN));

  it('numbers ordinals from one with no gaps', () => {
    expect(sections.map((s) => s.ordinal)).toEqual(sections.map((_, i) => i + 1));
  });

  it('never overlaps and never runs backwards', () => {
    let previousEnd = -1;
    for (const section of sections) {
      expect(section.startOffset).toBeGreaterThan(previousEnd);
      expect(section.endOffset).toBeGreaterThan(section.startOffset);
      previousEnd = section.endOffset;
    }
  });

  it('gives every section a distinct key', () => {
    expect(new Set(sections.map((s) => s.sectionKey)).size).toBe(sections.length);
  });
});

describe('X4 headings are captured, never invented', () => {
  it('captures the heading path from markdown structure', () => {
    const { sections } = sectionize(extractMarkdown(MARKDOWN));
    expect(sections.map((s) => s.headingPath)).toEqual([
      'Support Operations Handbook',
      'Support Operations Handbook > Escalation',
      'Support Operations Handbook > Escalation > Severity One',
      'Support Operations Handbook > Revision History',
    ]);
  });

  it('labels plain-text sections honestly instead of guessing a heading', () => {
    const { sections } = sectionize(extractPlainText(PLAIN));
    expect(sections.length).toBeGreaterThan(0);
    for (const section of sections) {
      expect(section.heading).toBeNull();
      expect(section.headingPath).toBeNull();
      expect(section.label).toMatch(/^Segment \d+ of \d+$/);
    }
  });

  it('does not promote an ALL-CAPS line to a heading', () => {
    const { sections } = sectionize(
      extractPlainText(`ESCALATION POLICY\n\n${paragraph('Page the on-call engineer.')}`),
    );
    expect(sections.every((s) => s.heading === null)).toBe(true);
  });

  it('marks document furniture non-assessable', () => {
    const { sections } = sectionize(extractMarkdown(MARKDOWN));
    const furniture = sections.find((s) => s.heading === 'Revision History');
    expect(furniture?.isAssessable).toBe(false);
    expect(furniture?.nonAssessableReason).toContain('furniture');
    expect(sections.find((s) => s.heading === 'Escalation')?.isAssessable).toBe(true);
  });

  it('marks a section below the assessable minimum, with its length in the reason', () => {
    const { sections } = sectionize(extractMarkdown('## Scope\n\nApplies to retail only.'), {
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

  it('reports an unregistered file type as UNSUPPORTED', () => {
    const result = extractContent({ fileName: 'runbook.pdf', content: '%PDF-1.7' });
    expect(result.status).toBe('UNSUPPORTED');
    expect(result.reason).toContain('.pdf');
    noText(result);
  });

  it('reports a file with no extension rather than guessing', () => {
    const result = extractContent({ fileName: 'README', content: 'text' });
    expect(result.status).toBe('UNSUPPORTED');
    noText(result);
  });

  it('reports an oversize document before parsing it', () => {
    const result = extractContent(
      { fileName: 'big.txt', content: 'x'.repeat(5_000) },
      { maxBytes: 1_000 },
    );
    expect(result.status).toBe('TOO_LARGE');
    expect(result.reason).toContain('1000-byte limit');
    noText(result);
  });

  it('reports a document with no extractable text as EMPTY, not as success', () => {
    const result = extractContent({ fileName: 'blank.txt', content: '   \n\n\t\n' });
    expect(result.status).toBe('EMPTY');
    expect(result.reason).toContain('only images or no content');
    noText(result);
  });

  it('never returns EXTRACTED with empty text', () => {
    for (const content of ['', '   ', '\n\n\n', '<html><body></body></html>']) {
      const result = extractContent({ fileName: 'doc.html', content });
      expect(result.status).not.toBe('EXTRACTED');
      expect(result.charCount).toBe(0);
    }
  });

  it('carries text and a hash only on the success path', () => {
    const result = extractContent({ fileName: 'handbook.md', content: MARKDOWN });
    expect(result.status).toBe('EXTRACTED');
    expect(result.normalizedText).not.toBeNull();
    expect(result.charCount).toBe(result.normalizedText?.length);
    expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.reason).toBeNull();
  });
});

describe('X6 truncation ends at a section boundary and is reported', () => {
  const result = extractContent({ fileName: 'handbook.md', content: MARKDOWN }, { maxChars: 400 });

  it('reports the truncation instead of silently shortening', () => {
    expect(result.truncated).toBe(true);
    expect(result.reason).toContain('Truncated at a section boundary');
  });

  it('keeps whole sections only', () => {
    expect(result.sections.length).toBeGreaterThan(0);
    const last = result.sections[result.sections.length - 1];
    expect(last?.endOffset).toBe(result.normalizedText?.length);
    for (const section of result.sections) {
      expect(result.normalizedText?.slice(section.startOffset, section.endOffset)).toBe(
        section.text,
      );
    }
  });

  it('does not report truncation when the document fits', () => {
    const whole = extractContent({ fileName: 'handbook.md', content: MARKDOWN });
    expect(whole.truncated).toBe(false);
    expect(whole.sections.length).toBeGreaterThan(result.sections.length);
  });
});

describe('X7 the content hash is SHA-256 of the normalized text', () => {
  it('matches an independently computed digest', () => {
    const result = extractContent({ fileName: 'handbook.md', content: MARKDOWN });
    expect(result.contentHash).toBe(sha256(result.normalizedText ?? ''));
  });

  it('is unchanged by differences normalization removes', () => {
    const windows = extractContent({
      fileName: 'handbook.md',
      content: MARKDOWN.replace(/\n/g, '\r\n'),
    });
    const unix = extractContent({ fileName: 'handbook.md', content: MARKDOWN });
    expect(windows.contentHash).toBe(unix.contentHash);
  });

  it('changes when the text changes', () => {
    const edited = extractContent({
      fileName: 'handbook.md',
      content: MARKDOWN.replace('pager rotation table', 'escalation matrix'),
    });
    const original = extractContent({ fileName: 'handbook.md', content: MARKDOWN });
    expect(edited.contentHash).not.toBe(original.contentHash);
  });
});

describe('X8 extraction is deterministic', () => {
  it('produces identical output across runs', () => {
    const first = extractContent({ fileName: 'handbook.md', content: MARKDOWN });
    const second = extractContent({ fileName: 'handbook.md', content: MARKDOWN });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('keeps section keys stable when unrelated content changes', () => {
    const before = extractContent({ fileName: 'handbook.md', content: MARKDOWN });
    const after = extractContent({
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
  const result = sectionize(extractHtml(html));

  it('discards script and style contents entirely', () => {
    expect(result.normalizedText).not.toContain('SCRIPTLEAK');
    expect(result.normalizedText).not.toContain('color:red');
    expect(result.normalizedText).not.toContain('alert');
  });

  it('discards chrome that is not document content', () => {
    expect(result.normalizedText).not.toContain('Home');
    expect(result.normalizedText).not.toContain('Copyright notice');
  });

  it('decodes entities so an evidence span from the rendered page matches', () => {
    expect(result.sections[0]?.heading).toBe('Returns & Refunds');
  });
});
