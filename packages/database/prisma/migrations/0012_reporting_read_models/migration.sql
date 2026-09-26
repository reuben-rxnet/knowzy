-- 0012 — Phase 10 R1: the reporting schema and its read models
--
-- Specified by docs/reporting.md §2 and §3. Six read models, a refresh ledger,
-- a dataset cache and a snapshot store, all in their own PostgreSQL schema.
--
-- FIVE DECISIONS THIS MIGRATION ENCODES
--
--   1. A SEPARATE SCHEMA, `reporting`, not an `rm_` prefix in `public`.
--      §2 requires reporting to be unable to lock, block or mutate anything on
--      the authoring or quiz path. A schema is the unit a GRANT applies to, so
--      it is the only shape in which that claim can later be enforced by the
--      database rather than by convention. Nothing here is modelled in Prisma:
--      four of the six read models are MATERIALIZED VIEWS, which Prisma cannot
--      express, and the schema is outside the one its connection string names.
--
--   2. `rm_question_pipeline` IS A TABLE MAINTAINED ON WRITE, the rest are
--      materialized views. Rule D1: the dashboard's most-used numbers must be
--      exact and instant, so they are written in the same transaction as the
--      transition they count. The rest are aggregates where a 15-minute lag is
--      honest and cheap (D2).
--
--   3. THE ON-WRITE MODEL IS RECOMPUTED PER DOMAIN, NOT INCREMENTED.
--      A literal `+1/-1` counter is correct until the first person adds a
--      lifecycle state, forgets one call site, or rolls a transaction back
--      halfway — and then it is wrong forever with nothing on screen saying so.
--      A scoped `GROUP BY` over one domain's rows is a few milliseconds, cannot
--      drift, and satisfies D1's actual requirement: the number is correct in
--      the same transaction. This is a recorded deviation from the literal
--      wording of D1, with the reconciliation of D7 kept anyway — it is what
--      catches a MISSING hook, which no arithmetic scheme could.
--
--   4. EVERY MATERIALIZED VIEW HAS A UNIQUE INDEX, because `REFRESH
--      MATERIALIZED VIEW CONCURRENTLY` requires one, and D3 requires a refresh
--      never to block a read. Without the index the refresh silently becomes
--      blocking, which is the kind of regression nobody notices until a
--      dashboard hangs during a demonstration.
--
--   5. `asOf` COMES FROM `refresh_state`, NEVER FROM `now()` (D2). A view has
--      no self-updating timestamp, so the ledger beside it carries the time of
--      the last SUCCESSFUL refresh, the last failure, and the failure streak —
--      which is what lets a panel be labelled stale instead of blanked (D4).
--
-- D8: NO READ MODEL CONTAINS QUESTION TEXT, ANSWER KEYS, EXPLANATIONS,
-- EVIDENCE OR LEARNER ANSWER VALUES. Every column below is an identifier, a
-- count, a score or a timestamp. A grep of this file for `question_text`,
-- `answer_payload`, `supporting_evidence` or `explanation` returns nothing, and
-- a contract test asserts the same thing against the live catalogue.

CREATE SCHEMA IF NOT EXISTS reporting;

COMMENT ON SCHEMA reporting IS
  'Reporting read models (docs/reporting.md). SELECT-only over the transactional schema; contains no question text, answer keys or learner answers (D8).';

-- ===========================================================================
-- The refresh ledger — where every response''s `asOf` comes from
-- ===========================================================================

