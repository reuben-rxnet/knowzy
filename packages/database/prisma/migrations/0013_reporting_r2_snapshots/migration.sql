-- 0013 — Phase 10 R2: coverage history, learner performance, platform inventory
--
-- Two product decisions taken on 2026-09-27 are encoded here:
--
--   D-1  Department + Job Role is the official reporting hierarchy. There is
--        NO team model and none is created: `Team` / `UserTeam` stay a future
--        extensibility point with zero rows. Learner reporting groups by the
--        DEPARTMENT THE QUESTIONS WERE FILED UNDER, because a learner has no
--        department and a question does.
--   R-1  Coverage history is a permanent requirement. `coverage_snapshot` is
--        the platform's first stored history of POINT-IN-TIME state, and the
--        authoritative source for any comparison of a figure that has no dated
--        row behind it (coverage, source count, lifecycle totals).
--
-- FIVE DECISIONS THIS MIGRATION ENCODES
--
--   1. A SNAPSHOT IS APPEND-ONLY. A trigger refuses UPDATE and DELETE. History
--      that can be rewritten is not history, and the one thing a trend line
--      must never do is change its past when somebody re-runs a job. One row
--      per UTC day; a second capture on the same day is a no-op, not an
--      overwrite, so the first capture of the day is the one that stands.
--
--   2. A SNAPSHOT READS THE READ MODELS, not the transactional tables. The KPI
--      a snapshot is later compared against is computed from `rm_source_
--      coverage`, `rm_question_pipeline` and `rm_platform_inventory`; a
--      snapshot computed some other way would compare two definitions and
--      call the difference a trend. `models_as_of` records how fresh those
--      models were at capture.
--
--   3. NOTHING IS BACK-FILLED. The first snapshot is taken by this migration,
--      today, from real state. There is no row for any earlier day, and
--      inventing one — even from `created_at` arithmetic — would be the
--      fabricated history R-1 exists to replace. A comparison that needs a
--      snapshot older than the first one reads "Not Yet Available".
--
--   4. LEARNER PERFORMANCE IS ATTRIBUTED, NOT JOINED. A topic result belongs to
--      a department only when EVERY question the learner was asked in that
--      topic is filed under that one department. Questions filed under two
--      departments make the result MIXED; questions filed under none make it
--      NOT_FILED. Per-question correctness is not stored (scoring produces a
--      topic result, not item results), so splitting one topic result across
--      departments would mean re-scoring in SQL — a second scoring engine.
--
--   5. SEED THE LEDGER BEFORE THE FIRST BUILD. 0012 inserted its ledger rows
--      after building, so a correct model read PENDING. Here the rows go in
--      first and each build marks its own row READY.
--
-- D8 still holds: no read model or snapshot contains question text, an answer
-- key, an explanation, evidence or a learner's answer. `learner_user_id` is
-- carried by the two attempt models because suppression needs a DISTINCT
-- learner count and distinct counts cannot be summed across days.

-- ===========================================================================
-- The ledger, first
-- ===========================================================================

INSERT INTO reporting.refresh_state (model, status) VALUES
  ('rm_platform_inventory',  'PENDING'),
  ('rm_assessment_attempt',  'PENDING'),
  ('rm_topic_attempt',       'PENDING'),
  ('coverage_snapshot',      'PENDING');

-- ===========================================================================
-- 7. rm_platform_inventory — one row: the counts no other model carries
--
--    Knowledge sources (a source with no documents is absent from
--    rm_source_coverage, so that model cannot count sources), assessments, and
--    the cumulative approval decisions and scored attempts. One row, with a
--    constant key, because CONCURRENTLY needs a unique index on a column.
-- ===========================================================================

CREATE MATERIALIZED VIEW reporting.rm_platform_inventory AS
SELECT
  1                                                              AS singleton,
  (SELECT count(*) FROM knowledge_source WHERE archived_at IS NULL)                  AS source_count,
  (SELECT count(*) FROM knowledge_source WHERE archived_at IS NULL AND is_active)    AS active_source_count,
  (SELECT count(*) FROM assessment)                                                  AS assessments_total,
  (SELECT count(*) FROM assessment WHERE current_published_version_id IS NOT NULL)   AS assessments_published,
  (SELECT count(*) FROM question_approval WHERE decision = 'APPROVED')               AS approvals_granted,
  (SELECT count(*) FROM question_approval WHERE decision <> 'APPROVED')              AS approvals_refused,
  (SELECT count(*) FROM assessment_result WHERE result_state = 'SCORED')             AS assessment_attempts;

CREATE UNIQUE INDEX reporting_rm_platform_inventory_key
  ON reporting.rm_platform_inventory (singleton);

