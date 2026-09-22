-- A version snapshot must record that a question was IMPORTED rather than
-- GENERATED. The snapshot table is append-only, so labelling an imported
-- question "GENERATED" would misattribute its authorship in the one place the
-- history cannot be corrected.
ALTER TYPE "change_kind" ADD VALUE IF NOT EXISTS 'IMPORTED';
