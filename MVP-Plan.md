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
| workflows.md §2.2 | Generation runs **in-process** on the job-creation request instead of returning 202 and enqueuing on the job runner. | `runGenerationJob` is a domain function with no process affinity, so moving it behind the existing pg-boss queue is wiring, not redesign. Until then a large job holds the request open. |
| workflows.md §2.3 retrieval | The run reads pinned sections from the index rather than re-calling `extract_document_content` through MCP. | The purpose of retrieval-time verification is kept: the run compares each document's current `contentHash` against what the scope captured and aborts with `DOCUMENT_CONTENT_DRIFT` rather than grounding questions in text that has since changed. |
| generation-governance.md §4.4 | Duplicate scoring computes trigram similarity in process instead of via `pg_trgm`. | Verification and scoring must both run BEFORE anything is persisted, so there is nothing in the database to compare against yet. The implementation mirrors `pg_trgm.similarity()` so a score here and a score from the database agree. |
| sharepoint-question-bank.md G4 | The mock bank is writable in `local` even though `sharepoint.write.enabled` is off and its ceiling forbids it outside test and prod. | G4 gates writes to **SharePoint**; the mock bank is a different implementation of the same port writing to a local JSON file, and knowledge-source-adapters.md §6 requires the whole pipeline — publish included — to be exercisable with no tenant credentials. The gate is therefore "may THIS bank be written in THIS environment": MOCK in `local` only (the registry refuses to construct it elsewhere), SHAREPOINT only when the flag is on, otherwise dry-run. Every publish response states `dryRun` and the bank type, so nothing is ambiguous. |
| §2.8 / live Claude | Generation uses a deterministic local generator, not a Claude call. | A documented time-boxing lever, and the zero-credential local path requires it. The generator quotes the document verbatim and goes through the SAME gate chain as a model response, so the gates are exercised for real. `modelId` records `knowzy-deterministic-local-1`, so no job row can suggest a Claude model produced these. |

## M4 and M5, as built

| Piece | Where |
| --- | --- |
| The 13 approval gates | `packages/domain/src/review/gates.ts` — all failures returned at once, each naming the field that fixes it |
| Separation of duties + break-glass | `src/review/separation-of-duties.ts` — the four §3.4 policies |
| The transition table | `src/review/transitions.ts` — the state machine as data, with permission, comment requirement, and gating per edge |
| Review, approval, comments, dispositions | `src/review/review-service.ts` — one transactional path for every transition |
| Versioning | `src/review/versioning.ts` — snapshot, field diff, evidence re-verified on every edit |
| Publishing and retirement | `src/review/publishing.ts` — operation keys, pre-write existence check, conditional update, G9 ordering |
| `QuestionBankAdapter` port | `packages/shared-types/src/question-bank-port.ts` — no delete method exists |
| `MockQuestionBankAdapter` | `packages/knowledge-source-adapters/src/mock` — real operation-key uniqueness, real ETag semantics, real 412 |
| 5 MCP bank tools | `apps/mcp-server/src/tools/question-bank.ts` |
| 13 API routes | `apps/api/src/routes/review.ts` |
| 65 integration tests | `packages/domain/test/review-pipeline.test.ts` |

**Verified live:** generate → claim → edit (version 2, evidence re-verified) →
SME endorsement → submit (13 gates) → the author holding both roles refused
with a 403 `SEPARATION_OF_DUTIES` naming gate 13 → break-glass refused while
disabled → a distinct approver approves with gate results persisted → publish
to `KNZ-SUPPORT_OPS-2026-000001` with a verified item id → replay publishes
nothing → retire leaves the item in place, inactive, with its comment → the
audit chain carries the bank item id and ETag G6 requires.

**Defects found by running it, not by reading it:**

1. **A boundary violation I introduced.** Putting the bank port in the adapters
   package made `@knowzy/domain` reach it, which B3 forbids transitively. The
   port is semantic-key vocabulary — explicitly *not* SharePoint names — so it
   moved to `@knowzy/shared-types`, where the domain can speak the interface
   while only the adapters implement it.