-- ===========================================================================
-- 8. rm_assessment_attempt — one row per SCORED result
--
--    Day-grained so a window can be applied, and learner-grained so a window's
--    DISTINCT learner count — the suppression group size — is exact. A
--    `count(DISTINCT learner)` per day cannot be summed into a month.
-- ===========================================================================

CREATE MATERIALIZED VIEW reporting.rm_assessment_attempt AS
SELECT
  r.id                               AS result_id,
  r.assessment_id                    AS assessment_id,
  r.assessment_version_id            AS assessment_version_id,
  a.domain_id                        AS domain_id,
  r.learner_user_id                  AS learner_user_id,
  r.completed_at                     AS completed_at,
  date_trunc('day', r.completed_at)  AS day,
  r.percentage_score                 AS percentage_score,
  r.passed                           AS passed,
  r.proficiency_band::text           AS proficiency_band
FROM assessment_result r
JOIN assessment a ON a.id = r.assessment_id
-- §5: latest-not-best, and a superseded or voided result is not an attempt.
WHERE r.result_state = 'SCORED';

CREATE UNIQUE INDEX reporting_rm_assessment_attempt_key
  ON reporting.rm_assessment_attempt (result_id);
CREATE INDEX reporting_rm_assessment_attempt_day_idx
  ON reporting.rm_assessment_attempt (day);
CREATE INDEX reporting_rm_assessment_attempt_domain_idx
  ON reporting.rm_assessment_attempt (domain_id);

-- ===========================================================================
-- 9. rm_topic_attempt — one row per (SCORED result × topic), attributed to a
--    department by the questions the learner was actually asked
-- ===========================================================================

CREATE MATERIALIZED VIEW reporting.rm_topic_attempt AS
WITH asked AS (
  -- The questions presented in this session, in this topic, and where each
  -- one is filed. Joined on the BANK identifier: `quiz_session_question.
  -- question_id` is the `KNZ-…` id the session pinned, which is unique on the
  -- published reference.
  SELECT
    r.id                                               AS result_id,
    sq.topic_id                                        AS topic_id,
    count(DISTINCT p.department_id)                    AS departments,
    count(*) FILTER (WHERE p.department_id IS NULL)    AS unfiled,
    -- uuid has no min(); text does, and with exactly one distinct value it is
    -- that value.
    min(p.department_id::text)::uuid                   AS department_id
  FROM assessment_result r
  JOIN quiz_session_question sq ON sq.session_id = r.session_id
  LEFT JOIN published_question_reference p ON p.question_id = sq.question_id
  WHERE r.result_state = 'SCORED'
  GROUP BY 1, 2
),
attributed AS (
  SELECT
    a.result_id,
    a.topic_id,
    CASE
      WHEN a.departments = 1 AND a.unfiled = 0 THEN 'FILED'
      WHEN a.departments = 0                   THEN 'NOT_FILED'
      ELSE                                          'MIXED'
    END AS attribution,
    CASE WHEN a.departments = 1 AND a.unfiled = 0 THEN a.department_id END AS department_id
  FROM asked a
)
SELECT
  tr.result_id                                     AS result_id,
  tr.topic_id                                      AS topic_id,
  t.name                                           AS topic_name,
  t.domain_id                                      AS domain_id,
  d.code                                           AS domain_code,
  -- A topic result with no presented question behind it cannot be attributed
  -- to anything, and is NOT_FILED rather than dropped: dropping it would make
  -- the heatmap's attempts disagree with the assessment report's.
  COALESCE(at.attribution, 'NOT_FILED')            AS attribution,
  at.department_id                                 AS department_id,
  -- Index-only, exactly as in rm_filing_coverage: never read, never shown.
  COALESCE(at.department_id, '00000000-0000-0000-0000-000000000000'::uuid) AS department_key,
  dep.code                                         AS department_code,
  dep.name                                         AS department_name,
  r.learner_user_id                                AS learner_user_id,
  r.completed_at                                   AS completed_at,
  date_trunc('day', r.completed_at)                AS day,
  tr.topic_accuracy                                AS topic_accuracy,
  tr.questions_asked                               AS questions_asked,
  tr.correct                                       AS correct,
  tr.is_knowledge_gap                              AS is_knowledge_gap,
  r.passed                                         AS passed
FROM topic_result tr
JOIN assessment_result r ON r.id = tr.result_id AND r.result_state = 'SCORED'
JOIN topic t ON t.id = tr.topic_id
JOIN domain d ON d.id = t.domain_id
LEFT JOIN attributed at ON at.result_id = tr.result_id AND at.topic_id = tr.topic_id
LEFT JOIN department dep ON dep.id = at.department_id;

CREATE UNIQUE INDEX reporting_rm_topic_attempt_key
  ON reporting.rm_topic_attempt (result_id, topic_id);
CREATE INDEX reporting_rm_topic_attempt_day_idx
  ON reporting.rm_topic_attempt (day);
