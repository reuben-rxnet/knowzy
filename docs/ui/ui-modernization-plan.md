# KNOWZY — UI Modernization Plan (Phase 8)

**Status:** Planning artifact. No application behaviour, route, or contract changed.
**Created:** 2026-09-21 · **Revised:** 2026-09-21 (learner portal, capability matrix, milestones)
**Assessed commit:** `bbb9df6`
**Sources of truth, in precedence order:**

1. The repository — what the software actually does
2. [`CLAUDE.md`](../CLAUDE.md) and [`/docs`](../) — architecture
3. [`KNOWZY_UI_SOURCE_OF_TRUTH.md`](KNOWZY_UI_SOURCE_OF_TRUTH.md) — shared and authoring UX
4. [`KNOWZY_LIVE_PORTAL_UI_SOURCE_OF_TRUTH.md`](KNOWZY_LIVE_PORTAL_UI_SOURCE_OF_TRUTH.md) — learner UX
5. `design/approved/authoring-portal/*.png` and `design/approved/live-portal/*.png` — **visual
   reference only**

Feature-by-feature classification lives in
[`full-solution-capability-matrix.md`](full-solution-capability-matrix.md): 17 mockups, 147
features, five status values. This plan does not repeat it.

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

**This commit contains planning artifacts only:** this plan and
[`full-solution-capability-matrix.md`](full-solution-capability-matrix.md). No component, page,
route, contract, or test behaviour changes. The design system itself is UI-M1, scoped in §19 and
gated on the two decisions in §20.

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

## 3. Technology decision required before UI-M1

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

**Recommendation: A for the tokens, then libraries at the point of need.** Icons are needed at
UI-M1 for navigation (Lucide). Charts are not needed until UI-M2's dashboard and UI-M10's reports,
so Recharts is adopted there. Adopting at the point of need keeps each dependency attributable to a
screen that justifies it.

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

### 4.1 Live Learning Portal mockup → route map

Eight learner mockups, added 2026-09-21. Four routes exist; four destinations do not.

| Mockup (`design/approved/live-portal/`) | Target route | Route status | Fit |
| --- | --- | --- | --- |
| `learner-home-page.png` | `/` (learner) | **Exists** as an eligibility list | Modernize. Real: assessments, attempts, in-progress session, gaps. Unsupported: learning progress %, badges, journey, courses |
| `assessments.png` | `/` and `/assessments/[assessmentId]` | **Exists** | Transfers well. Unsupported: "Assigned to Me", avg score/pass-rate KPIs, recommendations, thumbnails |
| *(none)* | `/sessions/[sessionId]` | **Exists** | No mockup; learner specification §10 governs. Highest-integrity screen in the product |
| *(none)* | `/results/[resultId]` | **Exists** | No mockup; §11 governs |
| `my-progress.png` | **new** `/my-progress` | — | Assessment half is derivable; course/hours/streak half needs models that do not exist |
| `my-learnings.png` | **new** `/my-learnings` | — | Entirely dependent on 11 absent models (§7.2) |
| `discover.png` | **new** `/discover` | — | Needs catalog + search + recommendations |
| `knowledge-library.png` | **new** `/knowledge-library` | — | Needs one approved integration per external source |
| `badges.png` | **new** `/badges` | — | 10 badge definitions are seeded; no award engine, no certificates |
| `help-and-support.png` | **new** `/help` | — | Needs approved help content and support integrations |

### 4.2 Learner navigation reconciliation

Learner specification §5.2 lists eight destinations. Four have routes today.

