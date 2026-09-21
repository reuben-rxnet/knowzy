# KNOWZY — UI Modernization Plan (Phase 8)

**Status:** Plan and design-system baseline. No application behaviour changed.
**Created:** 2026-09-21
**Assessed commit:** `bbb9df6`
**Sources of truth, in precedence order:**

1. The repository — what the software actually does
2. [`CLAUDE.md`](../CLAUDE.md) and [`/docs`](../) — architecture
3. [`KNOWZY_UI_SOURCE_OF_TRUTH.md`](KNOWZY_UI_SOURCE_OF_TRUTH.md) — UI specification
4. `design/*.png` — the approved visual baseline

Where the mockups and the specification disagree, the specification wins (§2, §38: *"Do not change
working business behavior merely to match a mockup"*). Where the specification and the repository
disagree about what exists, the repository wins and the gap is recorded in §6 below.

---

## 1. What this phase is, and is not

**Is:** a visual and structural modernization of two working portals — shell, navigation, layout,
component system, states, accessibility, responsive behaviour.

**Is not:** new business features, API contract changes, or domain behaviour changes. The eleven
controls listed in the UI specification §2 (evidence verification, the thirteen gates, separation of
duties, idempotent publishing, snapshots, answer-key protection, audit) are untouched by this phase.
Every screen below keeps calling the same server actions against the same 48 routes.

**This commit contains:** this plan, and a shared design-system baseline in
`packages/shared-ui` that nothing imports yet. No page, action, route, or test behaviour changes.

---

## 2. The existing portals, as they are today

Eleven routes across two Next.js applications, server-rendered, calling the API from the server
process. The browser holds an httpOnly cookie naming a demo identity and never an API address or a
subject header.

### 2.1 Authoring and Administration Portal — `localhost:3000`

| Route | Purpose today | Server data it already has | Actions it already performs |
| --- | --- | --- | --- |
| `/` | Identity picker, workflow list | `publicEnvironmentName()`, the five seeded demo subjects | `switchSubject` |
| `/sources` | Source health, connection test, sync | `GET /authoring/sources` — type, status, statusAt, pathCount, documentCount, usableForGeneration | `testConnection` (5 checks + capabilities), `synchronizeSource` (scanned/added/modified/unchanged/failed/chars/failures) |
| `/sources/[sourceId]` | Container → folder → document → section browser | `containers`, `items?containerId&folderPath&recursive`, `documents/:id/sections` | none (read-only) |
| `/generate` | Three-step generation | `sources`, `items`, `taxonomy` | `runPreflight` (6 checks/document), `recordDecision`, `runGeneration` (accepted, rejections, insufficient sections, tokens) |
| `/review` | Five queue views + document filter | `questions/review?queue=author\|approval\|publish\|published\|all&documentId` | none (navigation) |
| `/review/[questionId]` | The approval surface | `questions/:id` (options, proposed answer, evidence span + offsets + mode + similarity, confidence components, duplicate state, reviews, approvals), `:id/gates` (13 results), `:id/versions` | `claim`, `submit`, `approve`, `requestChanges`, `reject`, `dispositionDuplicate`, `editQuestion` |
| `/publish` | Publish, inventory, assessment creation | `questions/review?queue=publish`, `question-bank` (local projection), `assessments`, `taxonomy` | `publishQuestions` (per-item outcomes, idempotency key), `retireQuestion`, `createAndPublishAssessment` |

### 2.2 Live Learning Portal — `localhost:3001`

| Route | Purpose today | Server data it already has | Actions it already performs |
| --- | --- | --- | --- |
| `/` | Eligible assessments, identity picker | `GET /learning/assessments` — name, domain, questionCount, passPercentage, timeLimit, attemptsUsed/Limit, startable, blockedReason, inProgressSession | `switchLearner` |
| `/assessments/[assessmentId]` | Start/resume, expectations | the same eligibility list, filtered | `startSession` (resumes an open attempt rather than opening a second) |
| `/sessions/[sessionId]` | One question at a time | `sessions/:id/current` — presented index, totals, answeredCount, remainingSeconds, question with no answer key | `answerQuestion` (idempotency key per session+index+option), `completeSession` |
| `/results/[resultId]` | Score, topics, gaps | `results/:id` — stored rounded score, band, per-topic accuracy and gap state, applied thresholds | none |

### 2.3 What the current UI does well, and should not be lost

- Every refusal renders with its code, reason, and — for approvals — the failed gates. §7 of the UI
  specification asks for exactly this, and it already exists.
- The evidence span renders verbatim with its character offsets.
- All thirteen gates render, passing and failing, labelled advisory because the server re-evaluates.
- `isSelectable`, `coverageStatus`, and extraction status are shown rather than hidden.
- The learner projection carries no answer key, asserted at runtime on the API side.

### 2.4 What is visually deficient

No brand identity. No shell beyond a text banner and a link list. One stylesheet per app,
duplicated, hand-written, ~270 lines. No cards, drawers, tabs, KPI surfaces, charts, icons, empty
or loading states. Tables are unstyled and do not scroll. Nothing indicates where a user is in the
workflow. Identity switching looks like a debug affordance rather than a governed demo control.

---

## 3. Technology decision required before Milestone 2

UI specification §32 says to use *"the existing Next.js, React, TypeScript, **Tailwind CSS**,
Server Components, Server Actions"* and *"Lucide or approved Fluent-style icons"* and *"Recharts or
the existing chart library"*.

**None of Tailwind, Lucide, Recharts, or a Fluent icon package is in this repository.** The two web
apps use hand-written CSS. So §32 is not describing a constraint to preserve; it is describing an
addition, and §32 also says not to add a styling framework *without a documented reason*. The
reason therefore has to be documented either way.

| Option | Cost | Consequence |
| --- | --- | --- |
| **A. Design tokens in plain CSS** (this baseline) | None. No new dependency, no build-config change in either app | Tokens are CSS custom properties; components carry semantic class names. Coherent, reviewable, and portable — the tokens map 1:1 onto a Tailwind theme later if wanted |
| **B. Adopt Tailwind now** | Two app build configs, a content-scan config, a PostCSS chain, ~5 new dependencies, and a `postcss` advisory already deferred in the security register (EX-001) | Matches §32 literally; utility classes replace the component CSS; larger diff and more moving parts before any screen improves |
| **C. Adopt Tailwind + Lucide + Recharts now** | As B plus two dependency families | Needed eventually for §29 charts and §32 icons; premature before the shell exists |

**Recommendation: A for the baseline, then C — icons and charts — when a milestone actually needs
them.** Charts (§13, §20) cannot be built without a chart library, so Recharts will be required at
Milestone 6; icons will be required at Milestone 2 for navigation. Adopting them at the point of
need keeps each addition attributable to a screen.

This baseline is deliberately written so that option B remains open: every colour, space, radius,
and font size is a named token in one file.

---

## 4. Mockup → route map

Nine approved mockups exist, all of the Authoring Portal. Filenames in
`docs/ui/ui-modernization.md` do not all match what is on disk; the table uses the real filenames.

| Mockup (`design/`) | Target route | Route status | Fit |
| --- | --- | --- | --- |
| `dashboard.png` | `/` (authoring) | **Exists as an identity picker** | Rebuild as the specified dashboard. Nearly every KPI, chart, and panel on it is unsupported — see §5 |
| `knowledge-sources.png` | `/sources` | Exists | Layout and table transfer directly. KPI row, tabs, source-type donut, and recent-sync panel need data that partly exists (§5) |
| `ai-quiz-qeneration.png` *(filename typo preserved)* | `/generate` | Exists | **Conflicts with the specification and the platform** — see §6.1. The three-zone layout in specification §15 is the target, not this mockup's two-column form |
| `review-queue.png` | `/review` + `/review/[questionId]` | Exists | Master/detail transfers well. Priority, assignment, due dates, and review-time metrics are unsupported (§5) |
| `approvals.png` | *no route today* | **New route `/approvals`** | The mockup approves **documents**; the platform approves **questions**. Retarget to questions, add the Approval Gates and Evidence tabs the specification requires (§6.2) |
| `question-bank.png` | *partially `/publish`* | **New route `/question-bank`** | The inventory table exists inside `/publish`; promote it to its own route with provenance and versions |
| `assessments.png` | *partially `/publish`* | **New route `/assessments`** | Assessment creation is one form on `/publish` today. Participants, scores, pass rates, and trends are unsupported (§5) |
| `reports.png` | *no route* | **New route `/reports`** | Almost entirely unsupported — Phase 10 read models do not exist (§5) |
| `settings.png` | *no route* | **New route `/administration`** | Specification §22 renames Settings to Administration. User/role management is read-only at best today (§5) |
| *(none)* | `/sources/[sourceId]` | Exists | No mockup. Derive from the Knowledge Sources visual language |
| *(none)* | `/publish` | Exists | No mockup. Becomes a publishing workspace once Question Bank and Assessments move out |
| *(none)* | Governance | **New route `/governance`** | Specification §21 requires it; no mockup exists |
| *(none)* | All four learner routes | Exists | **No approved mockup for the Live Learning Portal.** Derive from specification §24–§27 and the shared brand tokens |

### 4.1 Navigation reconciliation

The mockups show nine sidebar items. Specification §9 requires ten.

| # | Specification §9 | In mockups | Route after Phase 8 |
| --- | --- | --- | --- |
| 1 | Dashboard | yes | `/` |
| 2 | Knowledge Sources | yes | `/sources` |
| 3 | AI Quiz Generation | yes | `/generate` |
| 4 | Review Queue | yes | `/review` |
| 5 | Approvals | yes | `/approvals` *(new)* |
| 6 | Question Bank | yes | `/question-bank` *(new)* |
| 7 | Assessments | yes | `/assessments` *(new)* |
| 8 | Reports | yes | `/reports` *(new, mostly disabled)* |
| 9 | Governance | **no** | `/governance` *(new)* |
| 10 | Administration | as "Settings" | `/administration` *(new)* |

---

## 5. Unsupported mockup functionality

Specification §2 is explicit: do not invent it, do not fabricate data, do not add it silently —
label it and document the backend extension required. This is that catalogue.

Legend: **Absent** = no data exists. **Derivable** = the data exists and needs a read model or an
aggregate endpoint. **Partial** = something exists but not what the mockup shows.

### 5.1 Dashboard (`dashboard.png`)

| Element shown | Status | What it would require |
| --- | --- | --- |
| Knowledge Coverage 87% (742 of 850 topics) | **Derivable** | `document_section.coverage_status` exists per section. A coverage aggregate per domain/topic does not. New read model + endpoint |
| Published Questions 12,450 | **Derivable** | Count of `published_question_reference`. Trivial aggregate endpoint |
| Assessment Readiness 92% | **Absent** | No definition of readiness exists in any design document |
| Knowledge Gaps 13% (112 topics need attention) | **Partial** | Gaps exist **per result** (`topic_result.gap_state`). An organisation-level gap index does not |
| Proficiency heatmap by team × level | **Absent** | `user_team` and `team` tables exist; no proficiency-by-team read model. Reporting is Phase 10. Also needs §20 minimum-group-size privacy rules |
| Knowledge coverage donut | **Derivable** | Same as coverage above |
| Assessment success rate trend (6 months) | **Derivable** | `assessment_result` rows carry scores and timestamps; no time-series aggregate |
| Recent activity feed | **Derivable** | `audit_event` is the natural source, partitioned and append-only. Needs a scoped, redacted projection — audit detail is allow-listed |
| Top knowledge sources with percentages | **Derivable** | Document counts per source exist; the percentage split does not |
| Quick actions | **Supported** | Links to existing routes |
| "+6% vs last quarter" deltas on every card | **Absent** | No historical snapshots are stored for any KPI. Deltas cannot be computed at all |
| Copilot entry point | **Absent** | No API. Specification §23: render disabled/preview, never fake a conversation |
| Notification count badge (3) | **Absent** | A `notification` table exists; nothing writes to it |

### 5.2 Knowledge Sources (`knowledge-sources.png`)

| Element | Status | Notes |
| --- | --- | --- |
| Total / Active sources | **Derivable** | Trivial from the existing list |
| Last Sync (Overall) | **Supported** | `knowledge_source_sync` rows exist |
| Total Documents, Unique Topics | **Partial** | Document count exists; "unique topics" as shown is a taxonomy count, not a source metric |
| Tabs: Connected / Disconnected / Pending | **Supported** | `connectionStatus` already distinguishes these |
| Owner column with avatars | **Absent** | No owner field on `knowledge_source` |
| Source-type distribution donut | **Derivable** | Only one source type (MOCK) exists in local data; the chart would show a single segment honestly |
| Recent sync activity panel | **Supported** | From `knowledge_source_sync` |
| Add / edit / archive source | **Absent** | `source.manage` policy exists; **no write endpoint does**. Sources are seeded rows today |
| Eight realistic sources (Confluence, SharePoint, Azure DevOps…) | **Absent** | One mock source exists. These are demo labels and must be presented as such (§4.4) |

### 5.3 AI Quiz Generation (`ai-quiz-qeneration.png`)

| Element | Status | Notes |
| --- | --- | --- |
| Quizzes Generated, Questions Created | **Derivable** | `generation_job` and `draft_question` counts |
| Avg. Generation Time | **Derivable** | Job timestamps exist |
| User Satisfaction 4.7/5 | **Absent** | No rating mechanism anywhere in the platform |
| Quiz type: Multiple Select / True-False / Short Answer | **Absent** | `question_type` enum has them; **only `MULTIPLE_CHOICE_4` is implemented** end to end, and the learner DTO validates four options |
| Difficulty Level (Easy/Medium/Hard) | **Absent** | No difficulty field on `draft_question`. Specification §15: must not be required |
| "Additional Instructions" free-text prompt | **Absent** | Generation takes a scope and a reason code, not a free prompt. Accepting one would be a prompt-injection surface and an ungoverned change to generation inputs |
| **Publish button on this page** | **Forbidden** | Specification §15: *"Do not provide direct publishing from generation."* Publishing requires approval by a different person |
| Export tab | **Absent** | No export exists |
| Preflight and recorded decision | **Missing from the mockup, required by the platform** | See §6.1 |

### 5.4 Review Queue (`review-queue.png`)

| Element | Status | Notes |
| --- | --- | --- |
| Question / Source / Topic / Type / Status | **Supported** | All present today |
| Priority (High/Medium/Low) | **Absent** | No priority field |
| Assigned To | **Partial** | `claim` sets no assignee column; claiming is a status transition. An assignee field would be a schema change |
| Overdue tab, Avg. Review Time, Completion Rate | **Absent** | No due dates, no SLA, no review-duration metric |
| Pending My Review (8) | **Derivable** | Filterable by the acting subject once an assignee exists |
| Evidence Status / Duplicate Risk columns | **Supported** | Both exist on the queue payload already |
| Detail tabs: Question, Evidence, Source, Governance, Review History, Version History | **Supported** | Every one of these has data on `/review/[questionId]` today |

### 5.5 Approvals (`approvals.png`)

| Element | Status | Notes |
| --- | --- | --- |
| Approving **documents** ("RxNet Order Processing Guide") | **Absent by design** | The platform approves questions. Document approval is not a workflow that exists |
| Pending / In Progress / Approved / Rejected tabs | **Supported** | Question statuses map to these |
| Approved This Month, Avg. Approval Time, Compliance Rate | **Absent** | `question_approval.decided_at` exists; no aggregates |
| Active Approvers (6) | **Derivable** | Distinct approvers from `question_approval` |
| **Approval Gates tab** | **Supported, and missing from the mockup** | Thirteen server-evaluated gates exist and must be shown (specification §17) |
| Evidence tab | **Supported, missing from the mockup** | |
| Comments (3) | **Supported** | `question_review.comment` |

### 5.6 Question Bank (`question-bank.png`)

| Element | Status | Notes |
| --- | --- | --- |
| Published / Draft / Archived tabs and counts | **Supported** | The five queue views already exist |
| Provenance: source, hash, version, evidence, dates, actors, bank item ID | **Supported** | All of it is on the question detail payload |
| Difficulty column | **Absent** | As §5.3 |
| Usage Count 124 | **Absent** | No join from a bank question to the assessments that used it is exposed. `assessment_eligibility_snapshot.pool_members` holds the data; no read model counts it |
| Avg. Rating 4.6/5 (36 ratings) | **Absent** | No rating mechanism |
| Duplicate / Archive / Use in Quiz actions | **Partial** | Retire exists. "Duplicate" and "Use in Quiz" do not; specification §18 also requires "Create New Version" and forbids editing a published version in place |
| Add Question (manual authoring) | **Absent** | Every question originates from a generation job today |

### 5.7 Assessments (`assessments.png`)

| Element | Status | Notes |
| --- | --- | --- |
| Assessment list with version and status | **Supported** | `GET /authoring/assessments` |
| Pinned pool size | **Supported** | From the eligibility snapshot |
| Participants, Avg. Score, Pass Rate per assessment | **Derivable** | `assessment_result` rows exist; no per-assessment aggregate endpoint |
| Performance trend chart | **Derivable** | Same data, no time series |
| Top Performing Domains | **Derivable** | Needs the same read model, plus §20 privacy rules |
| Due Date, Scheduled status | **Partial** | `availability_start/end` exist on a version; no scheduler |
| Type: Knowledge Check / Certification / Assessment | **Absent** | No assessment-type field |
| Assign to Users | **Absent** | No assignment model |
| Create Assessment (full builder) | **Partial** | One form on `/publish` creates and publishes. The specification §19 builder — topic distribution, fixed sets, attempt policy, availability — does not exist |

### 5.8 Reports (`reports.png`)

Essentially the whole page is **Absent**: nine analytics panels, a Knowledge Risk Index, learner
performance by role, content health, three export formats, and scheduled reports. `report_definition`,
`report_run`, `report_export`, and `report_schedule` tables exist and are empty; reporting is
Phase 10 of the roadmap. Specification §20 also requires data-level authorization, team scoping,
minimum-group-size suppression, and audit logging on every export — controls that do not exist yet.

**Plan:** build the page shell with each panel in a labelled *Planned — Phase 10* state. No numbers.

### 5.9 Settings → Administration (`settings.png`)

| Element | Status | Notes |
| --- | --- | --- |
| User list with role, department, status, last login | **Partial** | `user` rows exist with roles; `last_login` is not tracked |
| Role-based access control viewer | **Derivable** | The role→permission catalogue is real and in code (`packages/authorization`). A read-only permission matrix is genuinely buildable and useful |
| Add / edit / deactivate user, Manage Roles | **Absent** | No user-administration endpoints. Specification §22 requires authorization, confirmation, and audit on each |
| Pending Invitations (28), Send Reminder | **Absent** | No invitation model |
| Website/branding settings, notification settings, audit configuration | **Absent** | Configuration is environment and database driven; no admin write surface |
| Integrations tab | **Absent** | Same as "Add Source" (§5.2) |

### 5.10 Cross-cutting

| Element | Status | Notes |
| --- | --- | --- |
| Global search with `Ctrl + K` | **Absent** | `GET /sources/:id/search` searches documents in one source. There is no cross-entity search endpoint |
| KNOWZY Copilot | **Absent** | Specification §23: disabled or preview only |
| Notifications | **Absent** | Table exists, nothing writes to it |
| Real user avatar and job title ("Reuben Dsouza, L2 Support Lead") | **Must be labelled** | Specification §34: local personas are labelled *Local Development Identity*. The current identity picker already does this and must keep doing it |
| Every "+N% vs last month" delta | **Absent** | No KPI history is stored anywhere |

---

## 6. Conflicts to resolve, and how

### 6.1 The generation mockup contradicts the governed workflow

`ai-quiz-qeneration.png` shows: pick sources → pick type → pick difficulty → free-text instructions
→ *Generate Quiz* → *Publish*. The platform requires: explicit document selection → preflight (six
checks) → **a recorded decision** → generation → evidence verification → drafts → review →
independent approval → publish.

The specification resolves this and the platform is not moving: §15 requires the three-zone layout
(Knowledge Context / Generated Drafts / Evidence and Governance), *"no silent proceed-anyway
action"*, and *"do not provide direct publishing from generation"*.

**Resolution:** implement specification §15. Keep from the mockup its visual language — the card
rhythm, the KPI row where metrics are real, the preview pane, the AI purple accent for generated
content. Drop the direct Publish button, the difficulty selector, the unimplemented question types,
and the free-text prompt.

### 6.2 The approvals mockup approves the wrong noun

It shows document approval. The platform approves questions, with thirteen gates and separation of
duties. **Resolution:** the new `/approvals` route approves questions, with the Evidence and
Approval Gates tabs specification §17 requires.

### 6.3 The Copilot treatment

The header mockup uses a four-colour icon and the bare word "Copilot", which reads as Microsoft
Copilot. Specification §8: *"Do not represent KNOWZY Copilot as Microsoft Copilot unless formally
approved."* **Resolution:** *KNOWZY Copilot* wording with an original mark, rendered disabled with a
"Planned" label until an API exists.

### 6.4 Document and asset path discrepancies

| Reference | Says | Actually |
| --- | --- | --- |
| `KNOWZY_UI_SOURCE_OF_TRUTH.md` §Document Purpose | mockups in `design/approved/` | they are in `design/` |
| `ui-modernization.md` | `design/ai-quiz-generation.png` | `design/ai-quiz-qeneration.png` (typo on disk) |
| `ui-modernization.md` | `design/administration.png` | `design/settings.png` |

Recommend renaming the two files and moving all nine into `design/approved/` so the specification is
literally true. Not done in this commit: renaming approved assets is the stakeholders' call.

### 6.5 §32 describes libraries the repository does not have

See §3. Resolved by decision, not by assumption.

---

## 7. The design system baseline in this commit

`packages/shared-ui`, which may import only `@knowzy/shared-types` (boundary rule B6). Nothing
imports it yet, so this commit cannot change how any page behaves.

| File | Contents |
| --- | --- |
| `src/tokens.css` | Every colour, type step, space, radius, shadow, border, duration, and z-index as a CSS custom property. The brand palette is exactly specification §5.2 |
| `src/tokens.ts` | The same values as typed constants, for chart libraries and tests that must not re-type a hex |
| `src/styles/components.css` | Component styles, written only against tokens — no literal colours |
| `src/components/Card.tsx` | Card, CardHeader, CardBody, CardFooter, KpiCard |
| `src/components/DataTable.tsx` | Table scaffold with caption, scoped headers, responsive scroll, empty state |
| `src/components/Drawer.tsx` | Right-side drawer: focus trap, Escape, restore focus, `aria-modal`. The only client component |
| `src/components/Badge.tsx` | Status / risk / evidence / version / role / AI badges, each pairing colour with text and an icon glyph |
| `src/components/ApprovalGateChecklist.tsx` | The thirteen gates: number, code, pass/fail, detail, remediation, blocking status, and the advisory notice |
| `src/components/Evidence.tsx` | EvidenceExcerpt (verbatim span, offsets, verification mode, similarity) and SourceCitation (document, section, version, hash, URL) |
| `src/components/ProvenanceTimeline.tsx` | Generated → Reviewed → Approved → Published → Used, with unknown stages neutral rather than assumed complete |
| `src/index.ts` | The public surface |
| `src/tokens.test.ts` | Asserts the brand hexes, that component CSS contains no literal colour, and that every badge variant is covered |

Design rules these components follow, from specification §7 and §31:

- Colour is never the only signal: every status badge carries text, and gate rows carry a glyph.
- Focus is always visible; the drawer traps and restores focus.
- Interaction targets are at least 44 × 44 px where practical.
- `prefers-reduced-motion` removes transitions.
- Empty, loading, and refusal states are first-class props, not afterthoughts.
- No component fetches data or decides anything. They render what the server already computed.

---

## 8. Milestones

Each is one commit, verified before the next begins. `npm run verify` plus the CI gates must pass at
every one.

| # | Milestone | Scope | Exit criteria |
| --- | --- | --- | --- |
| **1** | **Plan and design-system baseline** *(this commit)* | This document; tokens and ten component families in `packages/shared-ui`; no consumer | Gates green; no behaviour change; nothing imports the package |
| 2 | Authoring shell | App header (brand, identity, disabled Copilot), sidebar with the ten items, workflow ribbon, page hero, icons adopted | All seven existing routes render inside the new shell with unchanged behaviour; keyboard and landmark checks pass |
| 3 | Knowledge Sources + Document Browser | `/sources`, `/sources/[sourceId]` to the mockup's visual language; real KPIs only; tabs from `connectionStatus` | Test Connection and Synchronize behave identically; denied documents still invisible |
| 4 | AI Quiz Generation | `/generate` as specification §15's three zones | Preflight, recorded decision, refusals, and rejection reporting unchanged; no Publish button; no difficulty |
| 5 | Review Queue + Approvals | `/review`, `/review/[questionId]`, new `/approvals` | Thirteen gates render server-evaluated; separation of duties still refuses the author; evidence verbatim |
| 6 | Question Bank + Assessments | New `/question-bank` and `/assessments`; provenance timeline; pinned pools | No in-place edit of a published version; publishing still idempotent |
| 7 | Learner portal | All four routes, lower density, same tokens | No answer key in any payload or page; resume correct; no `NaN` |
| 8 | Reports, Governance, Administration | Shells with honest *Planned* states; read-only permission matrix; audit search if scoping allows | Nothing fabricated; every disabled control labelled |
| 9 | Browser tests + visual QA | Playwright for specification §33's two lists; 1920/1440/1280 QA; accessibility audit | Critical workflows covered by automated browser tests |

Milestones 2–7 each modify presentation only. Any milestone that turns out to need a backend
extension stops and records it here first.

---

## 9. Risks

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| **A redesign quietly changes behaviour** | The controls in specification §2 are the product | No milestone touches an action's payload. `npm run verify` and the CI gates run at each milestone; the 189-test integration suite is the backstop |
| **Fabricated metrics reach a leadership demo** | §4.4 forbids it and it would destroy trust in the numbers that *are* real | §5 is the catalogue; every unsupported element ships labelled, or not at all |
| **Wiring `shared-ui` into Next apps** | Workspace packages resolve through `exports` into `dist`; a stale `dist` silently serves old components, and `'use client'` must survive the boundary | Milestone 2 adds `transpilePackages` and a build-order check, and verifies a deliberate change appears |
| **Scope creep into Phase 10 reporting** | Four of nine mockups lean on read models that do not exist | Milestone 8 ships shells only. Reporting stays Phase 10 |
| **Tailwind adoption mid-flight** | Half-converted styling is worse than either choice | Decide §3 before Milestone 2 |
| **Accessibility regression under new visuals** | The current UI is plain but accessible; cards, drawers, and tabs are where AA is usually lost | Components carry the semantics; Milestone 9 audits |
| **`postcss` advisory (EX-001)** | Adopting Tailwind enlarges a deferred-advisory surface | If option B is chosen, re-assess EX-001 in the same commit |

---

## 10. Testing strategy

| Layer | Now | After Phase 8 |
| --- | --- | --- |
| Unit | 155 tests | Token integrity and component rendering |
| Contract | answer-key and boundary suites | Unchanged |
| Integration | 189 tests, fixtures synchronized in CI | Unchanged — no domain change in this phase |
| Browser | **none** | Playwright, specification §33: nine authoring flows and seven learner flows |
| Accessibility | none automated | axe in the browser suite; manual keyboard pass per milestone |
| Visual | none | Screenshot QA at 1920 × 1080, 1440 × 810, 1280 × 720 |

Adding Playwright is a new dependency and a new CI job; it belongs to Milestone 9 with its own
documented decision.

---

## 11. What this phase will not do

- No new business feature, no API contract change, no domain behaviour change.
- No fabricated metric, citation, or activity feed.
- No weakening of approval, evidence, separation of duties, publishing, or answer-key protection.
- No manual question authoring, no document approval, no assessment scheduling, no user
  administration writes, no exports, no working Copilot — all absent from the backend, all labelled.
- No rewrite of all pages at once.

---

## 12. Open questions for the stakeholders

1. **§3 technology decision** — plain-CSS tokens now and libraries at the point of need, or Tailwind
   up front?
2. **Asset paths (§6.4)** — rename `ai-quiz-qeneration.png` and `settings.png`, and move the nine
   mockups into `design/approved/`?
3. **Dashboard honesty** — the specified dashboard is mostly Phase 10 data. Ship it with four real
   KPIs and labelled placeholders, or defer the dashboard until reporting exists and make Knowledge
   Sources the landing page?
4. **Demo domain names** — RxNet, MES 360, VisionStar and the rest appear throughout the mockups.
   Specification §13 permits them as development data but not as hardcoded production domains.
   Confirm they stay clearly synthetic in the demo seed.
5. **Priority, assignment, and due dates** (§5.4) — genuinely wanted? Each is a schema change plus a
   workflow decision, not a visual one.
