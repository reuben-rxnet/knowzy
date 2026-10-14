-- 0018 — AI Document Studio M3: assessment preparation (2026-10-14)
--
-- Specification first: docs/competencies/AI_DOCUMENT_STUDIO_ARCHITECTURE.md
-- §11. Four tables, nothing altered, nothing dropped:
--
--   studio_upload              one row per ACCEPTED upload (a refused one is
--                              never written); sha256 unique is the
--                              duplicate-upload control.
--   prepared_document          one per original document.
--   document_preparation_run   one row per preparation ATTEMPT; its tokens
--                              count against the generation token windows.
--   prepared_document_version  the prepared text, its five states, and its
--                              lineage to the original document and version.
--
-- The original document is never written by any of it. An uploaded original
-- is a file synchronized into a system source; a prepared version added to the
-- repository is a separate document in another.

-- CreateEnum
CREATE TYPE "prepared_version_state" AS ENUM ('DRAFT', 'READY_FOR_QUESTION_GENERATION', 'SUPERSEDED', 'REVALIDATION_REQUIRED', 'REJECTED');

-- CreateEnum
CREATE TYPE "prepared_version_origin" AS ENUM ('PREPARATION', 'EDIT', 'REVALIDATION_REVIEW');

-- CreateEnum
CREATE TYPE "preparation_run_status" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'REFUSED');