2. **Published identifiers were not monotonic.** The `KNZ-{DOMAIN}-{YYYY}-{SEQ}`
   sequence came from `count(proposedQuestionId != null)`. Archive or delete a
   draft and the count falls, so the next publish reissues an id a bank item
   already holds — the pre-write existence check then finds that item and
   reports `ALREADY_PUBLISHED`, and a brand-new question silently appears to be
   a different one. Now derived from the maximum already issued in
   `PublishedQuestionReference`, whose rows are never deleted.
3. **A submit reported `gates.passed: false` while succeeding**, because gate 13
   does not apply at submit but was still evaluated as a failure the caller
   filtered out. It now reports as a pass with that reason, so the checklist
   always has 13 rows and the result never contradicts the outcome.
4. **Integration test files ran in parallel against one database**, deleting
   each other's rows. Worse than flaky: a suite could pass because another
   file's leftovers satisfied its setup. Now serialized with one fork, and the
   review suite gets a fresh bank list per test.
5. **Publish and retire audit detail was dropped** by the redactor's allow-list
   — including the bank item id and ETag that G6 names explicitly.

## M6, as built

| Piece | Where |
| --- | --- |
| Deterministic scoring | `packages/domain/src/assessment/scoring.ts` — half-away-from-zero to two decimals, decisions on the stored value, all four §5.2 worked examples asserted |
| Seeded selection | `src/assessment/selection.ts` — mulberry32 + Fisher-Yates, so a selection replays identically years later |
| Assessment creation and the eligibility snapshot | `src/assessment/assessment-service.ts` — pool validated before submit, snapshot pinned in the same transaction as publication |
| Session lifecycle | `src/assessment/session-service.ts` — immutable snapshot, one question at a time, per-answer revisions, resume, expiry, recovery, scoring |
| 12 API routes | `apps/api/src/routes/learning.ts` — 5 authoring, 7 learner |
| 57 integration tests | `packages/domain/test/assessment-session.test.ts` |

**Verified live, the whole MVP in one pass:** 5 questions generated from two
documents → reviewed and approved → published as
`KNZ-SUPPORT_OPS-2026-000001..005` → an assessment created, validated against
the live pool of 5, and published with its snapshot pinned → the learner sees
it as startable → session started with 4 of 5 questions selected → the
server-side snapshot holds question ids, versions and keys while the wire
carries only options → answered one right and one wrong → a double-click
returned the original revision → the browser "closed" and resume returned index
2 with both saved answers → finished → **75%, PROFICIENT, passed** with
per-topic accuracy and no knowledge gap → a second complete returned the same
result id → an answer after completion refused with `SESSION_NOT_ACTIVE` →
another learner reading the result got 403 → attempt 2 opened a new session.

**Defects found by running it:**

1. **Cross-suite test coupling, twice more.** The M3 suite deleted drafts
   without their publish references, approvals, and reviews, so the M4/M6
   suites' rows broke its setup with a foreign-key violation. And the M6 suite
   left its last test's rows behind. Both now tear down completely.
2. **`Assessment.status` and `AssessmentVersion.status` are different
   vocabularies.** The assessment becomes `ACTIVE`; `PUBLISHED` is a version
   state. Conflating them would have broken §5.3's rule that version N stays
   published while N+1 is drafted.
3. **`ObjectiveResult` requires a `gapState`** the schema declares but §5.4
   only describes for topics. The same minimum-evidence rule now applies to an
   objective: one question about it is not enough to call it a gap.
4. **The retirement CHECK constraint caught a test shortcut** — the database
   refuses a half-retirement with no timestamp, actor, or comment, which is
   exactly right.

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

- [x] M3 Generation — verified live end to end, 301 tests

### M3, as built

