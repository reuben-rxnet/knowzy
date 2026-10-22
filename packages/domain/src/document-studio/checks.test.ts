import { describe, expect, it } from 'vitest';
import { parsePreparedMarkdown } from '@knowzy/shared-types';
import { checkPreparedText, markChanges, wordCoverage } from './checks.js';

// Synthetic: a fictional lantern shop.
const ORIGINAL = [
  'Customers should return a lantern within 14 days of delivery.',
  'Warning: never accept a lantern with a cracked glass panel and escalate it to the shift lead.',
  'Staff must record every refund in the returns ledger before the end of the shift.',
].join('\n\n');

const prepared = (markdown: string) => parsePreparedMarkdown(markdown);

describe('checkPreparedText', () => {
  it('passes a verbatim reorganization with no warnings', () => {
    const result = checkPreparedText(
      ORIGINAL,
      prepared(
        [
          '## Returns',
          'Customers should return a lantern within 14 days of delivery.',
          '> Warning: never accept a lantern with a cracked glass panel and escalate it to the shift lead.',
          '## Records',
          'Staff must record every refund in the returns ledger before the end of the shift.',
        ].join('\n\n'),
      ),
    );
    expect(result.inventedFigures).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('finds a figure the original does not contain', () => {
    const result = checkPreparedText(
      ORIGINAL,
      prepared('Customers should return a lantern within 30 days of delivery.'),
    );
    expect(result.inventedFigures).toEqual(['30']);
    expect(result.warnings.some((w) => w.kind === 'INVENTED_QUANTITY')).toBe(true);
  });

  it('ignores figures inside a missing-information marker, which is not content', () => {
    const result = checkPreparedText(
      ORIGINAL,
      prepared('> [!MISSING] Nothing says what happens after 90 days.'),
    );
    expect(result.inventedFigures).toEqual([]);
  });

  it('warns when should becomes must, and when must becomes should', () => {
    const strengthened = checkPreparedText(
      ORIGINAL,
      prepared('Customers must return a lantern within 14 days of delivery.'),
    );
    expect(strengthened.warnings.map((w) => w.kind)).toContain('OBLIGATION_STRENGTHENED');
    const weakened = checkPreparedText(
      ORIGINAL,
      prepared(
        'Staff should record every refund in the returns ledger before the end of the shift.',
      ),
    );
    expect(weakened.warnings.map((w) => w.kind)).toContain('OBLIGATION_WEAKENED');
  });

  it('warns when a warning or escalation in the original has no close match', () => {
    const result = checkPreparedText(
      ORIGINAL,
      prepared('Customers should return a lantern within 14 days of delivery.'),
    );
    const removed = result.warnings.filter((w) => w.kind === 'POSSIBLY_REMOVED');
    expect(removed).toHaveLength(1);
    expect(removed[0]?.text).toMatch(/cracked glass panel/);
  });

  it('does not call a warning removed when it was merged into a longer step', () => {
    const result = checkPreparedText(
      ORIGINAL,
      prepared(
        [
          '1. Customers should return a lantern within 14 days of delivery. Never accept a lantern with a cracked glass panel; escalate it to the shift lead and note the order in the returns ledger with the courier details.',
          'Staff must record every refund in the returns ledger before the end of the shift.',
        ].join('\n\n'),
      ),
    );
    expect(result.warnings.filter((w) => w.kind === 'POSSIBLY_REMOVED')).toEqual([]);
  });

  it('reports a condensed preparation, naming the original lines that went', () => {
    const original = [
      ORIGINAL,
      'Order LNT-48213 was returned twice in March by courier Northwind Express.',
      'Job ARCHIVE_LANTERN_SYNC rebuilds the returns index every night from the ledger.',
    ].join('\n\n');
    const result = checkPreparedText(
      original,
      prepared(
        [
          'Customers should return a lantern within 14 days of delivery.',
          '> Warning: never accept a lantern with a cracked glass panel and escalate it to the shift lead.',
          'Staff must record every refund in the returns ledger before the end of the shift.',
        ].join('\n\n'),
      ),
    );
    const reduced = result.warnings.filter((w) => w.kind === 'CONTENT_REDUCED');
    expect(reduced.map((w) => w.text)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/LNT-48213/),
        expect.stringMatching(/ARCHIVE_LANTERN_SYNC/),
      ]),
    );
    expect(reduced[0]?.message).toMatch(/keeps about \d+% of the original's words/);
  });

  it('counts repetition, so one mention does not stand for five', () => {
    expect(wordCoverage('alpha alpha alpha alpha', 'alpha')).toBe(0.25);
    expect(wordCoverage('alpha beta', 'beta alpha gamma')).toBe(1);
  });
});

describe('markChanges', () => {
  it('marks verbatim sentences as from the original and reworded ones as changed', () => {
    const marked = markChanges(
      ORIGINAL,
      prepared(
        [
          '## Lantern returns',
          'Customers should return a lantern within 14 days of delivery. Returns are welcome.',
        ].join('\n\n'),
      ),
    );
    expect(marked[0]).toEqual({ type: 'heading', level: 2, text: 'Lantern returns', added: true });
    expect(marked[1]).toEqual({
      type: 'paragraph',
      segments: [
        {
          text: 'Customers should return a lantern within 14 days of delivery.',
          fromOriginal: true,
        },
        { text: 'Returns are welcome.', fromOriginal: false },
      ],
    });
  });
});