| # | §5.2 destination | Route after Phase 8 | Released by |
| --- | --- | --- | --- |
| 1 | Home | `/` | UI-M9 |
| 2 | My Learnings | `/my-learnings` | LIVE-FULL-M2 |
| 3 | Assessments | `/assessments` (list) + `/assessments/[id]` | UI-M9 |
| 4 | Discover | `/discover` | LIVE-FULL-M3 |
| 5 | Badges | `/badges` | LIVE-FULL-M5 |
| 6 | Knowledge Library | `/knowledge-library` | LIVE-FULL-M4 |
| 7 | My Progress | `/my-progress` | LIVE-UI-M2 |
| 8 | Help & Support | `/help` | LIVE-FULL-M6 |

§5.2 says *do not create dead links*, so until a destination ships, its nav entry is **hidden** —
not disabled — unless a product owner explicitly wants it visible as a preview.

### 4.3 Authoring navigation reconciliation

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

Superseded by [`full-solution-capability-matrix.md`](full-solution-capability-matrix.md), which
classifies all 147 features across the 17 mockups with their route, model, backend support,
security and authorization impact, data dependency, required extension, and milestone.

Headline counts: **41 implemented, 25 partial, 7 planned, 67 requiring a backend extension, 7
deliberately disabled.** The 67 cluster in three product areas the roadmap already defers —
analytics (Phase 10), learning catalog, and recognition (Phase 9).

The three temptations that would breach specification §2/§4.4, repeated here because they are the
ones a redesign invites:

1. **Reinterpreting assessments as courses** to populate My Learnings. Learner specification §7.2
   forbids it by name.
2. **Computing "vs last month" deltas.** No KPI history is stored anywhere in the schema, so every
   delta on every mockup card is uncomputable today.
3. **Publishing from the generation screen** because the mockup has the button. Authoring
   specification §15 forbids it; it would defeat separation of duties.


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
| `KNOWZY_UI_SOURCE_OF_TRUTH.md` | mockups in `design/approved/` | **resolved** — now `design/approved/authoring-portal/` and `design/approved/live-portal/` |
| `ui-modernization.md` | `design/ai-quiz-generation.png` | `design/approved/authoring-portal/ai-quiz-qeneration.png` (typo still on disk) |
| `ui-modernization.md` | `design/administration.png` | `design/approved/authoring-portal/settings.png` |
| `help-and-support.png` | a concrete support mailbox address | learner specification §16.3 forbids hardcoding one; it must not ship as data |

Two filenames remain worth correcting (`qeneration` → `generation`, `settings` → `administration`),
and `ui-modernization.md` still points at the pre-move paths. Renaming approved assets stays the
stakeholders' call.

### 6.5 §32 describes libraries the repository does not have

See §3. Resolved by decision, not by assumption.

---

## 7. Shared design-system rollout

One system, two consumers. It lives in `packages/shared-ui`, which boundary rule **B6** restricts to
importing `@knowzy/shared-types` only — so no component can reach the database, an adapter, or a
domain service, by construction.

### 7.1 Layers

| Layer | Contents | Consumed by |
| --- | --- | --- |
| Tokens | Colour (specification §5.2/§5.3), type scale, spacing, radius, shadow, border, duration, z-index | Both portals, and any chart library later |
| Primitives | Button, Badge, Card, Tabs, Table, Drawer, Modal, Toast, Tooltip, Skeleton, EmptyState, ErrorState, RefusalState | Both |
| Domain components | ApprovalGateChecklist, EvidenceExcerpt, SourceCitation, ProvenanceTimeline, ConfidenceBreakdown, DuplicateRisk, CoverageIndicator, KpiCard, WorkflowRibbon | Authoring mainly; evidence components are shared |
| Learner components | AssessmentCard, QuizProgress, AnswerOptionCard, ResultSummary, TopicPerformance, ProgressRing, KnowledgeGapCard, StaleSessionNotice, EligibilityRefusal | Learner only |
| Shells | AppHeader, AuthoringSidebar, LearnerNav, PageHero | Respective portal |

### 7.2 Rules

- **No component fetches data or decides anything.** They render what the server already computed.
  Scoring, eligibility, gate evaluation, and authorization stay server-side (§4.2).