CREATE TABLE reporting.refresh_state (
  model                text          NOT NULL,
  -- The last SUCCESSFUL refresh. Null until one has happened, which is a
  -- different state from "stale" and is reported as such.
  refreshed_at         timestamptz(6),
  started_at           timestamptz(6),
  -- PENDING · REFRESHING · READY · FAILED. Text rather than an enum: this is
  -- operational state in a schema Prisma does not model, and an enum here would
  -- have to be migrated from two places.
  status               text          NOT NULL DEFAULT 'PENDING',
  duration_ms          integer,
  row_count            integer,
  -- D4: a failure raises the staleness age and leaves the data in place. The
  -- streak is kept so a panel can say "failing since" rather than "failed".
  failed_at            timestamptz(6),
  failure_detail       text,
  consecutive_failures integer       NOT NULL DEFAULT 0,

  CONSTRAINT reporting_refresh_state_pkey PRIMARY KEY (model),
  CONSTRAINT reporting_refresh_state_status_chk
    CHECK (status IN ('PENDING', 'REFRESHING', 'READY', 'FAILED'))
);

COMMENT ON TABLE reporting.refresh_state IS
  'One row per read model. `refreshed_at` is the only source of a response''s asOf (D2); now() is never used for it.';

-- ===========================================================================
-- Seed the refresh ledger
--
-- Every model gets a row immediately, with status PENDING and a null
-- `refreshed_at`. A missing row and an unrefreshed model would otherwise be
-- indistinguishable, and "no row" is the state in which a dashboard silently
-- reports nothing.
-- ===========================================================================

INSERT INTO reporting.refresh_state (model, status) VALUES
  ('rm_question_pipeline',      'PENDING'),
  ('rm_question_activity',      'PENDING'),
  ('rm_generation_yield',       'PENDING'),
  ('rm_assessment_performance', 'PENDING'),
  ('rm_filing_coverage',        'PENDING'),
  ('rm_source_coverage',        'PENDING');

-- ===========================================================================
-- 1. rm_question_pipeline — domain x lifecycle state, maintained ON WRITE (D1)
-- ===========================================================================

CREATE TABLE reporting.rm_question_pipeline (
  domain_id                 uuid        NOT NULL,
  status                    text        NOT NULL,
  question_count            integer     NOT NULL DEFAULT 0,
  needs_revalidation_count  integer     NOT NULL DEFAULT 0,
  imported_count            integer     NOT NULL DEFAULT 0,
  updated_at                timestamptz(6) NOT NULL DEFAULT now(),

  CONSTRAINT reporting_rm_question_pipeline_pkey PRIMARY KEY (domain_id, status),
  CONSTRAINT reporting_rm_question_pipeline_counts_chk
    CHECK (question_count >= 0 AND needs_revalidation_count >= 0 AND imported_count >= 0)
);

-- D5: scope is a predicate, not a post-filter.
CREATE INDEX reporting_rm_question_pipeline_domain_idx
  ON reporting.rm_question_pipeline (domain_id);

COMMENT ON TABLE reporting.rm_question_pipeline IS
  'Exact, instant lifecycle distribution. Recomputed per domain inside the transition transaction (D1); reconciled nightly (D7).';

-- ===========================================================================
-- 2. rm_question_activity — domain x day. Reviews, approvals, publications,
--    rejections. A DAY GRAIN, which is what makes a trend computable at all:
--    until now the platform stored no KPI history and every screen was
--    correctly forbidden from showing a delta.
-- ===========================================================================

