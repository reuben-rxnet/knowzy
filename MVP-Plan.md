# Knowzy MVP — Shortest Path Plan

**Goal:** configure a source → select a document → generate questions → review and
approve → publish → take a quiz → get a score.

**Authoritative scope:** [docs/initial-end-to-end-proof.md](docs/initial-end-to-end-proof.md),
**minus refreshers and the dashboard** (outside the seven MVP steps). Nothing here
overrides /docs; where this file and /docs disagree, /docs wins.

Runs on the **mock adapter and mock bank** — the designed zero-credential path
(knowledge-source-adapters.md §6), not a shortcut. That removes Entra
provisioning, SharePoint, Graph, and field mapping from the critical path.

## Invariants kept (not features — see docs/README.md)

| #   | Invariant                                   | Why it cannot be deferred                          |
| --- | ------------------------------------------- | -------------------------------------------------- |
| 1   | Human approval is mandatory                 | It is MVP step 4                                   |
| 2   | Claude never decides                        | Scoring is deterministic backend code (ADR-004)    |
| 3   | Everything is grounded                      | Evidence verification cannot be disabled (ADR-005) |
| 6   | Answer keys never leave the server mid-quiz | Contract tests already enforce it                  |
| 8   | Authorization is server-side                | Approval and separation of duties depend on it     |
| 9   | Bank writes are idempotent and audited      | Proven against the mock bank via the port          |

## Deferred

Real SharePoint (P7) · real bank writes (P8) · badges and certificates (P9) ·
reporting (P10) · knowledge refreshers · authoring dashboard · bulk operations ·
reconciliation · objective-driven generation · question types beyond
`MULTIPLE_CHOICE_4` · full Entra OIDC (local stub issuer instead, permitted by
implementation-roadmap.md Phase 2).

### Recorded deviations

Each is asserted by a test, so turning it on is a visible change rather than a
forgotten one.

| Rule | Deviation | Containment |
| --- | --- | --- |
| mcp-tools.md E1 | The authorization envelope is **not signed**. Signing needs a Key Vault key, rotation, and a local development key, none of which exist yet. | Expiry, structure, and E3's fresh re-resolution of roles and scope ARE enforced. MCP publishes no port, so the trust boundary is the container network. `ENVELOPE_SIGNING_ENFORCED = false` is asserted by `apps/mcp-server/test/tool-registry.test.ts`. |
| mcp-tools.md T7 vs audit-model.md §8 | The documents disagree: T7 says every tool invocation is audited, §8 lists "individual read requests (page loads, list queries)" as deliberately not audited. **Resolved in favour of the audit model**, which owns what the store contains and gives the reason. | `auditAction` is still a REQUIRED field; a read tool must name the rule that exempts it in `auditExemptionReason`, and a tool that WRITES cannot be exempt at all. Enforced at registration. |
| knowledge-source-adapters.md §2.3 | PDF, DOCX, PPTX, XLSX, and SharePoint pages have no extractor. | A document of an unregistered type returns `UNSUPPORTED` with a reason and **no text**, never a silent skip. Adding one is a map entry plus a conformance fixture. |
| §8 conformance groups | Section lineage, bank assertions, resilience (429/circuit), and end-to-end are not yet asserted. | Declared as `todo` in the suite rather than omitted, so the suite reports what it does not cover (6 todos). |

## Milestones

API and domain first, thin UI last, so a score is demonstrable over HTTP before
any screen exists.

| M   | Delivers                                                                      | MVP step     |
| --- | ----------------------------------------------------------------------------- | ------------ |
| M1  | Authorization spine: stub issuer, policy registry, DataScope, denials audited | prerequisite |
| M2  | Mock adapter, Test Connection, sync, extraction with sections and offsets     | 1, 2         |
| M3  | Preflight, generation, evidence verification, drafts persisted                | 3            |
| M4  | 13 approval gates, separation of duties, transitions, audit                   | 4            |
| M5  | Mock question bank, operation-key idempotency, projection                     | 5            |
| M6  | Assessment, session snapshot, per-answer persistence, scoring                 | 6, 7         |
| M7  | Thin UI across both portals                                                   | usability    |

## Time-boxing levers

Pull these before touching an invariant:

- extraction limited to TXT and Markdown (the extractor registry makes types additive)
- deterministic generation stub instead of a live Claude call (already the
  documented local behaviour when no key is configured)
- `FIXED_SET` selection instead of `TOPIC_BALANCED`
- plain HTML UI instead of the three-pane review workspace

## Status

- [x] M1 Authorization spine — verified live, 19 tests
- [x] M2 Source and documents — verified live end to end, 271 tests

### M2, as built

| Piece | Where |
| --- | --- |
| Normalization, sectioning, offsets, hashing | `packages/content-extraction/src` — X1-X8 asserted by 37 named tests |
| Extractors: plain text, Markdown, HTML | `src/extractors` — HTML via a real parser, script/style subtrees discarded |
| `KnowledgeSourceAdapter` port | `packages/knowledge-source-adapters/src/contract.ts` |
| `MockKnowledgeSourceAdapter` | `src/mock` over a deterministic fixture tree; `sourceDocumentId = sha256(relativePath)`; timestamps from a sidecar or a fixed base date, never the filesystem |
| Fixture documents | `fixtures/knowledge/support-operations` — 5 documents including one DENIED and one with no headings |
| Conformance suite | `packages/testing/contracts/adapter-conformance.ts`, run against the mock; Phase 7 hands the SharePoint adapter the same function |
| 12 MCP tools | `apps/mcp-server/src/tools` — source administration, navigation, and the two extraction tools |
| 12 API routes | `apps/api/src/routes/sources.ts`, each with a declared policy |

**Verified live:** `list_knowledge_sources` → `test_knowledge_source` (5 checks,
2 honest SKIPs) → `synchronize_knowledge_source` (4 documents, 17 sections, the
DENIED document correctly out of scope) → browse → `get_document_sections` with
text, where every persisted section's SHA-256 recomputed from its persisted text
matched its stored `sectionContentHash`. A second sync reported 4 unchanged.

**Defects found by running it, not by reading it:**

1. **The conformance suite was testing stale `dist`.** Cross-package imports
   resolved through the `exports` map, so mutating an adapter's permission
   filter left the suite green. Fixed with a `@knowzy/*` → `src` alias in
   `vitest.workspace.ts`. Every contract test was exposed to this.
2. **One denied document aborted an entire sync.** `extractContent` throws on a
   non-ALLOWED decision, and nothing caught it per item. Failure isolation is
   now explicit, and the mock's `synchronize` applies the same visibility rule
   browsing does.
3. **A container advertised more items than its listing showed**, because the
   count came from the fixture tree and the listing applied the access map.
4. **Audit detail was being silently dropped** — the redactor's allow-list had
   no entry for this milestone's actions, so counts arrived as `_droppedKeys`.
   Extended with counts and hashes only, never document text.

- [ ] M3 Generation
- [ ] M4 Review and approval
- [ ] M5 Publish
- [ ] M6 Quiz and scoring
- [ ] M7 Thin UI
