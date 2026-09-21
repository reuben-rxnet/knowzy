# KNOWZY — UI Modernization Plan (Phase 8)

**Status:** Planning artifact, except §19, §21, §22 and §23 — UI-M1 (the shared shell), UI-M2
(the authoring workflow chain), UI-M2b (real-data modernization) and UI-M3 (branding refinement and
screen quality) are implemented. No API contract, server action, route, or domain
behaviour changed.
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

**Sections 1–18 and 20 are planning artifacts** — this plan and
[`full-solution-capability-matrix.md`](full-solution-capability-matrix.md) changed no component,
page, route, contract, or test behaviour. **§19 is different:** it is the record of UI-M1, which is
implemented. The shell, tokens, and shared components exist; the pages inside them are untouched
and are modernized one milestone at a time from UI-M2.

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
| **UI-M2** | **Re-sequenced on request (2026-09-21): the authoring workflow chain** — Knowledge Sources, document selection, AI generation, Review Queue, Approval, Question Bank. Delivered; see §21 | Every page on the design system; every read, action, and refusal unchanged; browser-driven through the whole chain |
| **UI-M2b** | Real-data modernization: the authoring dashboard, and the implemented authoring and learner screens rebuilt on the data that exists. Delivered; see §22 | Every figure traceable to an existing response; no delta, no placeholder metric, no fabricated recommendation; a refused read is absent rather than zero |
| **UI-M3** | **Re-scoped on request: branding refinement and screen quality across the implemented screens.** Delivered; see §23. (The Knowledge Sources and Document Browser work originally listed here landed in UI-M2) | Approved assets used unmodified; header lock-up refined; WCAG 2.2 AA contrast computed and asserted by test; 14 routes browser-validated |
| **UI-M4** | Delivered inside UI-M2 — AI Quiz Generation (§15 three zones) | Preflight, recorded decision, refusals, and rejection reporting unchanged; **no Publish button, no difficulty** |
| **UI-M5** | Delivered inside UI-M2 — Review Queue and question detail | Six detail tabs; evidence verbatim with offsets; edit revalidates |
| **UI-M6** | Delivered inside UI-M2 — Approvals | 13 server-evaluated gates; gate 13 still refuses the author; refusals specific |
| **UI-M7** | Delivered inside UI-M2 — Question Bank | Provenance timeline; retire not delete; no in-place edit of a published version |
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

## 19. UI-M1 — the shared shell (delivered)

**Goal:** one design system, two shells, eleven routes that look enterprise-grade and behave
exactly as they do today.

**Decisions taken:** Tailwind CSS v4 with CSS-variable tokens, and Lucide icons — the §32 stack.
Tailwind v4 is CSS-first, so `@theme` in `packages/shared-ui/src/tokens.css` declares the custom
properties *and* generates the matching utilities: one definition, available as a variable and as a
class.

### 19.1 Scope

1. **Tokens** — colour (§5.2/§5.3 exactly), typography scale, spacing, radius, shadow, motion,
   z-index, and the shell's layout dimensions. Documented in
   [`design-tokens.md`](design-tokens.md).
2. **Branding assets** — the approved files in `assets/branding/` replace placeholder text
   branding: `essilorluxottica-logo.svg.svg`, `knowzy-wordmark.svg.svg`, and `favicon.ico.svg`.
   The logo and wordmark ship as inline-SVG components in `shared-ui` so they inherit
   `currentColor` and add no extra requests; the favicon is copied into each app's `public/` and
   registered through Next's `metadata.icons`. `assets/branding/` stays the master copy — the
   components mirror it and must change with it.
3. **Global header** with all five §8.1 regions: brand, search, KNOWZY Copilot entry point,
   notification area, and the user avatar with display name and role indicator. Search, Copilot,
   and notifications render **disabled and labelled**, because no search endpoint, Copilot service,
   or notification producer exists (capability matrix A1/B1) and §23 forbids faking them.
4. **Authoring navigation** — §9's ten destinations.
5. **Learner navigation** — learner §5.2's eight destinations: Home, My Learnings, Assessments,
   Discover, Badges, Knowledge Library, My Progress, Help & Support.
6. **Workflow ribbon** (§11), **page hero** (§12), **card system**, **badge system**, **status
   indicators**, **drawer**, **modal**, and the **empty / loading / error / refusal / planned**
   states.
7. **Both shells applied to all 11 existing routes**, with page content untouched.
8. Package wiring: `transpilePackages`, Tailwind source detection across the workspace, Turbo build
   order, and a verified client-component round-trip.
