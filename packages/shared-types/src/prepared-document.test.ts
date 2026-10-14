import { describe, expect, it } from 'vitest';
import {
  parsePreparedMarkdown,
  PreparationOutputSchema,
  preparedDownloadName,
  preparedNotice,
  quantitiesOf,
  renderPreparationMarkdown,
  repositoryMarkdown,
  safeFileStem,
  type PreparationOutput,
} from './prepared-document.js';

// Synthetic: a fictional lantern shop. No real procedure.
const OUTPUT: PreparationOutput = {
  sections: [
    {
      heading: 'Return window',
      kind: 'RULE',
      blocks: [
        { type: 'paragraph', text: 'A lantern must be returned within 14 days.' },
        { type: 'warning', text: 'Never accept a cracked panel.' },
      ],
    },
    {
      heading: 'Refund steps',
      kind: 'PROCEDURE',
      blocks: [
        { type: 'numbered_list', items: ['Check the receipt.', 'Inspect the lantern.'] },
        {
          type: 'table',
          header: ['Condition', 'Action'],
          rows: [['Under 14 days', 'Refund | in full']],
        },
      ],
    },
  ],
  findings: [
    {
      kind: 'MISSING_INFORMATION',
      sectionHeading: 'Return window',
      message: 'No reason is given.',
    },
    { kind: 'UNCLEAR', sectionHeading: null, message: 'The desk is not named.' },
  ],
};

describe('the prepared-document dialect', () => {
  it('renders a preparation and parses it back to the same structure', () => {
    const markdown = renderPreparationMarkdown(OUTPUT);
    const nodes = parsePreparedMarkdown(markdown);
    expect(nodes.map((node) => node.type)).toEqual([
      'heading',
      'paragraph',
      'warning',
      'marker',
      'heading',
      'list',
      'table',
      'marker',
    ]);
    expect(nodes[2]).toEqual({ type: 'warning', text: 'Never accept a cracked panel.' });
    expect(nodes[5]).toEqual({
      type: 'list',
      ordered: true,
      items: ['Check the receipt.', 'Inspect the lantern.'],
    });
    // A pipe inside a cell cannot break the table.
    expect(nodes[6]).toEqual({
      type: 'table',
      header: ['Condition', 'Action'],
      rows: [['Under 14 days', 'Refund / in full']],
    });
  });

  it('places a finding beside the section it names, and an unplaced one at the end', () => {
    const nodes = parsePreparedMarkdown(renderPreparationMarkdown(OUTPUT));
    expect(nodes[3]).toEqual({
      type: 'marker',
      marker: 'MISSING_INFORMATION',
      text: 'No reason is given.',
    });
    expect(nodes.at(-1)).toEqual({
      type: 'marker',
      marker: 'UNCLEAR',
      text: 'The desk is not named.',
    });
  });

  it('keeps unrecognised text as a paragraph rather than dropping it', () => {
    expect(parsePreparedMarkdown('Some text\nthat wraps.\n\n> [!UNKNOWN] tag')).toEqual([
      { type: 'paragraph', text: 'Some text that wraps.' },
      { type: 'warning', text: '[!UNKNOWN] tag' },
    ]);
  });
});

describe('the repository text', () => {
  it('drops every missing-information marker, so no question is generated from one', () => {
    const text = repositoryMarkdown(parsePreparedMarkdown(renderPreparationMarkdown(OUTPUT)));
    expect(text).not.toMatch(/No reason is given|not named|\[!/);
    expect(text).toMatch(/Warning: Never accept a cracked panel\./);
    expect(text).toMatch(/- Condition: Under 14 days; Action: Refund \/ in full\./);
    expect(text).toMatch(/^## Return window/m);
  });
});

describe('the output schema', () => {
  it('is strict: an extra field is a failed preparation', () => {
    expect(PreparationOutputSchema.safeParse(OUTPUT).success).toBe(true);
    expect(PreparationOutputSchema.safeParse({ ...OUTPUT, questions: [] }).success).toBe(false);
    expect(PreparationOutputSchema.safeParse({ sections: [], findings: [] }).success).toBe(false);
  });
});

describe('text helpers', () => {
  it('normalizes figures so 1,000 and 1000 are one figure', () => {
    expect(quantitiesOf('A fee of 1,000 and 25% within 14 days on 2026-10-14')).toEqual(
      new Set(['1000', '25', '14', '2026-10-14']),
    );
  });

  it('makes safe download names and states the notice verbatim', () => {
    expect(safeFileStem('../../Returns: SOP <v2>.docx')).toBe('Returns SOP v2');
    expect(preparedDownloadName('Lantern Returns.pdf', 'docx')).toBe(
      'Lantern Returns - Assessment Prepared.docx',
    );
    expect(safeFileStem('***.md')).toBe('Document');
    expect(preparedNotice('Lantern Returns.docx')).toBe(
      'Assessment-prepared document derived from Lantern Returns.docx. This document is intended for question generation and does not replace the authoritative original.',
    );
  });
});
