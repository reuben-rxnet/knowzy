import { describe, expect, it } from 'vitest';
import type {
  DocumentPreparer,
  PreparationRequest,
  PreparationSection,
} from '@knowzy/claude-services';
import {
  estimateTokensInParts,
  MIN_PART_COVERAGE,
  PART_CHARS,
  PART_CONCURRENCY,
  partition,
  prepareInParts,
} from './chunked-preparation.js';

// Synthetic: a fictional lantern shop, one numbered step per paragraph.
const step = (n: number): string =>
  `Step ${n}: check lantern LNT-${10_000 + n} against the returns ledger and record the courier reference CR-${n} before closing the ticket.`;

const section = (heading: string | null, count: number, from = 1): PreparationSection => ({
  heading,
  text: Array.from({ length: count }, (_, i) => step(from + i)).join('\n'),
  isAssessable: true,
});

/** Echoes every paragraph verbatim, or only the first half when told to condense. */
const fakePreparer = (opts: {
  live?: boolean;
  condense?: (request: PreparationRequest) => boolean;
  onCall?: (request: PreparationRequest) => void;
  delayMs?: number;
}): DocumentPreparer & { inFlight: { now: number; max: number } } => {
  const inFlight = { now: 0, max: 0 };
  return {
    providerId: 'OPENAI',
    modelId: 'fake-model',
    live: opts.live ?? true,
    inFlight,
    async prepare(request) {
      opts.onCall?.(request);
      inFlight.now += 1;
      inFlight.max = Math.max(inFlight.max, inFlight.now);
      await new Promise((resolve) => setTimeout(resolve, opts.delayMs ?? 1));
      inFlight.now -= 1;
      const condense = opts.condense?.(request) ?? false;
      return {
        output: {
          sections: request.sections.map((s, i) => {
            const lines = s.text.split('\n');
            const kept = condense ? lines.slice(0, Math.ceil(lines.length / 2)) : lines;
            return {
              heading: s.heading ?? `Part ${request.part?.index ?? 0}.${i}`,
              kind: 'PROCEDURE' as const,
              blocks: [{ type: 'numbered_list' as const, items: kept }],
            };
          }),
          findings: [],
        },
        inputTokens: 100,
        outputTokens: 50,
        servedModel: 'fake-model-served',
      };
    },
  };
};

describe('partition', () => {
  it('keeps a short document in one part', () => {
    const parts = partition([section('Returns', 5)]);
    expect(parts).toHaveLength(1);
  });

  it('splits by section, never exceeding the limit by more than one section', () => {
    const sections = Array.from({ length: 12 }, (_, i) => section(`S${i}`, 6, i * 6 + 1));
    const parts = partition(sections);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.flat()).toEqual(sections);
    for (const part of parts) {
      const size = part.reduce((n, s) => n + s.text.length + (s.heading?.length ?? 0) + 1, 0);
      expect(size).toBeLessThanOrEqual(PART_CHARS + 1_000);
    }
  });

  it('splits an oversized section at paragraph breaks and invents no heading', () => {
    const big = section('Procedure', 120);
    expect(big.text.length).toBeGreaterThan(PART_CHARS * 2);
    const pieces = partition([big]).flat();
    expect(pieces.length).toBeGreaterThan(2);
    expect(pieces[0]?.heading).toBe('Procedure');
    expect(pieces.slice(1).every((p) => p.heading === null)).toBe(true);
    expect(pieces.map((p) => p.text).join('\n')).toBe(big.text);
  });
});

describe('prepareInParts', () => {
  const longRequest: PreparationRequest = {
    documentName: 'Lantern returns',
    sections: Array.from({ length: 20 }, (_, i) => section(`S${i}`, 8, i * 8 + 1)),
  };

  it('prepares every part, in order, tells each which part it is, and sums usage', async () => {
    const seen: PreparationRequest[] = [];
    const preparer = fakePreparer({ onCall: (r) => seen.push(r) });
    const result = await prepareInParts(preparer, longRequest);
    const count = partition(longRequest.sections).length;
    expect(count).toBeGreaterThan(2);
    expect(seen).toHaveLength(count);
    expect(seen.every((r) => r.part?.count === count && r.strict === undefined)).toBe(true);
    expect(result.output.sections.map((s) => s.heading)).toEqual(
      longRequest.sections.map((s) => s.heading),
    );
    expect(result.inputTokens).toBe(100 * count);
    expect(result.outputTokens).toBe(50 * count);
    expect(result.servedModel).toBe('fake-model-served');
    expect(result.parts.every((p) => p.coverage === 1 && !p.retried)).toBe(true);
  });

  it(`runs at most ${PART_CONCURRENCY} parts at once`, async () => {
    const preparer = fakePreparer({ delayMs: 10 });
    await prepareInParts(preparer, longRequest);
    expect(preparer.inFlight.max).toBe(PART_CONCURRENCY);
  });

  it('prepares a condensed part once more, strictly, and keeps the fuller result', async () => {
    const seen: PreparationRequest[] = [];
    const preparer = fakePreparer({
      onCall: (r) => seen.push(r),
      condense: (r) => r.part?.index === 2 && r.strict !== true,
    });
    const result = await prepareInParts(preparer, longRequest);
    const retries = seen.filter((r) => r.strict === true);
    expect(retries).toHaveLength(1);
    expect(retries[0]?.part?.index).toBe(2);
    const second = result.parts[1];
    expect(second?.retried).toBe(true);
    expect(second?.coverage).toBeGreaterThanOrEqual(MIN_PART_COVERAGE);
    expect(result.inputTokens).toBe(100 * seen.length);
  });

  it('keeps the first result when the retry is no better, and reports the shortfall', async () => {
    const preparer = fakePreparer({ condense: (r) => r.part?.index === 1 });
    const result = await prepareInParts(preparer, longRequest);
    expect(result.parts[0]?.retried).toBe(true);
    expect(result.parts[0]?.coverage).toBeLessThan(MIN_PART_COVERAGE);
  });

  it('never retries the test preparer, which is not AI', async () => {
    const seen: PreparationRequest[] = [];
    const preparer = fakePreparer({
      live: false,
      onCall: (r) => seen.push(r),
      condense: () => true,
    });
    await prepareInParts(preparer, longRequest);
    expect(seen.some((r) => r.strict === true)).toBe(false);
  });

  it('reports usage as unknown when any call did not report it', async () => {
    const base = fakePreparer({});
    const preparer: DocumentPreparer = {
      ...base,
      prepare: async (r) => ({
        ...(await base.prepare(r)),
        inputTokens: r.part?.index === 2 ? null : 100,
      }),
    };
    const result = await prepareInParts(preparer, longRequest);
    expect(result.inputTokens).toBeNull();
    expect(result.outputTokens).not.toBeNull();
  });

  it('refuses a malformed part as MALFORMED_OUTPUT', async () => {
    const preparer: DocumentPreparer = {
      ...fakePreparer({}),
      prepare: async () => ({
        output: { nope: true },
        inputTokens: 1,
        outputTokens: 1,
        servedModel: null,
      }),
    };
    await expect(prepareInParts(preparer, longRequest)).rejects.toMatchObject({
      code: 'MALFORMED_OUTPUT',
    });
  });

  it('estimates the input of every part, each framed with the instructions', () => {
    const one: PreparationRequest = {
      documentName: 'Lantern returns',
      sections: [section('S', 3)],
    };
    const single = estimateTokensInParts(one);
    expect(single).toBeGreaterThan(0);
    expect(estimateTokensInParts(longRequest)).toBeGreaterThan(single * 3);
  });
});
