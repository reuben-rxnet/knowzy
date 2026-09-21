// The question generator port, plus the deterministic local generator.
//
// environment-and-configuration.md makes `local` run with no Anthropic key, so
// a generator that needs one would make the documented zero-credential path
// impossible. This module therefore exposes a PORT, and the local
// implementation is a real generator over the real section text — not a fixture
// of canned questions.
//
// That distinction matters: the local generator quotes the document verbatim and
// is then put through the SAME gate chain as a model response (schema, evidence
// verification, integrity, duplicates). If it produced pre-verified questions,
// the gates would be untested and M3 would prove nothing. It also returns
// `insufficientEvidence` for real when a section states nothing testable,
// rather than padding the count — which is the §2.7 behaviour.

import { normalizeForComparison } from '@knowzy/shared-types';
import { EVIDENCE_MAX_CHARS, EVIDENCE_MIN_CHARS } from './evidence.js';
import { frameGenerationPrompt, type FramedSection } from './framing.js';
import {
  GenerationOutputSchema,
  type GeneratedQuestion,
  type GenerationOutput,
} from './output-schema.js';

export interface GenerateArgs {
  readonly sections: readonly FramedSection[];
  readonly doNotDuplicate: readonly string[];
  readonly requestedQuestionCount: number;
  readonly domainName: string;
  readonly topicName: string;
}

export interface InsufficientSection {
  readonly sectionKey: string;
  readonly reason: string;
}

export interface GenerateResult {
  readonly output: GenerationOutput;
  /**
   * Sections that yielded nothing, reported ALONGSIDE any questions produced.
   *
   * `GenerationOutput` is a union, so it can carry questions or one
   * insufficient-evidence result but not both. That matches a single model call
   * about one section group; a generator that iterates several sections has a
   * per-section outcome for each, and workflows.md §2.7 requires every one of
   * them to be recorded on the job and shown to the author. Collapsing them
   * into the union would drop the reasons for four sections the moment a fifth
   * succeeded — which is exactly the bug this field exists to prevent.
   */
  readonly insufficientSections: readonly InsufficientSection[];
  readonly modelId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface QuestionGenerator {
  readonly kind: 'deterministic-local' | 'anthropic';
  readonly modelId: string;
  generate(args: GenerateArgs): Promise<GenerateResult>;
}

// ---------------------------------------------------------------------------
// Sentence selection

/** Splits into sentences while keeping each one's exact original substring. */
const sentencesOf = (text: string): string[] => {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    const atBoundary =
      (ch === '.' || ch === '!' || ch === '?') && (next === undefined || /\s/.test(next));
    if (atBoundary || ch === '\n') {
      const candidate = text.slice(start, i + 1).trim();
      if (candidate.length > 0) out.push(candidate);
      start = i + 1;
    }
  }
  const tail = text.slice(start).trim();
  if (tail.length > 0) out.push(tail);
  return out;
};

const NUMBER_WORDS: readonly string[] = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'seven',
  'ten',
  'fifteen',
  'thirty',
  'fifty',
  'ninety',
  'hundred',
  'thousand',
];

/** A sentence carries a testable rule only if it states one. */
const RULE_SIGNAL = /\b(must|may|requires?|never|only|shall|cannot|is refused|is issued)\b/i;

const QUANTITY = new RegExp(`\\b(\\d+|${NUMBER_WORDS.join('|')})\\b`, 'i');

interface Candidate {
  readonly sentence: string;
  readonly hasQuantity: boolean;
}

/**
 * Ranks sentences by how testable they are.
 *
 * A sentence naming a threshold or a timeframe makes the best question, because
 * there is a single right answer and plausible wrong ones. A sentence that only
 * describes ownership ("the duty manager is accountable") states no rule to
 * test, which is exactly the §2.7 case.
 */
const candidatesFor = (text: string): Candidate[] =>
  sentencesOf(text)
    .filter(
      (sentence) =>
        sentence.length >= EVIDENCE_MIN_CHARS &&
        sentence.length <= Math.min(EVIDENCE_MAX_CHARS, 600) &&
        RULE_SIGNAL.test(sentence),
    )
    .map((sentence) => ({ sentence, hasQuantity: QUANTITY.test(sentence) }))
    .sort((a, b) => Number(b.hasQuantity) - Number(a.hasQuantity));

// ---------------------------------------------------------------------------
// Distractor construction

const NUMERIC_SWAPS: Readonly<Record<string, string>> = {
  zero: 'two',
  one: 'three',
  two: 'four',
  three: 'five',
  four: 'seven',
  five: 'ten',
  seven: 'three',
  ten: 'thirty',
  fifteen: 'sixty',
  thirty: 'ninety',
  fifty: 'two hundred',
  ninety: 'thirty',
  hundred: 'thousand',
  thousand: 'hundred',
};

const MODAL_SWAPS: Readonly<Record<string, string>> = {
  must: 'may optionally',
  may: 'must never',
  never: 'always may',
  only: 'in addition to any other case',
  requires: 'does not require',
  require: 'do not require',
  cannot: 'is permitted to',
};

