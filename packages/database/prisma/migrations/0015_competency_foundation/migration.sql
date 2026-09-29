-- 0015 — competency reference definitions (COMPETENCY-M0/M1)
--
-- Specification first: docs/architecture.md §14 and docs/competencies/.
--
-- REFERENCE DEFINITIONS ONLY. Every table here describes what competencies
-- and levels an organization recognizes, where each definition was read, and
-- what an approved role target would look like. NO TABLE HOLDS AN OBSERVATION
-- ABOUT A PERSON: no rating, no self-assessment, no imported baseline. The
-- reference workbook names people and rates them individually; its importer
-- reads headers only (docs/competencies/COMPETENCY_IMPORT_PLAN.md).
--
-- Three decisions this migration encodes:
--
--   * Definitions are FRAMEWORK-scoped with a stable code, and a VERSION is one
--     source file identified by its content hash. Provenance rows record which
--     definitions a version contained. That is what makes a re-import of the
--     same file create nothing.
--
--   * A role target references the EXISTING job_role. A second role catalogue
--     would give "Developer" two rows that look identical in a dropdown.
--
--   * APPROVED is a recorded act, not a status somebody sets. The CHECKs below
--     refuse an approved framework version or role target without an approver,
--     a time and a reference to where the approval is held -- the same shape
--     as a provider approval (architecture.md §9.0 rule 7).

-- CreateEnum
CREATE TYPE "competency_category_kind" AS ENUM ('PRODUCT_KNOWLEDGE', 'FUNCTIONAL_DOMAIN', 'TECHNICAL', 'PROCESS', 'AGILE_PRACTICE', 'POWER_SKILL');

