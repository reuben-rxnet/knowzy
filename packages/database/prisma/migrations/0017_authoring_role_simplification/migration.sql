-- 0017 — Authoring Role Simplification (2026-10-07)
--
-- Specification first: docs/access-control.md §2.0, and the amendments it made
-- to workflows.md §3.4, architecture.md §14 rule 8 and
-- docs/competencies/COMPETENCY_ADMINISTRATION.md §2.
--
-- Two things, both reversible by configuration or a later migration, and
-- neither deleting anything:
--
--   * A role can be DEACTIVATED. The specialist roles are kept -- their rows,
--     names and historical grants are what make an old audit row naming an
--     Approver still read as one -- and the seed marks them inactive. The
--     identity read ignores a grant on an inactive role.
--
--   * The two separation CHECKs added in 0016 are dropped. A CHECK cannot read
--     a setting, and competency separation is now governed by the settings
--     approval.competencyVersionEditorMayApprove and
--     approval.competencyTargetEditorMayApprove (strict code defaults). The
--     columns they compared -- creator, editors, approver -- are untouched and
--     still written on every row, so who did what stays on the record.

-- AlterTable
ALTER TABLE "role" ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true;

-- Separation for competency approvals moves from the schema to configuration.
ALTER TABLE "competency_framework_version"
  DROP CONSTRAINT "competency_framework_version_separation_check";

ALTER TABLE "role_competency_expectation"
  DROP CONSTRAINT "role_competency_expectation_separation_check";
