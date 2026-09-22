-- How a question entered the platform.
--
-- Import and generation share every gate, every threshold and one review
-- queue, which is deliberate: an imported question is grounded in an uploaded
-- document exactly as a generated one is grounded in an SOP, so nothing
-- downstream needs a special case.
--
-- A REVIEWER, though, does. A question lifted out of somebody's existing
-- question bank was written outside this platform for a purpose the platform
-- cannot see. It passes the same gates and still deserves a different kind of
-- reading, so the acquisition method is recorded on the draft and shown in
-- review rather than inferred from the source document's name.
--
-- Defaults to GENERATED, which is not a guess: every question that existed
-- before this migration came from a generator, and `model_id` on those rows
-- says which.

CREATE TYPE "question_acquisition" AS ENUM ('GENERATED', 'IMPORTED');

ALTER TABLE "draft_question"
  ADD COLUMN "acquisition" "question_acquisition" NOT NULL DEFAULT 'GENERATED',
  ADD COLUMN "import_locator" TEXT;

CREATE INDEX "draft_question_acquisition_idx" ON "draft_question" ("acquisition");