9. Token integrity test; keyboard and landmark pass on all 11 routes.

### 19.2 How navigation states are rendered

Every destination carries its **capability-matrix status**, and the status decides the treatment.
Nothing is hidden, because the information architecture is itself informative; nothing unreleased is
a link, because learner §5.2 forbids dead links.

| Matrix status | Treatment | Chip |
| --- | --- | --- |
| `IMPLEMENTED` | Link | — |
| `PARTIALLY_IMPLEMENTED` | Link, plus a note saying where the capability currently lives | e.g. "On Publish" |
| `PLANNED` | Not a link. `aria-disabled` | "Planned" |
| `REQUIRES_BACKEND_EXTENSION` | Not a link. `aria-disabled` | "Needs backend" |
| `DISABLED_IN_CURRENT_RELEASE` | Not a link. `aria-disabled` | "Unavailable" |

Authoring: Dashboard, Knowledge Sources, AI Quiz Generation, and Review Queue are `IMPLEMENTED`;
Approvals, Question Bank, and Assessments are `PARTIALLY_IMPLEMENTED` and point at the route that
holds them today; Reports, Governance, and Administration need a backend.

Learner: Home is `IMPLEMENTED`; Assessments is `PARTIALLY_IMPLEMENTED` (the list is on Home until
UI-M9 moves it); My Learnings, Discover, Badges, Knowledge Library, and My Progress need a backend;
Help & Support needs approved integrations.

**Visual hiding is never the authorization control** (§9). The server refuses regardless of what
the sidebar renders.

### 19.3 Placeholder states

Permitted **only** where the capability matrix records the absence, and always labelled. UI-M1 ships
three: the disabled search box, the disabled Copilot button, and the disabled notification button —
each with an accessible name that states it is unavailable in this release. No placeholder KPI, no
placeholder chart, no placeholder list. `PlannedState` and `PlannedBadge` exist in the component set
for the milestones that need them; UI-M1 does not populate any page with them.

### 19.4 Out of scope for UI-M1

Every KPI, every chart, new routes, new endpoints, Playwright, and anything in §14 or §16.3. No page
is visually redesigned: pages keep their current markup and their existing stylesheet, which each
later milestone replaces one screen at a time.

### 19.5 Exit criteria

- All 11 routes render in the new shells; no payload, action, or refusal changed.
- `npm run verify` green; CI green; boundaries 0 errors and `shared-ui` no longer an orphan.
- A deliberate component change is proven to appear in both apps (no stale build output).
- Keyboard-only traversal of all 11 routes; visible focus everywhere; no colour-only status.
- Approved branding visible in both portals, including the favicon.
- Screenshots at 1920, 1440, and 1280 recorded for both portals.

### 19.6 What verification found, and what it changed

Every route was rendered against the running system and audited structurally — landmarks, skip
link, heading order, accessible names, unique ids, and whether each disabled control explains
itself — then photographed at all three widths. Four defects surfaced that review of the source had
not, and all four are fixed:

| Defect | Cause | Fix |
| --- | --- | --- |
| The header's disabled Copilot control and notification bell rendered as solid blue and looked enabled | `legacy.css` styles `button` at element level, so it painted the shell too | `legacy.css` nested under `#main`; the shell renders outside it |
| The KNOWZY wordmark overlapped the search field | The flexible search field compressed the brand box to nothing, and its `shrink-0` marks overflowed | The brand box is `shrink-0`; the search field is `min-w-0` |
| `Administration`, `Governance`, `My Learnings`, `Help & Support` truncated to `Admini…` | The status chip and the label competed for one 15rem row | The chip moved under the label, which now owns the full row |
| Two destinations highlighted at once — Review Queue **and** Approvals, Home **and** Assessments | Each item matched the location independently, and these pairs share a route | `activeNavLabel()` picks the most specific single match; the middleware now passes the query so a queue is distinguishable from its route |

Two findings were **not** defects and nothing was changed for them: the `h1 → h3` heading skip
appears only when a page renders `Problem.tsx`, which is pre-existing page markup that UI-M2
rewrites; and `title`-only explanation on the Copilot control was an artefact of the audit's search
window — the visible "Planned" label is inside the button.

One environment note for anyone repeating this: the integration suites truncate the development
database, so `npm run verify` empties the demonstration data. Re-seed through the API before
judging a screen.

### 19.7 Note on the supplied assets