const swapFirst = (
  sentence: string,
  pattern: RegExp,
  table: Readonly<Record<string, string>>,
): string | null => {
  const match = pattern.exec(sentence);
  const found = match?.[0];
  if (!found) return null;
  const replacement = table[found.toLowerCase()];
  if (replacement === undefined) return null;
  const cased =
    found[0] === found[0]?.toUpperCase()
      ? replacement.charAt(0).toUpperCase() + replacement.slice(1)
      : replacement;
  return sentence.slice(0, match.index) + cased + sentence.slice(match.index + found.length);
};

/** A second quantity swap, so a sentence with one number still yields three. */
const swapSecondQuantity = (sentence: string): string | null => {
  const matches = [...sentence.matchAll(new RegExp(QUANTITY.source, 'gi'))];
  const second = matches[1];
  if (!second?.[0]) return null;
  const replacement = NUMERIC_SWAPS[second[0].toLowerCase()];
  if (replacement === undefined) return null;
  return (
    sentence.slice(0, second.index) + replacement + sentence.slice(second.index + second[0].length)
  );
};

/**
 * Role nouns, swapped to produce a distractor about the wrong actor.
 *
 * "Who must do this" is as testable as "by when", and a sentence stating an
 * obligation without a number has no quantity to vary — so without this, every
 * modal-only rule sentence yields too few distractors and is reported as
 * insufficient when it is in fact perfectly testable.
 */
const ACTOR_SWAPS: Readonly<Record<string, string>> = {
  agent: 'duty manager',
  'duty manager': 'frontline agent',
  'team leader': 'billing manager',
  'billing manager': 'team leader',
  'on-call engineer': 'duty manager',
  'network engineer': 'service desk analyst',
  customer: 'account manager',
  reviewer: 'author',
  approver: 'reviewer',
};

const ACTOR_PATTERN = new RegExp(`\\b(${Object.keys(ACTOR_SWAPS).join('|')})\\b`, 'i');

/** The second modal occurrence, when a sentence states two obligations. */
const swapSecondModal = (sentence: string): string | null => {
  const matches = [...sentence.matchAll(/\b(must|may|never|only|requires|require|cannot)\b/gi)];
  const second = matches[1];
  if (!second?.[0]) return null;
  const replacement = MODAL_SWAPS[second[0].toLowerCase()];
  if (replacement === undefined) return null;
  return (
    sentence.slice(0, second.index) + replacement + sentence.slice(second.index + second[0].length)
  );
};

/**
 * Fixes a/an agreement after a word swap.
 *
 * A distractor that reads "An duty manager" is a giveaway: a reviewer spots the
 * broken article before reading the claim, so the option stops being plausible
 * and the question stops testing anything.
 */
const fixArticles = (text: string): string =>
  text.replace(/\b(a|an|A|An)\s+([A-Za-z])/g, (_match, article: string, letter: string) => {
    const vowel = 'aeiouAEIOU'.includes(letter);
    const fixed = vowel ? (article[0] === 'A' ? 'An' : 'an') : article[0] === 'A' ? 'A' : 'a';
    return `${fixed} ${letter}`;
  });

const asOption = (text: string): string => {
  const trimmed = text.trim();
  return trimmed.length <= 500 ? trimmed : `${trimmed.slice(0, 497).trimEnd()}...`;
};

/**
 * Builds three distinct distractors, or returns null.
 *
 * Returning null is deliberate: a question with two identical options would be
 * rejected downstream by the integrity gate anyway, and emitting one to hit a
 * requested count is the padding §2.7 prohibits. The section is reported as
 * insufficient instead.
 */
const distractorsFor = (sentence: string): [string, string, string] | null => {
  const MODAL_PATTERN = /\b(must|may|never|only|requires|require|cannot)\b/i;
  const quantitySwapped = swapFirst(sentence, new RegExp(QUANTITY.source, 'i'), NUMERIC_SWAPS);

  const attempts = [
    quantitySwapped,
    swapFirst(sentence, MODAL_PATTERN, MODAL_SWAPS),
    swapSecondQuantity(sentence),
    swapSecondModal(sentence),
    swapFirst(sentence, ACTOR_PATTERN, ACTOR_SWAPS),
    // Both at once, which is distinct from either alone whenever both applied.
    quantitySwapped === null ? null : swapFirst(quantitySwapped, MODAL_PATTERN, MODAL_SWAPS),
  ];

  const seen = new Set<string>([normalizeForComparison(asOption(sentence))]);
  const distinct: string[] = [];

  for (const attempt of attempts) {
    if (attempt === null) continue;
    const option = asOption(fixArticles(attempt));
    const key = normalizeForComparison(option);
    if (seen.has(key)) continue;
    seen.add(key);
    distinct.push(option);
  }

  if (distinct.length < 3) return null;
  return [distinct[0] ?? '', distinct[1] ?? '', distinct[2] ?? ''];
};