CREATE MATERIALIZED VIEW reporting.rm_question_activity AS
WITH reviews AS (
  SELECT q.domain_id, date_trunc('day', r.created_at) AS day, count(*) AS n
  FROM question_review r
  JOIN draft_question q ON q.id = r.question_id
  GROUP BY 1, 2
),
approvals AS (
  SELECT q.domain_id, date_trunc('day', a.decided_at) AS day,
         count(*) FILTER (WHERE a.decision = 'APPROVED') AS approved,
         count(*) FILTER (WHERE a.decision <> 'APPROVED') AS refused,
         -- An approval override IS the break-glass record: there is no
         -- boolean column, and `override_by_user_id` is set only when one was
         -- used. Using the justification text instead would count an empty
         -- string as an override.
         count(*) FILTER (WHERE a.override_by_user_id IS NOT NULL) AS break_glass
  FROM question_approval a
  JOIN draft_question q ON q.id = a.question_id
  GROUP BY 1, 2
),
publications AS (
  -- JOINED ON `internal_question_id`, NOT ON `question_id`. The published
  -- reference's `question_id` is the BANK identifier -- `KNZ-{CODE}-{YYYY}-
  -- {SEQ}`, a text column -- and `internal_question_id` is the durable uuid
  -- join key, exactly as docs/sharepoint-field-mapping.md says. Joining on the
  -- wrong one is a `uuid = text` error rather than silently wrong data, which
  -- is the one kindness in it.
  SELECT q.domain_id, date_trunc('day', p.published_at) AS day, count(*) AS n
  FROM published_question_reference p
  JOIN draft_question q ON q.internal_question_id = p.internal_question_id
  GROUP BY 1, 2
),
-- Candidates a generator produced and the platform refused. Distinct from an
-- approval refusal, which is a person's decision about a persisted question.
generation_rejections AS (
  SELECT j.domain_id, date_trunc('day', gr.created_at) AS day, count(*) AS n
  FROM generation_job_rejection gr
  JOIN generation_job j ON j.id = gr.job_id
  GROUP BY 1, 2
)
SELECT
  d.id                                   AS domain_id,
  d.code                                 AS domain_code,
  COALESCE(rv.day, ap.day, pb.day, gj.day) AS day,
  COALESCE(rv.n, 0)                      AS reviews_recorded,
  COALESCE(ap.approved, 0)               AS approvals_granted,
  COALESCE(ap.refused, 0)                AS approvals_refused,
  COALESCE(ap.break_glass, 0)            AS break_glass_uses,
  COALESCE(pb.n, 0)                      AS publications,
  COALESCE(gj.n, 0)                      AS generation_rejections
FROM domain d
JOIN (
  SELECT domain_id, day FROM reviews
  UNION SELECT domain_id, day FROM approvals
  UNION SELECT domain_id, day FROM publications
  UNION SELECT domain_id, day FROM generation_rejections
) days ON days.domain_id = d.id
LEFT JOIN reviews               rv ON rv.domain_id = d.id AND rv.day = days.day
LEFT JOIN approvals             ap ON ap.domain_id = d.id AND ap.day = days.day
LEFT JOIN publications          pb ON pb.domain_id = d.id AND pb.day = days.day
LEFT JOIN generation_rejections gj ON gj.domain_id = d.id AND gj.day = days.day;

CREATE UNIQUE INDEX reporting_rm_question_activity_key
  ON reporting.rm_question_activity (domain_id, day);

-- ===========================================================================
-- 3. rm_generation_yield — provider x model x prompt version x day
-- ===========================================================================

CREATE MATERIALIZED VIEW reporting.rm_generation_yield AS
SELECT
  j.provider_id::text                     AS provider_id,
  j.model_id                              AS model_id,
  j.prompt_version_id                     AS prompt_version_id,
  j.domain_id                             AS domain_id,
  date_trunc('day', j.created_at)         AS day,
  count(*)                                AS jobs,
  count(*) FILTER (WHERE j.status = 'SUCCEEDED') AS jobs_succeeded,
  count(*) FILTER (WHERE j.status = 'PARTIAL')   AS jobs_partial,
  count(*) FILTER (WHERE j.status = 'FAILED')    AS jobs_failed,
  -- A control decision, not an outage. Counted apart from FAILED so that
  -- "did the controls hold" is answerable without counting outages.
  count(*) FILTER (WHERE j.status = 'REFUSED')   AS jobs_refused,
  sum(j.requested_question_count)         AS requested,
  sum(j.accepted_question_count)          AS accepted,
  sum(j.input_tokens)                     AS input_tokens,
  sum(j.output_tokens)                    AS output_tokens,
  sum(j.attempt_count)                    AS attempts,
  -- An unobservable cost is null, never zero: a sum over a window where any
  -- contributor is unobservable is reported as unobservable by the read layer,
  -- so both halves are carried rather than one being silently dropped.
  count(*) FILTER (WHERE j.cost_observable)      AS cost_observable_jobs,
  sum(j.estimated_cost) FILTER (WHERE j.cost_observable) AS observable_cost,
  count(*) FILTER (WHERE NOT j.token_usage_reported) AS estimated_token_jobs
FROM generation_job j
GROUP BY 1, 2, 3, 4, 5;

CREATE UNIQUE INDEX reporting_rm_generation_yield_key
  ON reporting.rm_generation_yield (provider_id, model_id, prompt_version_id, domain_id, day);

-- ===========================================================================
-- 4. rm_assessment_performance — assessment version grain
--
--    `unique_learners` is carried because suppression needs it: S1 applies to
--    any aggregate that could identify an individual, and an assessment taken
--    by three people is one of those. The read layer suppresses on this
--    column; the view does not, because a view cannot know the caller.
-- ===========================================================================

CREATE MATERIALIZED VIEW reporting.rm_assessment_performance AS
SELECT
  r.assessment_version_id                                   AS assessment_version_id,
  r.assessment_id                                           AS assessment_id,
  a.domain_id                                               AS domain_id,
  a.name                                                    AS assessment_name,
  v.version_number                                          AS version_number,
  count(*)                                                  AS attempts,
  count(DISTINCT r.learner_user_id)                         AS unique_learners,
  count(*) FILTER (WHERE r.passed)                          AS passed_attempts,
  round(avg(r.percentage_score), 2)                         AS mean_score,
  round(
    (percentile_cont(0.5) WITHIN GROUP (ORDER BY r.percentage_score))::numeric, 2
  )                                                         AS median_score,
  round(avg(r.time_taken_seconds)::numeric, 0)              AS mean_time_seconds,
  count(*) FILTER (WHERE r.proficiency_band = 'EXPERT')                  AS band_expert,
  count(*) FILTER (WHERE r.proficiency_band = 'PROFICIENT')              AS band_proficient,
  count(*) FILTER (WHERE r.proficiency_band = 'DEVELOPING')              AS band_developing,
  count(*) FILTER (WHERE r.proficiency_band = 'NEEDS_IMPROVEMENT')       AS band_needs_improvement,
  count(*) FILTER (WHERE r.proficiency_band = 'CRITICAL_KNOWLEDGE_GAP')  AS band_critical,
  min(r.completed_at)                                       AS first_attempt_at,
  max(r.completed_at)                                       AS last_attempt_at
FROM assessment_result r
JOIN assessment_version v ON v.id = r.assessment_version_id
JOIN assessment a ON a.id = r.assessment_id
-- §5: latest-not-best, and a superseded result is not an attempt.
WHERE r.result_state = 'SCORED'
GROUP BY 1, 2, 3, 4, 5;

CREATE UNIQUE INDEX reporting_rm_assessment_performance_key
  ON reporting.rm_assessment_performance (assessment_version_id);

CREATE INDEX reporting_rm_assessment_performance_domain_idx
  ON reporting.rm_assessment_performance (domain_id);

-- ===========================================================================
-- 5. rm_filing_coverage — the four axes a question is filed under
--
--    Domain x topic x department x role, and department and role are NULLABLE.
--    That is a problem for `REFRESH MATERIALIZED VIEW CONCURRENTLY` twice over:
--    a null does not conflict with another null in a unique index, so two
--    unfiled groups would collide; and CONCURRENTLY requires a unique index
--    built from COLUMN NAMES ONLY, so a COALESCE expression does not qualify at
--    all. The first version used one and the refresh failed with
--    `55000: cannot refresh materialized view concurrently`.
--
--    So the view carries BOTH: `*_id` nullable for reading, and `*_key`
--    coalesced to the nil uuid for the index. The reader never sees a nil
--    uuid; the index never sees a null.
-- ===========================================================================

CREATE MATERIALIZED VIEW reporting.rm_filing_coverage AS
SELECT
  q.domain_id                                           AS domain_id,
  d.code                                                AS domain_code,
  q.topic_id                                            AS topic_id,
  t.name                                                AS topic_name,
  q.department_id                                       AS department_id,
  -- Index-only. Never read by a query and never shown: the nil uuid is a
  -- placeholder for "no department", and putting it on a screen would be the
  -- fabricated value this whole layer exists to avoid.
  COALESCE(q.department_id, '00000000-0000-0000-0000-000000000000'::uuid) AS department_key,
  dep.code                                              AS department_code,
  dep.name                                              AS department_name,
  q.job_role_id                                         AS job_role_id,
  COALESCE(q.job_role_id, '00000000-0000-0000-0000-000000000000'::uuid)   AS job_role_key,
  jr.code                                               AS job_role_code,
  jr.name                                               AS job_role_name,
  count(*)                                              AS questions,
  count(*) FILTER (WHERE q.status = 'PUBLISHED')        AS published,
  count(*) FILTER (WHERE q.status = 'APPROVED')         AS approved,
  count(*) FILTER (WHERE q.status IN
    ('GENERATED','DRAFT','AUTHOR_REVIEW','SUBMITTED_FOR_APPROVAL','CHANGES_REQUESTED')) AS in_progress,
  count(*) FILTER (WHERE q.status = 'RETIRED')          AS retired,
  count(*) FILTER (WHERE q.acquisition = 'IMPORTED')    AS imported,
  count(*) FILTER (WHERE q.needs_revalidation)          AS needs_revalidation,
  -- Unfiled on either organizational axis. Carried as a figure rather than
  -- left to be inferred from a null group, because "how much of the bank is
  -- unfiled" is the question this report exists to answer first.
  count(*) FILTER (WHERE q.department_id IS NULL OR q.job_role_id IS NULL) AS partially_unfiled
FROM draft_question q
JOIN domain d ON d.id = q.domain_id
JOIN topic t ON t.id = q.topic_id
LEFT JOIN department dep ON dep.id = q.department_id
LEFT JOIN job_role jr ON jr.id = q.job_role_id
GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12;

-- COLUMN NAMES ONLY. CONCURRENTLY accepts nothing else.
CREATE UNIQUE INDEX reporting_rm_filing_coverage_key
  ON reporting.rm_filing_coverage (domain_id, topic_id, department_key, job_role_key);

CREATE INDEX reporting_rm_filing_coverage_domain_idx
  ON reporting.rm_filing_coverage (domain_id);

-- ===========================================================================
-- 6. rm_source_coverage — source x document, with the section rollup
-- ===========================================================================

CREATE MATERIALIZED VIEW reporting.rm_source_coverage AS
WITH sections AS (
  SELECT
    s.document_id,
    count(*)                                                    AS sections_total,
    count(*) FILTER (WHERE s.is_assessable)                     AS sections_assessable,
    count(*) FILTER (WHERE s.coverage_status = 'COVERED')        AS sections_covered,
    count(*) FILTER (WHERE s.coverage_status = 'PARTIALLY_COVERED') AS sections_partial,
    count(*) FILTER (WHERE s.coverage_status = 'NOT_COVERED' AND s.is_assessable) AS sections_uncovered,
    -- Coverage and generation OUTCOME are separate fields since 0004, and
    -- conflating them once reported 94.8% coverage where the truth was 2.6%.
    count(*) FILTER (WHERE s.last_generation_outcome = 'REFUSED') AS sections_refused,
    count(*) FILTER (WHERE s.last_generation_outcome = 'NOT_ATTEMPTED') AS sections_never_attempted
  FROM document_section s
  GROUP BY 1
),
drafts AS (
  SELECT
    q.source_document_id,
    q.source_id,
    count(*)                                              AS questions,
    count(*) FILTER (WHERE q.status = 'APPROVED')         AS approved,
    count(*) FILTER (WHERE q.status = 'PUBLISHED')        AS published
  FROM draft_question q
  GROUP BY 1, 2
)
SELECT
  doc.source_id                                  AS source_id,
  ks.name                                        AS source_name,
  ks.source_type::text                           AS source_type,
  doc.id                                         AS document_id,
  doc.name                                       AS document_name,
  doc.extraction_status::text                    AS extraction_status,
  doc.is_excluded_from_generation                AS excluded,
  COALESCE(sec.sections_total, 0)                AS sections_total,
  COALESCE(sec.sections_assessable, 0)           AS sections_assessable,
  COALESCE(sec.sections_covered, 0)              AS sections_covered,
  COALESCE(sec.sections_partial, 0)              AS sections_partial,
  COALESCE(sec.sections_uncovered, 0)            AS sections_uncovered,
  COALESCE(sec.sections_refused, 0)              AS sections_refused,
  COALESCE(sec.sections_never_attempted, 0)      AS sections_never_attempted,
  COALESCE(dr.questions, 0)                      AS questions,
  COALESCE(dr.approved, 0)                       AS approved_questions,
  COALESCE(dr.published, 0)                      AS published_questions,
  dgs.generation_status::text                    AS generation_status,
  dgs.coverage_percentage                        AS coverage_percentage,
  dgs.last_generated_at                          AS last_generated_at
FROM knowledge_document doc
JOIN knowledge_source ks ON ks.id = doc.source_id
LEFT JOIN sections sec ON sec.document_id = doc.id
LEFT JOIN drafts dr ON dr.source_document_id = doc.source_document_id AND dr.source_id = doc.source_id
LEFT JOIN document_generation_stat dgs ON dgs.document_id = doc.id
WHERE doc.status = 'ACTIVE';

CREATE UNIQUE INDEX reporting_rm_source_coverage_key
  ON reporting.rm_source_coverage (document_id);

CREATE INDEX reporting_rm_source_coverage_source_idx
  ON reporting.rm_source_coverage (source_id);

-- ===========================================================================
-- The on-write hook — D1, implemented as a TRIGGER rather than as a call site
--
-- D1 requires the pipeline counters to be written "in the same transaction as
-- the transition it counts". The obvious implementation is a function the
-- transition service calls. The reason this is a trigger instead is the one
-- lesson this codebase keeps relearning: AN OPTIONAL HOOK IS ONE A CALLER
-- FORGETS, and the caller most likely to forget it is a future one.
--
-- `draft_question` rows are created and moved by at least six paths today --
-- generation, import, claim, submit, approve, publish, retire, archive -- and a
-- seventh will be added by somebody who has never read this file. A trigger on
-- the table is the only place the hook cannot be missed, it is inside the
-- transaction by construction, and it rolls back with it.
--
-- STATEMENT-level with transition tables, not ROW-level: a 50-question publish
-- batch would otherwise recompute the same domain fifty times.
--
-- THREE TRIGGERS, because a statement trigger may reference `NEW TABLE` only
-- for INSERT/UPDATE and `OLD TABLE` only for UPDATE/DELETE. The UPDATE one
-- reads both, because `domain_id` is not in the immutability trigger's list --
-- a question CAN move domain, and then two domains' counters are wrong.
-- ===========================================================================

CREATE OR REPLACE FUNCTION reporting.recompute_question_pipeline(p_domain_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM reporting.rm_question_pipeline WHERE domain_id = p_domain_id;

  INSERT INTO reporting.rm_question_pipeline
    (domain_id, status, question_count, needs_revalidation_count, imported_count, updated_at)
  SELECT q.domain_id,
         q.status::text,
         count(*)::int,
         count(*) FILTER (WHERE q.needs_revalidation)::int,
         count(*) FILTER (WHERE q.acquisition = 'IMPORTED')::int,
         now()
    FROM draft_question q
   WHERE q.domain_id = p_domain_id
   GROUP BY q.domain_id, q.status;

  -- The on-write model's `asOf` is the moment of the last write, which for this
  -- model is the truth rather than an approximation of it. D2 says asOf comes
  -- from this column and never from now() AT READ TIME; setting it here, inside
  -- the transaction that made the data true, is exactly what it is for.
  UPDATE reporting.refresh_state
     SET status = 'READY',
         refreshed_at = now(),
         consecutive_failures = 0,
         failure_detail = NULL,
         failed_at = NULL
   WHERE model = 'rm_question_pipeline';
END
$$;

COMMENT ON FUNCTION reporting.recompute_question_pipeline(uuid) IS
  'Rewrites one domain''s lifecycle counters from its own rows. A scoped recompute rather than a +1/-1 increment: arithmetic counters drift the first time a lifecycle state is added or a call site is missed, and then they are wrong forever with nothing on screen saying so.';

CREATE OR REPLACE FUNCTION reporting.question_pipeline_on_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE d uuid;
BEGIN
  FOR d IN SELECT DISTINCT domain_id FROM inserted LOOP
    PERFORM reporting.recompute_question_pipeline(d);
  END LOOP;
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION reporting.question_pipeline_on_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE d uuid;
BEGIN
  -- BOTH sides. A question that moves domain leaves one domain's counters too
  -- high and the other's too low, and recomputing only the new one fixes half
  -- of that -- the half nobody notices.
  FOR d IN
    SELECT DISTINCT domain_id FROM updated_new
    UNION
    SELECT DISTINCT domain_id FROM updated_old
  LOOP
    PERFORM reporting.recompute_question_pipeline(d);
  END LOOP;
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION reporting.question_pipeline_on_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE d uuid;
BEGIN
  FOR d IN SELECT DISTINCT domain_id FROM deleted LOOP
    PERFORM reporting.recompute_question_pipeline(d);
  END LOOP;
  RETURN NULL;
END
$$;

CREATE TRIGGER "draft_question_pipeline_insert_trg"
  AFTER INSERT ON "draft_question"
  REFERENCING NEW TABLE AS inserted
  FOR EACH STATEMENT EXECUTE FUNCTION reporting.question_pipeline_on_insert();

CREATE TRIGGER "draft_question_pipeline_update_trg"
  AFTER UPDATE ON "draft_question"
  REFERENCING NEW TABLE AS updated_new OLD TABLE AS updated_old
  FOR EACH STATEMENT EXECUTE FUNCTION reporting.question_pipeline_on_update();

CREATE TRIGGER "draft_question_pipeline_delete_trg"
  AFTER DELETE ON "draft_question"
  REFERENCING OLD TABLE AS deleted
  FOR EACH STATEMENT EXECUTE FUNCTION reporting.question_pipeline_on_delete();

-- First build, so the model is correct the moment this migration finishes
-- rather than at the first write. A model that is empty until somebody
-- approves a question is indistinguishable from a broken one.
--
-- Through the FUNCTION, not a direct INSERT: one code path builds this model,
-- so the ledger is updated the same way here as it is on every write. The final
-- UPDATE covers the empty database -- "built, and there is nothing in it" is a
-- different state from "never built", and only the first one should let a
-- dashboard render zeros.
DO $$
DECLARE d uuid;
BEGIN
  FOR d IN SELECT DISTINCT domain_id FROM draft_question LOOP
    PERFORM reporting.recompute_question_pipeline(d);
  END LOOP;

  UPDATE reporting.refresh_state
     SET status = 'READY', refreshed_at = now(), consecutive_failures = 0
   WHERE model = 'rm_question_pipeline';
END
$$;

-- ===========================================================================
-- The dataset cache
--
-- The read models are already the pre-aggregation; this caches the RESOLVED
-- RESPONSE — the rows a specific caller, with a specific scope, at a specific
-- `asOf`, after suppression. That is the expensive part for a wide report, and
-- it is also the part that must never be shared between callers.
--
-- THE SCOPE HASH IS PART OF THE KEY. A cache keyed on the report and its
-- parameters alone would serve one team's suppressed dataset to another team,
-- which is the single worst bug this table could have. The `asOf` is in the key
-- too, so a refresh invalidates every entry by construction rather than by a
-- sweep somebody has to remember to run.
-- ===========================================================================

CREATE TABLE reporting.dataset_cache (
  cache_key             text           NOT NULL,
  report                text           NOT NULL,
  params_hash           char(64)       NOT NULL,
  scope_hash            char(64)       NOT NULL,
  as_of                 timestamptz(6) NOT NULL,
  payload               jsonb          NOT NULL,
  row_count             integer        NOT NULL,
  suppressed_cell_count integer        NOT NULL DEFAULT 0,
  built_ms              integer,
  created_at            timestamptz(6) NOT NULL DEFAULT now(),
  expires_at            timestamptz(6) NOT NULL,
  hits                  integer        NOT NULL DEFAULT 0,

  CONSTRAINT reporting_dataset_cache_pkey PRIMARY KEY (cache_key)
);

CREATE INDEX reporting_dataset_cache_expiry_idx ON reporting.dataset_cache (expires_at);
CREATE INDEX reporting_dataset_cache_report_idx ON reporting.dataset_cache (report, as_of DESC);

COMMENT ON TABLE reporting.dataset_cache IS
  'Resolved, scope-specific, suppressed datasets. The cache key includes the caller''s scope hash and the read model''s asOf, so an entry can neither outlive a refresh nor be served to a different scope.';

-- ===========================================================================
-- Snapshots
--
-- A capture of one dataset, with its header block, retained. NOT a publication:
-- §8.2 U1 is explicit that a published report is a definition plus an audience
-- and never a frozen result set, precisely so that each viewer's render applies
-- their own scope. A snapshot is the opposite thing on purpose — an explicit,
-- audited record of what a report said at a moment, taken by a named person for
-- a named reason, and readable afterwards only by someone who could have run it.
--
-- It is also what finally makes a trend computable: the platform has stored no
-- KPI history at all, which is why every screen has been correctly forbidden
-- from showing "vs last month".
-- ===========================================================================

CREATE TABLE reporting.report_snapshot (
  id                    uuid           NOT NULL DEFAULT uuid_generate_v7(),
  report                text           NOT NULL,
  label                 varchar(200)   NOT NULL,
  reason                varchar(500),
  -- The header block §8.1 requires, kept with the payload so a snapshot read
  -- back in a year still states what it does and does not contain.
  as_of                 timestamptz(6) NOT NULL,
  params                jsonb          NOT NULL DEFAULT '{}',
  scope                 jsonb          NOT NULL DEFAULT '{}',
  minimum_group_size    integer        NOT NULL,
  suppressed_cell_count integer        NOT NULL DEFAULT 0,
  row_count             integer        NOT NULL,
  payload               jsonb          NOT NULL,
  captured_by_user_id   uuid,
  captured_at           timestamptz(6) NOT NULL DEFAULT now(),
  correlation_id        varchar(64)    NOT NULL,

  CONSTRAINT reporting_report_snapshot_pkey PRIMARY KEY (id)
);

CREATE INDEX reporting_report_snapshot_report_idx
  ON reporting.report_snapshot (report, captured_at DESC);

COMMENT ON TABLE reporting.report_snapshot IS
  'An explicit, audited capture of one dataset with its header block. Not a publication (reporting.md 8.2 U1): a publication is a definition plus an audience and is re-rendered per viewer.';