-- CreateTable
CREATE TABLE "studio_upload" (
    "id" UUID NOT NULL,
    "original_file_name" TEXT NOT NULL,
    "stored_file_name" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "scan_status" TEXT NOT NULL DEFAULT 'NOT_SCANNED',
    "uploaded_by_user_id" UUID NOT NULL,
    "uploaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "knowledge_document_id" UUID,

    CONSTRAINT "studio_upload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prepared_document" (
    "id" UUID NOT NULL,
    "original_document_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "prepared_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_preparation_run" (
    "id" UUID NOT NULL,
    "prepared_document_id" UUID NOT NULL,
    "provider_id" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "status" "preparation_run_status" NOT NULL,
    "outcome_reason" TEXT,
    "failure_class" TEXT,
    "original_version_counter" INTEGER NOT NULL,
    "original_content_hash" CHAR(64) NOT NULL,
    "estimated_input_tokens" INTEGER NOT NULL,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "measured_cost" DECIMAL(12,6),
    "output" JSONB,
    "output_markdown" TEXT,
    "checks" JSONB,
    "requested_by_user_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "document_preparation_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prepared_document_version" (
    "id" UUID NOT NULL,
    "prepared_document_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "state" "prepared_version_state" NOT NULL,
    "origin" "prepared_version_origin" NOT NULL,
    "based_on_version_id" UUID,
    "preparation_run_id" UUID,
    "content" TEXT NOT NULL,
    "content_sha256" CHAR(64) NOT NULL,
    "checks" JSONB NOT NULL DEFAULT '[]',
    "original_document_id" UUID NOT NULL,
    "original_version_counter" INTEGER NOT NULL,
    "original_content_hash" CHAR(64) NOT NULL,
    "provider_id" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "prepared_at" TIMESTAMPTZ(6) NOT NULL,
    "prepared_by_user_id" UUID NOT NULL,
    "edited_by_user_id" UUID,
    "edited_at" TIMESTAMPTZ(6),
    "added_by_user_id" UUID,
    "added_at" TIMESTAMPTZ(6),
    "repository_document_id" UUID,
    "repository_file_name" TEXT,
    "superseded_at" TIMESTAMPTZ(6),
    "revalidation_reason" TEXT,
    "revalidation_flagged_at" TIMESTAMPTZ(6),
    "rejected_by_user_id" UUID,
    "rejected_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "prepared_document_version_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "studio_upload_stored_file_name_key" ON "studio_upload"("stored_file_name");

-- CreateIndex
CREATE UNIQUE INDEX "studio_upload_sha256_key" ON "studio_upload"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "studio_upload_knowledge_document_id_key" ON "studio_upload"("knowledge_document_id");

-- CreateIndex
CREATE UNIQUE INDEX "prepared_document_original_document_id_key" ON "prepared_document"("original_document_id");

-- CreateIndex
CREATE INDEX "document_preparation_run_status_started_at_idx" ON "document_preparation_run"("status", "started_at");

-- CreateIndex
CREATE INDEX "document_preparation_run_started_at_idx" ON "document_preparation_run"("started_at");

-- CreateIndex
CREATE UNIQUE INDEX "prepared_document_version_repository_document_id_key" ON "prepared_document_version"("repository_document_id");

-- CreateIndex
CREATE UNIQUE INDEX "prepared_document_version_repository_file_name_key" ON "prepared_document_version"("repository_file_name");

-- CreateIndex
CREATE INDEX "prepared_document_version_state_idx" ON "prepared_document_version"("state");

-- CreateIndex
CREATE INDEX "prepared_document_version_original_document_id_idx" ON "prepared_document_version"("original_document_id");

-- CreateIndex
CREATE UNIQUE INDEX "prepared_document_version_prepared_document_id_version_numb_key" ON "prepared_document_version"("prepared_document_id", "version_number");

-- AddForeignKey
ALTER TABLE "studio_upload" ADD CONSTRAINT "studio_upload_knowledge_document_id_fkey" FOREIGN KEY ("knowledge_document_id") REFERENCES "knowledge_document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prepared_document" ADD CONSTRAINT "prepared_document_original_document_id_fkey" FOREIGN KEY ("original_document_id") REFERENCES "knowledge_document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_preparation_run" ADD CONSTRAINT "document_preparation_run_prepared_document_id_fkey" FOREIGN KEY ("prepared_document_id") REFERENCES "prepared_document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prepared_document_version" ADD CONSTRAINT "prepared_document_version_prepared_document_id_fkey" FOREIGN KEY ("prepared_document_id") REFERENCES "prepared_document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prepared_document_version" ADD CONSTRAINT "prepared_document_version_preparation_run_id_fkey" FOREIGN KEY ("preparation_run_id") REFERENCES "document_preparation_run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prepared_document_version" ADD CONSTRAINT "prepared_document_version_original_document_id_fkey" FOREIGN KEY ("original_document_id") REFERENCES "knowledge_document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prepared_document_version" ADD CONSTRAINT "prepared_document_version_repository_document_id_fkey" FOREIGN KEY ("repository_document_id") REFERENCES "knowledge_document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Invariants the schema file cannot express (invisible to the drift gate,
-- like every CHECK and trigger in this repository).
-- ---------------------------------------------------------------------------

-- A READY version was added by somebody, at a time, as a repository document.
ALTER TABLE "prepared_document_version"
  ADD CONSTRAINT "prepared_document_version_ready_check" CHECK (
    "state" <> 'READY_FOR_QUESTION_GENERATION'::"prepared_version_state"
    OR ("added_by_user_id" IS NOT NULL
        AND "added_at" IS NOT NULL
        AND "repository_document_id" IS NOT NULL)
  );

-- A REJECTED version records who discarded it, and when.
ALTER TABLE "prepared_document_version"
  ADD CONSTRAINT "prepared_document_version_rejected_check" CHECK (
    "state" <> 'REJECTED'::"prepared_version_state"
    OR ("rejected_by_user_id" IS NOT NULL AND "rejected_at" IS NOT NULL)
  );

ALTER TABLE "prepared_document_version"
  ADD CONSTRAINT "prepared_document_version_number_check" CHECK ("version_number" >= 1);

ALTER TABLE "studio_upload"
  ADD CONSTRAINT "studio_upload_size_check" CHECK ("size_bytes" > 0);

-- §11.6: a version with downstream questions can never be destructively
-- deleted. A question names its source document by (source_id,
-- source_document_id), so the trigger follows the version's repository
-- document to them. There is no delete route either; this is what holds when
-- somebody reaches the table another way.
CREATE FUNCTION "prepared_document_version_refuse_delete"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."repository_document_id" IS NOT NULL AND EXISTS (
    SELECT 1
      FROM "draft_question" dq
      JOIN "knowledge_document" kd
        ON kd."source_id" = dq."source_id"
       AND kd."source_document_id" = dq."source_document_id"
     WHERE kd."id" = OLD."repository_document_id"
  ) THEN
    RAISE EXCEPTION 'prepared_document_version % has questions generated from it and cannot be deleted', OLD."id"
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER "prepared_document_version_no_delete_with_questions"
  BEFORE DELETE ON "prepared_document_version"
  FOR EACH ROW EXECUTE FUNCTION "prepared_document_version_refuse_delete"();
