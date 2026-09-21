// The 13 approval-blocking gates — authoring-portal.md §5.7.
//
// "Gates are evaluated SERVER-SIDE at the moment of the transition. The UI
//  shows the same gate results in the validation panel so an approver is never
//  surprised, but the UI evaluation is advisory."
//
// Two design rules follow from the specification and are load-bearing:
//
//   1. ALL failures are returned at once. error-handling.md §328 requires "a
//      checklist showing ALL failures at once, each linking to the field that
//      fixes it". Returning the first failure would make an author fix one
//      thing, resubmit, and discover the next — three round trips for one form.
//   2. The result is PERSISTED on the approval. audit-model.md: gateResults is
//      stored "so an auditor sees exactly what the platform checked at the
//      moment of approval, not what it would check today".
//
// The gates are also re-evaluated at publish time, because G1 of
// sharepoint-question-bank.md refuses a write unless they all pass AT THE
// MOMENT OF THE WRITE — a question approved yesterday whose source document has
// since changed must not publish.

import { normalizeForComparison } from '@knowzy/shared-types';
import { verifyEvidence, type EvidenceSection } from '@knowzy/claude-services';

export type GateCode =
  | 'EVIDENCE_MISSING'
  | 'QUESTION_INCOMPLETE'
  | 'OPTION_MISSING'
  | 'OPTION_DUPLICATE'
  | 'ANSWER_INVALID'
  | 'EXPLANATION_MISSING'
  | 'DOMAIN_MISSING'
  | 'TOPIC_MISSING'
  | 'METADATA_MISSING'
  | 'DUPLICATE_THRESHOLD_EXCEEDED'
  | 'SOURCE_INACCESSIBLE'
  | 'SOURCE_VALIDATION_FAILED'
  | 'SEPARATION_OF_DUTIES'
  | 'SME_SIGNOFF_REQUIRED';

export interface GateResult {
  readonly gate: number;
  readonly code: GateCode;
  readonly passed: boolean;
  /** Names the field that fixes it. Shown to the author verbatim. */
  readonly detail: string;
  readonly field: string | null;
}

export interface GateEvaluation {
  readonly passed: boolean;
  readonly results: readonly GateResult[];
  readonly failures: readonly GateResult[];
}

export interface GateSubject {
  readonly questionId: string;
  readonly version: number;
  readonly questionText: string;
  readonly options: Readonly<Record<'A' | 'B' | 'C' | 'D', string>>;
  readonly correctOption: string;
  readonly explanation: string;
  readonly domainId: string | null;
  readonly topicId: string | null;
  readonly sourceMetadata: Readonly<Record<string, unknown>>;
  readonly supportingEvidence: string;
  readonly evidenceStartOffset: number;
  readonly evidenceEndOffset: number;
  readonly sectionKey: string;
  readonly sourceContentHash: string;
  readonly maxSimilarityScore: number | null;
  readonly duplicateDisposition: string | null;
  readonly authorUserId: string | null;
  readonly lastEditorUserId: string | null;
  readonly needsRevalidation: boolean;
}

/** What the platform knows about the source at the moment of the transition. */
export interface GateSourceState {
  /** null when the document row is gone or the source is archived. */
  readonly documentFound: boolean;
  readonly documentStatus: string | null;
  readonly sourceIsActive: boolean;
  readonly currentContentHash: string | null;
  /** The section as it reads NOW, for re-locating the span. */
  readonly section: EvidenceSection | null;
  readonly evidenceMode: 'STRICT' | 'STANDARD';
}