- **Colour is never the only signal.** Every status carries text; gates carry a glyph (§7).
- **Only Drawer, Modal, Tabs, and Toast are client components.** Everything else stays
  server-renderable so pages do not become client trees.
- **Component CSS references tokens only** — no literal colour outside `tokens.css`, asserted by a
  unit test.
- Tokens are additive: adopting Tailwind later means mapping this file into a theme, not rewriting
  components.

### 7.3 Integration requirements (verify at UI-M1, not later)

Workspace packages resolve through their `exports` map into `dist/`, so:

1. Both apps need `transpilePackages: ['@knowzy/shared-ui']` in `next.config.mjs`, or a stale
   `dist` will silently serve old components — the same class of trap the vitest source alias exists
   to prevent.
2. The client-component directive must survive the package boundary; verify with a deliberate
   interactive change.
3. `packages/shared-ui` must be built before either app in the Turbo graph.
4. `shared-ui` currently reports as a dependency-cruiser orphan; wiring it in clears that.

---

## 8. Authoring Portal rollout

Seven existing routes modernized, five new routes added. Every existing route keeps its server
actions and payloads unchanged.

| Order | Route | Change | New backend? |
| --- | --- | --- | --- |
| 1 | shell (all routes) | Header, sidebar, ribbon, hero, icons | none |
| 2 | `/` | Identity picker becomes a dashboard with **four** real KPIs and labelled placeholders | 2 count aggregates |
| 3 | `/sources`, `/sources/[sourceId]` | KPI row, tabs, donut, sync panel, styled browser | none |
| 4 | `/generate` | Specification §15 three-zone layout | 2 count aggregates (optional) |
| 5 | `/review`, `/review/[questionId]` | Master/detail with the six detail tabs | none |
| 6 | **`/approvals`** *(new)* | Question approvals with Evidence and Approval Gates tabs | none — reuses existing endpoints |
| 7 | **`/question-bank`** *(new)* | Inventory and provenance timeline, promoted out of `/publish` | usage count (optional) |
| 8 | **`/assessments`** *(new)* | Assessment list and a fuller create form | none — the create endpoint already accepts more than the UI sends |
| 9 | `/publish` | Narrows to a publishing workspace | none |
| 10 | **`/reports`**, **`/governance`**, **`/administration`** *(new)* | Shells with honest *Planned* states; read-only permission matrix | 1 read-only policy projection |

**Order rationale:** the shell first because every later screen sits inside it; then the two
read-heavy screens (sources, generate) to prove the component set against real payloads; then
review and approvals because they are the governance centre and the most sensitive to regression;
then the new inventory routes; then the shells last, since they ship least.

---

## 9. Live Learning Portal rollout

Two tracks, deliberately separated: **modernize what exists**, then **extend the product**.

### 9.1 Track 1 — modernization (no new backend)

| Order | Route | Change |
| --- | --- | --- |
| 1 | learner shell | Header, 8-item nav with unreleased entries hidden, hero |
| 2 | `/` | Home with real cards only: available assessments, attempts used, in-progress session, knowledge gaps |
| 3 | `/assessments/[assessmentId]` | Start and resume with full eligibility and refusal detail |
| 4 | `/sessions/[sessionId]` | Quiz: larger targets, progress, exit warning, stale-session notice |
| 5 | `/results/[resultId]` | Result summary, topic performance, gap explanation |

### 9.2 Track 2 — verified-data extensions (small backend, learner-scoped)

`LIVE-UI-M2` adds only aggregates over data the learner already owns: result history, score trend,
topic trend, proficiency rollup, cross-result gap rollup. Each needs a definition — source, period,
denominator, calculation, and whether it counts courses, assessments, or both (§15.4) — written
into this plan **before** it is built.

### 9.3 Track 3 — full-solution capabilities