The three files in `assets/branding/` are typeset SVG text rather than official logo artwork, and
two carry doubled extensions (`.svg.svg`, and `favicon.ico.svg` is an SVG rather than an ICO). They
are used as supplied. If the official marks arrive later, they replace these files and the two
`shared-ui` brand components, with no other change.

---

## 20. Open questions for the stakeholders

1. ~~**§3 technology decision**~~ — **decided:** Tailwind CSS with CSS-variable tokens and Lucide
   icons, adopted at UI-M1. §3's option A is superseded; what shipped is the §3 recommendation's
   icon half plus Tailwind up front, so the token file doubles as the Tailwind theme and there is
   one definition of the brand rather than two. Recharts is still deferred to the milestone that
   needs a chart.
2. ~~**Brand assets**~~ — **closed:** supplied in `assets/branding/` and in use in both portals.
   See §19.7 on what the files actually are.
3. ~~**Dashboard honesty**~~ — **answered by UI-M2b:** shipped with the figures that are real
   (sources, documents, the four queue counts, bank size, published assessments) and **no**
   labelled placeholders. A dashboard of mostly-empty "Planned" cards would have been a worse
   answer than a smaller dashboard that is entirely true. The specified KPIs that need an aggregate
   read model remain in UI-M10.
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

---

## 21. UI-M2 — the authoring workflow chain (delivered)

Re-sequenced on request: M2 is the workflow chain, not the dashboard. Knowledge Sources → document
selection → AI question generation → Review Queue → Approval → Question Bank, which absorbs what
§16.1 listed as UI-M3 through UI-M7. The dashboard moved to UI-M2b, where it still waits on the
§20 Q3 honesty question.

### 21.1 What changed

Six pages and seven components moved onto the design system:

| Screen | Route | What it is now |
| --- | --- | --- |
| Knowledge Sources | `/sources` | Three derived figures, the §14 source table, and the two operations. Test and Synchronize results open in a **drawer** (§30) instead of pushing the table down the page |
| Document Browser | `/sources/[sourceId]` | Containers as a link-based tab set, a folder breadcrumb, the item table with extraction status and selectability, and the section table with its offsets |
| AI Quiz Generation | `/generate` | §15's three zones as three numbered cards: select, decide, generate. The preflight checks are a real table; the rejection list is kept |
| Review Queue | `/review` | Five queues as a link-based tab set with a live count, status and version badges, confidence right-aligned |
| Approval | `/review/[questionId]` | §5.2's six detail tabs — Question, Evidence, Source, Governance, Review history, Version history |
| Question Bank | `/publish` | Bank figures, the publish batch with per-item outcomes, the inventory labelled with its source, and the assessment form |

**Nothing about behaviour changed.** Same reads, same server actions, same authorization, same
refusals, same URL contracts. The eleven §2 controls are untouched.

### 21.2 Decisions worth recording

- **The gate verdict is not inside a tab.** The six detail tabs are what §5.2 asks for, but burying
  "1 of 13 gates failed" one click away would hide the only thing on the page that says whether the
  question may proceed. The verdict card, with the failed gates spelled out, sits above the tabs;
  the full thirteen-row table lives in Governance.
- **Retirement is a modal.** In a table cell the comment box made every row three lines tall. It is
  the shared `Modal`, so Escape and focus restoration come with it — which matters most for the one
  action on the page that looks destructive. It is still retirement, never deletion (G7).
- **`legacy.css` is now opt-in.** It was nested under `#main` in UI-M1; a converted page still
  renders inside `#main`, and `#main button` (0,1,1) outranks the utility classes on a shared
  `Button` (0,1,0), so a converted control kept its legacy paint. The rules now sit under
  `.legacy-page`, which each unconverted page names on its root element. Six of eleven pages have
  dropped it. When the last one goes, the file goes.
- **Owner and Scope are still absent** from the source table, as the capability matrix says
  (`REQUIRES_BACKEND_EXTENSION`, UI-M10): `KnowledgeSource` has no owner field, and an invented
  name would be a person presented as fact.
- **No Publish button and no difficulty control on the generation screen**, which §15 forbids there.
- **The derived figures carry no comparison.** No "vs last month" anywhere, because no history is
  stored to compare against.

### 21.3 Not delivered, from the absorbed milestones

Stated rather than quietly dropped:

- **Provenance timeline** (UI-M7's exit criterion). Not built. The provenance that exists — version
  history, change kind, changed fields, whether evidence was re-verified — is on the question's
  Version history tab. A timeline component belongs with the reconciliation work in §8.
- **Status tabs on the source list** (UI-M3's "tabs from real status"). Not built: with one
  configured source, a tab set filtering one row would be furniture. The status is a column.
- **Pagination.** Every list in this build fits on one page.

### 21.4 How it was verified

A browser actually drove it, which this repository could not do before. Node 24 ships a global
WebSocket, so a small Chrome DevTools Protocol script clicks through the flows and reports console
errors; it lives in the session scratchpad as a verification aid, not as the Playwright suite (still
UI-M11).

That found two defects that reading the source had not:

1. **A hydration failure on the generation screen.** `PageHero`'s `secondaryText` rendered inside a
   `<p>`, and the page passed a `<dl>` into it. Invalid nesting, which React reports as a hydration
   mismatch and then re-renders the whole tree on the client. Fixed in the component: every
   `ReactNode` slot is a `div`.
2. **Two highlighted destinations on `/publish`.** Question Bank and Assessments both point there
   in this release and both sit earlier in the sidebar than Publish itself, so an alias won the
   tie. `activeNavLabel` now prefers the destination that *is* the page.

Also checked: the structural audit over all 13 routes — landmarks, skip link, heading order,
accessible names, unique ids, and whether each disabled control explains itself — **no findings**;
and the full flow end to end in the browser, selecting a document, running preflight, recording a
decision, generating, and reading the result.

Two audit findings turned out to be the audit's own fault and are recorded so nobody chases them
again: Tailwind's `disabled:` class variants read as a `disabled` attribute, and the "Planned"
label inside the Copilot button sits past a 700-character window.

---

## 22. UI-M2b — real-data modernization (delivered)

The implemented screens, redesigned against the data the platform already serves. No domain model
was added, no endpoint was added, and nothing on these screens is computed from anything but an
existing response.

### 22.1 What was built

| Screen | Route | Built from |
| --- | --- | --- |
| Authoring dashboard | `/` | `GET /authoring/sources`, the four review queues, `GET /authoring/question-bank`, `GET /authoring/assessments` |
| Knowledge Sources | `/sources` | The same list, plus `isActive`, which the payload carried and the table had been dropping |
| AI Generation | `/generate` | A three-zone stepper whose steps complete only because a preflight, a decision, or a job record exists |
| Review Queue | `/review` | Plus `duplicate.disposition`, also carried and also dropped |
| Approval gates | `/review/[id]` | `GET /authoring/questions/:id/gates` through the new `ApprovalGateChecklist` |
| Question Bank traceability | `/publish?trace=<id>` | `GET /authoring/questions/:id` and `/versions`, plus the inventory row |
| Learner home | `/` (3001) | `GET /learning/assessments`, and only that |
| Assessment detail | `/assessments/[id]` (3001) | The same eligibility list |
| Results, gap visualization | `/results/[id]` (3001) | `GET /learning/results/:id` |

Three shared components carry it: `Meter` and `BandScale` (`Meter.tsx`), and
`ApprovalGateChecklist` and `ProvenanceTimeline` (`Governance.tsx`).

### 22.2 What each screen refuses to show

This is the substance of the milestone, so it is listed rather than implied.

- **No deltas anywhere.** No "vs last month", no trend arrow, no sparkline. The platform stores no
  KPI history, so every comparison would be invented.
- **The dashboard has no coverage percentage, no content-health score, and no activity feed.** Each
  needs an aggregate or a redacted audit projection that does not exist. They are absent, not
  mocked, and not labelled "Planned" either — this milestone was to use real data, and a dashboard
  half-filled with placeholders is the outcome §20 Q3 was asking about.
- **A figure the caller may not read is absent, not zero.** The dashboard lists the refused reads
  by name with their codes, so "0 awaiting approval" always means zero. An Author, who has no
  `assessment.read`, sees exactly that.
- **The learner home has no streaks, points, levels, badges, due dates, recommendations, or
  continue-learning rail**, and no course or learning-path hierarchy. None has a backing field, and
  learner §7.2 forbids reinterpreting an assessment as a course to fill the space.
- **The knowledge-gap visualization draws only what the server computed.** Every bar prints its own
  percentage and its correct-of-asked denominator, so the picture says nothing the text does not
  (§29 forbids a hidden denominator). There is no comparison to other learners and no "study this
  next": neither exists.
- **`gapState` keeps its third answer.** Too few questions asked to judge is not a pass, and §5.3
  excludes it from gap reporting rather than reporting it green.
- **Traceability does not name people.** Who approved what is in the audit trail, not in this
  payload, so the panel says so instead of guessing from the decision record.
- **The gate checklist stays advisory,** and repeats the server's own sentence saying so. The rail
  is `aria-hidden`: every segment's meaning is in the list below it, and thirteen unlabelled cells
  read out one by one would be worse than useless.

### 22.3 A defect this found

`appliedThresholds` is an **array** of `{band, minInclusive, maxExclusive}`. The results page had
it typed `unknown` and read it with `Object.entries`, so the "Bands applied to this attempt" list
rendered `{"band":"EXPERT","maxExclusive":100.01,…}` as literal JSON. It is now typed and drives
`BandScale`, which places the score in the band it actually fell into.

### 22.4 How it was verified

Every screen was driven in a real browser: no console errors, and the structural audit over all 13
routes — landmarks, skip link, heading order, accessible names, unique ids, and whether each
disabled control explains itself — reported no findings.

The gap visualization was checked at more than one value. The seeded result was 0%, which draws
every bar empty and proves nothing, so a second attempt was answered from the **authoring** side's
answer key — the learner projection does not carry one, which is the control being relied on rather
than worked around — giving a 50% `NEEDS_IMPROVEMENT` result. Both render correctly, including the
band scale placing the score in the right band.

---

## 23. UI-M3 — branding refinement and screen quality (delivered)

No new route, endpoint, domain model or business capability. Every figure on every screen still
comes from a response this build already served before the milestone started.

### 23.1 Branding integration summary

The approved set is three files. What each one actually is matters, because it decided how each is
used:

| File | What it is | How it is used |
| --- | --- | --- |
| `essilorluxottica-logo.svg.svg` | Typeset Arial text, `fill="currentColor"` | The corporate endorsement, left of a hairline, white at 85% on the navy header. `currentColor` is honoured rather than overridden, so the mark takes the header's colour |
| `knowzy-wordmark.svg.svg` | Typeset Arial text, `KNOW` in white, `ZY` in brand green, tagline in `#DCE8FF` | The product wordmark. Its fills are white and pale blue, so the mark is **drawn for a dark background** — which is why it appears on the navy header and on no light surface |
| `favicon.ico.svg` | **Real drawn artwork** — a navy tile, a white K, three green bars | Promoted from favicon to product mark. It is now in the header beside the wordmark, so the product is recognisable at a glance and the header matches the browser tab |

**The tile mark was the find of this milestone.** It was the only piece of genuine vector artwork in
the approved set and it was being used for nothing but the browser tab. Bringing it into the header
is what makes the lock-up read as a product rather than as a line of type.

Rules kept:

- **Nothing was modified, recoloured, stretched or cropped.** Each component reproduces its file's
  viewBox, geometry, fills and letter-spacing exactly. The components take a `className` for size
  only, and the SVG aspect ratio is preserved at any height.
- **SVG throughout**, inline rather than `<img>`. That is necessary rather than preferred for the
  corporate mark: `currentColor` cannot be inherited through an `<img>`, so it would render black on
  the navy header, and hard-coding white instead would be recolouring the asset.
- **Dark header support** is the default case, not an adaptation. Every foreground on the navy is
  either white at a measured opacity or the brand green, and each ratio is asserted by test.

Header refinements, in the order they matter:

1. The tile mark plus the wordmark, with the corporate mark given its own zone behind a hairline —
   §5.1's order, EssilorLuxottica first, KNOWZY second, neither competing with the other.
2. A 2px brand-green rule under the navy: the accent used as structure, and the line that separates
   header from workspace without a shadow.
3. One spacing scale across the bar, the search field centred on the page rather than on the space
   left over, and a fixed rhythm in the action cluster so the identity block lands in the same place
   on every width.
4. The search field and the Copilot button no longer appear at the same breakpoint. They did, and at
   exactly 1280 they fought until the search collapsed to the word "Sear".

### 23.2 Accessibility summary

The structural audit passes on all **14** routes: skip link first, one `main`, one `h1`, no skipped
heading level, every `nav` labelled, every link and button named, no `aria-hidden` on a focusable,
no duplicate ids, no positive tabindex, and every disabled control explaining itself.

**Contrast was not passing, and the documentation said it was.** UI-M1 wrote ratios into `tokens.css`
and `design-tokens.md` by hand; computing them found six failures:

| Pair | Was | Needed | Fix |
| --- | --- | --- | --- |
| `ink-subtle` on white / sunken | 4.38 / 3.93 | 4.5 | Token darkened to `#5a6e8b` → 5.2 / 4.7 |
| `success` on `success-soft` | 4.07 | 4.5 | Token darkened to `#0a7a56` → 4.8. A badge's own label was failing against the badge |
| `brand-blue` as link text on canvas / sunken / info-soft | 4.31 / 4.11 / 3.97 | 4.5 | `TextLink` uses `--color-info` (5.3 worst). Brand blue is unchanged and keeps the primary button (white on it is 4.59) and the focus ring |
| `brand-green` as the active nav border on white | 2.69 | 3.0 (1.4.11) | The indicator uses `--color-success` (5.3) |
| `brand-green` as the active tab underline | 2.69 | 3.0 | Same |
| `brand-green` behind white on a completed stage, and as the lock-up and hero accent text | 2.69 | 4.5 / 3.0 | Same |

**Neither approved brand colour was altered.** What changed is the surface each may sit on: brand
green appears only on the navy header, where it is 5.7:1, and brand blue is not used for small text.
That is a design-system decision, not a brand one, and `design-tokens.md` §2.4 now states it.

`packages/shared-ui/src/contrast.test.ts` computes all of it from `tokens.css` — 12 tests over the
page surfaces, the badge pairs, the link surfaces, the header opacities and the non-text indicators.
Reverting either token makes it fail, which was verified. The ratios are now checked rather than
claimed.

### 23.3 Visual QA summary

Nine screens at 1920, 1440 and 1280 — dashboard, sources, generation, review queue, approval,
question bank, traceability, learner home, result. Findings, all fixed:

- The search field collapsed at 1280 (see §23.1).
- A lone assessment card sat at half width in a two-column grid; the grid is now conditional on
  there being more than one.
- The learner's refusal panel rendered as **loose unstyled text**. `Problem.tsx` in the learner
  portal still depended on `legacy.css`, and UI-M2b moved those pages off it — so
  `PORTAL_ACCESS_DENIED` appeared as three bare lines. It now uses the shared states, like the
  authoring portal's has since UI-M2.

Also cleaned up: **the authoring portal has no legacy stylesheet left.** Every one of its pages is
on the design system, so the file was deleted rather than left in the build. One learner page — the
quiz — is still unconverted, so `apps/live-web/src/app/legacy.css` remains, and the guard test
keeps every article root in that app opted in.

### 23.4 Browser validation summary

Every route driven in Chrome over the DevTools Protocol: **14 routes, no console errors or
warnings**, including the two flows that only exist after a click — the source connection drawer and
the three-zone generation sequence.

### 23.5 Screen improvements, and what each is built from

| Screen | Improvement | Source of every value |
| --- | --- | --- |
| Dashboard | Pipeline figures enlarged and made links; **pipeline health** as a list of true conditions with the action each implies | `sources`, the four queue counts, `question-bank`, `assessments`. No composite score — a number nobody can trace is worse than a list |
| Knowledge Sources | Health in one cell (connection, active, and **how stale** the check is), scope in one cell | The same list payload, plus a relative time derived from `connectionStatusAt` |
| AI Generation | The drafts a job created are now listed and linked; the recorded decision shows as governance state | `questionIds`, which was in the response and was being dropped |
| Review Queue | **Every** tab carries its own real count | Five reads of the endpoint the page already calls |
| Approvals | Gate rail, failures first, advisory verbatim | `/questions/:id/gates` |
| Question Bank | Per-step glyphs on the provenance trail; revision count beside the published version | The question's version history |
| Learner Home | Four stat tiles per card, an explicit "Ready to start", and the resume card above everything | `GET /learning/assessments` |
| Results | The proficiency band now shows **its own range**, so the band means something | `appliedThresholds` |

### 23.6 What could not be built from existing data

Two items on the brief have no backing field, and inventing one was not an option:

- **Learner result visibility** and **proficiency visibility on the home page.** There is no
  endpoint listing a learner's results or sessions — `GET /learning/results/:resultId` needs an id
  the home page has no way to obtain. `attemptsUsed` is shown because it is real; a past result is
  not, and the page says so in one sentence rather than showing an empty "Your progress" card.
  This is the same gap the capability matrix records as a learner-scoped aggregate endpoint, and it
  belongs to LIVE-UI-M2.
- **Sync history.** The source payload carries `connectionStatusAt` but no last-sync timestamp or
  outcome; a synchronization result exists only in the response to the action that ran it. Sync
  visibility is therefore the drawer and the document count, not a history.
