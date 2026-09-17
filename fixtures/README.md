# Fixtures

Backing data for the mock adapters, so the entire pipeline runs with **no
tenant credentials at all** — a design requirement, not a convenience
([knowledge-source-adapters.md §6](../docs/knowledge-source-adapters.md#6-mock-adapter)).

```
knowledge/{sourceKey}/...   Document tree. Folder structure maps to containers
                            and folder paths; files are real PDF/DOCX/PPTX/
                            XLSX/HTML/TXT so the REAL extractors run.
bank/                       Mock question bank state, written as JSON.
graph/                      Recorded Graph responses for SharePoint adapter
                            tests, so the conformance suite needs no tenant.
```

## Rules

- **No tenant values.** No real site URL, site ID, list ID, GUID, or credential
  appears here or ever will. Document names are illustrative.
- **Deterministic.** `sourceDocumentId` is `sha256(relativePath)`; timestamps
  come from a `{file}.meta.json` sidecar or a fixed base date, never from the
  filesystem. Identical fixtures produce identical IDs, hashes, section keys,
  and offsets on every machine and in CI.
- **Versioned content.** A fixture set may declare `versions/v1`, `versions/v2`,
  …; switching the active version simulates a document change, which is how
  revalidation, delta generation, and section lineage are testable without a
  tenant.

## Status

Phase 1 creates the directory contract. The document files, metadata sidecars,
access maps, and recorded Graph responses are authored in **Phase 3**, with the
mock adapter and the conformance suite that consume them. Committing
placeholder documents now would give the suite something to pass against
without exercising a real extractor.