Catalog, My Learnings, Discover, Badges and Certificates, Help, Copilot. Each is a product area, not
a screen: every one needs a domain model, an API with authorization, audit behaviour, privacy
controls, UI states, accessibility, browser tests, and a migration and rollback plan (learner
specification §27). Sequenced as LIVE-FULL-M1 to M7 in §16.

**Non-negotiable during every learner milestone:** no answer key in any payload, prop, log, or page
during an active quiz; learners see only their own data; recommendations are explainable or absent.

---

## 10. Accessibility plan

Target **WCAG 2.2 AA** (both specifications §7 and §19).

| Area | Requirement | Where it is enforced |
| --- | --- | --- |
| Keyboard | Every control, table, tab, drawer, dialog, and quiz answer reachable and operable; logical order; no traps except a modal that restores focus | Components own it; audited per milestone |
| Focus | Visible indicator on every interactive element; focus restored after a server action | Focus ring token; Drawer and Modal restore focus |
| Structure | One `h1`, ordered headings, landmarks, accessible table captions and scoped headers | `PageHero`, `DataTable` |
| Status | Never colour alone — text plus glyph on every badge, gate, and risk indicator | `Badge`, `ApprovalGateChecklist` |
| Announcements | Status role for save and answer confirmations; alert role for refusals; quiz progress announced | Action result components |
| Targets | At least 44 by 44 px where practical; learner answer cards deliberately larger | Sizing tokens |
| Motion | Reduced-motion preference removes transitions | Motion tokens |
| Charts | Accessible name, text summary, and a data alternative (table) for every chart | `ChartCard` when charts arrive |
| Images | Text alternatives for meaningful imagery; decorative hero art marked decorative | Per page |
| Contrast | Brand navy on white and green on white verified; **green on navy is not** — restricted to large text and non-text indicators | Token test and manual check |

**Validation:** axe in the browser suite (UI-M11), plus a manual keyboard-only pass per milestone.
Accessibility is a milestone exit criterion, not a final sweep.

---

## 11. Responsive strategy

Desktop targets 1920 x 1080, 1440 x 810, 1280 x 720 (both specifications). Fluid layouts; the 16:9
mockups are references, not a canvas.

| Pattern | Behaviour |
| --- | --- |
| Authoring sidebar | Persistent at 1280 and above; icon rail 1024 to 1280; drawer below |
| Workflow ribbon | Horizontal scroll, never wrap |
| KPI rows | 4-up, then 2-up, then 1-up |
| Tables | Horizontal scroll with a sticky first column; below tablet, priority columns only |
| Detail panels | Side panel at 1440 and above; drawer below |
| Filters | Inline at 1440 and above; drawer below |
| Charts | Resize without clipping; legends wrap |
| Learner quiz | **Must work on tablet and phone** — answer cards full width, targets at least 44 px, no horizontal scroll |
| Learner home and catalog | Card grids 4, then 2, then 1 |

Authoring may stay desktop-focused (§30). Learner Home, Assessments, Detail, Quiz, Resume, Results,
and Help must be usable on tablet and mobile (learner §20).

---

## 12. Browser end-to-end strategy

No browser test exists today. This is the largest testing gap in the product: 430 tests cover the
domain and the API, and **zero** cover a rendered page.

**Tool:** Playwright, added at UI-M11 with its own CI job. Chromium only to begin with.

**Environment:** the compose stack with a migrated, seeded, and fixture-synchronized database — the
same recipe CI already performs for the integration job.

### 12.1 Authoring flows (authoring specification §33)

1. Source connection test and synchronization
2. Document selection and section inspection
3. Preflight and recorded decision
4. Draft generation and claim
5. Question edit with evidence revalidation
6. Submit for approval
7. **Gate refusal** — approval attempted by the author, refused by gate 13
8. Independent approval by a second identity
9. Publishing, with the per-item outcome rendered

### 12.2 Learner flows (learner specification §25)

