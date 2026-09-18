# Knowzy — MVP Readiness Assessment

**Status:** Implementation status report
**Date:** 2026-09-18
**Assessed commit:** `8d2df76` (`MVP M6: assessment, quiz session, and deterministic scoring`)
**Amended for M7 (thin UI):** §1, §7.1, and §10. Everything else still describes `8d2df76`; the
M7 change was additive — no API behaviour, invariant, or test in §2–§6 was altered by it.
**Assessed against:** the seven MVP objectives in [../MVP-Plan.md](../MVP-Plan.md), scoped from
[initial-end-to-end-proof.md](initial-end-to-end-proof.md)

> **This document reports status; it does not define behaviour.** Every other document in this
> directory is a design specification and remains the authority. Where this report and a design
> document disagree about what the system *should* do, the design document is correct and this
> report is out of date. Where this report and the code disagree about what the system *does*, the
> code is correct and this report is out of date.

---

## 1. Verdict

**All seven MVP objectives are achieved and verified end to end, with no tenant credentials.**

The MVP is **demonstrable in a browser and not shippable to users.** The pipeline from knowledge
source to learner score is complete, tested, and audited, and M7 added the minimum UI needed to walk
it without curl. What is missing is everything beyond that minimum — the specified authoring
dashboard, badges, certificates, and reporting surfaces — plus the real SharePoint and Entra
integrations and a single CI execution. See §7 and §9.

| Question | Answer |
| --- | --- |
| Can a complete quiz lifecycle be demonstrated today? | Yes, in the browser, on the mock adapters |
| Can a learner use it? | For a demonstration, yes; for daily use, no (§7.1) |
| Can it be pointed at a real tenant? | No — the SharePoint adapter is Phase 7 (§7.2) |
| Has anything run outside this machine? | No — CI has never executed (§7.4) |
| Are the ten design invariants intact? | Yes, all ten (§4) |

---

## 2. The seven MVP objectives

Each row was executed against the running compose stack at the assessed commit. "Evidence" states
what was observed, not what the code intends.

| # | Objective | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Configure a knowledge source | **Achieved** | Source listed via `GET /authoring/sources`; `test-connection` returned 5 checks with 2 honest `SKIP`s; `synchronize` indexed 4 documents into 17 sections |
| 2 | Select a document | **Achieved** | Container → folder → document traversal with `isSelectable` per document; the fixture's `DENIED` document absent from browse, search, and sync |
| 3 | Generate quiz questions | **Achieved** | 5 grounded drafts from 10 sections across two documents; the 5 sections that yielded nothing reported with a per-section reason |
| 4 | Review and approve questions | **Achieved** | Claim → edit (version 2, evidence re-verified) → SME endorsement → submit (13 gates) → approval by a distinct person, with gate results persisted on the approval |
| 5 | Publish to the Question Bank | **Achieved** | Published as `KNZ-SUPPORT_OPS-2026-000001`…`000005` with verified bank item IDs; a replayed batch wrote nothing |
| 6 | Take a quiz | **Achieved** | 4 of 5 questions selected; one question at a time; each answer persisted as a revision; resume after a simulated browser loss returned the exact position and both saved answers |
| 7 | Receive a score | **Achieved** | **75.00%, `PROFICIENT`, passed**, with per-topic accuracy (3/4 = 75%), gap analysis (`NO_GAP`), and the threshold set copied onto the result |

### 2.1 Refusals observed, not just successes

A pipeline that only demonstrates the happy path demonstrates very little. These refusals were
exercised live at the same commit:

| Refusal | Observed |
| --- | --- |
| Generation without a recorded preflight decision | `422 PREFLIGHT_REQUIRED` |
| Approval by the question's own author | `403 SEPARATION_OF_DUTIES`, naming gate 13 |
| Break-glass while the flag is off | `403`, stating the flag that must be enabled |
| Publishing a question whose source changed after approval | `GATE_FAILED` with `SOURCE_VALIDATION_FAILED`; nothing written, question left `APPROVED` |
| Retirement with a thin comment | `400`, minimum 10 characters |
| A second publish of the same question | Wrote nothing; the bank still held one item |
| An answer after completion | `409 SESSION_NOT_ACTIVE` |
| A double-clicked answer | Original revision returned; the second option not applied |
| Another learner reading a result | `403` |