| Piece | Where |
| --- | --- |
| Evidence verification (STRICT / STANDARD) | `packages/claude-services/src/evidence.ts` — the §2.5 rules, span bounds, section attribution, and offsets that re-locate |
| Output schema, integrity, confidence | `src/output-schema.ts`, `src/integrity.ts`, `src/confidence.ts` — the six weighted confidence components, model self-report capped at 0.10 |
| Untrusted-content framing | `src/framing.ts` — per-call random nonce delimiters, and generation grants NO tools |
| Generator port + deterministic local generator | `src/generator.ts` — quotes the document verbatim, goes through the same gate chain as a model response |
| Six preflight checks | `packages/domain/src/generation/preflight.ts` |
| `ResolvedGenerationScope` | `src/generation/scope.ts` — a branded type; a forged object literal does not typecheck |
| Job creation and the 11 preconditions | `src/generation/job-creation.ts` |
| The gate chain and persistence | `src/generation/generation-service.ts` |
| Duplicate scoring | `src/generation/similarity.ts` — the five documented weights, detection across ALL domains |
| 2 MCP tools | `preflight_generation`, `record_preflight_decision` |
| 5 API routes | preflight · decide · create-and-run · job read · author review queue |
| 28 integration tests | `packages/domain/test/generation-workflow.test.ts` |

**Verified live:** preflight over two documents → job refused with
`PREFLIGHT_REQUIRED` until a decision is recorded → decision → 5 grounded
drafts from 10 sections with all 5 shortfalls reported → every persisted
evidence span re-located in the stored source text (`STRICT`, similarity
1.000) → all 5 in the author review queue with options, proposed answer,
evidence, and confidence breakdown → audit events per draft and per job.

**Defects found by running it, not by reading it:**

1. **Per-section insufficient-evidence results were silently discarded**
   whenever any question succeeded. `GenerationOutput` is a union, so it can
   carry questions or one insufficiency but not both — §2.7 requires every
   section's reason recorded and shown. `GenerateResult.insufficientSections`
   now carries them alongside. Four sections' reasons were being lost per run.
2. **The `ResolvedGenerationScope` brand was vacuous.** `declare const` has no
   runtime value, so assigning it threw; making it optional then let any object
   literal satisfy the type. Fixed with a required phantom and verified by
   compiling a forged literal and watching it fail.
3. **A literal backspace character was written into a regex** in place of
   ``, so the article-agreement fix never applied and distractors read "An
   duty manager".
4. **The integration suite depended on its own previous run.** A generation run
   mutates section assessability and coverage, so tests passed or failed based
   on execution order. It now resets the document to a known baseline before
   every run.
5. **Token counts were redacted from audit.** `/token/i` matched
   `inputTokenCount`, writing `"[redacted]"` over a cost figure — losing the
   accounting and implying a secret had been there. The redactor now carries an
   exact-match safe-key exception list, with tests that `accessTokenCount`
   stays redacted.
6. **`??` precedence bug** in the preflight capacity sum (`sum + get() ?? 0`
   parses as `(sum + get()) ?? 0`), caught by the typechecker.
7. **Suppression was reported as insufficient evidence.** When a question for a
   section already existed, stage-1 suppression produced nothing and the
   section was reported as stating no testable rule — sending the author to fix
   a document that was fine. The two cases now carry different reasons.

**One architectural finding:** evidence verification belongs to
`@knowzy/claude-services` (architecture.md §365) and is reached by
`@knowzy/domain`, but B3 forbids domain from reaching `@knowzy/content-extraction`
even transitively — where the normalization pipeline lived. "Exactly one
implementation and everything calls it" was therefore unsatisfiable; the
alternative was a second copy, which is the specific failure that rule exists
to prevent. The pipeline moved to `@knowzy/shared-types`, the only package every
consumer may import, and content-extraction re-exports it.
- [x] M4 Review and approval — verified live end to end
- [x] M5 Publish — verified live end to end (folded into M4)
- [x] M6 Quiz and scoring — verified live end to end
- [ ] M7 Thin UI
