-- 0016 — competency administration (COMPETENCY-M2)
--
-- Specification first: docs/competencies/COMPETENCY_ADMINISTRATION.md, and the
-- amendments it made to COMPETENCY_MODEL.md §2.2 and architecture.md §14 rule 8.
--
-- STILL REFERENCE DEFINITIONS ONLY. Nothing here holds an observation about a
-- person. A role target names a ROLE.
--
-- Four things this migration encodes:
--
--   * A framework version is a SNAPSHOT identified by `definitions_sha256`,
--     with an origin (IMPORT or ADMINISTRATION). An approval covers that hash.
--
--   * APPROVAL IS SEPARATED FROM EDITING. A version's creator and every user who
--     changed a definition it covers are in `editor_user_ids`; a target's
--     proposer and editors likewise. The CHECKs below refuse an approver among
--     them, so the rule holds even for a write that bypasses the service.
--
--   * Every definition write is a row in `competency_definition_change`, and
--     that table is APPEND-ONLY. A version's editors are read from it, so a
--     rewritable log would be a way to approve your own edits. It has no
--     foreign key to the framework, as audit_log has none to its entities.
--
--   * At most one PROPOSED and one APPROVED target per role and competency.
--     An EXPRESSION index rather than a partial one: Prisma ignores expression
--     indexes, so the schema drift gate does not try to drop it (CLAUDE.md,
--     "Gotchas", 0003).

-- CreateEnum
CREATE TYPE "competency_version_origin" AS ENUM ('IMPORT', 'ADMINISTRATION');

-- CreateEnum
CREATE TYPE "competency_change_subject" AS ENUM ('CATEGORY', 'COMPETENCY', 'ALIAS');

-- AlterTable
ALTER TABLE "competency_framework_version" ADD COLUMN     "created_by_user_id" UUID,
ADD COLUMN     "definitions_sha256" CHAR(64),
ADD COLUMN     "editor_user_ids" UUID[] DEFAULT ARRAY[]::UUID[],
ADD COLUMN     "origin" "competency_version_origin" NOT NULL DEFAULT 'IMPORT';

-- AlterTable
ALTER TABLE "competency_alias" ADD COLUMN     "created_by_user_id" UUID,
ADD COLUMN     "modified_by_user_id" UUID,
ADD COLUMN     "status" "competency_definition_status" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "role_competency_expectation" ADD COLUMN     "editor_user_ids" UUID[] DEFAULT ARRAY[]::UUID[],
ADD COLUMN     "framework_version_id" UUID,
ADD COLUMN     "retired_at" TIMESTAMPTZ(6),
ADD COLUMN     "retired_by_user_id" UUID;

-- CreateTable
CREATE TABLE "competency_definition_change" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "framework_id" UUID NOT NULL,
    "subject" "competency_change_subject" NOT NULL,
    "subject_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "changed_fields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "previous_value" JSONB,
    "new_value" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competency_definition_change_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "competency_definition_change_framework_id_created_at_idx" ON "competency_definition_change"("framework_id", "created_at");

-- AddForeignKey
ALTER TABLE "role_competency_expectation" ADD CONSTRAINT "role_competency_expectation_framework_version_id_fkey" FOREIGN KEY ("framework_version_id") REFERENCES "competency_framework_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written (not expressible in Prisma; invisible to the drift gate)
-- ---------------------------------------------------------------------------

-- A definitions hash is 64 lower-case hex characters, never a placeholder.
ALTER TABLE "competency_framework_version"
  ADD CONSTRAINT "competency_framework_version_definitions_sha256_check"
  CHECK ("definitions_sha256" IS NULL OR "definitions_sha256" ~ '^[0-9a-f]{64}$');

-- An administration snapshot always has a hash and a creator: it is drawn up
-- by a person on screen. An import may have neither (it runs as a command).
ALTER TABLE "competency_framework_version"
  ADD CONSTRAINT "competency_framework_version_origin_check" CHECK (
    "origin" <> 'ADMINISTRATION'
    OR ("definitions_sha256" IS NOT NULL AND "created_by_user_id" IS NOT NULL)
  );

-- Separation of duties for a version: the approver is not its creator and not
-- one of the people who edited what it covers.
ALTER TABLE "competency_framework_version"
  ADD CONSTRAINT "competency_framework_version_separation_check" CHECK (
    "approved_by_user_id" IS NULL
    OR (
      "approved_by_user_id" <> ALL (COALESCE("editor_user_ids", ARRAY[]::UUID[]))
      AND ("created_by_user_id" IS NULL OR "approved_by_user_id" <> "created_by_user_id")
    )
  );

-- Separation of duties for a role target: the approver is not its proposer,
-- its last editor, or anyone who edited it before.
ALTER TABLE "role_competency_expectation"
  ADD CONSTRAINT "role_competency_expectation_separation_check" CHECK (
    "approved_by_user_id" IS NULL
    OR (
      "approved_by_user_id" <> ALL (COALESCE("editor_user_ids", ARRAY[]::UUID[]))
      AND ("created_by_user_id" IS NULL OR "approved_by_user_id" <> "created_by_user_id")
      AND ("modified_by_user_id" IS NULL OR "approved_by_user_id" <> "modified_by_user_id")
    )
  );

-- An approved target records the framework version it was approved against.
ALTER TABLE "role_competency_expectation"
  ADD CONSTRAINT "role_competency_expectation_version_check" CHECK (
    "status" <> 'APPROVED' OR "framework_version_id" IS NOT NULL
  );

-- A retired target says who retired it and when.
ALTER TABLE "role_competency_expectation"
  ADD CONSTRAINT "role_competency_expectation_retired_check" CHECK (
    "status" <> 'RETIRED' OR ("retired_at" IS NOT NULL AND "retired_by_user_id" IS NOT NULL)
  );

-- One PROPOSED and one APPROVED per role and competency. The CASE makes every
-- RETIRED row NULL in the third column, and NULLs never collide. (A cast of the
-- enum to text is not IMMUTABLE, so it cannot appear in an index; an enum
-- comparison can.)
CREATE UNIQUE INDEX "role_competency_expectation_open_key"
  ON "role_competency_expectation" (
    "job_role_id",
    "competency_id",
    (CASE WHEN "status" = 'RETIRED'::"role_competency_expectation_status" THEN NULL ELSE "status" END)
  );

-- The change log is append-only.
CREATE OR REPLACE FUNCTION "competency_definition_change_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'competency_definition_change is append-only: % refused', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "competency_definition_change_no_update"
  BEFORE UPDATE OR DELETE ON "competency_definition_change"
  FOR EACH ROW EXECUTE FUNCTION "competency_definition_change_append_only"();
