-- ---------------------------------------------------------------------------
-- 0003  Platform constraints, partial indexes, triggers, and append-only rules
--
-- Hand-written, per data-model.md §15. Everything here is something Prisma
-- cannot express: CHECK constraints, partial and expression indexes, triggers,
-- and the append-only enforcement on audit and lineage.
--
-- Each statement names the invariant it implements (data-model.md §13) or the
-- index it provides (§12), so a failure points at the documented rule.
--
-- Runs AFTER 0002_init, which is generated from schema.prisma.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- §13  CHECK constraints
-- ===========================================================================

-- I1 — a MULTIPLE_CHOICE_4 question has exactly four non-blank options and a
-- correctOption in {A,B,C,D}. Normalization-sensitive duplicate detection (I2)
-- is an application gate; it is not expressible in a CHECK.
ALTER TABLE "draft_question"
  ADD CONSTRAINT "draft_question_mc4_payload_check" CHECK (
    "question_type" <> 'MULTIPLE_CHOICE_4'
    OR (
      "answer_payload" ->> 'type' = 'MULTIPLE_CHOICE_4'
      AND length(btrim(coalesce("answer_payload" -> 'options' ->> 'A', ''))) > 0
      AND length(btrim(coalesce("answer_payload" -> 'options' ->> 'B', ''))) > 0
      AND length(btrim(coalesce("answer_payload" -> 'options' ->> 'C', ''))) > 0
      AND length(btrim(coalesce("answer_payload" -> 'options' ->> 'D', ''))) > 0
      AND "answer_payload" ->> 'correctOption' IN ('A', 'B', 'C', 'D')
    )
  );

-- I3 — a question cannot reach APPROVED or beyond without a verified evidence
-- span. The columns are NOT NULL already; this forbids a blank span.
ALTER TABLE "draft_question"
  ADD CONSTRAINT "draft_question_evidence_required_check" CHECK (
    "status" NOT IN ('APPROVED', 'PUBLISHED', 'RETIRED')
    OR (
      length(btrim("supporting_evidence")) > 0
      AND "evidence_end_offset" > "evidence_start_offset"
    )
  );

-- Evidence span length bounds — workflows.md §2.5: 40–1,200 characters.
-- Too short is not evidence; too long is not a citation.
ALTER TABLE "draft_question"
  ADD CONSTRAINT "draft_question_evidence_length_check" CHECK (
    "status" = 'GENERATED'
    OR (
      length("supporting_evidence") BETWEEN 40 AND 1200
    )
  );

-- I17 — a written justification is required for PUBLISHER_REQUESTED.
ALTER TABLE "generation_job"
  ADD CONSTRAINT "generation_job_justification_check" CHECK (
    "reason_code" <> 'PUBLISHER_REQUESTED'
    OR (
      "justification" IS NOT NULL AND length(btrim("justification")) >= 20
    )
  );

-- I18 (partial) — the 1–10 document cap. Cardinality of the joined
-- generation_job_document rows is asserted in the creating transaction;
-- what is expressible here is that a job must request at least one question
-- and no more than the platform cap.
ALTER TABLE "generation_job"
  ADD CONSTRAINT "generation_job_requested_count_check" CHECK (
    "requested_question_count" BETWEEN 1 AND 50
  );

ALTER TABLE "generation_preflight"
  ADD CONSTRAINT "generation_preflight_document_count_check" CHECK (
    cardinality("document_ids") BETWEEN 1 AND 10
  );

-- I8 — correct + incorrect = total.
ALTER TABLE "assessment_result"
  ADD CONSTRAINT "assessment_result_counts_check" CHECK (
    "correct_answers" + "incorrect_answers" = "total_questions"
  );

-- I9 — unanswered items count as incorrect, so they are a subset of them.
ALTER TABLE "assessment_result"
  ADD CONSTRAINT "assessment_result_unanswered_check" CHECK (
    "unanswered_count" <= "incorrect_answers"
  );

-- I10 — percentageScore is consistent with the counts, within one unit in the
-- second decimal. The stored value IS the decided value, so this constraint is
-- what makes "no hidden precision" checkable.
ALTER TABLE "assessment_result"
  ADD CONSTRAINT "assessment_result_score_consistency_check" CHECK (
    "total_questions" > 0
    AND abs(
      "percentage_score"
      - round(("correct_answers"::numeric / "total_questions"::numeric) * 100, 2)
    ) <= 0.01
  );

-- Topic accuracy uses the same rule with its own denominator.
ALTER TABLE "topic_result"
  ADD CONSTRAINT "topic_result_counts_check" CHECK (
    "correct" + "incorrect" = "questions_asked" AND "unanswered" <= "incorrect"
  );