---

## 3. What was built

| Layer | Delivered |
| --- | --- |
| Extraction | Normalization, sectioning, offsets, hashing; plain-text, Markdown, and HTML extractors |
| Adapters | `KnowledgeSourceAdapter` and `QuestionBankAdapter` ports, both with mock implementations over committed fixtures |
| Claude services | Untrusted-content framing, output schema, evidence verification, integrity checks, composite confidence, generator port |
| Domain | Generation governance, the 13 approval gates, separation of duties, the transition table, versioning, publishing, assessment, selection, session lifecycle, scoring |
| MCP server | 19 of the 36 tools in [mcp-tools.md](mcp-tools.md) §2, each declaring policy, portal partition, timeout budget, and audit action |
| API | 45 routes, every one declaring a policy |
| Tests | 430 passing across 14 files, plus 6 declared `todo` |

### 3.1 MCP tools registered

| Family | Tools |
| --- | --- |
| Source administration | 5 |
| Source navigation | 7 |
| Generation governance | 2 |
| Question Bank | 5 |
| **Total** | **19 of 36** |

The remaining 17 belong to refreshers, recognition, reporting, and objective-driven generation —
Phases 9 and 10.

### 3.2 Test coverage by kind

| Project | Covers |
| --- | --- |
| `unit` | Redaction, authorization engine, startup validation, extraction invariants X1–X8 |
| `contract` | Answer-key protection, registry completeness, boundary rules B1–B9, adapter and bank conformance |
| `integration` | Audit transactionality, route-policy completeness, MCP tool registry, generation workflow, review and publishing pipeline, assessment and session lifecycle |

---

## 4. Design invariants

All ten invariants in [README.md](README.md) hold. Each is enforced by a mechanism rather than a
convention, and the mechanism is named.

| # | Invariant | Enforcement |
| --- | --- | --- |
| 1 | Human approval is mandatory | The transition table has no path from `GENERATED` to `PUBLISHED` that omits an approval |
| 2 | Claude never decides | Scoring is arithmetic with no model input; the generator's self-reported confidence is capped at 0.10 of a composite the platform computes |
| 3 | Everything is grounded | Evidence verification runs at generation, at every edit, at submit, at approval, and again at publish (G1) |
| 4 | Two applications, one backend | Separate portals in the tool registry; a `LIVE` envelope cannot resolve an authoring tool |
| 5 | Sources are data, not code | No tool accepts a location; every path comes from a configured `KnowledgeSourcePath` row |
| 6 | Answer keys never leave the server mid-quiz | The learner projection is built from an explicit field list, with a runtime key assertion behind it |
| 7 | Retrieved documents are untrusted | Per-call nonce delimiters; generation grants no tools |
| 8 | Authorization is server-side | Route policy, then MCP re-resolution of roles and scope from the database |
| 9 | Bank writes are idempotent and audited | Deterministic operation keys, pre-write existence check, conditional update, audit in the same transaction |
| 10 | A new source is an adapter | One conformance suite, parameterized by adapter |

---

## 5. Roadmap coverage

Against [implementation-roadmap.md](implementation-roadmap.md) §2:

| Phase | Status |
| --- | --- |
| 1 — Foundation | Complete, validated by execution |
| 2 — Identity and access | Complete for `local`; the stub issuer stands in for Entra OIDC |
| 3 — Sources and documents (mock) | Complete |
| 4 — Generation and governance | Complete, with a deterministic local generator in place of a live Claude call |
| 5 — Review and approval | Complete |
| 6 — Assessment, quiz, and scoring | Complete |
| 7 — SharePoint read integration | Not started |
| 8 — Question Bank write integration | Port and mock complete; the SharePoint adapter is not started |
| 9 — Refreshers and recognition | Not started |
| 10 — Reporting and audit surfaces | Not started |
| 11 — Hardening and release | Not started |

Phases 1–6 are the MVP. Everything after them is post-MVP by design.

---

## 6. How this was verified

