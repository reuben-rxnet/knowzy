# KNOWZY — Full Solution Capability Matrix

**Status:** Planning artifact. No code, route, contract, or behaviour changed by this document.
**Created:** 2026-09-21
**Assessed commit:** `bbb9df6`
**Covers:** every visible feature in all 17 approved mockups — 9 Authoring, 8 Live Learning.

**Sources of truth, in precedence order:** the repository (functional) → `CLAUDE.md` and `/docs`
(architecture) → [`KNOWZY_UI_SOURCE_OF_TRUTH.md`](KNOWZY_UI_SOURCE_OF_TRUTH.md) and
[`KNOWZY_LIVE_PORTAL_UI_SOURCE_OF_TRUTH.md`](KNOWZY_LIVE_PORTAL_UI_SOURCE_OF_TRUTH.md) (UX) →
`design/approved/**` (visual reference only).

This matrix supersedes the seven-row draft in
[`live-portal-capability-matrix.md`](live-portal-capability-matrix.md).

---

## How to read this

**Status values**

| Status | Meaning |
| --- | --- |
| `IMPLEMENTED` | Works today, end to end, with a route and a tested backend path |
| `PARTIALLY_IMPLEMENTED` | Some of it works; the mockup shows more than exists |
| `PLANNED` | Designed in `/docs` or seeded in the schema, but no code path produces it |
| `REQUIRES_BACKEND_EXTENSION` | No model, endpoint, or data exists; needs new backend design |
| `DISABLED_IN_CURRENT_RELEASE` | Deliberately shown as unavailable — no API exists and faking it is forbidden |

**Column conventions.** *Backend today* names the endpoint or table that exists. *Security* and
*Authorization* record what the feature must not leak and which policy governs it — `n/a` means the
feature adds no new exposure beyond what its route already has. *Data source* names what the number
or list would have to be computed from.

**Verified facts this matrix rests on** (checked against the running database at the assessed
commit, not assumed):

- 48 API routes, every one with a declared policy; 26 policies in `packages/authorization`.
- `badge_definition` holds **10 seeded rows**; `badge_award` holds **0** and **nothing writes it**.
- `certificate_rule` holds **1 seeded row**; `certificate` holds **0** and nothing writes it.
- `knowledge_recommendation` exists as a model with approved-explanation and citation fields;
  **nothing writes it**, 0 rows.
- `notification` and `team` exist; both empty, nothing writes them.
- `report_definition` / `_run` / `_export` / `_schedule` exist; all empty. `@knowzy/reporting` and
  `@knowzy/certificate-generator` are placeholder packages.
- **No** `Course`, `Enrollment`, `LearningPath`, `LearningItem`, `Module`, `Bookmark`, or
  `CompletionRecord` model exists anywhere in the schema.
- No KPI history is stored for any metric, so no "vs last month" delta is computable.

---

# PART A — Authoring Portal

## A1. Global shell (all 9 authoring mockups)

| Feature | Status | Route | Domain model | Backend today | Security | Authorization | Data source | Required extension | Milestone |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| EssilorLuxottica + KNOWZY wordmark, tagline | `REQUIRES_BACKEND_EXTENSION` (asset only) | all | — | none | Brand assets must be approved originals | n/a | Static asset | Approved logo files in the repo | UI-M1 |
| Sidebar, 10 items, selected-state treatment | `PARTIALLY_IMPLEMENTED` | all | — | 7 routes exist of 10 destinations | Nav hiding is never the authz control | Visibility mirrors policy; server still enforces | Route table | 3 new routes (UI-M6/7/8), 3 more (UI-M10) | UI-M1 |
| Workflow ribbon (Sources → … → Insights) | `PARTIALLY_IMPLEMENTED` | authoring workflow pages | — | Stage completion is knowable for questions, not globally | n/a | n/a | Question/job state | Aggregate "stage complete" read is out of scope; mark unknown stages neutral | UI-M1 |
| Global search + `Ctrl + K` | `REQUIRES_BACKEND_EXTENSION` | — | — | `GET /sources/:id/search` searches documents **within one source** only | Cross-entity search must be access-trimmed per entity type | New policy needed (`search.query`) | Would span documents, questions, assessments | Cross-entity search API with per-type trimming | UI-M10 |
| Notification bell with count | `DISABLED_IN_CURRENT_RELEASE` | — | `Notification` | Table exists, **0 rows, no writer** | Counts must not leak others' activity | Per-user scope | `notification` | Notification producer + read API | UI-M10 |
| KNOWZY Copilot entry point | `DISABLED_IN_CURRENT_RELEASE` | — | — | none | §23: must never bypass authz, reveal answers, or act autonomously | Would need its own policy + envelope | — | Copilot service, grounding, prompt-injection defence | Post-Phase-8 |
| User avatar, display name, active role | `IMPLEMENTED` (as demo identity) | all | `User`, `Role` | Stub issuer resolves subject server-side | Must stay labelled *Local Development Identity* (§34) | Roles re-resolved server-side each request | `user`, `user_role` | Entra ID for non-local (Phase 2 deferred) | UI-M1 |

## A2. Dashboard — `dashboard.png`

| Feature | Status | Route | Domain model | Backend today | Security | Authorization | Data source | Required extension | Milestone |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Hero "Turn Knowledge into Impact" | `IMPLEMENTED` (static) | `/` | — | none needed | n/a | n/a | Static copy | — | UI-M2 |
| KPI: Knowledge Coverage % | `REQUIRES_BACKEND_EXTENSION` | `/` | `DocumentSection.coverageStatus` | Per-section status exists; no aggregate | n/a | Domain-scoped to the caller | `document_section` | Coverage aggregate read model + endpoint | UI-M2 |
| KPI: Published Questions | `REQUIRES_BACKEND_EXTENSION` (trivial) | `/` | `PublishedQuestionReference` | Rows exist; no count endpoint | n/a | Domain scope | `published_question_reference` | Count aggregate endpoint | UI-M2 |
| KPI: Assessment Readiness % | `REQUIRES_BACKEND_EXTENSION` | `/` | — | **No definition of "readiness" exists in any design document** | n/a | n/a | undefined | Define the metric before building it | UI-M10 |
| KPI: Knowledge Gaps % | `PARTIALLY_IMPLEMENTED` | `/` | `TopicResult.gapState` | Gaps exist **per result**; no org-level index | Aggregated learner data — §20 minimum-group-size applies | Report-level authz, not learner | `topic_result` | Org gap read model + privacy thresholds | UI-M10 |
| "+6% vs last quarter" deltas (all cards) | `REQUIRES_BACKEND_EXTENSION` | `/` | — | **No KPI history is stored anywhere** | n/a | n/a | none | Periodic KPI snapshot table + job | UI-M10 |
| Proficiency heatmap (team × level) | `REQUIRES_BACKEND_EXTENSION` | `/` | `Team`, `UserTeam`, `TopicResult` | `team` empty, nothing writes it | **Highest privacy risk on the page** — per-team performance | Manager/report policy; never learner-visible | `assessment_result` + team membership | Team model population + Phase 10 read model + suppression rules | UI-M10 |
| Knowledge coverage donut | `REQUIRES_BACKEND_EXTENSION` | `/` | as coverage above | — | n/a | Domain scope | `document_section` | Same read model as coverage KPI | UI-M2 |
| Assessment success-rate trend (6 mo) | `REQUIRES_BACKEND_EXTENSION` | `/` | `AssessmentResult` | Rows carry score + timestamp; no time series | Aggregate of learner results | Report policy | `assessment_result` | Time-series aggregate endpoint | UI-M10 |
| Recent activity feed | `REQUIRES_BACKEND_EXTENSION` | `/` | `AuditEvent` | Partitioned append-only audit exists | Audit detail is **allow-listed**; a naive projection leaks | `audit.read` (exists as a permission) | `audit_event` | Scoped, redacted activity projection | UI-M10 |
| Top knowledge sources with % split | `PARTIALLY_IMPLEMENTED` | `/` | `KnowledgeSource`, `KnowledgeDocument` | Document counts exist per source | n/a | `source.read` | `knowledge_document` | Percentage aggregate | UI-M3 |
| Quick actions (4 links) | `IMPLEMENTED` | `/` | — | Links to existing routes | n/a | Hide by policy, enforce server-side | — | — | UI-M2 |
| Eight realistic domain names (RxNet, MES 360 …) | `PARTIALLY_IMPLEMENTED` | `/` | `Domain` | One seeded domain (`SUPPORT_OPS`) | Must not read as production domains (§4.4) | n/a | `domain` | Demo seed extension, clearly synthetic | UI-M2 |

