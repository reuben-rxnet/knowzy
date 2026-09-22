-- PILOT-T2: grounding integrity and coverage honesty.
--
-- Three defects, one migration, in dependency order:
--
--   1. `section_key` was sha256(heading path + ordinal), so a section with no
--      heading hashed `segment:N#N` — identical in EVERY heading-less
--      document. One key was shared by 21 documents in the pilot corpus, and
--      both resolvers take the first match, so a span could verify against
--      another document's section and the question's lineage would follow it.
--
--   2. Generation wrote `coverage_status = 'NON_ASSESSABLE'` on a refusal, and
--      preflight counted a section as uncovered only when the status was
--      NOT_COVERED or PARTIALLY_COVERED. Every refusal therefore counted as
--      coverage: 94.8% reported where the truth was 2.6%.
--
--   3. Nothing recorded whether a section had been ATTEMPTED, so "no question
--      here" and "nothing has ever looked here" were indistinguishable.
--
-- The key rewrite is expressible in SQL only because the new key is a pure
-- function of the OLD key and the document's scope:
--
--     new = sha256(old_key || source_document_id)
--
-- `old_key` is always exactly 64 hex characters, so the concatenation is
-- unambiguous without a separator. `scopeSectionKey()` in
-- @knowzy/content-extraction is the same expression, and a contract test
-- asserts the two agree.

-- ---------------------------------------------------------------------------
-- 1. New columns and the outcome enum
-- ---------------------------------------------------------------------------

CREATE TYPE "section_generation_outcome" AS ENUM (
  'NOT_ATTEMPTED',
  'GENERATED',
  'REFUSED',
  'UNRESOLVED'
);

ALTER TABLE "document_section"
  ADD COLUMN "section_key_v1" CHAR(64),
  ADD COLUMN "generation_attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_attempted_at" TIMESTAMPTZ(6),
  ADD COLUMN "last_generation_outcome" "section_generation_outcome" NOT NULL DEFAULT 'NOT_ATTEMPTED',
  ADD COLUMN "last_refusal_reason" TEXT;

CREATE INDEX "document_section_document_id_last_generation_outcome_idx"
  ON "document_section" ("document_id", "last_generation_outcome");

-- Every subsequent step reads this column rather than `section_key`, so the
-- order of the rewrites below does not matter.
UPDATE "document_section" SET "section_key_v1" = "section_key"::text;

-- ---------------------------------------------------------------------------
-- 2. Recover the generation outcome that was encoded as a coverage status
-- ---------------------------------------------------------------------------
--
-- A section marked NON_ASSESSABLE while `is_assessable` is true is a refusal
-- that was written to the wrong column. The reason string is unique to that
-- code path, which is what makes the repair safe to target.

UPDATE "document_section"
SET "last_generation_outcome" = 'REFUSED',
    "last_refusal_reason" = COALESCE(
      "non_assessable_reason",
      'Insufficient assessable content: no testable rule stated.'
    ),
    "generation_attempt_count" = GREATEST("generation_attempt_count", 1),
    "coverage_status" = 'NOT_COVERED',
    -- Curation is not what happened here, so the curated reason is cleared.
    "non_assessable_reason" = NULL
WHERE "is_assessable" = true
  AND "coverage_status" = 'NON_ASSESSABLE';

-- A covered section was, by definition, generated from.
UPDATE "document_section"
SET "last_generation_outcome" = 'GENERATED',
    "generation_attempt_count" = GREATEST("generation_attempt_count", 1)
WHERE "coverage_status" = 'COVERED';

-- ---------------------------------------------------------------------------
-- 3. Scope the section keys
-- ---------------------------------------------------------------------------
--
-- Unambiguous wherever the row knows its own document. That covers every
-- table except the two job-level ones in step 4.

UPDATE "document_section" s
SET "section_key" = encode(
      sha256(convert_to(s."section_key_v1"::text || d."source_document_id", 'UTF8')),
      'hex'
    )
FROM "knowledge_document" d
WHERE d."id" = s."document_id";