ALTER TABLE "topic_result"
  ADD CONSTRAINT "topic_result_accuracy_consistency_check" CHECK (
    "questions_asked" > 0
    AND abs(
      "topic_accuracy" - round(("correct"::numeric / "questions_asked"::numeric) * 100, 2)
    ) <= 0.01
  );

-- I12 — availability window ordering. T7: half-open intervals everywhere, so
-- there is no gap or overlap at midnight.
ALTER TABLE "assessment_version"
  ADD CONSTRAINT "assessment_version_availability_check" CHECK (
    "availability_start" IS NULL
    OR "availability_end" IS NULL
    OR "availability_start" < "availability_end"
  );

ALTER TABLE "assessment_version"
  ADD CONSTRAINT "assessment_version_pass_percentage_check" CHECK (
    "pass_percentage" >= 0 AND "pass_percentage" <= 100
  );

ALTER TABLE "assessment_version"
  ADD CONSTRAINT "assessment_version_question_count_check" CHECK (
    "question_count" >= 1
  );

-- Score and similarity columns are proportions or percentages; a value outside
-- range means a defect upstream, and storing it would corrupt every aggregate
-- that reads it.
ALTER TABLE "draft_question"
  ADD CONSTRAINT "draft_question_confidence_range_check" CHECK (
    "confidence_score" >= 0 AND "confidence_score" <= 1
  );

ALTER TABLE "question_similarity"
  ADD CONSTRAINT "question_similarity_score_range_check" CHECK (
    "composite_score" >= 0 AND "composite_score" <= 1
  );

ALTER TABLE "question_similarity"
  ADD CONSTRAINT "question_similarity_distinct_pair_check" CHECK (
    "question_a_id" <> "question_b_id"
  );

ALTER TABLE "document_section"
  ADD CONSTRAINT "document_section_offsets_check" CHECK (
    "end_offset" > "start_offset" AND "start_offset" >= 0
  );

-- A source with no probe has no probe timestamp, and a probed source has one.
-- §5.4 rule 1: connectionStatus is never inferred.
ALTER TABLE "knowledge_source"
  ADD CONSTRAINT "knowledge_source_probe_timestamp_check" CHECK (
    ("connection_status" = 'UNTESTED' AND "connection_status_at" IS NULL)
    OR ("connection_status" <> 'UNTESTED' AND "connection_status_at" IS NOT NULL)
  );

-- Folder paths are normalized on write so traversal is not expressible (§4.2).
ALTER TABLE "knowledge_source_path"
  ADD CONSTRAINT "knowledge_source_path_normalized_check" CHECK (
    "folder_path" LIKE '/%'
    AND "folder_path" NOT LIKE '%..%'
    AND ("folder_path" = '/' OR "folder_path" NOT LIKE '%/')
  );

-- A document with no extracted text must say why, and one with text must not
-- claim a failure status. §X5: empty text with a success status is prohibited.
ALTER TABLE "knowledge_document"
  ADD CONSTRAINT "knowledge_document_extraction_consistency_check" CHECK (
    ("extraction_status" = 'EXTRACTED' AND "extracted_text" IS NOT NULL AND "content_hash" IS NOT NULL)
    OR ("extraction_status" <> 'EXTRACTED' AND "extracted_char_count" = 0)
  );

-- A retired reference records who retired it and why (workflows.md §4.4).
ALTER TABLE "published_question_reference"
  ADD CONSTRAINT "published_question_reference_retirement_check" CHECK (
    "status" <> 'RETIRED'
    OR (
      "retired_at" IS NOT NULL
      AND "retired_by_user_id" IS NOT NULL
      AND "retire_comment" IS NOT NULL
      AND length(btrim("retire_comment")) >= 10
    )
  );

-- A revoked award or certificate records when and why, and is never deleted (I20).
ALTER TABLE "badge_award"
  ADD CONSTRAINT "badge_award_revocation_check" CHECK (
    ("revoked_at" IS NULL AND "revoke_reason" IS NULL)
    OR ("revoked_at" IS NOT NULL AND "revoke_reason" IS NOT NULL)
  );

ALTER TABLE "certificate"
  ADD CONSTRAINT "certificate_revocation_check" CHECK (
    "status" <> 'REVOKED'
    OR ("revoked_at" IS NOT NULL AND "revoke_reason" IS NOT NULL)
  );