CREATE INDEX reporting_rm_topic_attempt_domain_idx
  ON reporting.rm_topic_attempt (domain_id);

-- The three views were built WITH DATA by CREATE, so they are correct now. The
-- ledger says so with a real row count rather than leaving them PENDING until
-- the job's first tick.
UPDATE reporting.refresh_state rs
   SET status = 'READY',
       refreshed_at = now(),
       consecutive_failures = 0,
       row_count = CASE rs.model
         WHEN 'rm_platform_inventory' THEN (SELECT count(*) FROM reporting.rm_platform_inventory)
         WHEN 'rm_assessment_attempt' THEN (SELECT count(*) FROM reporting.rm_assessment_attempt)
         WHEN 'rm_topic_attempt'      THEN (SELECT count(*) FROM reporting.rm_topic_attempt)
       END
 WHERE rs.model IN ('rm_platform_inventory', 'rm_assessment_attempt', 'rm_topic_attempt');

-- ===========================================================================
-- 10. coverage_snapshot — the daily record of point-in-time state (R-1)
-- ===========================================================================

CREATE TABLE reporting.coverage_snapshot (
  -- The UTC day the snapshot belongs to. The primary key IS the day: one
  -- authoritative record per day, and a second capture cannot displace it.
  snapshot_date                 date           NOT NULL,
  captured_at                   timestamptz(6) NOT NULL DEFAULT now(),
  -- SCHEDULE · MANUAL · MIGRATION. Text, like refresh_state.status, because
  -- this schema is not modelled in Prisma and an enum would be migrated twice.
  capture_trigger               text           NOT NULL,
  correlation_id                varchar(64),
  -- The OLDEST refresh of the read models this snapshot was taken from. A
  -- snapshot is only as true as its stalest input, the same rule as asOf.
  models_as_of                  timestamptz(6),

  -- Sources and content
  source_count                  integer        NOT NULL,
  active_source_count           integer        NOT NULL,
  document_count                integer        NOT NULL,
  section_count                 integer        NOT NULL,
  assessable_sections           integer        NOT NULL,
  covered_sections              integer        NOT NULL,
  -- covered ÷ assessable × 100, NULL when nothing is assessable. Never 0 for
  -- "no denominator": a zero here would read as "nothing is covered".
  coverage_percent              numeric(5, 2),

  -- The question lifecycle, in the five buckets the dashboard draws plus the
  -- two it must not hide, and the full ten-state split for anything finer.
  total_questions               integer        NOT NULL,
  published_questions           integer        NOT NULL,
  approved_questions            integer        NOT NULL,
  in_review_questions           integer        NOT NULL,
  draft_questions               integer        NOT NULL,
  rejected_questions            integer        NOT NULL,
  retired_or_archived_questions integer        NOT NULL,
  status_counts                 jsonb          NOT NULL DEFAULT '{}',

  -- Approvals and assessments, cumulative to the capture.
  approvals_granted             integer        NOT NULL,
  approvals_refused             integer        NOT NULL,
  assessments_total             integer        NOT NULL,
  assessments_published         integer        NOT NULL,
  assessment_attempts           integer        NOT NULL,

  CONSTRAINT reporting_coverage_snapshot_pkey PRIMARY KEY (snapshot_date),
  CONSTRAINT reporting_coverage_snapshot_trigger_chk
    CHECK (capture_trigger IN ('SCHEDULE', 'MANUAL', 'MIGRATION')),
  CONSTRAINT reporting_coverage_snapshot_counts_chk
    CHECK (source_count >= 0 AND document_count >= 0 AND section_count >= 0
           AND assessable_sections >= 0 AND covered_sections >= 0
           AND covered_sections <= assessable_sections
           AND total_questions >= 0 AND published_questions >= 0),
  CONSTRAINT reporting_coverage_snapshot_percent_chk
    CHECK (coverage_percent IS NULL OR (coverage_percent >= 0 AND coverage_percent <= 100))
);

COMMENT ON TABLE reporting.coverage_snapshot IS
  'One row per UTC day of point-in-time platform state (decision R-1, 2026-09-27). Append-only: a trigger refuses UPDATE and DELETE. The authoritative source for any comparison of a figure with no dated row behind it. Never back-filled.';

CREATE OR REPLACE FUNCTION reporting.coverage_snapshot_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'reporting.coverage_snapshot is append-only: a recorded day is not rewritten (R-1)'
    USING ERRCODE = 'restrict_violation';
END
$$;

CREATE TRIGGER coverage_snapshot_no_update
  BEFORE UPDATE ON reporting.coverage_snapshot
  FOR EACH ROW EXECUTE FUNCTION reporting.coverage_snapshot_immutable();