1. Identity selection in local mode
2. Assessment list rendering
3. Eligibility refusal (manager identity, portal refusal)
4. Start assessment
5. Answer submission
6. Refresh and resume mid-quiz
7. Complete and score
8. Topic-level gaps rendered
9. **Stale and fully-answered session recovery** — the defect fixed on 2026-09-21, now pinned in the
   domain suite and to be pinned again in the browser
10. **No answer-key exposure** — assert no correct-option field appears in HTML, serialized props, or
    network payloads at any point during an active quiz

### 12.3 Rules

- Tests drive the UI, never the API, except to set up state.
- No test asserts a fabricated metric.
- The answer-key test is the one test that must never be skipped; it fails the build.

---

## 13. Visual QA strategy

| Check | Method | When |
| --- | --- | --- |
| Screen fidelity against the mockup | Side by side at 1920 x 1080, reviewed against the approved image | Per milestone |
| Three breakpoints | Manual pass at 1920, 1440, 1280, plus tablet and phone for learner flows | Per milestone |
| Token conformance | No literal colour outside the token file (unit test) | Every commit |
| Both portals coherent | Same tokens, same primitives; learner density lower by intent | UI-M9 review |
| Dark and high-contrast OS settings | Manual check that nothing becomes unreadable | UI-M11 |
| Screenshot regression | Deferred — proposed only after the shell settles, to avoid churn | post-UI-M11 |

Visual QA is a review gate with named evidence (the screenshots), not a vibe check.

---

## 14. API extension requirements

Nothing in Phase 8's modernization milestones requires a new endpoint. Everything below belongs to a
numbered later milestone and is listed so the UI never invents it.

### 14.1 Read-only aggregates (small, low risk)

| Endpoint | Purpose | Policy | Milestone |
| --- | --- | --- | --- |
| `GET /authoring/metrics/questions` | Published, approved, and draft counts | `question.read` | UI-M2 |
| `GET /authoring/metrics/coverage` | Section coverage by domain and topic | `document.browse` | UI-M2 |
| `GET /authoring/metrics/generation` | Job counts and average duration | `question.read` | UI-M4 |
| `GET /authoring/question-bank/:id/usage` | Assessments that pinned a question | `question.read` | UI-M7 |
| `GET /authoring/roles/matrix` | Read-only projection of the real policy table | `role.read` (new) | UI-M10 |
| `GET /learning/results` | The learner's own result history | `learning.result.own` | LIVE-UI-M2 |
| `GET /learning/metrics/me` | Own averages, trend, proficiency rollup, gap rollup | `learning.result.own` | LIVE-UI-M2 |

### 14.2 New models and services (product areas, not endpoints)

| Capability | Models required | Notes |
| --- | --- | --- |
| Learning catalog | `LearningItem`, `Course`, `Module`, `LearningPath`, `ExternalCatalogReference` | Per-source integration, access trimming, deep-link policy |
| Assignment and progress | `Enrollment`, `LearnerProgress`, `CompletionRecord`, `Bookmark`, `LearningCalendarEvent` | Drives "Assigned to Me", due dates, calendar |
| Recommendations | `KnowledgeRecommendation` **exists, unwritten** | Needs the Phase 9 engine; must state why (§12.4) |
| Recognition | `BadgeAward` **(0 rows)**, `Certificate` **(0 rows)**, verification, revocation, expiry | 10 badge definitions and 1 certificate rule already seeded |
| Reporting | The report tables **exist and are empty**; `@knowzy/reporting` is a placeholder | Phase 10, with minimum-group-size suppression and export audit |
| Notifications | `Notification` **exists, unwritten** | Needs a producer and a read API |
| Administration writes | user, role, domain, source, and configuration writes | Privilege-escalation surface: authorization, confirmation, and audit on each |
| Search | Cross-entity and access-trimmed | New policy; per-type trimming inside the query |
| Copilot | Grounding, citation, injection defence, integrity restrictions | Must never bypass authorization or reveal answers |