-- A blocking review must carry a comment; a mandatory-comment transition
-- cannot be satisfied by an empty string.
ALTER TABLE "question_review"
  ADD CONSTRAINT "question_review_comment_check" CHECK (
    "outcome" NOT IN ('CHANGES_REQUESTED', 'REJECTED')
    OR length(btrim("comment")) >= 10
  );

-- Scheduled reporting may only ever run per recipient (reporting.md §9 H1).
ALTER TABLE "report_schedule"
  ADD CONSTRAINT "report_schedule_run_as_mode_check" CHECK (
    "run_as_mode" = 'PER_RECIPIENT'
  );

-- ===========================================================================
-- §12  Partial and expression indexes
-- ===========================================================================

-- I6 — one IN_PROGRESS session per learner per assessment, enforced as a
-- constraint rather than a check-then-act race.
CREATE UNIQUE INDEX "quiz_session_one_in_progress_per_assessment_uidx"
  ON "quiz_session" ("learner_user_id", "assessment_id")
  WHERE "status" = 'IN_PROGRESS';

-- I7 — exactly one isLatest response per session question, so scoring reads
-- exactly one row per question.
CREATE UNIQUE INDEX "quiz_response_one_latest_per_question_uidx"
  ON "quiz_response" ("session_id", "presentation_index")
  WHERE "is_latest";

-- Revalidation queue. A partial index keeps it tiny: the flag is false for
-- almost every row.
CREATE INDEX "draft_question_needs_revalidation_idx"
  ON "draft_question" ("domain_id", "revalidation_detected_at" DESC)
  WHERE "needs_revalidation";

-- Publish worker claim and crash recovery.
CREATE INDEX "publish_operation_claimable_idx"
  ON "publish_operation" ("state", "claimed_at")
  WHERE "state" IN ('PENDING', 'IN_FLIGHT');

-- Reconciliation worklist.
CREATE INDEX "published_question_reference_drift_idx"
  ON "published_question_reference" ("reconciliation_state", "last_reconciled_at")
  WHERE "reconciliation_state" <> 'IN_SYNC';

-- Effective-role resolution runs on every request.
CREATE INDEX "user_role_active_idx"
  ON "user_role" ("user_id", "role_id")
  WHERE "revoked_at" IS NULL;

CREATE INDEX "user_domain_scope_active_idx"
  ON "user_domain_scope" ("user_id", "domain_id")
  WHERE "revoked_at" IS NULL;

CREATE INDEX "user_source_access_active_idx"
  ON "user_source_access" ("user_id", "mode")
  WHERE "revoked_at" IS NULL;

-- R1 of sharepoint-field-mapping.md §4.2: exactly one ACTIVE profile per list.
CREATE UNIQUE INDEX "field_mapping_profile_one_active_uidx"
  ON "field_mapping_profile" ("environment", "target_list_id")
  WHERE "status" = 'ACTIVE';

-- Open findings and unresolved sync failures are worklists, not archives.
CREATE INDEX "platform_consistency_finding_open_idx"
  ON "platform_consistency_finding" ("check_key", "detected_at" DESC)
  WHERE "state" = 'OPEN';

CREATE INDEX "sync_document_failure_retryable_idx"
  ON "sync_document_failure" ("next_retry_at")
  WHERE "state" = 'PENDING_RETRY';

CREATE INDEX "notification_unread_idx"
  ON "notification" ("recipient_user_id", "created_at" DESC)
  WHERE "state" IN ('PENDING', 'DELIVERED');

-- QuestionSimilarity: one row per unordered pair. Without the expression index
-- the same pair could be stored twice with the ids swapped, which would double
-- every cluster metric.
CREATE UNIQUE INDEX "question_similarity_unordered_pair_uidx"
  ON "question_similarity" (
    LEAST("question_a_id", "question_b_id"),
    GREATEST("question_a_id", "question_b_id")
  );

-- ===========================================================================
-- §12  Trigram and full-text indexes
-- ===========================================================================

-- Stage-2 duplicate candidate blocking (generation-governance.md §4.4).
CREATE INDEX "draft_question_text_trgm_idx"
  ON "draft_question" USING GIN ("question_text" gin_trgm_ops);

-- Local document search: full text over extracted text, fuzzy over names
-- (knowledge-source-administration.md §7.4).
CREATE INDEX "knowledge_document_extracted_text_fts_idx"
  ON "knowledge_document"
  USING GIN (to_tsvector('english', coalesce("extracted_text", '')));

CREATE INDEX "knowledge_document_name_trgm_idx"
  ON "knowledge_document" USING GIN ("name" gin_trgm_ops);