| Method | What it covers | Limitation |
| --- | --- | --- |
| `npm run verify` | Lint, typecheck, codegen contract check, the full test suite, build | Exits 0 at the assessed commit |
| 430 automated tests | Every gate, transition, invariant, and refusal listed above | See the gap in §7.5 |
| Manual HTTP walkthrough | All seven objectives in one pass against the compose stack | **Scripted with `curl`, not automated** (§7.5) |
| Database inspection | Snapshots, revisions, audit rows, bank state on disk | — |

Each gate and policy was tested by making it **fail in isolation from a passing baseline**. A suite
where the happy path passes proves the happy path works; it proves nothing about the controls meant
to stop it. Two mechanisms were additionally checked by deliberate mutation — the evidence
round-trip and an adapter's permission filter — because both had previously passed while being
vacuous.

---

## 7. What is not done

### 7.1 Minimum UI only
M7 built the ten screens the workflow needs and nothing else: knowledge sources, document browser,
generate, review queue, question approval, publish (with a small assessment section) in the
Authoring Portal, and assessment list, start, quiz, and results in the Live Learning Portal. Both
apps are server-rendered and call the API from their own process, so the browser never holds an
identity header.

What that leaves out is most of the specified product. The Authoring Dashboard
(authoring-portal.md §2) needs the Phase 10 reporting read models and does not exist; neither do
badges, certificates, refresher scheduling, or any report surface. There is no assessment builder —
creating one is a single form on the Publish page, which covers what the learner portal needs to
have anything to serve and no more. The identity picker is a demonstration affordance over the local
stub issuer and refuses to exist outside `local`. Every form except the identity switch needs
JavaScript, because the results those forms return — a failed gate, a per-item publish outcome — have
to stay on screen.

### 7.2 Mock adapters only
`SharePointKnowledgeSourceAdapter` (Phase 7) and `SharePointQuestionBankAdapter` (Phase 8) do not
exist. The ports and the conformance suite that both must pass do exist, so the work is an
implementation rather than a redesign.

### 7.3 No live Claude call
Generation uses a deterministic local generator. It quotes documents verbatim and passes through the
same gate chain as a model response, so the gates are exercised for real — but **question quality
has never been tested against Claude**, which is the product's actual purpose. The local generator
yields roughly 6 questions across 16 fixture sections because it only builds from sentences stating
an explicit rule.

### 7.4 CI has never executed
There is no git remote. The workflow file encodes gates that pass locally and have never run in CI,
on a clean checkout, or on any other machine.

### 7.5 The end-to-end acceptance script is not automated
[initial-end-to-end-proof.md](initial-end-to-end-proof.md) §3 defines a 36-step acceptance script.
The equivalent was executed manually and reproducibly, but no automated test walks source → score in
one pass. The integration suites cover each stage; nothing covers the seam between all of them.

### 7.6 Deferred by scope
Knowledge refreshers, badges, certificates, reporting, the authoring dashboard, bulk operations,
reconciliation, objective-driven generation, and question types beyond `MULTIPLE_CHOICE_4`.

---

## 8. Recorded deviations

