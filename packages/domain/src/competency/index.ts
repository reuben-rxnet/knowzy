// Competency reference definitions — COMPETENCY-M0/M1.
// Specification: docs/architecture.md §14 and docs/competencies/.

export { foldLabel, isNearMatch, deriveCodeSegment, boundedEditDistance } from './fold.js';
export { RX_COMPETENCY_MATRIX_2024 } from './reference-profile.js';
export type {
  AliasDecision,
  CategoryKind,
  CompetencyImportProfile,
  DeclaredCategory,
  DeclaredCompetency,
  DeclaredLabel,
  DeclaredLevel,
  DeclaredScale,
} from './reference-profile.js';
export { buildCompetencyImportPlan } from './import-plan.js';
export type {
  BuildPlanArgs,
  CompetencyImportPlan,
  FindingSeverity,
  ImportFinding,
  ImportSummary,
  PlannedAlias,
  PlannedCategory,
  PlannedCompetency,
  PlannedLevel,
  PlannedScale,
  SheetClass,
  SheetReport,
  SourceRef,
} from './import-plan.js';
export { formatCompetencyImportReport } from './report.js';
export { applyCompetencyImportPlan, CompetencyImportError } from './import-service.js';
export type {
  ApplyImportArgs,
  ApplyImportResult,
  CompetencyImportActor,
  CompetencyImportDeps,
} from './import-service.js';
export { evaluateCompetencyGap, COMPETENCY_EVIDENCE_SOURCES } from './gap.js';
export type {
  CompetencyEvidenceSource,
  EvaluateGapArgs,
  GapEvaluation,
  GapObservation,
  GapPrecondition,
  GapTarget,
} from './gap.js';

// COMPETENCY-M2: competency administration (docs/competencies/COMPETENCY_ADMINISTRATION.md).
export {
  canonicalDefinitions,
  definitionsDigest,
  separationRefusal,
} from './definitions-digest.js';
export type { FrameworkDefinitions } from './definitions-digest.js';
export {
  ADMIN_ALIAS_DECISIONS,
  COMPETENCY_DOMAINS,
  CompetencyAdminError,
  approveFrameworkVersion,
  approveRoleTarget,
  createCompetency,
  createCompetencyAlias,
  createCompetencyCategory,
  createFrameworkVersion,
  proposeRoleTarget,
  readCompetencyCatalogue,
  readFrameworkDefinitions,
  readRoleTargets,
  retireRoleTarget,
  snapshotFramework,
  updateCompetency,
  updateCompetencyAlias,
  updateCompetencyCategory,
  updateRoleTarget,
} from './administration.js';
export type {
  CatalogueFramework,
  CatalogueVersion,
  CompetencyAdminActor,
  CompetencyAdminDeps,
  CompetencyDomain,
  RoleTargetRow,
  RoleTargetsView,
} from './administration.js';
