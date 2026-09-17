-- ---------------------------------------------------------------------------
-- 0001  Platform prerequisites
--
-- Hand-written, per data-model.md §15: extensions, the UUIDv7 generator, and
-- the partitioned audit table.
--
-- audit_event is created HERE rather than by the generated init migration
-- because PostgreSQL cannot convert a plain table into a partitioned one. The
-- five enum types it depends on are created here for the same reason; every
-- other enum and table is created by 0002_init, generated from schema.prisma.
-- ---------------------------------------------------------------------------

-- Extensions ----------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "unaccent";
-- Created but unused in release 1 (ADR-008). Requires an image that ships
-- pgvector; infrastructure/compose uses pgvector/pgvector:pg16.
CREATE EXTENSION IF NOT EXISTS "vector";

-- Session time zone ---------------------------------------------------------
-- data-model.md §9 T2: every stored value is UTC, so an implicit cast cannot
-- introduce a local offset. Set on the database so it applies to every
-- connection, including psql and migration tooling.
DO $$
DECLARE
  db text := current_database();
BEGIN
  EXECUTE format('ALTER DATABASE %I SET "TimeZone" TO %L', db, 'UTC');
END
$$;

-- ---------------------------------------------------------------------------
-- UUIDv7 generator
--
-- data-model.md §1.1: time-ordered ids for index locality. Implemented over
-- pgcrypto rather than depending on an extension that may not be present:
-- 48-bit Unix millisecond timestamp, 4-bit version, 12 bits of randomness,
-- 2-bit variant, 62 bits of randomness (RFC 9562 layout).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION uuid_generate_v7()
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  unix_ts_ms bigint;
  uuid_bytes bytea;
BEGIN
  unix_ts_ms := (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint;

  -- 10 random bytes; the first 6 bytes are then overwritten with the timestamp.
  uuid_bytes := gen_random_bytes(16);

  uuid_bytes := set_byte(uuid_bytes, 0, ((unix_ts_ms >> 40) & 255)::int);
  uuid_bytes := set_byte(uuid_bytes, 1, ((unix_ts_ms >> 32) & 255)::int);
  uuid_bytes := set_byte(uuid_bytes, 2, ((unix_ts_ms >> 24) & 255)::int);
  uuid_bytes := set_byte(uuid_bytes, 3, ((unix_ts_ms >> 16) & 255)::int);
  uuid_bytes := set_byte(uuid_bytes, 4, ((unix_ts_ms >> 8) & 255)::int);
  uuid_bytes := set_byte(uuid_bytes, 5, (unix_ts_ms & 255)::int);

  -- Version 7: high nibble of byte 6.
  uuid_bytes := set_byte(uuid_bytes, 6, ((get_byte(uuid_bytes, 6) & 15) | 112));
  -- Variant 10: high two bits of byte 8.
  uuid_bytes := set_byte(uuid_bytes, 8, ((get_byte(uuid_bytes, 8) & 63) | 128));

  RETURN encode(uuid_bytes, 'hex')::uuid;
END
$$;

COMMENT ON FUNCTION uuid_generate_v7() IS
  'UUIDv7 (RFC 9562). Time-ordered for index locality — data-model.md §1.1.';

-- ---------------------------------------------------------------------------
-- Enum types required by audit_event
-- ---------------------------------------------------------------------------
CREATE TYPE "audit_category" AS ENUM ('ADMIN', 'AUTHORING', 'LEARNING', 'REPORT', 'PLATFORM');
CREATE TYPE "audit_outcome"  AS ENUM ('SUCCESS', 'FAILURE', 'DENIED');
CREATE TYPE "audit_severity" AS ENUM ('INFO', 'NOTICE', 'WARNING', 'HIGH');
CREATE TYPE "actor_type"     AS ENUM ('USER', 'SYSTEM', 'MODEL');
CREATE TYPE "portal_context" AS ENUM ('AUTHORING', 'LIVE', 'SYSTEM');

-- ---------------------------------------------------------------------------
-- audit_event — append-only, partitioned monthly by occurred_at
--
-- PostgreSQL requires the partition key in the primary key, which is why the
-- key is (id, occurred_at) and why schema.prisma declares @@id([id, occurredAt]).
-- Columns must match schema.prisma exactly; 0002_init will add the indexes
-- under Prisma's own names.
-- ---------------------------------------------------------------------------
CREATE TABLE "audit_event" (
  "id"                    uuid           NOT NULL DEFAULT uuid_generate_v7(),
  "occurred_at"           timestamptz(6) NOT NULL DEFAULT now(),

  "action"                text             NOT NULL,
  "family"                text             NOT NULL,
  "category"              "audit_category" NOT NULL,
  "outcome"               "audit_outcome"  NOT NULL,
  "severity"              "audit_severity" NOT NULL,

  "actor_type"            "actor_type"     NOT NULL,
  "actor_user_id"         uuid,
  "actor_display_name"    text,
  "actor_roles"           text[]           NOT NULL DEFAULT ARRAY[]::text[],
  "on_behalf_of_user_id"  uuid,

  "entity_type"           text             NOT NULL,
  "entity_id"             text,
  "entity_label"          text,
  "domain_id"             uuid,
  "source_id"             uuid,

  "previous_value"        jsonb,
  "new_value"             jsonb,
  "detail"                jsonb            NOT NULL DEFAULT '{}',

  "correlation_id"        text             NOT NULL,
  "request_id"            text,
  "portal"                "portal_context",
  "ip_address"            text,
  "user_agent_class"      text,
  "policy_name"           text,
  "deny_reason"           text,
  "error_code"            text,
  "schema_version"        integer          NOT NULL DEFAULT 1,

  CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id", "occurred_at")
) PARTITION BY RANGE ("occurred_at");

COMMENT ON TABLE "audit_event" IS
  'Append-only. Retention drops whole partitions under a separate role — audit-model.md §6.';

-- ---------------------------------------------------------------------------
-- Partition management
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION knowzy_ensure_audit_partition(p_month date)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  start_ts   timestamptz := date_trunc('month', p_month)::timestamptz;
  end_ts     timestamptz := (date_trunc('month', p_month) + interval '1 month')::timestamptz;
  part_name  text := 'audit_event_' || to_char(start_ts, 'YYYY_MM');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = part_name) THEN
    EXECUTE format(
      'CREATE TABLE %I PARTITION OF "audit_event" FOR VALUES FROM (%L) TO (%L)',
      part_name, start_ts, end_ts
    );
  END IF;
  RETURN part_name;
END
$$;

COMMENT ON FUNCTION knowzy_ensure_audit_partition(date) IS
  'Idempotently creates the monthly audit partition for the given month.';

-- Seed a window: previous month through eleven months ahead, so routine
-- operation never depends on the maintenance job having run.
DO $$
DECLARE
  m date := date_trunc('month', now() - interval '1 month')::date;
BEGIN
  WHILE m <= (date_trunc('month', now() + interval '11 months'))::date LOOP
    PERFORM knowzy_ensure_audit_partition(m);
    m := (m + interval '1 month')::date;
  END LOOP;
END
$$;

-- A DEFAULT partition is deliberate. U1 couples the audit insert to the state
-- change it describes, so an insert with no matching partition would roll back
-- a legitimate transition. Landing the row in the default partition keeps the
-- guarantee intact; the maintenance job reports anything that arrives here.
CREATE TABLE "audit_event_default" PARTITION OF "audit_event" DEFAULT;

COMMENT ON TABLE "audit_event_default" IS
  'Safety net so a missing monthly partition can never roll back a state change. Rows here are a platform finding.';