## A3. Knowledge Sources — `knowledge-sources.png`

| Feature | Status | Route | Domain model | Backend today | Security | Authorization | Data source | Required extension | Milestone |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Source table (name, type, status, last sync, documents) | `IMPLEMENTED` | `/sources` | `KnowledgeSource` | `GET /authoring/sources` | n/a | `source.read` | live | — | UI-M3 |
| Test Connection with per-check results | `IMPLEMENTED` | `/sources` | — | `POST :id/test-connection` — 5 checks + capabilities | Honest `SKIP` must stay visible | `source.test` | live | — | UI-M3 |
| Synchronize with counts and per-item failures | `IMPLEMENTED` | `/sources` | `KnowledgeSourceSync` | `POST :id/synchronize` | Denied documents must stay invisible | `source.sync` | live | — | UI-M3 |
| Tabs: Connected / Disconnected / Pending | `IMPLEMENTED` (client filter) | `/sources` | `connectionStatus` | field exists | n/a | `source.read` | live | — | UI-M3 |
| KPI: Total / Active sources, Last sync | `IMPLEMENTED` (derive in page) | `/sources` | as above | list payload already carries it | n/a | `source.read` | live | — | UI-M3 |
| KPI: Total Documents, Unique Topics | `PARTIALLY_IMPLEMENTED` | `/sources` | `KnowledgeDocument`, `Topic` | Document count exists; "unique topics" is a taxonomy count, not a source metric | n/a | `source.read`, `taxonomy.read` | live | Define the metric honestly or drop it | UI-M3 |
| Owner column with avatar | `REQUIRES_BACKEND_EXTENSION` | `/sources` | — | **No owner field on `KnowledgeSource`** | Names are personal data | n/a | none | Schema field + admin write path | UI-M10 |
| Source-type distribution donut | `PARTIALLY_IMPLEMENTED` | `/sources` | `sourceType` | Only `MOCK` exists locally — an honest chart shows one segment | n/a | `source.read` | live | Real adapters (Phase 7) | UI-M3 |
| Recent sync activity panel | `IMPLEMENTED` | `/sources` | `KnowledgeSourceSync` | `GET :id/synchronizations` | n/a | `source.read` | live | — | UI-M3 |
| Add / Edit / Archive source | `REQUIRES_BACKEND_EXTENSION` | — | `KnowledgeSource` | `source.manage` **policy exists; no write endpoint does** | Source config controls what AI may read — high impact | `source.manage` | — | Create/update/archive endpoints + audit | UI-M10 |
| Configure tenant/site/library/schedule | `REQUIRES_BACKEND_EXTENSION` | — | `KnowledgeSourcePath` | Paths are seeded rows | Tenant values are configuration, never code (C2) | `source.manage` | — | Admin write surface + Phase 7 adapter | Phase 7 |
| Document browser: containers → folders → documents → sections | `IMPLEMENTED` | `/sources/[sourceId]` | `KnowledgeDocument`, `DocumentSection` | `containers`, `items`, `sections` | Permission-trimmed; denied documents hidden | `document.browse` | live | — | UI-M3 |
| Extraction status, hash, version, offsets, coverage, selectability | `IMPLEMENTED` | `/sources/[sourceId]` | `DocumentSection` | live payload | Offsets prove the evidence claim (X2) | `document.browse` | live | — | UI-M3 |

## A4. AI Quiz Generation — `ai-quiz-qeneration.png`

> This mockup conflicts with the governed workflow in several places. The specification wins;
> details in the modernization plan §6.1.

| Feature | Status | Route | Domain model | Backend today | Security | Authorization | Data source | Required extension | Milestone |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Select knowledge source(s) and documents | `IMPLEMENTED` | `/generate` | `KnowledgeDocument` | `items`, explicit 1–10 selection | No "all documents" option by design | `document.browse` + `question.generate` | live | — | UI-M4 |
| Preflight, six checks per document | `IMPLEMENTED` | `/generate` | `GenerationPreflight` | `POST /generation/preflight` | Recommendation is not permission | `question.generate` | live | — | UI-M4 |
| Recorded decision (5 actions) | `IMPLEMENTED` | `/generate` | `GenerationPreflight.chosenAction` | `POST …/decide` | **No silent proceed-anyway** (§15) | `question.generate` | live | — | UI-M4 |
| Generate → drafts with evidence | `IMPLEMENTED` | `/generate` | `DraftQuestion`, `GenerationJob` | `POST /generation-jobs` | Evidence verified before persistence | `question.generate` | live | — | UI-M4 |
| Rejection + insufficient-evidence reporting | `IMPLEMENTED` | `/generate` | `GenerationJobRejection` | live payload | Refusals shown, not hidden | `question.generate` | live | — | UI-M4 |
| Three-zone layout (Context / Drafts / Evidence) | `PARTIALLY_IMPLEMENTED` | `/generate` | — | All three zones' **data** exists; the layout does not | n/a | n/a | live | Presentation only | UI-M4 |
| KPI: Quizzes Generated, Questions Created | `REQUIRES_BACKEND_EXTENSION` (trivial) | `/generate` | `GenerationJob`, `DraftQuestion` | rows exist, no counts endpoint | n/a | `question.read` | live | Count aggregates | UI-M4 |
| KPI: Avg. Generation Time | `REQUIRES_BACKEND_EXTENSION` | `/generate` | `GenerationJob` timestamps | rows exist | n/a | `question.read` | live | Aggregate | UI-M4 |
| KPI: User Satisfaction 4.7/5 | `REQUIRES_BACKEND_EXTENSION` | — | — | **No rating mechanism anywhere** | n/a | n/a | none | Rating model + UI + moderation | UI-M10 |
| Quiz type: Multiple Select / True-False / Short Answer | `PLANNED` | — | `QuestionType` enum | Enum has them; **only `MULTIPLE_CHOICE_4` is implemented end to end** and the learner DTO validates 4 options | Scoring and answer-key protection are per-type | `question.generate` | — | Generator, scorer, learner DTO, and gates per type | Post-Phase-8 |
| Difficulty Level (Easy/Medium/Hard) | `REQUIRES_BACKEND_EXTENSION` | — | — | No difficulty field on `DraftQuestion` | n/a | n/a | none | Schema + generation + selection semantics. §15: must not be required | UI-M10 |
| "Additional Instructions" free-text prompt | `DISABLED_IN_CURRENT_RELEASE` | — | — | Generation takes a scope + reason code, not a prompt | **Prompt-injection surface**; also an ungoverned change to generation inputs | `question.generate` | — | Prompt governance, versioning, injection defence | Post-Phase-8 |
| **Publish button on this page** | `DISABLED_IN_CURRENT_RELEASE` | — | — | Publishing requires prior approval by a different person | Would defeat human approval and separation of duties | `question.publish` | — | **None — forbidden by §15** | never |
| Export tab | `REQUIRES_BACKEND_EXTENSION` | — | — | no export exists | Exports need scoping + audit (§20) | new policy | — | Export service | UI-M10 |