Nine deviations from the design documents are recorded in
[../MVP-Plan.md](../MVP-Plan.md#recorded-deviations), each with its containment and each asserted by
a test so that reversing it is a visible change. Summarized:

| Deviation | Containment |
| --- | --- |
| Envelope signing (E1) not enforced | Expiry, structure, and E3's fresh re-resolution are; MCP publishes no port |
| Read tools not audited (T7 vs audit-model.md §8) | Resolved for the audit model; a read must name the rule that exempts it, and a write can never be exempt |
| PDF, DOCX, PPTX, XLSX extractors absent | An unregistered type returns `UNSUPPORTED` with a reason and no text |
| Four conformance groups unasserted | Declared `todo`, so the suite reports what it does not cover |
| Generation runs in-process, not on the job runner | `runGenerationJob` has no process affinity; moving it is wiring |
| Retrieval reads the index, not MCP | The hash freshness check is kept; drift aborts with `DOCUMENT_CONTENT_DRIFT` |
| Trigram similarity computed in process | Mirrors `pg_trgm.similarity()`; nothing is persisted to compare against yet |
| Mock bank writable in `local` while SharePoint writes are off | G4 gates *SharePoint*; the registry refuses to construct the mock elsewhere, and every publish response states `dryRun` and the bank type |
| Deterministic generator instead of Claude | `modelId` records `knowzy-deterministic-local-1`, so no job row can suggest otherwise |

### 8.1 One architectural change

Evidence verification belongs to `@knowzy/claude-services` ([architecture.md](architecture.md#73-shared-services) §7.3)
and is reached by `@knowzy/domain`, but boundary rule B3 forbids domain from reaching
`@knowzy/content-extraction` even transitively — where the normalization pipeline lived. "Exactly one
implementation and everything calls it" was therefore unsatisfiable, and the alternative was a second
copy, which is the specific failure that rule exists to prevent. The pipeline moved to
`@knowzy/shared-types`, the only package every consumer may import; `@knowzy/content-extraction`
re-exports it. The `QuestionBankAdapter` port moved for the same reason.

---

## 9. Risks to shipping

| # | Risk | Why it matters | Mitigation |
| --- | --- | --- | --- |
| R1 | Question quality is unmeasured | The platform's value is the questions, and no human has reviewed one produced by Claude | Wire the Anthropic client and review a real batch before any pilot |
| R2 | CI has never run | Every gate is locally verified only; a clean checkout has never been proven to build | Configure the remote and let CI run once |
| R3 | The integration suite shares one database | Serialized to a single fork for correctness; ~40 s and growing | Per-worker schemas or a database per worker |
| R4 | No automated end-to-end test | The seam between stages is covered by manual walkthrough only | Automate the §3 acceptance script |
| R5 | SharePoint behaviour is assumed | Throttling, eTag semantics, and indexed filters are designed but untested against Graph | Phase 7 against a real tenant, early |
| R6 | Local role catalogue separates duties by role | Gate 13 only bites for users holding two roles; no seeded role holds both `question.generate` and `question.approve` | Confirm the intended production role assignments |

---

## 10. Recommended next steps

In order, on the reasoning that each unblocks the next:

1. **Configure the git remote and let CI run.** Everything below is harder to trust until something
   outside this machine has verified the tree.
2. **Wire the live Claude generator** behind the existing port and review a real batch of questions.
   This is the only remaining unknown about whether the product works, as opposed to whether the
   pipeline works.
3. **Automate the end-to-end acceptance script** (§7.5), so the seam between stages is covered.
   M7 made the workflow clickable, which is not the same as covered: no test drives the UI, so a
   broken screen would be found by a person, not by the build.
4. **Phase 7 and 8** against a real tenant, taking the conformance suite as the specification.

M7 (the thin UI) is done — see §7.1 for what it deliberately left out.

---

## 11. Traceability

| Objective | Design authority | Implementation | Tests |
| --- | --- | --- | --- |
| 1, 2 | [knowledge-source-administration.md](knowledge-source-administration.md), [knowledge-source-adapters.md](knowledge-source-adapters.md) | `packages/content-extraction`, `packages/knowledge-source-adapters`, `apps/mcp-server/src/tools` | `extraction-invariants`, `mock-adapter-conformance` |
| 3 | [generation-governance.md](generation-governance.md), [workflows.md](workflows.md) §2 | `packages/claude-services`, `packages/domain/src/generation` | `generation-workflow` |
| 4 | [authoring-portal.md](authoring-portal.md) §5.7, [workflows.md](workflows.md) §3 | `packages/domain/src/review` | `review-pipeline` |
| 5 | [sharepoint-question-bank.md](sharepoint-question-bank.md) §4 | `packages/domain/src/review/publishing.ts`, `apps/mcp-server/src/tools/question-bank.ts` | `review-pipeline` |
| 6, 7 | [live-learning-portal.md](live-learning-portal.md) §4–5, [workflows.md](workflows.md) §5–6 | `packages/domain/src/assessment` | `assessment-session` |
| All | [access-control.md](access-control.md), [audit-model.md](audit-model.md), [security.md](security.md) | `packages/authorization`, `packages/database/src/audit-writer.ts` | `engine`, `registries`, `answer-key-protection`, `audit-transaction`, `route-policy-registry` |