Each of these requires, before any UI: domain model, API and authorization design, audit behaviour,
privacy controls, UI states, accessibility, browser tests, migration and rollback.

---

## 15. Production integration dependencies

Modernization needs none of these. The full solution cannot ship without them, and several are
procurement or approval questions rather than engineering ones.

| Dependency | Needed for | Status | Blocking |
| --- | --- | --- | --- |
| Entra ID app registrations (two portals) | Real sign-in, replacing the local stub issuer | Deferred since Phase 2; values listed in `assumptions-and-tenant-configuration.md` | Any non-local deployment |
| SharePoint tenant, site, and library IDs | Real knowledge sources (Phase 7) | Not supplied | Knowledge Sources beyond the mock |
| SharePoint Question Bank list | Real publishing target | Port and mock done; adapter not started | Publishing outside local |
| Anthropic API key | Live generation, replacing the deterministic local generator | Not configured | Question **quality**, never yet tested |
| Approved EssilorLuxottica brand assets | Header, wordmark, hero imagery | **Not in the repository** — every mockup shows them | UI-M1 |
| Leonardo, Confluence, Microsoft Learn, Udemy, LinkedIn Learning | Knowledge Library sources | None integrated; licensing unvalidated | LIVE-FULL-M1 and M4 |
| Ticketing (for example ServiceNow) | Raise a Support Ticket | None | LIVE-FULL-M6 |
| Support mailbox, chat, scheduling | Help channels | None; the mockup's address must not ship as data | LIVE-FULL-M6 |
| Health and status service | "All Systems Operational" | None | LIVE-FULL-M6 |
| Copilot backend | Both Copilot entry points | None | LIVE-FULL-M7 |

**The brand assets are the only integration dependency that blocks UI-M1.** Without approved logo
files the header ships with a text wordmark — acceptable as a placeholder, not for a leadership
demonstration.

---

## 16. Release milestones

Each milestone is one commit, verified before the next begins: `npm run verify`, the CI gates, and
the milestone's own exit criteria.

### 16.1 Modernization — no new business behaviour

| ID | Scope | Exit criteria |
| --- | --- | --- |
| **UI-M1** | Design tokens, typography, shared primitives, domain and learner components, authoring shell, learner shell, package wiring, icon library | Both portals render inside the new shells; all 11 routes behave identically; keyboard and landmark pass; token test green |
| **UI-M2** | Authoring dashboard | Four real KPIs; every unsupported panel labelled *Planned*; no delta claims |
| **UI-M3** | Knowledge Sources and Document Browser | Test and sync unchanged; denied documents invisible; tabs from real status |
| **UI-M4** | AI Quiz Generation (§15 three zones) | Preflight, recorded decision, refusals, and rejection reporting unchanged; **no Publish button, no difficulty** |
| **UI-M5** | Review Queue and question detail | Six detail tabs; evidence verbatim with offsets; edit revalidates |
| **UI-M6** | Approvals | 13 server-evaluated gates; gate 13 still refuses the author; refusals specific |
| **UI-M7** | Question Bank | Provenance timeline; retire not delete; no in-place edit of a published version |
| **UI-M8** | Assessments (authoring) | Pinned pool and versions visible; published visually distinct from draft |
| **UI-M9** | Learner MVP routes: home, assessments, detail, quiz, results | No answer key anywhere; resume correct; no `NaN`; quiz usable on tablet |
| **UI-M10** | Reports, Governance, and Administration shells | Honest *Planned* states; read-only permission matrix reflects the real policy table |
| **UI-M11** | Playwright suite, accessibility audit, visual QA | 9 authoring and 10 learner flows automated; axe clean; three breakpoints reviewed |

### 16.2 Learner verified-data extension

| ID | Scope | Depends on |
| --- | --- | --- |
| **LIVE-UI-M2** | My Progress and result history from the learner's own verified data; defined metrics only | UI-M9 and the §14.1 endpoints |