## A5. Review Queue — `review-queue.png`

| Feature | Status | Route | Domain model | Backend today | Security | Authorization | Data source | Required extension | Milestone |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Queue table: question, source, topic, type, status | `IMPLEMENTED` | `/review` | `DraftQuestion` | `GET /questions/review?queue=` (5 views) | Authoring surface may show the proposed answer | `question.read` | live | — | UI-M5 |
| Evidence status + duplicate-risk columns | `IMPLEMENTED` | `/review` | `evidence*`, `maxSimilarityScore` | live payload | Duplicate block surfaced before work is wasted | `question.read` | live | — | UI-M5 |
| Confidence ordering (lowest first) | `IMPLEMENTED` | `/review` | `confidenceScore` | API orders it | n/a | `question.read` | live | — | UI-M5 |
| Detail tabs: Question / Evidence / Source / Governance / Review History / Version History | `IMPLEMENTED` (data), `PARTIALLY_IMPLEMENTED` (as tabs) | `/review/[questionId]` | `DraftQuestion`, `QuestionReview`, `DraftQuestionVersion` | `GET /questions/:id`, `:id/versions` | Evidence verbatim with offsets | `question.read` | live | Presentation only | UI-M5 |
| Claim / Submit / Request changes / Reject | `IMPLEMENTED` | `/review/[questionId]` | `QuestionStatus` state machine | 4 transition endpoints | Comment mandatory where the workflow says so | `question.edit`, `.submit`, `.review` | live | — | UI-M5 |
| Edit with evidence revalidation | `IMPLEMENTED` | `/review/[questionId]` | `DraftQuestionVersion` | `PATCH /questions/:id` | Edit creates a version and re-verifies | `question.edit` | live | — | UI-M5 |
| Duplicate disposition | `IMPLEMENTED` | `/review/[questionId]` | `duplicateDisposition` | `POST :id/duplicate-disposition` | Blocks approval until dispositioned | `question.review` | live | — | UI-M5 |
| Priority (High/Medium/Low) | `REQUIRES_BACKEND_EXTENSION` | — | — | no priority field | n/a | n/a | none | Schema + who sets it + what it changes | UI-M10 |
| Assigned To | `PARTIALLY_IMPLEMENTED` | — | — | `claim` is a status transition, not an assignment column | Assignment implies personal workload data | `question.edit` | none | Assignee field + reassignment rules | UI-M10 |
| Overdue tab, Avg. Review Time, Completion Rate | `REQUIRES_BACKEND_EXTENSION` | — | — | no due dates, no SLA | Review-time metrics are staff performance data | Report policy | `question_review` timestamps | SLA model + aggregates + privacy review | UI-M10 |
| Pending My Review count | `PARTIALLY_IMPLEMENTED` | `/review` | — | filterable once an assignee exists | Own-workload only | `question.read` | live | Depends on assignment | UI-M10 |

## A6. Approvals — `approvals.png`

> The mockup approves **documents**. The platform approves **questions**, and the mockup omits the
> Approval Gates and Evidence tabs the specification requires. Plan §6.2.

| Feature | Status | Route | Domain model | Backend today | Security | Authorization | Data source | Required extension | Milestone |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Approval queue (pending / approved / rejected) | `IMPLEMENTED` | `/review?queue=approval` → new `/approvals` | `DraftQuestion` | `GET /questions/review?queue=approval` | — | `question.read` | live | New route only | UI-M6 |
| **Thirteen server-evaluated approval gates** | `IMPLEMENTED` | `/review/[questionId]` | `GateResult` | `GET /questions/:id/gates` | Advisory in UI; server re-evaluates at the transition | `question.read` | live | — | UI-M6 |
| Per-gate name, reason, remediation, blocking flag | `IMPLEMENTED` | as above | `GateResult.detail`, `.field` | live payload | Refusals must be specific, never generic | `question.read` | live | — | UI-M6 |
| Approve / Reject / Request changes | `IMPLEMENTED` | `/review/[questionId]` | `QuestionApproval` | 3 endpoints, audited | **Separation of duties enforced server-side** (gate 13) | `question.approve`, `.review` | live | — | UI-M6 |
| Approval records with version and actor | `IMPLEMENTED` | `/review/[questionId]` | `QuestionApproval` | in the detail payload | An approval that predates the current version does not carry forward | `question.read` | live | — | UI-M6 |
| Comments thread | `IMPLEMENTED` | `/review/[questionId]` | `QuestionReview` | `POST :id/reviews` | — | `question.review` | live | — | UI-M6 |
| **Document / content approval** | `REQUIRES_BACKEND_EXTENSION` | — | — | **Not a workflow that exists.** Documents are synchronized, not approved | Would be a new governance surface | new policy | none | Whole workflow: model, states, gates, audit | not scheduled |
| KPI: Approved This Month, Avg. Approval Time, Compliance Rate | `REQUIRES_BACKEND_EXTENSION` | — | `QuestionApproval.decidedAt` | rows exist, no aggregates | Approver throughput is staff performance data | Report policy | `question_approval` | Aggregates + privacy review | UI-M10 |
| KPI: Active Approvers | `REQUIRES_BACKEND_EXTENSION` (trivial) | — | `QuestionApproval.approverUserId` | rows exist | Names of approvers | `question.read` | live | Distinct-count aggregate | UI-M10 |

## A7. Question Bank — `question-bank.png`

| Feature | Status | Route | Domain model | Backend today | Security | Authorization | Data source | Required extension | Milestone |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Inventory with bank ID, version, status, published date | `IMPLEMENTED` | inside `/publish` → new `/question-bank` | `PublishedQuestionReference` | `GET /authoring/question-bank` | Labelled **local projection**, reconciled separately (§8) | `question.read` | live | New route only | UI-M7 |
| Tabs: All / Published / Drafts / Archived | `IMPLEMENTED` | `/review?queue=` | `QuestionStatus` | 5 queue views exist | — | `question.read` | live | — | UI-M7 |
| Full provenance (source, hash, version, evidence, actors, dates) | `IMPLEMENTED` | `/review/[questionId]` | `DraftQuestion` lineage fields | detail payload | Lineage is immutable after insert (I15) | `question.read` | live | — | UI-M7 |
| Provenance timeline Generated → … → Used | `PARTIALLY_IMPLEMENTED` | `/question-bank` | as above | Four stages knowable; "Used in Assessments" is not | Unknown stages must render neutral, not complete | `question.read` | live | Usage join (below) | UI-M7 |
| Retire (never delete) | `IMPLEMENTED` | `/publish` | `PublishedQuestionReference.retiredAt` | `POST :id/retire`, 10-char reason enforced by DB CHECK | **G7: the bank adapter has no delete method at all** | `question.retire` | live | — | UI-M7 |
| Create New Version | `PARTIALLY_IMPLEMENTED` | — | `DraftQuestionVersion` | Versioning exists for drafts; no "new version of a published question" flow | §18: never edit a published version in place | `question.edit` | live | Explicit re-version + re-approval path | UI-M7 |
| Usage Count | `REQUIRES_BACKEND_EXTENSION` | — | `AssessmentEligibilitySnapshot.poolMembers` | Data is in the snapshot JSON; nothing counts it | n/a | `question.read` | `assessment_eligibility_snapshot` | Usage read model | UI-M7 |
| Avg. Rating 4.6/5 | `REQUIRES_BACKEND_EXTENSION` | — | — | no rating mechanism | n/a | n/a | none | Rating model | UI-M10 |
| Difficulty column | `REQUIRES_BACKEND_EXTENSION` | — | — | as A4 | n/a | n/a | none | as A4 | UI-M10 |
| Duplicate / Use in Quiz actions | `REQUIRES_BACKEND_EXTENSION` | — | — | neither exists | "Use in Quiz" would write an assessment pool | `assessment.manage` | — | Assessment builder (UI-M8) | UI-M8 |
| Add Question (manual authoring) | `REQUIRES_BACKEND_EXTENSION` | — | `DraftQuestion` | **Every question originates from a generation job today** | A manual question has no evidence lineage — gates 1–3 would need a defined answer | `question.edit` | — | Manual-authoring workflow + evidence policy | not scheduled |

