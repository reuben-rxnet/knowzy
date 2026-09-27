-- 0014 — OPENAI-CODEX-01: the ESTIMATE beside the measurement
--
-- The control layer has always estimated a job's input tokens before the
-- call -- ceil(characters / 4) + 700 -- to enforce the per-job and window
-- budgets, and then thrown the number away. With a model that REPORTS its
-- usage, the estimate and the measurement are two different facts, and the
-- gap between them is what tells an administrator whether the budgets are
-- set against reality. So the estimate is kept, on the job and on every
-- attempt, nullable: rows written before this migration never had one, and
-- a back-filled estimate would be a number nobody computed at the time.
--
-- `measured_cost` already exists on both tables and stays NULL: OpenAI's
-- API reports token usage, not a billed amount, so the only cost the
-- platform can state is the ESTIMATE from configured prices.

ALTER TABLE "generation_job" ADD COLUMN "estimated_input_tokens" INTEGER;
ALTER TABLE "generation_provider_call" ADD COLUMN "estimated_input_tokens" INTEGER;