export interface GatePolicyState {
  readonly minQuestionTextLength: number;
  readonly requiredMetadataFields: readonly string[];
  readonly duplicateFlagThreshold: number;
  /** Already-decided separation-of-duties outcome; see separation-of-duties.ts. */
  readonly separationOfDuties: { readonly permitted: boolean; readonly reason: string };
  /**
   * Whether gate 13 applies at this transition.
   *
   * It applies at APPROVAL and nowhere else: refusing a SUBMIT because the
   * author is the author would make submission impossible. Reported as a pass
   * with that reason rather than omitted, so the checklist always has 13 rows
   * and a reader can see why one of them is inert here.
   */
  readonly separationApplies: boolean;
  /** Domain-level requireSmeSignoff, and whether an endorsement exists. */
  readonly smeSignoffRequired: boolean;
  readonly smeEndorsedVersion: number | null;
}

const OPTION_KEYS = ['A', 'B', 'C', 'D'] as const;

const pass = (gate: number, code: GateCode, detail: string): GateResult => ({
  gate,
  code,
  passed: true,
  detail,
  field: null,
});

const fail = (gate: number, code: GateCode, detail: string, field: string | null): GateResult => ({
  gate,
  code,
  passed: false,
  detail,
  field,
});

export const evaluateApprovalGates = (
  subject: GateSubject,
  source: GateSourceState,
  policy: GatePolicyState,
): GateEvaluation => {
  const results: GateResult[] = [];

  // --- 1. Source evidence missing or unverified
  if (subject.supportingEvidence.trim().length === 0) {
    results.push(
      fail(
        1,
        'EVIDENCE_MISSING',
        'The question carries no supporting evidence span.',
        'supportingEvidence',
      ),
    );
  } else if (subject.evidenceEndOffset <= subject.evidenceStartOffset) {
    results.push(
      fail(
        1,
        'EVIDENCE_MISSING',
        'The evidence offsets do not describe a span, so the citation cannot be re-located.',
        'supportingEvidence',
      ),
    );
  } else {
    results.push(pass(1, 'EVIDENCE_MISSING', 'A supporting evidence span is present.'));
  }

  // --- 2. Question text empty or below the configured minimum length
  const questionText = subject.questionText.trim();
  if (questionText.length === 0) {
    results.push(fail(2, 'QUESTION_INCOMPLETE', 'The question text is empty.', 'questionText'));
  } else if (questionText.length < policy.minQuestionTextLength) {
    results.push(
      fail(
        2,
        'QUESTION_INCOMPLETE',
        `The question text is ${questionText.length} characters; the configured minimum is ${policy.minQuestionTextLength}.`,
        'questionText',
      ),
    );
  } else {
    results.push(pass(2, 'QUESTION_INCOMPLETE', 'The question text meets the minimum length.'));
  }

  // --- 3. Any of options A-D missing or blank
  const blank = OPTION_KEYS.filter((key) => (subject.options[key] ?? '').trim().length === 0);
  results.push(
    blank.length > 0
      ? fail(
          3,
          'OPTION_MISSING',
          `Option(s) ${blank.join(', ')} are missing or blank.`,
          `option${blank[0]}`,
        )
      : pass(3, 'OPTION_MISSING', 'All four options are present.'),
  );

  // --- 4. Two or more options identical after normalization
  const normalized = OPTION_KEYS.map((key) => normalizeForComparison(subject.options[key] ?? ''));
  const collision: string[] = [];
  for (let i = 0; i < normalized.length; i += 1) {
    for (let j = i + 1; j < normalized.length; j += 1) {
      if (normalized[i] !== '' && normalized[i] === normalized[j]) {
        collision.push(`${OPTION_KEYS[i]}/${OPTION_KEYS[j]}`);
      }
    }
  }
  results.push(
    collision.length > 0
      ? fail(
          4,
          'OPTION_DUPLICATE',
          `Option pair(s) ${collision.join(', ')} are the same answer after normalization.`,
          `option${OPTION_KEYS[0]}`,
        )
      : pass(4, 'OPTION_DUPLICATE', 'The four options are distinct.'),
  );

  // --- 5. Correct answer not exactly one of A, B, C, D
  results.push(
    (OPTION_KEYS as readonly string[]).includes(subject.correctOption)
      ? pass(5, 'ANSWER_INVALID', `The correct answer is ${subject.correctOption}.`)
      : fail(
          5,
          'ANSWER_INVALID',
          `The correct answer is "${subject.correctOption}", which is not one of A, B, C, or D.`,
          'correctOption',
        ),
  );

  // --- 6. Explanation missing
  results.push(
    subject.explanation.trim().length === 0
      ? fail(6, 'EXPLANATION_MISSING', 'The explanation is empty.', 'explanation')
      : pass(6, 'EXPLANATION_MISSING', 'An explanation is present.'),
  );

  // --- 7 and 8. Domain and topic
  results.push(
    subject.domainId
      ? pass(7, 'DOMAIN_MISSING', 'A domain is assigned.')
      : fail(7, 'DOMAIN_MISSING', 'No domain is assigned.', 'domainId'),
  );
  results.push(
    subject.topicId
      ? pass(8, 'TOPIC_MISSING', 'A topic is assigned.')
      : fail(8, 'TOPIC_MISSING', 'No topic is assigned.', 'topicId'),
  );

  // --- 9. Any configured required metadata field missing
  const missingMetadata = policy.requiredMetadataFields.filter((field) => {
    const value = subject.sourceMetadata[field];
    return value === undefined || value === null || String(value).trim().length === 0;
  });
  results.push(
    missingMetadata.length > 0
      ? fail(
          9,
          'METADATA_MISSING',
          `Required metadata field(s) missing: ${missingMetadata.join(', ')}.`,
          missingMetadata[0] ?? 'sourceMetadata',
        )
      : pass(
          9,
          'METADATA_MISSING',
          policy.requiredMetadataFields.length === 0
            ? 'No metadata fields are configured as required.'
            : 'All required metadata fields are present.',
        ),
  );

  // --- 10. Duplicate similarity above threshold and not dispositioned
  const similarity = subject.maxSimilarityScore ?? 0;
  if (similarity >= policy.duplicateFlagThreshold && subject.duplicateDisposition === null) {
    results.push(
      fail(
        10,
        'DUPLICATE_THRESHOLD_EXCEEDED',
        `Similarity ${similarity.toFixed(3)} is at or above the flag threshold ${policy.duplicateFlagThreshold} and has not been dispositioned. A reviewer must record DISTINCT or DUPLICATE.`,
        'duplicateDisposition',
      ),
    );
  } else if (subject.duplicateDisposition === 'DUPLICATE') {
    // Dispositioned AS a duplicate is not a pass. Recording the judgement does
    // not make the question publishable; it records that it should not be.
    results.push(
      fail(
        10,
        'DUPLICATE_THRESHOLD_EXCEEDED',
        'This question was dispositioned as a DUPLICATE, so it cannot be approved. Reject it instead.',
        'duplicateDisposition',
      ),
    );
  } else {
    results.push(
      pass(
        10,
        'DUPLICATE_THRESHOLD_EXCEEDED',
        subject.duplicateDisposition === 'DISTINCT'
          ? 'Flagged as similar and dispositioned DISTINCT by a reviewer.'
          : `Similarity ${similarity.toFixed(3)} is below the flag threshold.`,
      ),
    );
  }

  // --- 11. Source document inaccessible at approval time
  if (!source.documentFound) {
    results.push(
      fail(
        11,
        'SOURCE_INACCESSIBLE',
        'The source document no longer exists in the platform index, so the citation cannot be checked.',
        null,
      ),
    );
  } else if (!source.sourceIsActive) {
    results.push(
      fail(11, 'SOURCE_INACCESSIBLE', 'The knowledge source is inactive or archived.', null),
    );
  } else if (source.documentStatus !== 'ACTIVE') {
    results.push(
      fail(
        11,
        'SOURCE_INACCESSIBLE',
        `The source document is ${source.documentStatus ?? 'unavailable'}, not ACTIVE.`,
        null,
      ),
    );
  } else {
    results.push(pass(11, 'SOURCE_INACCESSIBLE', 'The source document is accessible.'));
  }

  // --- 12. Source validation: hash mismatch without revalidation, or the span
  //         is no longer locatable. This is the gate that makes "everything is
  //         grounded" survive the document changing after generation.
  if (!source.documentFound || source.section === null) {
    results.push(
      fail(
        12,
        'SOURCE_VALIDATION_FAILED',
        'The cited section is no longer present in the current version of the document.',
        'supportingEvidence',
      ),
    );
  } else if (
    source.currentContentHash !== null &&
    source.currentContentHash !== subject.sourceContentHash &&
    subject.needsRevalidation
  ) {
    results.push(
      fail(
        12,
        'SOURCE_VALIDATION_FAILED',
        'The source document changed since this question was generated and the question is flagged for revalidation. Re-verify the evidence before approving.',
        'supportingEvidence',
      ),
    );
  } else {
    // Re-located for real, against the section as it reads NOW. A stored
    // offset that no longer points at the stored span is exactly the silent
    // failure this gate exists to catch.
    const relocated = verifyEvidence({
      evidence: subject.supportingEvidence,
      sectionKey: subject.sectionKey,
      sections: [source.section],
      mode: source.evidenceMode,
    });
    results.push(
      relocated.verified
        ? pass(
            12,
            'SOURCE_VALIDATION_FAILED',
            `The evidence span re-located in the current text (${source.evidenceMode}, similarity ${relocated.similarityScore.toFixed(3)}).`,
          )
        : fail(
            12,
            'SOURCE_VALIDATION_FAILED',
            `The evidence span no longer re-locates in the cited section: ${relocated.detail}`,
            'supportingEvidence',
          ),
    );
  }

  // --- 13. Separation of duties
  results.push(
    !policy.separationApplies
      ? pass(
          13,
          'SEPARATION_OF_DUTIES',
          'Separation of duties is evaluated at approval, not at this transition.',
        )
      : policy.separationOfDuties.permitted
        ? pass(13, 'SEPARATION_OF_DUTIES', policy.separationOfDuties.reason)
        : fail(13, 'SEPARATION_OF_DUTIES', policy.separationOfDuties.reason, null),
  );

  // --- SME sign-off. workflows.md §3.3 adds this as a BLOCKING gate when a
  // domain sets requireSmeSignoff, and endorsement is VERSION-BOUND: editing
  // after endorsement invalidates it.
  if (policy.smeSignoffRequired) {
    results.push(
      policy.smeEndorsedVersion === subject.version
        ? pass(
            14,
            'SME_SIGNOFF_REQUIRED',
            `Endorsed by a subject matter expert for version ${subject.version}.`,
          )
        : fail(
            14,
            'SME_SIGNOFF_REQUIRED',
            policy.smeEndorsedVersion === null
              ? 'This domain requires subject-matter-expert sign-off, and no endorsement exists for the current version.'
              : `The subject-matter-expert endorsement is for version ${policy.smeEndorsedVersion}, but the current version is ${subject.version}. Editing invalidated it.`,
            null,
          ),
    );
  }

  const failures = results.filter((result) => !result.passed);
  return { passed: failures.length === 0, results, failures };
};

/** The persisted shape, for QuestionApproval.gateResults. */
export const gateResultsForAudit = (
  evaluation: GateEvaluation,
): Readonly<Record<string, unknown>> => ({
  passed: evaluation.passed,
  evaluatedGateCount: evaluation.results.length,
  results: evaluation.results.map((result) => ({
    gate: result.gate,
    code: result.code,
    passed: result.passed,
  })),
  // Only the failures carry their detail: the full text of 14 passing gates
  // would bloat a row kept for years without adding anything.
  failures: evaluation.failures.map((result) => ({
    gate: result.gate,
    code: result.code,
    detail: result.detail,
  })),
});