## A8. Assessments (authoring) — `assessments.png`

| Feature | Status | Route | Domain model | Backend today | Security | Authorization | Data source | Required extension | Milestone |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Assessment list with version + status | `IMPLEMENTED` | inside `/publish` → new `/assessments` | `Assessment`, `AssessmentVersion` | `GET /authoring/assessments` | — | `assessment.read` | live | New route only | UI-M8 |
| Pinned question pool size | `IMPLEMENTED` | `/publish` | `AssessmentEligibilitySnapshot` | in the list payload | Publication pins IDs **and versions** | `assessment.read` | live | — | UI-M8 |
| Create → submit → approve → publish | `IMPLEMENTED` | `/publish` | `AssessmentVersion.status` | 4 endpoints | Each transition audited | `assessment.manage`, `.publish` | live | — | UI-M8 |
| Published vs draft visual distinction | `PARTIALLY_IMPLEMENTED` | `/publish` | `status` | data exists | §19 requires the distinction to be visible | `assessment.read` | live | Presentation only | UI-M8 |
| Full builder (topic distribution, fixed sets, attempt policy, availability) | `PARTIALLY_IMPLEMENTED` | `/publish` | `AssessmentVersion` fields exist (`attemptLimit`, `availabilityStart/End`, `selectionStrategy`) | The **create endpoint accepts** several of these; the UI exposes only name/domain/topic/count/pass/time | Availability and attempt policy are eligibility controls | `assessment.manage` | live | UI exposure + validation, not new backend | UI-M8 |
| Participants, Avg. Score, Pass Rate per assessment | `REQUIRES_BACKEND_EXTENSION` | — | `AssessmentResult` | rows exist; no per-assessment aggregate | Aggregated learner performance | Report policy + min-group-size | `assessment_result` | Aggregate endpoint + privacy rules | UI-M10 |
| Performance trend, Top Performing Domains | `REQUIRES_BACKEND_EXTENSION` | — | as above | — | as above | Report policy | `assessment_result` | Phase 10 read models | UI-M10 |
| Due date / Scheduled status | `PARTIALLY_IMPLEMENTED` | — | `availabilityStart/End` | fields exist; no scheduler | Availability gates eligibility server-side | `assessment.manage` | live | Scheduler + status derivation | UI-M8 |
| Type: Knowledge Check / Certification | `REQUIRES_BACKEND_EXTENSION` | — | — | no type field | Certification implies certificate issuance | `assessment.manage` | none | Schema + certificate coupling | LIVE-FULL-M5 |
| Assign to Users | `REQUIRES_BACKEND_EXTENSION` | — | — | **no assignment model** | Assignment drives learner obligations | new policy | none | Assignment model + notification | LIVE-FULL-M2 |

## A9. Reports — `reports.png`

Every panel on this page is `REQUIRES_BACKEND_EXTENSION`. `report_definition`, `report_run`,
`report_export`, `report_schedule` exist and are **empty**; `@knowzy/reporting` is a placeholder.
Reporting is roadmap Phase 10.

| Feature | Status | Security / Authorization | Required extension | Milestone |
| --- | --- | --- | --- | --- |
| Total Knowledge Articles / Assessments / Learners, Avg. Score | `REQUIRES_BACKEND_EXTENSION` | Aggregates of learner data; report policy | Phase 10 read models | UI-M10 |
| Assessment performance trend, Question usage | `REQUIRES_BACKEND_EXTENSION` | as above | Time-series aggregates | UI-M10 |
| Knowledge Coverage by Domain, Content Health | `REQUIRES_BACKEND_EXTENSION` | Domain-scoped | Coverage read model | UI-M10 |
| Top Knowledge Gaps, Knowledge Risk Index | `REQUIRES_BACKEND_EXTENSION` | Org-level gap data; **min-group-size suppression required** | Gap read model + risk definition | UI-M10 |
| **Learner Performance by Role** | `REQUIRES_BACKEND_EXTENSION` | **Highest privacy risk in the product** — per-role learner performance | Team/role scoping, suppression, audit on view | UI-M10 |
| Export to PDF / Excel / PowerPoint | `REQUIRES_BACKEND_EXTENSION` | Exports need scoping, CSV-injection guard, audit (§20 / G-EXPORT) | Export service | UI-M10 |
| Scheduled reports | `REQUIRES_BACKEND_EXTENSION` | Delivery to inboxes is data egress | `report_schedule` + job runner | UI-M10 |

**Plan:** UI-M10 ships this page as a shell with every panel labelled *Planned — Phase 10*. No
numbers, no charts with fabricated series.

## A10. Settings → Administration — `settings.png`

| Feature | Status | Route | Domain model | Backend today | Security | Authorization | Data source | Required extension | Milestone |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| User list (name, email, department, role, status) | `PARTIALLY_IMPLEMENTED` | — | `User`, `UserRole` | 13 seeded users; **no user-list endpoint** | Email + department are personal data | new `user.read` policy | `user` | Read endpoint with scoping | UI-M10 |
| Last Login column | `REQUIRES_BACKEND_EXTENSION` | — | — | not tracked | Login telemetry | — | none | Field + writer | UI-M10 |
| Role-Based Access Control viewer / permission matrix | `PLANNED` | — | `Role`, `Permission`, `RolePermission` | **The catalogue is real and in code** (`packages/authorization`) — 26 policies | Matrix must reflect actual server capability, never a hand-written copy | `role.read` | code + `role_permission` | Read endpoint projecting the real policy table | UI-M10 |
| Add / Edit / Deactivate user, Manage Roles | `REQUIRES_BACKEND_EXTENSION` | — | — | no write endpoints | **Privilege escalation surface** — needs authz, confirmation, audit (§22) | `user.manage` (new) | — | Admin write API + audit actions | UI-M10 |
| Pending Invitations, Send Reminder | `REQUIRES_BACKEND_EXTENSION` | — | — | no invitation model | Email egress | — | none | Invitation model + mail integration | not scheduled |
| Knowledge Source Integrations tab | `REQUIRES_BACKEND_EXTENSION` | — | as A3 | — | Controls what AI may read | `source.manage` | — | as A3 | Phase 7 |
| Knowledge Domains tab | `PARTIALLY_IMPLEMENTED` | — | `Domain`, `Topic` | `GET /authoring/taxonomy` reads them; no write | Domain codes appear in every published question ID — immutable once used | `taxonomy.read`, `taxonomy.manage` (new) | live | Write endpoints with immutability rules | UI-M10 |
| Website/branding, Notification, Audit configuration | `REQUIRES_BACKEND_EXTENSION` | — | `ApplicationConfiguration`, `FeatureFlag` | Config is env + DB driven, no admin write surface | Config changes are audited (`configuration_change` exists) | new policy | live | Admin config API + flag ceilings | UI-M10 |
| Audit Logs tab | `PLANNED` | — | `AuditEvent` | Partitioned append-only store exists and is populated | Detail is allow-listed; actor/entity/correlation are safe | `audit.read` | `audit_event` | Search endpoint with redaction | UI-M10 |

