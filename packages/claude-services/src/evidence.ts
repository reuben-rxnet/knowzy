// Evidence verification — workflows.md §2.5 (normative).
//
// "Grounding is enforced mechanically, not requested politely."
//
// This is the single control that prevents plausible-sounding fabrication from
// reaching a reviewer, which is why ADR-005 makes it impossible to switch off —
// only its tolerance varies between STRICT and STANDARD. A candidate whose
// evidence does not verify is NOT PERSISTED; the reason goes on the job.
//
//   STRICT   normalize(evidence) must be an exact substring of
//            normalize(sectionText)
//   STANDARD trigram similarity(normalize(evidence), best-matching window of
//            normalize(sectionText)) >= 0.95
//
// The stored span keeps its ORIGINAL casing and offsets into the section's own
// text, so it stays re-locatable years later (X2 is what makes that true).

import { normalizeForComparison, type EvidenceMode } from '@knowzy/shared-types';

/** §2.5: "Too short is not evidence; too long is not a citation." */
export const EVIDENCE_MIN_CHARS = 40;
export const EVIDENCE_MAX_CHARS = 1_200;

/** STANDARD tolerance. Not configurable below this: §2.5 fixes it. */
export const STANDARD_SIMILARITY_FLOOR = 0.95;

export interface EvidenceSection {
  readonly sectionKey: string;
  /** The section's own text, exactly as extraction produced it. */
  readonly text: string;
  /** Offset of this section within the document's normalized text. */
  readonly startOffset: number;
}

export type EvidenceFailureCode =
  | 'EVIDENCE_TOO_SHORT'
  | 'EVIDENCE_TOO_LONG'
  | 'EVIDENCE_SECTION_NOT_IN_SCOPE'
  | 'EVIDENCE_NOT_FOUND';

export interface EvidenceVerified {
  readonly verified: true;
  readonly sectionKey: string;
  /** The span as it appears in the section text, original casing preserved. */
  readonly evidence: string;
  /** Offsets into the DOCUMENT's normalized text, so the span re-locates. */
  readonly startOffset: number;
  readonly endOffset: number;
  readonly mode: EvidenceMode;
  /** 1.000 for an exact match. */
  readonly similarityScore: number;
}

export interface EvidenceRejected {
  readonly verified: false;
  readonly code: EvidenceFailureCode;
  /** Actionable for an author, and safe to show: no document text beyond the span. */
  readonly detail: string;
}

export type EvidenceResult = EvidenceVerified | EvidenceRejected;

