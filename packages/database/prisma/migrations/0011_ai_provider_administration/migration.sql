-- 0011 — AI provider administration: recorded readiness validations
--
-- Administration -> AI Providers lets an administrator configure a provider
-- entirely through the UI. The SETTINGS themselves need no migration: they are
-- one value under the `llm.providerSettings` key in `application_configuration`,
-- which already carries `is_secret_ref`, a version counter and a
-- `configuration_change` audit trail. Adding seven columns per provider would
-- have been a second, weaker copy of that machinery.
--
-- What needed a table is the VALIDATION. "Test connection" produces a result
-- somebody will quote in a week's time, and three decisions follow from that:
--
--   * ONE ROW PER ATTEMPT, not one mutable "last validation" column. The
--     question is "what did it say, and has anybody checked since" — a single
--     column answers only the first half. This is the same reasoning that made
--     `generation_provider_call` an attempt log in 0009.
--
--   * THE OUTCOME HAS THREE VALUES, and the middle one is the normal one. No
--     provider client exists in this build, so the live call is never
--     attempted and the result is INCOMPLETE. A two-valued outcome would have
--     forced every honest result to be recorded as a failure, and a screen full
--     of red for a correctly configured provider is a screen people stop
--     reading.
--
--   * `generation_provider_state` HAS FIVE MEMBERS, not six. The TypeScript
--     union has a sixth, OVER_BUDGET, which the usage read model derives from
--     budget consumption. It is deliberately absent here: a stored OVER_BUDGET
--     would be false the moment a window rolled over, and a stale state in a
--     durable table is worse than none.
--
-- NOTHING in this table is a secret. `steps` records which check passed and
-- why; it never holds a credential, a reference's value, an endpoint response
-- or a model output.

-- ---------------------------------------------------------------- enums

CREATE TYPE "generation_provider_state" AS ENUM (
  'AVAILABLE',
  'UNAVAILABLE',
  'BLOCKED_BY_CONFIGURATION',
  'BLOCKED_BY_APPROVAL',
  'BLOCKED_BY_CAPABILITY'
);

CREATE TYPE "provider_validation_outcome" AS ENUM ('PASSED', 'FAILED', 'INCOMPLETE');

-- ------------------------------------------------------------- the table

CREATE TABLE "generation_provider_validation" (
  "id"                   uuid                          NOT NULL DEFAULT uuid_generate_v7(),
  "provider_id"          "generation_provider"       NOT NULL,
  "state"                "generation_provider_state"    NOT NULL,
  "outcome"              "provider_validation_outcome"  NOT NULL,
  "steps"                jsonb                          NOT NULL,
  "summary"              varchar(500)                   NOT NULL,
  "validated_by_user_id" uuid,
  "validated_at"         timestamptz(6)                 NOT NULL DEFAULT now(),
  "correlation_id"       varchar(64)                    NOT NULL,

  CONSTRAINT "generation_provider_validation_pkey" PRIMARY KEY ("id")
);

-- The only access pattern: the latest validation for one provider, and the
-- history behind it.
CREATE INDEX "generation_provider_validation_provider_at_idx"
  ON "generation_provider_validation" ("provider_id", "validated_at" DESC);

COMMENT ON TABLE "generation_provider_validation" IS
  'One recorded provider readiness validation per attempt. Contains no secrets: only which configuration check passed and why.';

COMMENT ON COLUMN "generation_provider_validation"."outcome" IS
  'INCOMPLETE is the expected result for an external provider in this build: no client exists, so the live call is not attempted and nothing claims authentication succeeded.';
