// The competency gap rule —
// docs/competencies/KNOWLEDGE_PROFICIENCY_ARCHITECTURE.md §4.
//
// A gap is CALCULABLE only when all five preconditions hold: an approved
// population, an approved target, a valid observation on the same scale, a
// declared source and an as-of date. Otherwise the answer is NOT_CALCULABLE
// with EVERY missing precondition named, never a zero and never the first one
// alone -- a reader fixing one reason should not discover the next one only
// after the fix.
//
// Deliberately distinct from `GapState` (GAP / NO_GAP / INSUFFICIENT_EVIDENCE),
// which describes a learner's topic accuracy in an ASSESSMENT. This compares an
// observation to a ROLE TARGET, and a report must not be able to confuse them.
//
// Pure: the caller supplies `now`. There is no data to run this on in
// COMPETENCY-M0/M1 -- no observation is stored and no target is approved --
// and that is the honest state, not a gap in the implementation.

export const COMPETENCY_EVIDENCE_SOURCES = [
  'SELF_ASSESSMENT',
  'ASSESSMENT_MEASURED',
  'MANAGER_ASSESSMENT',
  'SME_ASSESSMENT',
  'CERTIFICATION_EVIDENCE',
  'IMPORTED_BASELINE',
] as const;
export type CompetencyEvidenceSource = (typeof COMPETENCY_EVIDENCE_SOURCES)[number];

export type GapPrecondition =
  | 'NO_POPULATION'
  | 'NO_APPROVED_TARGET'
  | 'NO_VALID_OBSERVATION'
  | 'SCALE_MISMATCH'
  | 'UNDECLARED_SOURCE'
  | 'NO_AS_OF_DATE';

export interface GapTarget {
  readonly status: 'PROPOSED' | 'APPROVED' | 'RETIRED';
  readonly approvedAt: Date | null;
  readonly approvedByUserId: string | null;
  readonly approvalReference: string | null;
  /** The target's job role exists and is active. False or null is no population. */
  readonly populationActive: boolean | null;
  readonly scaleCode: string;
  readonly levelOrdinal: number;
}

export interface GapObservation {
  readonly scaleCode: string;
  readonly levelOrdinal: number;
  /** Must be one of COMPETENCY_EVIDENCE_SOURCES. A string, because a caller may hold anything. */
  readonly source: string | null;
  readonly asOf: Date | null;
  /** After this, the observation is due for review and no longer valid. */
  readonly reviewBy?: Date | null;
}

export type GapEvaluation =
  | { readonly state: 'NOT_CALCULABLE'; readonly missing: readonly GapPrecondition[] }
  | {
      readonly state: 'GAP' | 'MEETS_TARGET';
      /** Ordinal steps below the target on the shared scale; 0 when met. */
      readonly shortfall: number;
      readonly source: CompetencyEvidenceSource;
      readonly asOf: Date;
    };

const isSource = (value: string | null): value is CompetencyEvidenceSource =>
  value !== null && (COMPETENCY_EVIDENCE_SOURCES as readonly string[]).includes(value);

const approvalRecorded = (target: GapTarget): boolean =>
  target.approvedAt !== null &&
  target.approvedByUserId !== null &&
  target.approvalReference !== null &&
  target.approvalReference.trim().length > 0;

export interface EvaluateGapArgs {
  readonly target: GapTarget | null;
  readonly observation: GapObservation | null;
  readonly now: Date;
}

export const evaluateCompetencyGap = ({
  target,
  observation,
  now,
}: EvaluateGapArgs): GapEvaluation => {
  const missing: GapPrecondition[] = [];

  // Q1 — an approved population.
  if (target === null || target.populationActive !== true) missing.push('NO_POPULATION');
  // Q2 — an approved target, meaning the status AND the record behind it.
  if (target === null || target.status !== 'APPROVED' || !approvalRecorded(target)) {
    missing.push('NO_APPROVED_TARGET');
  }
  // Q3 — a valid observation on the same scale.
  const expired =
    observation?.reviewBy !== undefined &&
    observation.reviewBy !== null &&
    observation.reviewBy < now;
  const fromTheFuture =
    observation?.asOf !== null && observation?.asOf !== undefined && observation.asOf > now;
  if (observation === null || expired || fromTheFuture) missing.push('NO_VALID_OBSERVATION');
  if (target !== null && observation !== null && target.scaleCode !== observation.scaleCode) {
    missing.push('SCALE_MISMATCH');
  }
  // Q4 — a declared source.
  if (observation !== null && !isSource(observation.source)) missing.push('UNDECLARED_SOURCE');
  // Q5 — an as-of date.
  if (observation !== null && observation.asOf === null) missing.push('NO_AS_OF_DATE');

  if (missing.length > 0 || target === null || observation === null || observation.asOf === null) {
    return { state: 'NOT_CALCULABLE', missing };
  }
  if (!isSource(observation.source))
    return { state: 'NOT_CALCULABLE', missing: ['UNDECLARED_SOURCE'] };

  const shortfall = Math.max(0, target.levelOrdinal - observation.levelOrdinal);
  return {
    state: shortfall > 0 ? 'GAP' : 'MEETS_TARGET',
    shortfall,
    source: observation.source,
    asOf: observation.asOf,
  };
};