/** Trigram set of a normalized string, for the STANDARD comparison. */
const trigrams = (value: string): Set<string> => {
  const padded = `  ${value} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i += 1) out.add(padded.slice(i, i + 3));
  return out;
};

/**
 * Jaccard similarity over trigram sets.
 *
 * This mirrors what `pg_trgm.similarity()` computes, so a score here and a
 * score from the database agree. Computed in process because verification must
 * run before anything is persisted — there is nothing in the database to
 * compare against yet.
 */
export const trigramSimilarity = (a: string, b: string): number => {
  if (a.length === 0 && b.length === 0) return 1;
  const left = trigrams(a);
  const right = trigrams(b);
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;
  const union = left.size + right.size - shared;
  return union === 0 ? 0 : shared / union;
};

/**
 * Finds the span in `sectionText` whose normalization equals `needle`.
 *
 * The search is on ORIGINAL text because the offsets must index the original:
 * normalization changes length (it folds ellipses to three dots, strips
 * zero-width characters, collapses whitespace), so an offset found in
 * normalized space would not point at the same characters in the stored text.
 */
const locateExact = (
  sectionText: string,
  needle: string,
): { start: number; end: number } | null => {
  // The fast path: the model quoted verbatim, which is the common case.
  const direct = sectionText.indexOf(needle);
  if (direct !== -1) return { start: direct, end: direct + needle.length };

  const target = normalizeForComparison(needle);
  if (target.length === 0) return null;

  // Otherwise walk candidate windows. Anchoring on the first word keeps this
  // linear in practice rather than quadratic over every offset pair.
  const firstWord = target.split(' ')[0] ?? '';
  const lowerSection = sectionText.toLowerCase();

  for (let start = lowerSection.indexOf(firstWord); start !== -1;) {
    // The normalized form can be shorter or longer than the original, so the
    // window is probed around the needle's length rather than fixed to it.
    for (let extra = -8; extra <= Math.max(16, Math.floor(needle.length * 0.25)); extra += 1) {
      const end = start + needle.length + extra;
      if (end > sectionText.length || end <= start) continue;
      if (normalizeForComparison(sectionText.slice(start, end)) === target) {
        return { start, end };
      }
    }
    start = lowerSection.indexOf(firstWord, start + 1);
  }

  return null;
};

/** Best-matching window for STANDARD, at the granularity of a sentence run. */
const locateBestWindow = (
  sectionText: string,
  needle: string,
): { start: number; end: number; score: number } | null => {
  const target = normalizeForComparison(needle);
  if (target.length === 0) return null;

  // Sentence boundaries, keeping the terminator so offsets stay exact.
  const bounds: number[] = [0];
  for (let i = 0; i < sectionText.length; i += 1) {
    const ch = sectionText[i];
    if (ch === '.' || ch === '!' || ch === '?' || ch === '\n') bounds.push(i + 1);
  }
  if (bounds[bounds.length - 1] !== sectionText.length) bounds.push(sectionText.length);

  let best: { start: number; end: number; score: number } | null = null;

  for (let i = 0; i < bounds.length - 1; i += 1) {
    for (let j = i + 1; j < bounds.length; j += 1) {
      const start = bounds[i] ?? 0;
      const end = bounds[j] ?? 0;
      const length = end - start;
      // Windows far from the needle's length cannot score 0.95; skipping them
      // keeps this bounded without changing the outcome.
      if (length < needle.length * 0.5 || length > needle.length * 2) continue;
      const score = trigramSimilarity(
        target,
        normalizeForComparison(sectionText.slice(start, end)),
      );
      if (best === null || score > best.score) best = { start, end, score };
    }
  }

  return best;
};

export interface VerifyEvidenceArgs {
  /** The span the model claims supports the question. */
  readonly evidence: string;
  /** The section the model attributed it to. */
  readonly sectionKey: string;
  /** ONLY the sections in the pinned scope. A span from elsewhere fails. */
  readonly sections: readonly EvidenceSection[];
  readonly mode: EvidenceMode;
}

export const verifyEvidence = (args: VerifyEvidenceArgs): EvidenceResult => {
  const evidence = args.evidence.trim();

  if (evidence.length < EVIDENCE_MIN_CHARS) {
    return {
      verified: false,
      code: 'EVIDENCE_TOO_SHORT',
      detail: `The evidence span is ${evidence.length} characters; the minimum is ${EVIDENCE_MIN_CHARS}. A fragment that short does not establish what the question tests.`,
    };
  }
  if (evidence.length > EVIDENCE_MAX_CHARS) {
    return {
      verified: false,
      code: 'EVIDENCE_TOO_LONG',
      detail: `The evidence span is ${evidence.length} characters; the maximum is ${EVIDENCE_MAX_CHARS}. A span that long is a copy of the section, not a citation.`,
    };
  }

  // Section attribution, checked BEFORE the text search. A span that happens to
  // appear in an out-of-scope section must fail, so the search may only ever
  // look inside the section the model named.
  const section = args.sections.find((candidate) => candidate.sectionKey === args.sectionKey);
  if (!section) {
    return {
      verified: false,
      code: 'EVIDENCE_SECTION_NOT_IN_SCOPE',
      detail: `The cited section is not part of the pinned generation scope, so the citation cannot be trusted even if the words appear elsewhere in the document.`,
    };
  }

  const exact = locateExact(section.text, evidence);
  if (exact) {
    return {
      verified: true,
      sectionKey: section.sectionKey,
      // The section's own characters, not the model's — so a span that differed
      // only in normalization is stored as the document actually reads.
      evidence: section.text.slice(exact.start, exact.end),
      startOffset: section.startOffset + exact.start,
      endOffset: section.startOffset + exact.end,
      mode: args.mode,
      similarityScore: 1,
    };
  }

  if (args.mode === 'STRICT') {
    return {
      verified: false,
      code: 'EVIDENCE_NOT_FOUND',
      detail:
        'The evidence span is not an exact quotation from the cited section. Under STRICT verification a paraphrase is not evidence.',
    };
  }

  const window = locateBestWindow(section.text, evidence);
  if (window && window.score >= STANDARD_SIMILARITY_FLOOR) {
    return {
      verified: true,
      sectionKey: section.sectionKey,
      evidence: section.text.slice(window.start, window.end),
      startOffset: section.startOffset + window.start,
      endOffset: section.startOffset + window.end,
      mode: 'STANDARD',
      similarityScore: Math.round(window.score * 1000) / 1000,
    };
  }

  return {
    verified: false,
    code: 'EVIDENCE_NOT_FOUND',
    detail: `The closest matching passage in the cited section scores ${(window?.score ?? 0).toFixed(3)}, below the ${STANDARD_SIMILARITY_FLOOR} floor STANDARD verification requires.`,
  };
};