---

# PART B — Live Learning Portal

## B1. Global learner shell (all 8 learner mockups)

| Feature | Status | Route | Domain model | Backend today | Security | Authorization | Data source | Required extension | Milestone |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Learner header, brand, learner name + role | `IMPLEMENTED` (as demo identity) | all | `User` | stub issuer, server-side | Labelled *Local Development Identity* (§5.1) | `learning.access` | live | Entra for non-local | UI-M1 |
| Learner nav, 8 destinations | `PARTIALLY_IMPLEMENTED` | 4 routes exist of 8 | — | Home + assessments exist; 6 destinations do not | §5.2: **do not create dead links**; hide unreleased | policy-mirrored, server-enforced | — | 4 new routes across LIVE-FULL milestones | UI-M1 |
| Global search (`Search courses, assessments, topics…`) | `REQUIRES_BACKEND_EXTENSION` | — | — | no learner search endpoint | §5.3: do not claim knowledge search without access-trimmed retrieval | new policy | — | Catalog + search API | LIVE-FULL-M3 |
| Notifications (3) | `DISABLED_IN_CURRENT_RELEASE` | — | `Notification` | 0 rows, no writer | Must not leak others' activity | learner-own | `notification` | Producer + read API | LIVE-FULL-M2 |
| KNOWZY Copilot ("Ask. Learn. Grow.") | `DISABLED_IN_CURRENT_RELEASE` | — | — | none | §17: **during an active quiz, restrict to navigation/technical help**; never hints, never answers | own policy | — | Copilot service + integrity restrictions | LIVE-FULL-M7 |

## B2. Learner Home — `learner-home-page.png`

| Feature | Status | Route | Domain model | Backend today | Security | Authorization | Data source | Required extension | Milestone |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Hero "Welcome back, <name>" | `IMPLEMENTED` | `/` | `User.displayName` | resolved server-side | Own name only | `learning.access` | live | — | UI-M9 |
| KPI: Assessments Completed | `IMPLEMENTED` (derive) | `/` | `AssessmentResult` | `attemptsUsed` per assessment in the eligibility list | Own results only | `learning.assessment.list` | live | A learner-scoped totals endpoint would be cleaner | UI-M9 |
| KPI: Learning Progress 84% | `REQUIRES_BACKEND_EXTENSION` | — | — | **No course model → no such percentage** | n/a | n/a | none | Course + enrollment + progress models | LIVE-FULL-M2 |
| KPI: Badges Earned 8 | `PLANNED` | — | `BadgeDefinition` (10 seeded), `BadgeAward` | **0 awards, nothing writes them** | Own badges only | learner-own | `badge_award` | Deterministic award engine (Phase 9) | LIVE-FULL-M5 |
| KPI: Knowledge Level "Advanced" | `PARTIALLY_IMPLEMENTED` | — | `ProficiencyBand` | Bands exist **per result**; no learner-level rollup | Own level only | learner-own | `assessment_result` | Define the rollup rule, then derive | LIVE-UI-M2 |
| Continue Learning cards (courses, % complete, duration, modules) | `REQUIRES_BACKEND_EXTENSION` | — | — | no course/module/progress models | §7.2: **do not reinterpret assessments as courses** | — | none | Full learning model | LIVE-FULL-M2 |
| In-progress quiz session / Resume | `IMPLEMENTED` | `/` | `QuizSession` | `inProgressSession { sessionId, answeredOf }` | §6.5: **never `NaN`**, never a stale session as resumable | `learning.session.own` | live | — | UI-M9 |
| Upcoming Assessments with due dates | `PARTIALLY_IMPLEMENTED` | — | `AssessmentVersion.availabilityStart/End` | availability exists; **no assignment or due date** | Due dates imply obligation | — | live (availability only) | Assignment model for true "due" | LIVE-FULL-M2 |
| Knowledge Gaps panel (per topic %) | `IMPLEMENTED` | `/results/[resultId]` today | `TopicResult` | per-result gaps with `gapState` | Own gaps only; §22 no comparisons | `learning.result.own` | live | Cross-result rollup for the home card | LIVE-UI-M2 |
| Recommended for You | `PLANNED` | — | `KnowledgeRecommendation` | **Model exists with approved-explanation + citation fields; nothing writes it**, 0 rows | §12.4: recommendations must say *why*; never fabricated | learner-own | `knowledge_recommendation` | Refresher/recommendation engine (Phase 9) | LIVE-FULL-M3 |
| Your Learning Journey (Learn → Practice → Assess → Grow) | `REQUIRES_BACKEND_EXTENSION` | — | — | no journey model | n/a | n/a | none | Journey definition + progress | LIVE-FULL-M2 |
| My Badges strip | `PLANNED` | — | as badges above | — | Own badges | learner-own | `badge_award` | Award engine | LIVE-FULL-M5 |
| "Explore Learning Paths" | `REQUIRES_BACKEND_EXTENSION` | — | — | no learning-path model | n/a | — | none | Learning-path model | LIVE-FULL-M2 |

## B3. Assessments (learner) — `assessments.png`

| Feature | Status | Route | Domain model | Backend today | Security | Authorization | Data source | Required extension | Milestone |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Eligible assessment list | `IMPLEMENTED` | `/` | `Assessment`, `AssessmentVersion` | `GET /learning/assessments` — published versions only | Only ACTIVE + PUBLISHED are visible | `learning.assessment.list` | live | — | UI-M9 |
| Name, domain, question count, pass mark, attempts | `IMPLEMENTED` | `/`, `/assessments/[id]` | as above | list payload | — | as above | live | — | UI-M9 |
| Start / Continue action | `IMPLEMENTED` | `/assessments/[id]` | `QuizSession` | `POST /learning/sessions` — resumes rather than duplicating | Idempotency key prevents a second attempt by accident | `learning.session.create` | live | — | UI-M9 |
| Precise refusal reason (attempt limit, closed, not yet open) | `IMPLEMENTED` | `/`, `/assessments/[id]` | — | `blockedReason` per card | §8.6: state the specific reason, never a dead button | as above | live | — | UI-M9 |
| Estimated duration / time limit | `PARTIALLY_IMPLEMENTED` | `/assessments/[id]` | `timeLimitMinutes` | field exists, often null | §8.4: show duration **only** when configured or transparently calculated | — | live | Calculation rule if wanted | UI-M9 |
| KPI: Total / Completed / Pending / Avg. Score / Pass Rate | `PARTIALLY_IMPLEMENTED` | — | `AssessmentResult` | Completed and attempts are derivable per assessment; avg score and pass rate are not aggregated | Own data only | learner-own | `assessment_result` | Learner-scoped aggregate endpoint | LIVE-UI-M2 |
| Tab "Assigned to Me" | `REQUIRES_BACKEND_EXTENSION` | — | — | no assignment model | §8.2: do not mix availability with assignment | — | none | Assignment model | LIVE-FULL-M2 |
| Recent Results panel | `IMPLEMENTED` (data) | `/results/[resultId]` | `AssessmentResult` | per-result read exists; **no learner result history endpoint** | Own results only | `learning.result.own` | live | History list endpoint | LIVE-UI-M2 |
| Your Progress donut (completed / in progress / not started) | `PARTIALLY_IMPLEMENTED` | — | as above | derivable from the eligibility list + results | Own data | learner-own | live | Define denominators (§15.4) | LIVE-UI-M2 |
| Recommended Assessments | `PLANNED` | — | `KnowledgeRecommendation` | nothing writes it | Must be explainable (§12.4) | learner-own | — | Recommendation engine | LIVE-FULL-M3 |
| Course-style thumbnails per assessment | `REQUIRES_BACKEND_EXTENSION` | — | — | no image field on `Assessment` | Imagery must be approved assets | — | none | Asset field + curation | LIVE-FULL-M1 |

