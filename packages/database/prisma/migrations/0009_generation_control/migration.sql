-- 0009 — the AI Generation Control Layer
--
-- architecture.md §9.0 (amended 2026-09-24: generation is provider-independent).
--
-- What this migration exists to make possible:
--
--   * REFUSED as a job state. A control-layer decision is not a failure, and
--     recording one as FAILED would count every working budget as a defect in
--     the metrics that exist to show the controls holding.
--   * generation_refusal_reason. A refusal always names the control that
--     fired, so "budget exhausted" is never the whole answer.
--   * measured_cost / cost_observable. A NULL cost with cost_observable FALSE
--     is an honest absence — a per-seat licence or a user-managed run billed to
--     an account the platform cannot read. Writing 0 there would fabricate a
--     measurement, which is what no-fabricated-metrics.test.ts exists to stop.
--   * generation_provider_call, one row per ATTEMPT. Tokens are spent per call,
--     so a budget that ignored retries would not be a budget, and provider
--     health derived from job rows alone cannot see a job that succeeded on its
--     third try.
--   * OPENAI in the provider enum. DECLARED, not registered: the catalogue
--     carries its capabilities so the platform can state exactly why it cannot
--     be used yet.
--
-- Also note what is NOT here. `draft_question_acquisition_idx` was created by
-- 0006 and never declared in schema.prisma, so `prisma migrate diff` wanted to
-- DROP it and the CI drift gate failed on every run since. The index is wanted,
-- so the MODEL was corrected in this change and no SQL was needed. The gate was
-- right; the model was wrong.

-- CreateEnum
CREATE TYPE "generation_refusal_reason" AS ENUM ('PROVIDER_NOT_REGISTERED', 'PROVIDER_BLOCKED_BY_CONFIGURATION', 'PROVIDER_BLOCKED_BY_APPROVAL', 'PROVIDER_BLOCKED_BY_CAPABILITY', 'PROVIDER_UNAVAILABLE', 'EXECUTION_MODE_UNSUPPORTED', 'PER_JOB_TOKEN_BUDGET_EXCEEDED', 'DAILY_TOKEN_BUDGET_EXHAUSTED', 'WEEKLY_TOKEN_BUDGET_EXHAUSTED', 'MONTHLY_TOKEN_BUDGET_EXHAUSTED', 'CONCURRENCY_LIMIT_REACHED', 'RETRY_LIMIT_EXHAUSTED');

-- CreateEnum
CREATE TYPE "generation_call_outcome" AS ENUM ('SUCCEEDED', 'FAILED', 'RATE_LIMITED', 'REFUSED');

-- AlterEnum
ALTER TYPE "generation_provider" ADD VALUE 'OPENAI';

-- AlterEnum
ALTER TYPE "job_state" ADD VALUE 'REFUSED';

-- AlterTable
ALTER TABLE "generation_job" ADD COLUMN     "attempt_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cost_observable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "measured_cost" DECIMAL(12,6),
ADD COLUMN     "refusal_detail" TEXT,
ADD COLUMN     "refusal_reason" "generation_refusal_reason";

-- CreateTable
CREATE TABLE "generation_provider_call" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "job_id" UUID NOT NULL,
    "provider_id" "generation_provider" NOT NULL,
    "provider_version" TEXT,
    "model_id" TEXT NOT NULL,
    "execution_mode" "generation_execution_mode" NOT NULL,
    "attempt" INTEGER NOT NULL,
    "outcome" "generation_call_outcome" NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "token_usage_reported" BOOLEAN NOT NULL DEFAULT false,
    "estimated_cost" DECIMAL(12,6),
    "measured_cost" DECIMAL(12,6),
    "cost_observable" BOOLEAN NOT NULL DEFAULT false,
    "latency_ms" INTEGER,
    "error_class" TEXT,
    "refusal_reason" "generation_refusal_reason",
    "requested_by_user_id" UUID,
    "on_behalf_of_user_id" UUID,
    "correlation_id" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "generation_provider_call_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "generation_provider_call_provider_id_started_at_idx" ON "generation_provider_call"("provider_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "generation_provider_call_started_at_idx" ON "generation_provider_call"("started_at" DESC);

-- CreateIndex
CREATE INDEX "generation_provider_call_outcome_idx" ON "generation_provider_call"("outcome");

-- CreateIndex
CREATE UNIQUE INDEX "generation_provider_call_job_id_attempt_key" ON "generation_provider_call"("job_id", "attempt");

-- AddForeignKey
ALTER TABLE "generation_provider_call" ADD CONSTRAINT "generation_provider_call_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "generation_job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

