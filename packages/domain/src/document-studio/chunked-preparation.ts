// AI Document Studio -- preparing a document in parts
// (docs/competencies/AI_DOCUMENT_STUDIO_ARCHITECTURE.md §11.3, amended
// 2026-10-22).
//
// Measured on the pilot SOPs (2026-10-22): a model asked to restructure a
// 25,000-character document in one call CONDENSED it -- 69% of the original's
// words survived, and what went were specific facts (order numbers, job ids,
// ticket subjects). Documents under ~6,000 characters kept 93-99%. So a long
// document is prepared in parts of about that size, up to three at once,
// which is both faster and more faithful.
//
// Each part's output is checked for COMPLETENESS: the share of the part's
// words that reappear in what came back. Below the threshold the part is
// prepared once more with a stricter instruction, and the better of the two
// is kept. Whatever is still short is reported to the reviewer by the
// completeness warning in checks.ts; nothing is silently accepted.

import { PreparationOutputSchema, type PreparationOutput } from '@knowzy/shared-types';
import {
  estimatePreparationTokens,
  PreparationError,
  type DocumentPreparer,
  type PreparationRequest,
  type PreparationSection,
} from '@knowzy/claude-services';
import { wordCoverage } from './checks.js';

/** About 1,500 input tokens: the size at which preparation stayed faithful. */
export const PART_CHARS = 6_000;
/** A part keeping less than this share of its words is prepared again, once. */
export const MIN_PART_COVERAGE = 0.85;
export const PART_CONCURRENCY = 3;

/** All the readable text of an output, findings excluded (they are not content). */
export const outputText = (output: PreparationOutput): string =>
  output.sections
    .flatMap((section) => [
      section.heading,
      ...section.blocks.flatMap((block) =>
        block.type === 'paragraph' || block.type === 'warning'
          ? [block.text]
          : block.type === 'table'
            ? [...block.header, ...block.rows.flat()]
            : block.items,
      ),
    ])
    .join('\n');

const sectionText = (section: PreparationSection): string =>
  [section.heading ?? '', section.text].join('\n');

/**
 * Splits sections into parts of about `limit` characters. A section longer than
 * the limit is split at paragraph breaks; its pieces after the first carry no
 * heading, so no heading is invented to label them.
 */
export const partition = (
  sections: readonly PreparationSection[],
  limit = PART_CHARS,
): PreparationSection[][] => {
  const pieces: PreparationSection[] = [];
  for (const section of sections) {
    if (section.text.length <= limit) {
      pieces.push(section);
      continue;
    }
    let current = '';
    let first = true;
    const flush = (): void => {
      if (current.trim().length === 0) return;
      pieces.push({
        heading: first ? section.heading : null,
        text: current.trim(),
        isAssessable: section.isAssessable,
      });
      first = false;
      current = '';
    };
    for (const paragraph of section.text.split(/\n+/)) {
      if (current.length + paragraph.length + 1 > limit) flush();
      current = current.length === 0 ? paragraph : `${current}\n${paragraph}`;
    }
    flush();
  }
  const parts: PreparationSection[][] = [];
  let part: PreparationSection[] = [];
  let size = 0;
  for (const piece of pieces) {
    const length = sectionText(piece).length;
    if (part.length > 0 && size + length > limit) {
      parts.push(part);
      part = [];
      size = 0;
    }
    part.push(piece);
    size += length;
  }
  if (part.length > 0) parts.push(part);
  return parts;
};

/**
 * The input estimate the budgets check: every part framed on its own, since
 * each carries the full instructions. A retry is not estimated in advance; its
 * tokens are counted when they are reported.
 */
export const estimateTokensInParts = (request: PreparationRequest): number => {
  const parts = partition(request.sections);
  return parts.reduce(
    (sum, sections, index) =>
      sum +
      estimatePreparationTokens({
        documentName: request.documentName,
        sections,
        part: { index: index + 1, count: parts.length },
      }),
    0,
  );
};

export interface PartReport {
  readonly index: number;
  readonly characters: number;
  readonly coverage: number;
  readonly retried: boolean;
}

export interface ChunkedResult {
  readonly output: PreparationOutput;
  /** Null when any call did not report its usage: an unknown sum is not a sum. */
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly servedModel: string | null;
  readonly parts: readonly PartReport[];
}

const parseOrThrow = (raw: unknown): PreparationOutput => {
  const parsed = PreparationOutputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PreparationError(
      'MALFORMED_OUTPUT',
      'The provider returned a prepared document in an unexpected format.',
    );
  }
  return parsed.data;
};

/** Runs `work` over `items` with at most `limit` in flight, keeping order. */
const mapLimited = async <T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await work(items[index] as T, index);
    }
  });
  await Promise.all(lanes);
  return results;
};

/**
 * `onUsage` hears every call's usage as it is reported, so tokens a FAILED
 * preparation already spent are still counted against the budgets.
 */
export const prepareInParts = async (
  preparer: DocumentPreparer,
  request: PreparationRequest,
  onUsage: (inputTokens: number | null, outputTokens: number | null) => void = () => undefined,
): Promise<ChunkedResult> => {
  const parts = partition(request.sections);
  let inputTokens: number | null = 0;
  let outputTokens: number | null = 0;
  let servedModel: string | null = null;
  const add = (input: number | null, output: number | null): void => {
    inputTokens = inputTokens === null || input === null ? null : inputTokens + input;
    outputTokens = outputTokens === null || output === null ? null : outputTokens + output;
    onUsage(inputTokens, outputTokens);
  };

  const results = await mapLimited(parts, PART_CONCURRENCY, async (sections, index) => {
    const partRequest: PreparationRequest = {
      documentName: request.documentName,
      sections,
      part: { index: index + 1, count: parts.length },
      ...(request.nonce === undefined ? {} : { nonce: request.nonce }),
    };
    const original = sections.map(sectionText).join('\n');
    const first = await preparer.prepare(partRequest);
    add(first.inputTokens, first.outputTokens);
    servedModel = servedModel ?? first.servedModel;
    let output = parseOrThrow(first.output);
    let coverage = wordCoverage(original, outputText(output));
    let retried = false;
    // Only a live model condenses; the test preparer is verbatim by design.
    if (coverage < MIN_PART_COVERAGE && preparer.live) {
      retried = true;
      const second = await preparer.prepare({ ...partRequest, strict: true });
      add(second.inputTokens, second.outputTokens);
      const retry = parseOrThrow(second.output);
      const retryCoverage = wordCoverage(original, outputText(retry));
      if (retryCoverage > coverage) {
        output = retry;
        coverage = retryCoverage;
      }
    }
    return { output, report: { index: index + 1, characters: original.length, coverage, retried } };
  });

  return {
    output: {
      sections: results.flatMap((result) => result.output.sections),
      findings: results.flatMap((result) => result.output.findings),
    },
    inputTokens,
    outputTokens,
    servedModel,
    parts: results.map((result) => result.report),
  };
};