## B4. Quiz and Results (no dedicated mockup; specification §10–§11)

| Feature | Status | Route | Domain model | Backend today | Security | Authorization | Data source | Required extension | Milestone |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| One question at a time, Question X of Y, progress | `IMPLEMENTED` | `/sessions/[sessionId]` | `QuizSessionQuestion` | `GET :id/current` | **Learner projection has no answer-key field for any type (K2)**, asserted at runtime (K3) | `learning.session.own` | live | — | UI-M9 |
| Answer cards A–D, keyboard accessible | `IMPLEMENTED` | as above | — | — | 44 px targets, focus visible | as above | live | Larger targets per §19 | UI-M9 |
| Per-answer persistence + double-submit prevention | `IMPLEMENTED` | as above | `QuizResponse` | `POST :id/answers` with required idempotency key | A replayed key returns the original write | as above | live | — | UI-M9 |
| Refresh / resume, including fully-answered sessions | `IMPLEMENTED` | as above | `QuizSession.currentIndex` | fixed 2026-09-21 (clamped cursor) | §6.5 / §21: stale session handled safely, never `NaN` | as above | live | — | UI-M9 |
| Exit / abandon warning | `REQUIRES_BACKEND_EXTENSION` (UI-only) | — | — | no warning today | Abandon must not silently score | as above | live | Presentation + confirm dialog | UI-M9 |
| Expired-session handling | `IMPLEMENTED` | as above | `expiresAt` | server-side deadline; answers refused after it | Client clock cannot extend an attempt | as above | live | — | UI-M9 |
| Deterministic result: score, band, pass | `IMPLEMENTED` | `/results/[resultId]` | `AssessmentResult` | `POST :id/complete`, `GET /results/:id` | Round half away from zero on the **stored** value | `learning.result.own` | live | — | UI-M9 |
| Topic accuracy, gap state, applied thresholds | `IMPLEMENTED` | as above | `TopicResult` | in the result payload | Thresholds copied at scoring time | as above | live | — | UI-M9 |
| Approved explanations after completion | `PARTIALLY_IMPLEMENTED` | — | `DraftQuestion.explanation` | Explanations exist but are **not sent to learners at all** | §11: follow the configured review policy — not "reveal because complete" | as above | live | A review-policy flag + a projection that honours it | LIVE-UI-M2 |
| Recommended refreshers on the result | `PLANNED` | — | `KnowledgeRecommendation` | nothing writes it | Grounded, with approved explanations only | learner-own | — | Refresher engine (Phase 9) | LIVE-FULL-M3 |
| Assessment history / attempt list | `REQUIRES_BACKEND_EXTENSION` | — | `AssessmentResult` | rows exist; no history endpoint | Own history only | `learning.result.own` | live | History list endpoint | LIVE-UI-M2 |

## B5. My Learnings — `my-learnings.png`