/** Deterministic option ordering from the section key — stable across runs. */
const rotationFor = (sectionKey: string, index: number): number => {
  const seed = Number.parseInt(sectionKey.slice(0, 8), 16);
  return (Number.isFinite(seed) ? seed + index : index) % 4;
};

// ---------------------------------------------------------------------------

const buildQuestion = (
  section: FramedSection,
  candidate: Candidate,
  index: number,
): GeneratedQuestion | null => {
  const distractors = distractorsFor(candidate.sentence);
  if (distractors === null) return null;

  const correct = asOption(candidate.sentence);
  const pool = [correct, ...distractors];
  const rotation = rotationFor(section.sectionKey, index);
  const ordered = [...pool.slice(rotation), ...pool.slice(0, rotation)];
  const correctIndex = ordered.indexOf(correct);
  const keys = ['A', 'B', 'C', 'D'] as const;

  return {
    sectionKey: section.sectionKey,
    questionText: `According to "${section.label}", which statement is correct?`,
    options: {
      A: ordered[0] ?? '',
      B: ordered[1] ?? '',
      C: ordered[2] ?? '',
      D: ordered[3] ?? '',
    },
    correctOption: keys[correctIndex] ?? 'A',
    explanation: `The section "${section.label}" states this rule directly. The other options alter a threshold, a timeframe, or the obligation itself, and none of them is supported by the document.`,
    // Verbatim, so verification has something real to check.
    supportingEvidence: candidate.sentence,
    difficulty: candidate.hasQuantity ? 'RECALL' : 'APPLICATION',
    // Deliberately not 1: the local generator has no basis for certainty, and
    // claiming it would inflate a component that is supposed to be advisory.
    modelConfidence: 0.6,
  };
};

/**
 * Generates from the section text with no network call and no key.
 *
 * `frameGenerationPrompt` is still invoked and its token estimate recorded,
 * because the framing is part of what M3 must prove works — including that
 * generation grants no tools.
 */
export const createDeterministicGenerator = (): QuestionGenerator => ({
  kind: 'deterministic-local',
  // Recorded on the job as the model that ran. Naming it honestly is the point:
  // a job row must never suggest a Claude model produced these.
  modelId: 'knowzy-deterministic-local-1',

  async generate(args: GenerateArgs): Promise<GenerateResult> {
    const prompt = frameGenerationPrompt(args);

    const suppressed = new Set(args.doNotDuplicate.map((stem) => normalizeForComparison(stem)));
    const questions: GeneratedQuestion[] = [];
    const insufficient: { sectionKey: string; reason: string }[] = [];

    for (const section of args.sections) {
      if (questions.length >= args.requestedQuestionCount) break;

      const candidates = candidatesFor(section.text);
      if (candidates.length === 0) {
        insufficient.push({
          sectionKey: section.sectionKey,
          reason:
            'The section describes context and ownership but states no procedure, threshold, or decision rule that could be tested reliably.',
        });
        continue;
      }

      let built = false;
      let wasSuppressed = false;
      for (const [index, candidate] of candidates.entries()) {
        const question = buildQuestion(section, candidate, index);
        if (question === null) continue;
        // Stage 1 suppression, applied by the generator itself rather than
        // hoped for: §4.3 calls this the cheapest duplicate control because it
        // prevents the duplicate from existing.
        if (suppressed.has(normalizeForComparison(question.questionText))) {
          wasSuppressed = true;
          continue;
        }
        questions.push(question);
        built = true;
        break;
      }

      if (!built) {
        insufficient.push({
          sectionKey: section.sectionKey,
          // Two different situations with two different remedies: rewrite the
          // document, or go and look at the question that already exists.
          // Reporting both as "insufficient evidence" sends the author to fix
          // content that is fine.
          reason: wasSuppressed
            ? 'A question testing this section already exists, so generation was suppressed rather than producing a duplicate.'
            : 'No set of four distinct, plausible options could be formed from this section without inventing content it does not contain.',
        });
      }
    }

    // A rough but honest token estimate; no provider reported one.
    const inputTokens = Math.ceil((prompt.system.length + prompt.user.length) / 4);

    if (questions.length === 0) {
      const first = insufficient[0];
      const output = GenerationOutputSchema.parse({
        result: 'insufficientEvidence',
        sectionKey: first?.sectionKey ?? args.sections[0]?.sectionKey ?? 'unknown',
        reason:
          first?.reason ??
          'No section in the pinned scope states a testable procedure, threshold, or decision rule.',
      });
      return {
        output,
        insufficientSections: insufficient,
        modelId: this.modelId,
        inputTokens,
        outputTokens: 40,
      };
    }

    const output = GenerationOutputSchema.parse({ questions });
    return {
      output,
      // Every section that yielded nothing, even though some sections did.
      insufficientSections: insufficient,
      modelId: this.modelId,
      inputTokens,
      outputTokens: Math.ceil(JSON.stringify(questions).length / 4),
    };
  },
});
