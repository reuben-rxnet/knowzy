-- Multi-provider generation provenance.
--
-- Records WHO drafted a question and WHOSE entitlement paid for it. Both are
-- new facts: until now there was exactly one generator, so "the deterministic
-- local generator, on the platform's own machine" was implied by the absence
-- of any alternative. With a provider registry that implication stops holding,
-- and a job row that cannot say which provider ran is a provenance gap in the
-- same class as PromptVersion.body holding a paraphrase.
--
-- Existing rows default to DETERMINISTIC_LOCAL / PLATFORM_MANAGED, which is
-- not a guess: every generation job on record was run by the deterministic
-- generator in process, and `model_id` on those rows already says so.
--
-- See docs/integrations/MULTI_PROVIDER_GENERATION_ARCHITECTURE.md §8.

CREATE TYPE "generation_provider" AS ENUM (
  'DETERMINISTIC_LOCAL',
  'ANTHROPIC',
  'MICROSOFT_COPILOT',
  'AZURE_OPENAI',
  'GEMINI'
);

CREATE TYPE "generation_execution_mode" AS ENUM ('PLATFORM_MANAGED', 'USER_MANAGED');

ALTER TABLE "generation_job"
  ADD COLUMN "provider_id" "generation_provider" NOT NULL DEFAULT 'DETERMINISTIC_LOCAL',
  ADD COLUMN "execution_mode" "generation_execution_mode" NOT NULL DEFAULT 'PLATFORM_MANAGED',
  ADD COLUMN "provider_version" TEXT,
  ADD COLUMN "on_behalf_of_user_id" UUID,
  ADD COLUMN "token_usage_reported" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "generation_job_provider_id_created_at_idx"
  ON "generation_job" ("provider_id", "created_at" DESC);

-- Nullable on the question, because a question can predate the column and a
-- draft is immutable after insert: backfilling it would mean editing lineage,
-- which a trigger refuses (I15) and which migration 0004 already learned not
-- to attempt. A null here means "recorded before provider provenance existed",
-- and the job row still carries the answer.
ALTER TABLE "draft_question"
  ADD COLUMN "provider_id" "generation_provider",
  ADD COLUMN "execution_mode" "generation_execution_mode",
  ADD COLUMN "provider_version" TEXT;

-- The existing jobs were all deterministic, and their model_id proves it
-- rather than the default asserting it.
UPDATE "generation_job"
SET "provider_version" = "model_id"
WHERE "model_id" = 'knowzy-deterministic-local-1';