-- draft_question and published_question_reference are DELIBERATELY NOT
-- rewritten. A trigger enforces I15 — "draft_question lineage is immutable;
-- edits create a new version" — and it refused the first attempt at this
-- migration, which is the invariant doing its job.
--
-- Respecting it is also the correct answer rather than an obstacle. Rewriting
-- the section key on an already-published question would change what the
-- platform claims was published, after the fact, with no new version and no
-- audit record. So an existing question keeps its v1 key, permanently and
-- honestly, and `document_section.section_key_v1` is what makes that key
-- resolvable forever. Code that resolves a question's section matches on
-- either column; new questions carry scoped keys from the start.

UPDATE "objective_section_mapping" m
SET "section_key" = encode(
      sha256(convert_to(m."section_key"::text || d."source_document_id", 'UTF8')),
      'hex'
    )
FROM "knowledge_document" d
WHERE d."id" = m."document_id";

UPDATE "document_section_lineage" l
SET "from_section_key" = CASE
      WHEN l."from_section_key" IS NULL THEN NULL
      ELSE encode(
        sha256(convert_to(l."from_section_key"::text || d."source_document_id", 'UTF8')),
        'hex'
      )
    END,
    "to_section_key" = CASE
      WHEN l."to_section_key" IS NULL THEN NULL
      ELSE encode(
        sha256(convert_to(l."to_section_key"::text || d."source_document_id", 'UTF8')),
        'hex'
      )
    END
FROM "knowledge_document" d
WHERE d."id" = l."document_id";

-- ---------------------------------------------------------------------------
-- 4. The two job-level tables, where a key may be genuinely ambiguous
-- ---------------------------------------------------------------------------
--
-- A generation job references section keys without naming which of its
-- documents each one belongs to. Where exactly ONE document in the job has a
-- section with that v1 key the mapping is certain and is rewritten. Where more
-- than one does — which is precisely the collision this migration removes — the
-- v1 value is LEFT IN PLACE rather than guessed at.
--
-- That is deliberate. These are historical, append-only job records; a wrong
-- rewrite would be worse than an old value, and `document_section.section_key_v1`
-- keeps every v1 value resolvable. New jobs record scoped keys from the start.

WITH resolved AS (
  SELECT r."id",
         MIN(d."source_document_id") AS scope,
         COUNT(DISTINCT d."source_document_id") AS candidates
  FROM "generation_job_rejection" r
  JOIN "generation_job_document" jd ON jd."job_id" = r."job_id"
  JOIN "knowledge_document" d ON d."id" = jd."document_id"
  JOIN "document_section" s
    ON s."document_id" = d."id"
   AND s."section_key_v1"::text = r."section_key"::text
  WHERE r."section_key" IS NOT NULL
  GROUP BY r."id"
)
UPDATE "generation_job_rejection" r
SET "section_key" = encode(
      sha256(convert_to(r."section_key"::text || resolved.scope, 'UTF8')),
      'hex'
    )
FROM resolved
WHERE resolved."id" = r."id"
  AND resolved.candidates = 1;

WITH mapped AS (
  SELECT j."id" AS job_id,
         k.old_key,
         MIN(d."source_document_id") AS scope,
         COUNT(DISTINCT d."source_document_id") AS candidates
  FROM "generation_job" j
  CROSS JOIN LATERAL unnest(j."resolved_section_keys") AS k(old_key)
  JOIN "generation_job_document" jd ON jd."job_id" = j."id"
  JOIN "knowledge_document" d ON d."id" = jd."document_id"
  JOIN "document_section" s
    ON s."document_id" = d."id"
   AND s."section_key_v1"::text = k.old_key
  GROUP BY j."id", k.old_key
)
UPDATE "generation_job" j
SET "resolved_section_keys" = (
  SELECT array_agg(
           CASE
             WHEN m.candidates = 1
               THEN encode(sha256(convert_to(k.old_key || m.scope, 'UTF8')), 'hex')
             ELSE k.old_key
           END
           ORDER BY k.ord
         )
  FROM unnest(j."resolved_section_keys") WITH ORDINALITY AS k(old_key, ord)
  LEFT JOIN mapped m ON m.job_id = j."id" AND m.old_key = k.old_key
)
WHERE COALESCE(array_length(j."resolved_section_keys", 1), 0) > 0;