> **Preview since 2026-09-27 (LIVE-PREVIEW-M1).** This page is reachable as a labelled preview. **No status in this table changed**; see [Preview pages](#preview-pages-live-preview-m1) at the end.

The entire page depends on models that do not exist. Specification §7.2 lists eleven of them;
**none** is in the schema.

| Feature | Status | Required models / extension | Security & authorization | Milestone |
| --- | --- | --- | --- | --- |
| In Progress / Completed / Recommended / Bookmarks tabs | `REQUIRES_BACKEND_EXTENSION` | `LearningItem`, `Enrollment`, `LearnerProgress`, `Bookmark` | Learner-own; catalog items must be permission-trimmed | LIVE-FULL-M2 |
| Course cards with % progress, duration, modules | `REQUIRES_BACKEND_EXTENSION` | `Course`, `Module`, `LearnerProgress` | as above | LIVE-FULL-M2 |
| KPI: In Progress / Completed / Learning Hours | `REQUIRES_BACKEND_EXTENSION` | `CompletionRecord`, time tracking | Learner-own; §15.4 metric integrity | LIVE-FULL-M2 |
| KPI: Knowledge Gaps 3 | `PARTIALLY_IMPLEMENTED` | Cross-result gap rollup over `TopicResult` | Learner-own | LIVE-UI-M2 |
| Learning Calendar with Join links | `REQUIRES_BACKEND_EXTENSION` | `LearningCalendarEvent` + an approved meeting integration | §7.5: **do not fabricate sessions, office hours, or join links** | LIVE-FULL-M2 |
| Recommended for You rail | `PLANNED` | Recommendation engine | Explainable (§12.4) | LIVE-FULL-M3 |

## B6. Discover — `discover.png`

> **Preview since 2026-09-27 (LIVE-PREVIEW-M1).** This page is reachable as a labelled preview. **No status in this table changed**; see [Preview pages](#preview-pages-live-preview-m1) at the end.

| Feature | Status | Required extension | Security & authorization | Milestone |
| --- | --- | --- | --- | --- |
| Content-type facets with item counts (124 items) | `REQUIRES_BACKEND_EXTENSION` | Unified catalog model + counts | Counts must reflect **access-trimmed** results, or they leak the existence of inaccessible content | LIVE-FULL-M3 |
| Search + Type/Level/Domain/Duration filters | `REQUIRES_BACKEND_EXTENSION` | Catalog search API, taxonomies for level and duration | Access trimming inside the query, not after it | LIVE-FULL-M3 |
| Recommended for You (Featured / Popular / Trending / New) | `REQUIRES_BACKEND_EXTENSION` | Recommendation engine + usage analytics | §12.4 explainability; "Popular"/"Trending" need real usage data or must not appear | LIVE-FULL-M3 |
| Trending Now with learner counts (1.2K, 980…) | `REQUIRES_BACKEND_EXTENSION` | Usage analytics | Aggregate learner behaviour — privacy review; §13.3 permits "Most Popular" **only with valid analytics** | LIVE-FULL-M3 |
| Knowledge Gaps rail | `PARTIALLY_IMPLEMENTED` | Gap rollup (as B5) | Learner-own | LIVE-UI-M2 |
| "Let KNOWZY Copilot suggest a learning path" | `DISABLED_IN_CURRENT_RELEASE` | Copilot + learning paths | §17 restrictions | LIVE-FULL-M7 |

## B7. Knowledge Library — `knowledge-library.png`

> **Preview since 2026-09-27 (LIVE-PREVIEW-M1).** This page is reachable as a labelled preview. **No status in this table changed**; see [Preview pages](#preview-pages-live-preview-m1) at the end.

| Feature | Status | Required extension | Security & authorization | Milestone |
| --- | --- | --- | --- | --- |
| Source tiles: Leonardo, SharePoint, Confluence, Microsoft Learn, Udemy, LinkedIn Learning | `REQUIRES_BACKEND_EXTENSION` | One approved integration **per source**: auth, metadata normalization, access trimming, deep-link policy, health, licensing | §13.2: **do not imply a source is connected until configured and verified.** Only a MOCK source exists today | LIVE-FULL-M1 |
| Item counts per source (248, 186, 95, 312…) | `REQUIRES_BACKEND_EXTENSION` | Catalog aggregation | Counts must be access-trimmed (§13.4) | LIVE-FULL-M1 |
| Grid / List, Bookmarks, Recommended, Recently Added, Most Popular tabs | `REQUIRES_BACKEND_EXTENSION` | Catalog + bookmark + usage analytics | "Most Popular" requires real analytics | LIVE-FULL-M4 |
| Resource cards with source attribution and duration | `REQUIRES_BACKEND_EXTENSION` | Normalized catalog metadata | §13.4: **must not expose inaccessible titles, thumbnails, descriptions, or links** | LIVE-FULL-M4 |
| Suggest a Resource | `REQUIRES_BACKEND_EXTENSION` | Submission + moderation workflow | Learner-submitted content needs review before exposure | LIVE-FULL-M4 |

## B8. Badges and Certifications — `badges.png`

| Feature | Status | Route | Domain model | Backend today | Security | Authorization | Data source | Required extension | Milestone |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Earned badges grid | `PLANNED` | — | `BadgeDefinition`, `BadgeAward` | **10 definitions seeded** (`FIRST_ASSESSMENT`, `PERFECT_SCORE`, `DOMAIN_EXPERT`, `IMPROVEMENT`, `NO_WEAK_TOPICS`, `BREADTH`, `CONSISTENCY`, `FIRST_ATTEMPT_PASS`, `DOMAIN_PROFICIENT`, `REFRESHER_COMPLETION`); **0 awards, no award engine** | §14.2: awarded by deterministic backend rules, never by Claude | learner-own | `badge_award` | Award evaluator on `RESULT_SCORED` / `PERIODIC` triggers | LIVE-FULL-M5 |
| Locked badges + progress toward next | `PLANNED` | — | `BadgeDefinition.criteria` | criteria are seeded as JSON | Progress must be computed, not estimated | learner-own | `badge_definition` | Progress evaluator | LIVE-FULL-M5 |
| Certifications with issue/expiry and View Certificate | `REQUIRES_BACKEND_EXTENSION` | — | `Certificate`, `CertificateRule` | **1 rule seeded, 0 certificates, nothing writes them**; `@knowzy/certificate-generator` is a placeholder | §14.4: server-side generation, unique ID, verification URL, revocation, versioned assessment reference | learner-own + a public verification endpoint | `certificate` | Generator, verification, revocation, expiry | LIVE-FULL-M5 |
| Add External Certification | `REQUIRES_BACKEND_EXTENSION` | — | — | no model | Self-asserted credentials need a verification state, never shown as verified | learner-own | none | `ExternalCertification` + verification workflow | LIVE-FULL-M5 |
| Points Earned 1,250 / Achievement Level "Silver Learner" | `REQUIRES_BACKEND_EXTENSION` | — | — | no points ledger, no level model | §14.3: **do not display invented points, ranks, achievement levels, or streaks**. §14.2 permits `PointsLedger` and `AchievementLevel` **only if formally approved** | learner-own | none | Approval of the scheme, then a ledger | not scheduled |
| Learning Streak 24 days | `REQUIRES_BACKEND_EXTENSION` | — | — | no activity-streak model | as above | learner-own | none | Activity model | not scheduled |
| "Your Impact" (courses, assessments, points, badges) | `PARTIALLY_IMPLEMENTED` | — | mixed | Assessments taken is derivable; courses/points are not | §15.4: do not merge unlike metrics | learner-own | mixed | Per-metric definition | LIVE-FULL-M5 |

## B9. My Progress — `my-progress.png`

| Feature | Status | Required extension | Security & authorization | Milestone |
| --- | --- | --- | --- | --- |
| Assessments Completed, Average Score, attempt history | `PARTIALLY_IMPLEMENTED` | Learner-scoped history + aggregate endpoint over `AssessmentResult` | Own data only (§22) | LIVE-UI-M2 |
| Topic performance and knowledge-gap trends | `PARTIALLY_IMPLEMENTED` | Cross-result rollup over `TopicResult` | Own data only | LIVE-UI-M2 |
| Proficiency level over time | `PARTIALLY_IMPLEMENTED` | Rollup rule + time series | Own data only | LIVE-UI-M2 |
| Courses Completed, Learning Hours, Overall Progress 72% | `REQUIRES_BACKEND_EXTENSION` | Course/enrollment/progress models | §15.3 | LIVE-FULL-M2 |
| Learning Journey by domain (x / y courses) | `REQUIRES_BACKEND_EXTENSION` | as above | Own data | LIVE-FULL-M2 |
| Learning Activity chart (hours + courses per month) | `REQUIRES_BACKEND_EXTENSION` | Time tracking | Own data | LIVE-FULL-M2 |
| Learning Streak, Next Milestone (42/50 courses) | `REQUIRES_BACKEND_EXTENSION` | Activity + milestone models | §14.3 | not scheduled |
| Recent Activity (mixed course + assessment + certificate) | `PARTIALLY_IMPLEMENTED` | Assessment events are derivable from results; course and certificate events are not | Own data | LIVE-UI-M2 |
| Upcoming Learning with Continue / Start | `REQUIRES_BACKEND_EXTENSION` | Assignment + course models | Own data | LIVE-FULL-M2 |

## B10. Help and Support — `help-and-support.png`

> **Preview since 2026-09-27 (LIVE-PREVIEW-M1).** This page is reachable as a labelled preview. **No status in this table changed**; see [Preview pages](#preview-pages-live-preview-m1) at the end.

| Feature | Status | Required extension | Security & authorization | Milestone |
| --- | --- | --- | --- | --- |
| Help article search, categories, featured articles, article counts | `REQUIRES_BACKEND_EXTENSION` | An approved help-content source + search + access model (§16.4) | Content must be access-appropriate | LIVE-FULL-M6 |
| Ask KNOWZY Copilot | `DISABLED_IN_CURRENT_RELEASE` | Copilot service | §17 restrictions; during an active quiz, navigation/technical help only | LIVE-FULL-M7 |
| Raise a Support Ticket | `REQUIRES_BACKEND_EXTENSION` | Approved ticketing integration (e.g. ServiceNow) | §16.3: no ticketing without an approved integration | LIVE-FULL-M6 |
| Email Support with a concrete address | `REQUIRES_BACKEND_EXTENSION` | Approved mailbox | §16.3: **do not hardcode real support email addresses.** The mockup shows one — it must not ship as data | LIVE-FULL-M6 |
| Live Chat / Schedule a Call | `REQUIRES_BACKEND_EXTENSION` | Approved chat + enterprise scheduling | as above | LIVE-FULL-M6 |
| Support Hours, "respond within 4 hours" | `REQUIRES_BACKEND_EXTENSION` | — | An **operational commitment**; §16.3 forbids hardcoding it in mock data | LIVE-FULL-M6 |
| System Status "All Systems Operational" | `REQUIRES_BACKEND_EXTENSION` | Health/status service | A fabricated green status is a safety claim about the platform | LIVE-FULL-M6 |

---

## Summary counts

| Status | Authoring | Live | Total |
| --- | --- | --- | --- |
| `IMPLEMENTED` | 27 | 14 | **41** |
| `PARTIALLY_IMPLEMENTED` | 13 | 12 | **25** |
| `PLANNED` | 2 | 5 | **7** |
| `REQUIRES_BACKEND_EXTENSION` | 34 | 33 | **67** |
| `DISABLED_IN_CURRENT_RELEASE` | 4 | 3 | **7** |

**Reading of this:** the validated MVP covers the governed pipeline end to end, and that is what the
41 implemented features are. The 67 extensions are almost entirely **analytics, catalog, and
recognition** — three product areas the roadmap already places in Phases 9 and 10. Phase 8 can make
the existing product look and feel enterprise-grade without touching any of them, provided every
unsupported element ships labelled rather than fabricated.

**The three highest-risk temptations**, all forbidden:

1. Reinterpreting assessments as courses to fill My Learnings (§7.2).
2. Computing "vs last month" deltas from nothing — no KPI history exists anywhere.
3. Publishing from the generation screen because the mockup has the button (§15).

---

## SharePoint Sync Manager (2026-09-23)

A separate application, classified here so one document still answers "what exists". **The
counts above cover the two learning portals only** and are unchanged by this section. Full detail:
[`SHAREPOINT_SYNC_MANAGER_UI_SOURCE_OF_TRUTH.md`](SHAREPOINT_SYNC_MANAGER_UI_SOURCE_OF_TRUTH.md).

| Feature | Classification | Backing |
| --- | --- | --- |
| Operational dashboard on :3002 | `IMPLEMENTED` | `GET /authoring/sync/overview` |
| KPI summary | `IMPLEMENTED` | Counts over a 30-day window. No trend is computable — no KPI history is stored |
| Workflow table and statuses | `IMPLEMENTED` | `KnowledgeSource` + `KnowledgeSourceSync` |
| Sorting, filtering, free-text search | `PARTIALLY_IMPLEMENTED` | The table is real; client-side sort and search are not built |
| Sync Now | `IMPLEMENTED` | `synchronize_knowledge_source` |
| Sync All | `IMPLEMENTED` | `POST /authoring/sync/sync-all`, per-source results, failures isolated, already-running skipped |
| Create / edit / pause / resume | `IMPLEMENTED` | `source.manage`, new in SYNC-M2 |
| Archive with lineage protection | `IMPLEMENTED` | A source with documents, questions, jobs or run history cannot be hard-deleted |
| Scheduling (Manual/Hourly/Daily/Weekly/Monthly/Cron) | `IMPLEMENTED` | pg-boss in `apps/jobs`, SYNC-M3 |
| Next run and timezone | `IMPLEMENTED` | Computed; `WEEKLY`/`MONTHLY` are intervals, not calendar anchors |
| Stuck-run recovery | `IMPLEMENTED` | The reaper. Concurrency protection without it is a permanent lock |
| Destination site / library / folder | `DISABLED_IN_CURRENT_RELEASE` | No destination model; needs Graph write and T-22 |
| Two-way sync · sync deletes · write metadata | `DISABLED_IN_CURRENT_RELEASE` | Same |
| SharePoint Graph source | `REQUIRES_BACKEND_EXTENSION` | Roadmap Phase 7 |
| Deployment to a hosting target | `PLANNED` | Deployable; no approved target exists |

---

## Governance → AI Usage & Budgets (2026-09-24)

The first governance screen with a backend behind it. Full detail:
[`../governance/AI_USAGE_AND_BUDGETS.md`](../governance/AI_USAGE_AND_BUDGETS.md). The counts above
are unchanged by this section.

| Feature | Classification | Backing |
| --- | --- | --- |
| Eight KPIs | `IMPLEMENTED` | Counts over a 30-day window. `Not Yet Recorded` where nothing has been written, never 0 |
| Budget windows with HEALTHY / WARNING / EXHAUSTED | `IMPLEMENTED` | `generation_provider_call` sums against the declared `llm.*` ceilings |
| Provider table with five states and the reason | `IMPLEMENTED` | The registry over `PROVIDER_CATALOGUE`; every declared provider, including the unusable |
| Provider health | `IMPLEMENTED` | Assessed over a 15-minute window, separately from availability. A refusal is not a failure sample |
| Usage timeline by day / week / month | `IMPLEMENTED` | `generation_job` rows grouped in memory |
| Generation history including refusals | `IMPLEMENTED` | With the acting person, the mode, the tokens, the cost and the refusal reason |
| Per-provider token and concurrency limits, set from the page | `IMPLEMENTED` | `platform.configure`; the platform's first configuration write path, audited with previous and new value |
| Cost per provider | `IMPLEMENTED`, and honest | Written only where observable. `Not observable` with the reason otherwise — a per-seat licence, a user-managed run, or no configured price |
| Sorting, filtering, free-text search | `PARTIALLY_IMPLEMENTED` | The tables are real; client-side sort and search are not built |
| Trends, deltas, spend forecast | `DISABLED_IN_CURRENT_RELEASE` | No KPI history is stored, so none is computable. Nothing on the page implies one |
| Per-user or per-team quotas | `PLANNED` | Budgets are per platform and per provider today |
| Any external provider | `REQUIRES_BACKEND_EXTENSION` | OpenAI, Anthropic, Azure OpenAI and Gemini are declared and `UNAVAILABLE`; Copilot is `BLOCKED_BY_CAPABILITY` |

---

## Preview pages (LIVE-PREVIEW-M1)

**2026-09-27.** The product owner asked for every learner destination to be clickable, so a
stakeholder can see the intended finished product. That answers open question 4 of
[ui-modernization-plan.md §20](ui-modernization-plan.md) for four of the six unbuilt destinations:
**My Learnings, Discover, Knowledge Library and Help & Support are shown as previews.** Badges and
My Progress stay unreachable.

**A preview is not a status.** Every feature row in B5, B6, B7 and B10 keeps the status it had. The
sidebar item keeps `REQUIRES_BACKEND_EXTENSION` and gains `preview: true`. A test refuses a preview
item whose status is `IMPLEMENTED` or `PARTIALLY_IMPLEMENTED`, and it was checked by mutation.

**What each preview page promotes to real, and it is only what the existing API already serves:**

| Page | Real, from `GET /learning/assessments` or this release's behaviour | Everything else |
| --- | --- | --- |
| My Learnings | Three counts (available, attempted, in progress) and an assessment history of attempts used, with Resume | Framed examples |
| Discover | The domains of the assessments published to the learner, with counts | Framed examples |
| Knowledge Library | The same domains (permission-trimmed by construction, §13.4) | Framed examples. Every source reads Not connected |
| Help & Support | User guides and FAQ describing this release (user guide §5) | Framed examples. No address, number, hours or status claim |

**The rules a preview keeps, and what enforces each one:**

| Rule | Enforced by |
| --- | --- |
| The page says it is a preview first | `PreviewNotice` (role `note`). e2e `previews.spec.ts` |
| Illustrative content is fenced and tagged | `ExampleRegion`, with a visible tag on every frame. e2e |
| Nothing in a frame is actionable | Buttons are disabled with a reason; filters sit in a disabled `fieldset`; no links. e2e asserts all three, and was checked by mutation |
| No example interpolates a value for an unrecorded concept | Every string is in `apps/live-web/src/copy.ts`, which `no-fabricated-metrics.test.ts` scans |
| A badge design never reads as earned | `KnowzyBadgeArt` has no earned variant; its artwork is greyed and its alt text ends "Not earned." e2e |
| No calendar, session or join link | Absent (§7.5) |