### 16.3 Full-solution product areas — each needs its own design cycle

| ID | Scope | Prerequisite |
| --- | --- | --- |
| **LIVE-FULL-M1** | Learning catalog foundation: unified model, source adapters, access-trimmed search, metadata normalization, deep-link governance | Approved source integrations |
| **LIVE-FULL-M2** | My Learnings: assignment, enrollment, progress, bookmarks, paths, calendar | M1 |
| **LIVE-FULL-M3** | Discover: search, filters, explainable recommendations | M1 and the Phase 9 recommendation engine |
| **LIVE-FULL-M4** | Knowledge Library: catalog browsing, bookmarks, source attribution | M1 |
| **LIVE-FULL-M5** | Badges and certificates: deterministic award engine, generation, verification, revocation, expiry | Phase 9 |
| **LIVE-FULL-M6** | Help and support: content source, search, approved escalation channels, status | Approved integrations |
| **LIVE-FULL-M7** | Learner Copilot with assessment-integrity restrictions | Copilot backend |

### 16.4 Sequencing note

UI-M1 through UI-M11 can all be delivered without a single new domain model, and that is the point:
the validated MVP becomes an enterprise-looking product first, and the product grows second. Nothing
in 16.3 should start before UI-M11 is green.

---

## 17. Risks

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| **A redesign quietly changes behaviour** | The controls in specification §2 are the product | No milestone alters an action's payload; `npm run verify`, the CI gates, and the 189-test integration suite run at each one |
| **Fabricated metrics reach a leadership demo** | §4.4 forbids it and it would poison trust in the numbers that are real | The capability matrix is the gate; 67 features ship labelled or not at all |
| **Assessments reinterpreted as courses** | Learner §7.2 names this; it would make the learner data model a lie | My Learnings stays empty until real models exist |
| **`shared-ui` resolves to a stale build** | Silently serves old components — the same trap the vitest source alias exists to prevent | UI-M1 adds `transpilePackages` and verifies a deliberate change appears |
| **Scope creep into Phases 9 and 10** | 67 of 147 features live there | 16.3 is gated behind UI-M11 |
| **Tailwind adopted mid-flight** | Half-converted styling is worse than either choice | Decide §3 before UI-M1 |
| **Accessibility regression under new visuals** | The current UI is plain but accessible; cards, drawers, and tabs are where AA is usually lost | Components own the semantics; per-milestone keyboard pass; axe at UI-M11 |
| **Performance: KPI-heavy pages** | The dashboard mockup implies around ten aggregate queries per load, and `/generate` already loops containers to list documents | Aggregates must be single indexed queries, measured before shipping; caching only with explicit staleness labels |
| **Performance: large tables** | Question Bank shows 2,850 rows and 357 pages; today's endpoints cap at 100 with no cursor | Server-side pagination before any table claims a full inventory |
| **Performance: client bundle** | Adding icons and charts to server-rendered pages can pull large client bundles | Keep components server-renderable; import icons individually; charts only on chart pages |
| **Privacy: team and role analytics** | The heatmap and learner-performance panels are the most sensitive surfaces in the product | Phase 10 only, with minimum-group-size suppression, report-level authorization, and audit on view |
| **Security: Copilot and free-text prompts** | Both are prompt-injection surfaces reaching retrieved documents | Disabled until a governed service exists; §23 and §17 restrictions encoded then |
| **Security: brand and personal data in mockups** | Real names, job titles, and a support mailbox appear in the images | Demo identities stay labelled; the mailbox never becomes data |
| **Testing gap: zero browser coverage** | Every screen change today is verified by a person looking at it | UI-M11; until then each milestone states what was manually verified |
| **Testing gap: no visual regression** | A token change can silently alter every page | Token test now; screenshot regression considered after UI-M11 |
| **17 mockups, 11 routes** | The visual target is much larger than the product | The matrix and 16.3 keep the difference explicit rather than aspirational |

