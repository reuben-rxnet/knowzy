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
- [ ] M2 Source and documents
- [ ] M3 Generation
- [ ] M4 Review and approval
- [ ] M5 Publish
- [ ] M6 Quiz and scoring
- [ ] M7 Thin UI