-- Objective and section heading matching for the deterministic mapping layer.
CREATE INDEX "document_section_heading_trgm_idx"
  ON "document_section" USING GIN (coalesce("heading_path", "heading", '') gin_trgm_ops);

-- NOTE: the reserved `embedding vector(1536)` column on draft_question stays
-- unindexed in release 1. ADR-008 ships lexical detection only, and an HNSW
-- index over an all-NULL column would be cost without benefit. The index is
-- created by the migration that enables semantic detection.

-- ===========================================================================
-- §13  Immutability: triggers and append-only enforcement
-- ===========================================================================

-- I14 — a PromptVersion is never modified. Every generated question references
-- it and yield analytics compare versions, so an in-place edit would rewrite
-- history. Only `retired_at` may be set.
CREATE OR REPLACE FUNCTION knowzy_prompt_version_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."prompt_key" IS DISTINCT FROM OLD."prompt_key"
     OR NEW."semantic_version" IS DISTINCT FROM OLD."semantic_version"
     OR NEW."body" IS DISTINCT FROM OLD."body"
     OR NEW."output_schema_hash" IS DISTINCT FROM OLD."output_schema_hash"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  THEN
    RAISE EXCEPTION
      'prompt_version is immutable (data-model.md §13 I14); create a new version instead'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "prompt_version_immutable_trg"
  BEFORE UPDATE ON "prompt_version"
  FOR EACH ROW EXECUTE FUNCTION knowzy_prompt_version_immutable();

-- I15 — generation lineage on draft_question is never modified after insert.
-- Edits create new versions that carry the same lineage (M2).
CREATE OR REPLACE FUNCTION knowzy_draft_question_lineage_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."source_id"                    IS DISTINCT FROM OLD."source_id"
     OR NEW."source_document_id"        IS DISTINCT FROM OLD."source_document_id"
     OR NEW."section_key"               IS DISTINCT FROM OLD."section_key"
     OR NEW."source_url"                IS DISTINCT FROM OLD."source_url"
     OR NEW."source_document_name"      IS DISTINCT FROM OLD."source_document_name"
     OR NEW."source_site_name"          IS DISTINCT FROM OLD."source_site_name"
     OR NEW."source_library_name"       IS DISTINCT FROM OLD."source_library_name"
     OR NEW."source_folder_path"        IS DISTINCT FROM OLD."source_folder_path"
     OR NEW."source_version_at_generation" IS DISTINCT FROM OLD."source_version_at_generation"
     OR NEW."source_etag_at_generation" IS DISTINCT FROM OLD."source_etag_at_generation"
     OR NEW."source_content_hash"       IS DISTINCT FROM OLD."source_content_hash"
     OR NEW."section_content_hash"      IS DISTINCT FROM OLD."section_content_hash"
     OR NEW."generation_job_id"         IS DISTINCT FROM OLD."generation_job_id"
     OR NEW."model_id"                  IS DISTINCT FROM OLD."model_id"
     OR NEW."prompt_version_id"         IS DISTINCT FROM OLD."prompt_version_id"
     OR NEW."internal_question_id"      IS DISTINCT FROM OLD."internal_question_id"
     OR NEW."created_at"                IS DISTINCT FROM OLD."created_at"
  THEN
    RAISE EXCEPTION
      'draft_question lineage is immutable (data-model.md §13 I15); edits create a new version'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "draft_question_lineage_immutable_trg"
  BEFORE UPDATE ON "draft_question"
  FOR EACH ROW EXECUTE FUNCTION knowzy_draft_question_lineage_immutable();

-- I13 — an AuditEvent row is never updated or deleted.
--
-- The documented control is "no UPDATE/DELETE grant for the application role".
-- Grants do not restrict a table owner, and local development commonly connects
-- as the owner, so a trigger is added as the enforcement that holds in every
-- environment. Retention drops whole partitions, which a row trigger does not
-- see. PostgreSQL 13+ supports BEFORE ROW triggers on partitioned tables.
CREATE OR REPLACE FUNCTION knowzy_audit_event_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'audit_event is append-only (data-model.md §13 I13); retention drops partitions'
    USING ERRCODE = 'restrict_violation';
END
$$;

CREATE TRIGGER "audit_event_no_update_trg"
  BEFORE UPDATE ON "audit_event"
  FOR EACH ROW EXECUTE FUNCTION knowzy_audit_event_append_only();

CREATE TRIGGER "audit_event_no_delete_trg"
  BEFORE DELETE ON "audit_event"
  FOR EACH ROW EXECUTE FUNCTION knowzy_audit_event_append_only();

