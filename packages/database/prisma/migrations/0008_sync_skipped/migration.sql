-- A document outside every configured path is SKIPPED, not failed.
--
-- One number carried two facts, and a reader acts on them differently: a
-- failure is something that went wrong and may need attention, a skip is the
-- configuration working. A tree legitimately contains files belonging to
-- another source's configured paths, and counting those as failures made a
-- healthy source report PARTIAL permanently -- which trains people to ignore
-- the failure count, the one number that should always mean something.
--
-- The skip is still reported with its reason. A document the operator expected
-- to be indexed and which silently vanished would be worse.
ALTER TABLE "knowledge_source_sync"
  ADD COLUMN "items_skipped" INTEGER NOT NULL DEFAULT 0;
