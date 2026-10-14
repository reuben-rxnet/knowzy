// AI Document Studio M3 (§11.7): every download is read back through the
// platform's OWN extractors, so "the complete prepared content" is a property
// a test checks, not a hope. Synthetic content only.

import { describe, expect, it } from 'vitest';
import { writePreparedDocx, writePreparedPdf } from '@knowzy/certificate-generator';
import { extractContent } from '@knowzy/content-extraction';
import { parsePreparedMarkdown, preparedNotice } from '@knowzy/shared-types';

const MARKDOWN = `## Return window
Customers should return a lantern within 14 days of delivery.

> Warning: Never accept a lantern with a cracked glass panel.

1. Check the receipt.
2. Inspect the lantern.

| Condition | Action |
| --- | --- |
| Under 14 days | Refund in full |

> [!MISSING] No reason is given for the 14-day limit.
`;

const DOC = {
  title: 'Synthetic Lantern Returns — Assessment-prepared document',
  originalName: 'Synthetic Lantern Returns.docx',
  originalVersion: '4',
  preparedVersion: 3,
  preparedBy: 'Test preparation — not AI',
  preparedAt: '2026-10-14 09:00 UTC',
  nodes: parsePreparedMarkdown(MARKDOWN),
};

const EXPECTED = [
  preparedNotice(DOC.originalName),
  'Prepared document version: 3',
  'Return window',
  'Customers should return a lantern within 14 days of delivery.',
  'Never accept a lantern with a cracked glass panel.',
  'Check the receipt.',
  'Under 14 days',
  'Refund in full',
  'No reason is given for the 14-day limit.',
];

const flat = (text: string | null): string => (text ?? '').replace(/\s+/g, ' ');

describe('prepared downloads read back through the platform extractors', () => {
  it('Word: every heading, paragraph, warning, list item, table cell and marker survives', async () => {
    const extracted = await extractContent({
      fileName: 'prepared.docx',
      content: new Uint8Array(writePreparedDocx(DOC)),
    });
    expect(extracted.status).toBe('EXTRACTED');
    // A Word heading is carried as a SECTION heading, not in the body text.
    for (const text of EXPECTED.filter((line) => line !== 'Return window')) {
      expect(flat(extracted.normalizedText)).toContain(text);
    }
    expect(extracted.sections.some((section) => section.heading === 'Return window')).toBe(true);
  });

  it('PDF: the same content survives', async () => {
    const extracted = await extractContent({
      fileName: 'prepared.pdf',
      content: new Uint8Array(writePreparedPdf(DOC)),
    });
    expect(extracted.status).toBe('EXTRACTED');
    for (const text of EXPECTED) expect(flat(extracted.normalizedText)).toContain(text);
  });
});