-- Append-only entities: the same protection for the tables §1.1 declares are
-- never updated. Their rows explain historical decisions.
CREATE OR REPLACE FUNCTION knowzy_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    '% is append-only (data-model.md §1 M3)', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END
$$;

CREATE TRIGGER "draft_question_version_append_only_trg"
  BEFORE UPDATE ON "draft_question_version"
  FOR EACH ROW EXECUTE FUNCTION knowzy_append_only();

CREATE TRIGGER "assessment_result_append_only_trg"
  BEFORE UPDATE ON "assessment_result"
  FOR EACH ROW EXECUTE FUNCTION knowzy_append_only();

CREATE TRIGGER "question_approval_append_only_trg"
  BEFORE UPDATE ON "question_approval"
  FOR EACH ROW EXECUTE FUNCTION knowzy_append_only();

CREATE TRIGGER "configuration_change_append_only_trg"
  BEFORE UPDATE ON "configuration_change"
  FOR EACH ROW EXECUTE FUNCTION knowzy_append_only();

-- knowledge_recommendation history is never overwritten by a later
-- recommendation (workflows.md §7.5), but the learner's disposition is a
-- legitimate update, so only the content columns are frozen.
CREATE OR REPLACE FUNCTION knowzy_recommendation_content_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."approved_explanation" IS DISTINCT FROM OLD."approved_explanation"
     OR NEW."refresher_text"    IS DISTINCT FROM OLD."refresher_text"
     OR NEW."citations"         IS DISTINCT FROM OLD."citations"
     OR NEW."topic_accuracy"    IS DISTINCT FROM OLD."topic_accuracy"
     OR NEW."no_source_found"   IS DISTINCT FROM OLD."no_source_found"
  THEN
    RAISE EXCEPTION
      'knowledge_recommendation content is immutable (workflows.md §7.5); only disposition may change'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "knowledge_recommendation_content_immutable_trg"
  BEFORE UPDATE ON "knowledge_recommendation"
  FOR EACH ROW EXECUTE FUNCTION knowzy_recommendation_content_immutable();

-- ===========================================================================
-- Least-privilege grants
--
-- Applied when the application role exists. In deployed environments the
-- application connects as `knowzy_app`, which is not the table owner, so the
-- revoked grants below are the primary control and the triggers above are
-- defence in depth. Retention runs as `knowzy_maintenance`.
-- ===========================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'knowzy_app') THEN
    EXECUTE 'GRANT SELECT, INSERT ON "audit_event" TO knowzy_app';
    EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON "audit_event" FROM knowzy_app';
    EXECUTE 'REVOKE UPDATE, DELETE ON "draft_question_version" FROM knowzy_app';
    EXECUTE 'REVOKE UPDATE, DELETE ON "assessment_result" FROM knowzy_app';
    EXECUTE 'REVOKE UPDATE, DELETE ON "question_approval" FROM knowzy_app';
    EXECUTE 'REVOKE DELETE ON "certificate" FROM knowzy_app';
    EXECUTE 'REVOKE DELETE ON "badge_award" FROM knowzy_app';
    EXECUTE 'REVOKE DELETE ON "user" FROM knowzy_app';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'knowzy_reporting') THEN
    -- reporting.md §2: SELECT only, so a reporting query cannot lock, block, or
    -- mutate anything in the authoring or quiz path.
    EXECUTE 'GRANT USAGE ON SCHEMA public TO knowzy_reporting';
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA public TO knowzy_reporting';
  END IF;
END
$$;

-- ===========================================================================
-- Uniqueness where a nullable column participates
--
-- PostgreSQL treats NULLs as DISTINCT in a unique index, so a composite unique
-- containing a nullable column does not prevent duplicates when that column is
-- NULL. `@@unique([key, scope, scopeId])` on application_configuration
-- therefore does NOT stop two PLATFORM rows for one key, which is exactly the
-- case the platform uses most.
--
-- These partial indexes are what actually enforce the uniqueness described in
-- data-model.md §10. Prisma cannot express them.
-- ===========================================================================

CREATE UNIQUE INDEX "application_configuration_platform_uidx"
  ON "application_configuration" ("key", "scope")
  WHERE "scope_id" IS NULL;

COMMENT ON INDEX "application_configuration_platform_uidx" IS
  'Enforces one row per (key, scope) when scope_id IS NULL; the composite unique cannot, because NULLs are distinct.';

-- Same shape, same reason: one draft question per proposed QuestionID, but the
-- column is nullable until the ID is allocated.
CREATE UNIQUE INDEX "draft_question_proposed_id_uidx"
  ON "draft_question" ("proposed_question_id")
  WHERE "proposed_question_id" IS NOT NULL;