CREATE TRIGGER coverage_snapshot_no_delete
  BEFORE DELETE ON reporting.coverage_snapshot
  FOR EACH ROW EXECUTE FUNCTION reporting.coverage_snapshot_immutable();

-- ONE code path captures a snapshot: this function. The job calls it, the
-- migration calls it, and a test calls it. Returns true when a row was
-- written, false when today already had one.
CREATE OR REPLACE FUNCTION reporting.capture_coverage_snapshot(p_trigger text, p_correlation_id text)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_inserted integer;
BEGIN
  INSERT INTO reporting.coverage_snapshot (
    snapshot_date, capture_trigger, correlation_id, models_as_of,
    source_count, active_source_count, document_count, section_count,
    assessable_sections, covered_sections, coverage_percent,
    total_questions, published_questions, approved_questions, in_review_questions,
    draft_questions, rejected_questions, retired_or_archived_questions, status_counts,
    approvals_granted, approvals_refused, assessments_total, assessments_published,
    assessment_attempts
  )
  SELECT
    (now() AT TIME ZONE 'UTC')::date,
    p_trigger,
    p_correlation_id,
    -- The two MATERIALIZED inputs only. rm_question_pipeline is maintained on
    -- write and exact at every moment; its ledger time is its last WRITE, and
    -- counting it here would report a snapshot as stale because nobody had
    -- approved a question that morning.
    (SELECT min(refreshed_at) FROM reporting.refresh_state
      WHERE model IN ('rm_source_coverage', 'rm_platform_inventory')),
    inv.source_count,
    inv.active_source_count,
    cov.document_count,
    cov.section_count,
    cov.assessable_sections,
    cov.covered_sections,
    CASE WHEN cov.assessable_sections = 0 THEN NULL
         ELSE round(cov.covered_sections::numeric * 100 / cov.assessable_sections, 2) END,
    pipe.total,
    pipe.published,
    pipe.approved,
    pipe.in_review,
    pipe.draft,
    pipe.rejected,
    pipe.retired_or_archived,
    pipe.by_status,
    inv.approvals_granted,
    inv.approvals_refused,
    inv.assessments_total,
    inv.assessments_published,
    inv.assessment_attempts
  FROM reporting.rm_platform_inventory inv
  CROSS JOIN (
    SELECT count(*)::int                                AS document_count,
           COALESCE(sum(sections_total), 0)::int        AS section_count,
           COALESCE(sum(sections_assessable), 0)::int   AS assessable_sections,
           COALESCE(sum(sections_covered), 0)::int      AS covered_sections
      FROM reporting.rm_source_coverage
  ) cov
  CROSS JOIN (
    SELECT COALESCE(sum(question_count), 0)::int AS total,
           COALESCE(sum(question_count) FILTER (WHERE status = 'PUBLISHED'), 0)::int AS published,
           COALESCE(sum(question_count) FILTER (WHERE status = 'APPROVED'), 0)::int  AS approved,
           COALESCE(sum(question_count) FILTER (WHERE status IN
             ('AUTHOR_REVIEW', 'SUBMITTED_FOR_APPROVAL', 'CHANGES_REQUESTED')), 0)::int AS in_review,
           COALESCE(sum(question_count) FILTER (WHERE status IN ('GENERATED', 'DRAFT')), 0)::int AS draft,
           COALESCE(sum(question_count) FILTER (WHERE status = 'REJECTED'), 0)::int  AS rejected,
           COALESCE(sum(question_count) FILTER (WHERE status IN ('RETIRED', 'ARCHIVED')), 0)::int
             AS retired_or_archived,
           COALESCE(
             (SELECT jsonb_object_agg(status, n)
                FROM (SELECT status, sum(question_count)::int AS n
                        FROM reporting.rm_question_pipeline GROUP BY status) s),
             '{}'::jsonb) AS by_status
      FROM reporting.rm_question_pipeline
  ) pipe
  ON CONFLICT (snapshot_date) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- The ledger records the LATEST capture as this model's asOf, whether or not
  -- this call wrote it: "today's snapshot exists" is the state being reported.
  UPDATE reporting.refresh_state
     SET status = 'READY',
         refreshed_at = (SELECT max(captured_at) FROM reporting.coverage_snapshot),
         row_count = (SELECT count(*) FROM reporting.coverage_snapshot),
         consecutive_failures = 0,
         failure_detail = NULL,
         failed_at = NULL
   WHERE model = 'coverage_snapshot';

  RETURN v_inserted > 0;
END
$$;

COMMENT ON FUNCTION reporting.capture_coverage_snapshot(text, text) IS
  'Captures today''s coverage snapshot from the read models, once. A second call on the same UTC day writes nothing and returns false.';

-- The first snapshot, from real state, today. Not a back-fill: nothing is
-- written for any day before this one.
SELECT reporting.capture_coverage_snapshot('MIGRATION', NULL);