---

## 18. What this phase will not do

- No new business feature, no API contract change, no domain behaviour change.
- No fabricated metric, citation, activity feed, badge, certificate, course, or support channel.
- No weakening of approval, evidence, separation of duties, publishing, or answer-key protection.
- No assessments-as-courses, no direct publish from generation, no computed deltas without history.
- No rewrite of all pages at once.

---

## 19. Recommended scope for UI-M1

**Goal:** one design system, two shells, eleven routes that look enterprise-grade and behave exactly
as they do today.

**In scope**

1. `packages/shared-ui`: tokens (colour, typography, spacing, radius, shadow, motion, z-index);
   primitives (Button, Badge, Card, Tabs, Table, Drawer, Modal, Toast, Skeleton, and Empty, Error,
   and Refusal states); domain components (ApprovalGateChecklist, EvidenceExcerpt, SourceCitation,
   ProvenanceTimeline, ConfidenceBreakdown, DuplicateRisk, CoverageIndicator, KpiCard,
   WorkflowRibbon); learner components (AssessmentCard, QuizProgress, AnswerOptionCard,
   ResultSummary, ProgressRing, StaleSessionNotice, EligibilityRefusal).
2. `AppHeader`, `AuthoringSidebar` (10 items, unreleased hidden), `WorkflowRibbon`, `PageHero`.
3. `LearnerNav` (8 items, unreleased hidden) and the learner header.
4. Both apps re-shelled: every one of the 11 routes renders inside the new shell with its existing
   content, actions, and refusals **unchanged**.
5. An icon library (Lucide) adopted with its reason recorded here.
6. Package wiring: `transpilePackages`, Turbo build order, and a verified client-component
   round-trip.
7. Token integrity test; keyboard and landmark pass on all 11 routes.

**Out of scope for UI-M1:** every KPI, chart, new route, new endpoint, Tailwind, Playwright, and
anything in §14 or §16.3.

**Exit criteria**

- All 11 routes render in the new shells; no payload, action, or refusal changed.
- `npm run verify` green; CI green; boundaries 0 errors and `shared-ui` no longer an orphan.
- A deliberate component change is proven to appear in both apps (no stale build output).
- Keyboard-only traversal of all 11 routes; visible focus everywhere; no colour-only status.
- Screenshots at 1920, 1440, and 1280 recorded for both portals.

**Decisions needed before starting:** §3 (styling technology) and the brand assets in §15. Both are
listed in §20.

---

## 20. Open questions for the stakeholders

1. **§3 technology decision** — plain-CSS tokens now with libraries at the point of need, or Tailwind
   up front? UI-M1 cannot start without this.
2. **Brand assets** — approved EssilorLuxottica logo and wordmark files are not in the repository.
   Text placeholder for UI-M1, or supply assets first?
3. **Dashboard honesty** — the specified dashboard is mostly Phase 10 data. Ship with four real KPIs
   and labelled placeholders, or defer it and land on Knowledge Sources?
4. **Unreleased navigation** — hide the six unbuilt learner destinations (the §5.2 default), or show
   them as explicit previews for demonstration purposes?
5. **Asset filenames** — rename `ai-quiz-qeneration.png` to `ai-quiz-generation.png` and
   `settings.png` to `administration.png`, and update `ui-modernization.md`?
6. **Demo domains** — RxNet, MES 360, VisionStar and the rest appear throughout both mockup sets.
   Confirm they stay clearly synthetic in the demo seed and are never hardcoded as production
   domains (§13, §4.4).
7. **Points, levels, and streaks** (badges mockup) — learner §14.3 permits them **only if formally
   approved**. Approve the scheme, or drop them from the design?
8. **Review policy for explanations** — should a learner see the approved explanation after
   completing an assessment? §11 says follow the configured policy; no such policy exists yet.
