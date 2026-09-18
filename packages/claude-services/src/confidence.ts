// The confidence indicator — workflows.md §2.8.
//
// "A COMPOSITE, PLATFORM-COMPUTED value in [0,1] — not the model's
// self-report." The model's own number contributes 0.10 at most, and is
// advisory.
//
// Stored with its component breakdown so a reviewer sees WHY confidence is low
// rather than being handed a bare number. And per §2.8: confidence never
// authorizes anything — a 0.99 question still requires human approval.

import { EVIDENCE_MIN_CHARS, type EvidenceVerified } from './evidence.js';
import { optionDistinctness } from './integrity.js';
import type { GeneratedQuestion } from './output-schema.js';

export const CONFIDENCE_WEIGHTS = {
  evidenceMatchQuality: 0.35,
  sectionCoverageAdequacy: 0.15,
  optionDistinctness: 0.2,
  metadataCompleteness: 0.1,
  duplicateDistance: 0.1,
  modelDeclaredConfidence: 0.1,
} as const;

export interface ConfidenceComponents {
  readonly evidenceMatchQuality: number;
  readonly sectionCoverageAdequacy: number;
  readonly optionDistinctness: number;
  readonly metadataCompleteness: number;
  readonly duplicateDistance: number;
  readonly modelDeclaredConfidence: number;
}

export interface ConfidenceResult {
  readonly score: number;
  readonly components: ConfidenceComponents;
  readonly weights: typeof CONFIDENCE_WEIGHTS;
}

export interface ConfidenceArgs {
  readonly question: GeneratedQuestion;
  readonly evidence: EvidenceVerified;
  /** The section's assessable character count. */
  readonly sectionCharCount: number;
  /** The minimum a section needs to be assessable at all. */
  readonly minAssessableChars: number;
  /** Highest similarity against the whole corpus, 0 when nothing matched. */
  readonly maxSimilarityScore: number;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export const computeConfidence = (args: ConfidenceArgs): ConfidenceResult => {
  const { question, evidence } = args;

  // An exact match scores 1; a STANDARD match carries its own similarity. Span
  // length also matters: a span at the 40-character floor is technically
  // evidence but weak, so quality ramps to full at three times the floor.
  const lengthAdequacy = clamp01(evidence.evidence.length / (EVIDENCE_MIN_CHARS * 3));
  const evidenceMatchQuality = clamp01(evidence.similarityScore * (0.6 + 0.4 * lengthAdequacy));

  const sectionCoverageAdequacy = clamp01(args.sectionCharCount / (args.minAssessableChars * 3));

  const metadataFields = [
    question.sectionKey.length > 0,
    question.explanation.trim().length >= 20,
    question.difficulty !== undefined,
    question.questionText.trim().endsWith('?') || question.questionText.trim().length > 20,
  ];
  const metadataCompleteness =
    metadataFields.filter(Boolean).length / Math.max(1, metadataFields.length);

  const components: ConfidenceComponents = {
    evidenceMatchQuality,
    sectionCoverageAdequacy,
    optionDistinctness: clamp01(optionDistinctness(question)),
    metadataCompleteness,
    duplicateDistance: clamp01(1 - args.maxSimilarityScore),
    // Advisory, and absent means neutral-low rather than assumed high: a model
    // that did not report a confidence has not earned one.
    modelDeclaredConfidence: clamp01(question.modelConfidence ?? 0.5),
  };

  const score =
    components.evidenceMatchQuality * CONFIDENCE_WEIGHTS.evidenceMatchQuality +
    components.sectionCoverageAdequacy * CONFIDENCE_WEIGHTS.sectionCoverageAdequacy +
    components.optionDistinctness * CONFIDENCE_WEIGHTS.optionDistinctness +
    components.metadataCompleteness * CONFIDENCE_WEIGHTS.metadataCompleteness +
    components.duplicateDistance * CONFIDENCE_WEIGHTS.duplicateDistance +
    components.modelDeclaredConfidence * CONFIDENCE_WEIGHTS.modelDeclaredConfidence;

  return {
    score: Math.round(clamp01(score) * 1000) / 1000,
    components,
    weights: CONFIDENCE_WEIGHTS,
  };
};