-- CreateEnum
CREATE TYPE "competency_definition_status" AS ENUM ('ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "competency_framework_version_status" AS ENUM ('DRAFT', 'APPROVED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "competency_alias_subject" AS ENUM ('CATEGORY', 'COMPETENCY');

-- CreateEnum
CREATE TYPE "competency_alias_decision" AS ENUM ('EXACT', 'CASE_OR_SPACING', 'SPELLING_CORRECTION', 'ABBREVIATION', 'CATEGORY_QUALIFIED', 'PROVISIONAL', 'UNDECLARED');

-- CreateEnum
CREATE TYPE "role_competency_expectation_status" AS ENUM ('PROPOSED', 'APPROVED', 'RETIRED');

-- CreateEnum
CREATE TYPE "competency_import_outcome" AS ENUM ('APPLIED', 'NO_CHANGES');

-- CreateEnum
CREATE TYPE "competency_import_finding_severity" AS ENUM ('INFO', 'WARNING', 'DECISION_REQUIRED', 'BLOCKING');

-- CreateEnum
CREATE TYPE "competency_provenance_subject" AS ENUM ('CATEGORY', 'COMPETENCY', 'LEVEL');

-- CreateTable
CREATE TABLE "competency_framework" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "competency_definition_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by_user_id" UUID,
    "modified_by_user_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "competency_framework_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competency_framework_version" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "framework_id" UUID NOT NULL,
    "version_label" TEXT NOT NULL,
    "source_file_name" TEXT NOT NULL,
    "source_content_sha256" CHAR(64) NOT NULL,
    "status" "competency_framework_version_status" NOT NULL DEFAULT 'DRAFT',
    "effective_from" DATE,
    "approved_at" TIMESTAMPTZ(6),
    "approved_by_user_id" UUID,
    "approval_reference" TEXT,
    "importer_version" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "competency_framework_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competency_level_scale" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "framework_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "competency_level_scale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competency_level" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "scale_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "description" TEXT,
    "source_labels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "competency_level_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competency_category" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "framework_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "competency_category_kind" NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "status" "competency_definition_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "competency_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competency" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "framework_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "level_scale_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "competency_definition_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "competency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competency_alias" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "framework_id" UUID NOT NULL,
    "subject" "competency_alias_subject" NOT NULL,
    "context_code" TEXT NOT NULL,
    "category_id" UUID,
    "competency_id" UUID,
    "alias" TEXT NOT NULL,
    "folded_alias" TEXT NOT NULL,
    "decision" "competency_alias_decision" NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competency_alias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_competency_expectation" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "job_role_id" UUID NOT NULL,
    "competency_id" UUID NOT NULL,
    "target_level_id" UUID NOT NULL,
    "status" "role_competency_expectation_status" NOT NULL DEFAULT 'PROPOSED',
    "source" TEXT NOT NULL,
    "rationale" TEXT,
    "effective_from" DATE,
    "approved_at" TIMESTAMPTZ(6),
    "approved_by_user_id" UUID,
    "approval_reference" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by_user_id" UUID,
    "modified_by_user_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "role_competency_expectation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competency_import_batch" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "framework_version_id" UUID NOT NULL,
    "outcome" "competency_import_outcome" NOT NULL,
    "profile_code" TEXT NOT NULL,
    "importer_version" TEXT NOT NULL,
    "source_file_name" TEXT NOT NULL,
    "source_content_sha256" CHAR(64) NOT NULL,
    "actor_label" TEXT,
    "correlation_id" TEXT NOT NULL,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "competency_import_batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competency_import_finding" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "batch_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "severity" "competency_import_finding_severity" NOT NULL,
    "sheet_name" TEXT,
    "cell_reference" TEXT,
    "subject_label" TEXT,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competency_import_finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competency_import_provenance" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "framework_version_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "subject" "competency_provenance_subject" NOT NULL,
    "category_id" UUID,
    "competency_id" UUID,
    "level_id" UUID,
    "sheet_name" TEXT NOT NULL,
    "cell_reference" TEXT NOT NULL,
    "raw_label" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competency_import_provenance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "competency_framework_code_key" ON "competency_framework"("code");

-- CreateIndex
CREATE UNIQUE INDEX "competency_framework_version_framework_id_source_content_sh_key" ON "competency_framework_version"("framework_id", "source_content_sha256");

-- CreateIndex
CREATE UNIQUE INDEX "competency_framework_version_framework_id_version_label_key" ON "competency_framework_version"("framework_id", "version_label");

-- CreateIndex
CREATE UNIQUE INDEX "competency_level_scale_framework_id_code_key" ON "competency_level_scale"("framework_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "competency_level_scale_id_code_key" ON "competency_level"("scale_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "competency_level_scale_id_ordinal_key" ON "competency_level"("scale_id", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "competency_category_framework_id_code_key" ON "competency_category"("framework_id", "code");

-- CreateIndex
CREATE INDEX "competency_category_id_idx" ON "competency"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "competency_framework_id_code_key" ON "competency"("framework_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "competency_alias_framework_id_subject_context_code_folded_a_key" ON "competency_alias"("framework_id", "subject", "context_code", "folded_alias");

-- CreateIndex
CREATE INDEX "role_competency_expectation_job_role_id_competency_id_idx" ON "role_competency_expectation"("job_role_id", "competency_id");

-- CreateIndex
CREATE INDEX "role_competency_expectation_status_idx" ON "role_competency_expectation"("status");

-- CreateIndex
CREATE INDEX "competency_import_batch_framework_version_id_started_at_idx" ON "competency_import_batch"("framework_version_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "competency_import_finding_batch_id_idx" ON "competency_import_finding"("batch_id");

-- CreateIndex
CREATE INDEX "competency_import_provenance_competency_id_idx" ON "competency_import_provenance"("competency_id");

-- CreateIndex
CREATE UNIQUE INDEX "competency_import_provenance_framework_version_id_subject_s_key" ON "competency_import_provenance"("framework_version_id", "subject", "sheet_name", "cell_reference");

-- AddForeignKey
ALTER TABLE "competency_framework_version" ADD CONSTRAINT "competency_framework_version_framework_id_fkey" FOREIGN KEY ("framework_id") REFERENCES "competency_framework"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competency_level_scale" ADD CONSTRAINT "competency_level_scale_framework_id_fkey" FOREIGN KEY ("framework_id") REFERENCES "competency_framework"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competency_level" ADD CONSTRAINT "competency_level_scale_id_fkey" FOREIGN KEY ("scale_id") REFERENCES "competency_level_scale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competency_category" ADD CONSTRAINT "competency_category_framework_id_fkey" FOREIGN KEY ("framework_id") REFERENCES "competency_framework"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competency" ADD CONSTRAINT "competency_framework_id_fkey" FOREIGN KEY ("framework_id") REFERENCES "competency_framework"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competency" ADD CONSTRAINT "competency_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "competency_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competency" ADD CONSTRAINT "competency_level_scale_id_fkey" FOREIGN KEY ("level_scale_id") REFERENCES "competency_level_scale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competency_alias" ADD CONSTRAINT "competency_alias_framework_id_fkey" FOREIGN KEY ("framework_id") REFERENCES "competency_framework"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competency_alias" ADD CONSTRAINT "competency_alias_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "competency_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competency_alias" ADD CONSTRAINT "competency_alias_competency_id_fkey" FOREIGN KEY ("competency_id") REFERENCES "competency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_competency_expectation" ADD CONSTRAINT "role_competency_expectation_job_role_id_fkey" FOREIGN KEY ("job_role_id") REFERENCES "job_role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_competency_expectation" ADD CONSTRAINT "role_competency_expectation_competency_id_fkey" FOREIGN KEY ("competency_id") REFERENCES "competency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_competency_expectation" ADD CONSTRAINT "role_competency_expectation_target_level_id_fkey" FOREIGN KEY ("target_level_id") REFERENCES "competency_level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competency_import_batch" ADD CONSTRAINT "competency_import_batch_framework_version_id_fkey" FOREIGN KEY ("framework_version_id") REFERENCES "competency_framework_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competency_import_finding" ADD CONSTRAINT "competency_import_finding_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "competency_import_batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competency_import_provenance" ADD CONSTRAINT "competency_import_provenance_framework_version_id_fkey" FOREIGN KEY ("framework_version_id") REFERENCES "competency_framework_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competency_import_provenance" ADD CONSTRAINT "competency_import_provenance_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "competency_import_batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competency_import_provenance" ADD CONSTRAINT "competency_import_provenance_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "competency_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competency_import_provenance" ADD CONSTRAINT "competency_import_provenance_competency_id_fkey" FOREIGN KEY ("competency_id") REFERENCES "competency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competency_import_provenance" ADD CONSTRAINT "competency_import_provenance_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "competency_level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- CHECK constraints (not expressible in Prisma; invisible to the drift gate,
-- as those in 0003 are)
-- ---------------------------------------------------------------------------

-- An approval is three facts, all present, or it is not an approval.
ALTER TABLE "competency_framework_version"
  ADD CONSTRAINT "competency_framework_version_approval_check" CHECK (
    "status" <> 'APPROVED'
    OR (
      "approved_at" IS NOT NULL
      AND "approved_by_user_id" IS NOT NULL
      AND "approval_reference" IS NOT NULL
      AND length(btrim("approval_reference")) > 0
    )
  );

ALTER TABLE "role_competency_expectation"
  ADD CONSTRAINT "role_competency_expectation_approval_check" CHECK (
    "status" <> 'APPROVED'
    OR (
      "approved_at" IS NOT NULL
      AND "approved_by_user_id" IS NOT NULL
      AND "approval_reference" IS NOT NULL
      AND length(btrim("approval_reference")) > 0
    )
  );

-- A content hash is 64 lower-case hex characters, never a placeholder.
ALTER TABLE "competency_framework_version"
  ADD CONSTRAINT "competency_framework_version_sha256_check"
  CHECK ("source_content_sha256" ~ '^[0-9a-f]{64}$');

ALTER TABLE "competency_import_batch"
  ADD CONSTRAINT "competency_import_batch_sha256_check"
  CHECK ("source_content_sha256" ~ '^[0-9a-f]{64}$');

-- An alias maps to exactly the kind of definition its subject names. A
-- competency alias also records the category it appeared under, which is the
-- context that keeps "Oracle" under Database and under ERP apart.
ALTER TABLE "competency_alias"
  ADD CONSTRAINT "competency_alias_subject_check" CHECK (
    (
      "subject" = 'CATEGORY'
      AND "category_id" IS NOT NULL
      AND "competency_id" IS NULL
      AND "context_code" = ''
    )
    OR (
      "subject" = 'COMPETENCY'
      AND "category_id" IS NOT NULL
      AND "competency_id" IS NOT NULL
      AND "context_code" <> ''
    )
  );

-- Provenance points at exactly one definition, of the kind its subject names.
ALTER TABLE "competency_import_provenance"
  ADD CONSTRAINT "competency_import_provenance_subject_check" CHECK (
    ("subject" = 'CATEGORY' AND "category_id" IS NOT NULL AND "competency_id" IS NULL AND "level_id" IS NULL)
    OR ("subject" = 'COMPETENCY' AND "competency_id" IS NOT NULL AND "category_id" IS NULL AND "level_id" IS NULL)
    OR ("subject" = 'LEVEL' AND "level_id" IS NOT NULL AND "category_id" IS NULL AND "competency_id" IS NULL)
  );

ALTER TABLE "competency_level"
  ADD CONSTRAINT "competency_level_ordinal_check" CHECK ("ordinal" >= 0);
