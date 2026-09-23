# Knowzy

Architecture Source of Truth:

- /docs
- Where this file and /docs disagree, /docs wins.
- docs/MVP-READINESS.md is a STATUS REPORT, not a specification. If it and the
  code disagree, the code is right and the report is stale.
- docs/SECURITY-EXCEPTIONS.md is a LIVE CONTROL DOCUMENT, not prose: the JSON
  block in its section 4 is parsed by `npm run audit:gate` in CI. A new high or
  critical advisory fails the build until it is classified and declared there,
  an expired entry fails, and an entry matching nothing fails. Never widen the
  gate in the workflow; add or re-assess an entry instead.
- docs/USER-GUIDE.md describes the SOFTWARE for the person driving it. It is
  updated in the SAME COMMIT as any change to what a user sees or does: a new
  screen, a moved control, a changed label, a new refusal, or anything promoted
  out of its "not real yet" table. A milestone that changes the UI is not
  finished until that file matches it, including its header block and change
  log.

Question Repository:

- SharePoint Question Bank

Knowledge Source:

- SharePoint via MCP

Applications:

- Authoring Portal
- Live Learning Portal

Rules:

- Human approval required
- No automatic publishing
- Published questions are reusable assets
- Prevent duplicate generation
- Track source documents and versions

Implementation Order:

- Authoritative: docs/implementation-roadmap.md (11 phases, with exit criteria)

1. Foundation DONE
2. Identity and access DONE (local stub issuer; Entra deferred)
3. Sources and documents (mock) DONE
4. Generation and governance DONE (deterministic local generator)
5. Review and approval DONE
6. Assessment, quiz, and scoring DONE
7. SharePoint read integration NOT STARTED
8. Question Bank write integration PORT + MOCK DONE; adapter NOT STARTED
9. Refreshers and recognition NOT STARTED
10. Reporting and audit surfaces NOT STARTED
11. Hardening and release NOT STARTED

Phase 2 is Identity and access, not Knowledge Sources. Sources come in Phase 3
and depend on it: every route must have a declared policy, and the registry
test fails the build on a handler without one.

Current Status:

- Phases 1-6 complete, plus M7 (the thin UI). All seven MVP objectives verified
  end to end IN A BROWSER on the mock adapters, with no tenant credentials.
  See docs/MVP-READINESS.md for the full assessment.
- THREE web applications serve real screens: authoring on :3000 (sources,
  document browser, generate, review queue, question approval, publish,
  administration/taxonomy), learning on :3001 (assessment list, start, quiz,
  results) and the SharePoint Sync Manager on :3002 (one operational dashboard).
  Server components plus server actions — the browser never calls the API and
  never holds a subject header.
- Last live walkthrough (M7, through the two portals): source tested and
  synchronized, 6 drafts generated from 4 documents, claimed, submitted,
  approved by a different identity, published as
  KNZ-SUPPORT_OPS-2026-000001..006, an assessment published with a pinned pool
  of 6, three learner attempts including a mid-quiz resume, scored 100.00%
  EXPERT on the attempt answered correctly. Gate 13 failed for the author and
  passed for the approver, on screen, which is separation of duties visible in
  the UI.
- npm run verify passes: typecheck 34/34, lint 22/22,
  tests 795 passing + 12 todo across 36 files, boundaries 0 errors,
  codegen contract clean, format clean. Re-counted 2026-09-23; see
  docs/project/STATUS_RECONCILIATION_2026-09-23.md for what was stale.
- npm run test:e2e passes: 19 browser acceptance tests across three projects,
  driving all three applications against the running stack. It is NOT part of verify —
  it needs the stack up. On a network that blocks cdn.playwright.dev, run it
  as E2E_BROWSER_CHANNEL=chrome npm run test:e2e.
- The integration project is 189 of those tests, and until 2026-09-21 three of
  its suites (152 tests) only passed on a database where somebody had
  SYNCHRONIZED the mock source by hand. On a fresh database their beforeAll
  threw and vitest skipped them, which reads like success. CI now synchronizes
  the fixtures before the suites run, and asserts an extracted document exists.
- 8 migrations apply from empty; seed is idempotent. 0004 is PILOT-T2:
  section keys scoped per document, coverage split from generation outcome.
  0008 splits SKIPPED from FAILED on a sync. Taxonomy administration needed
  NO migration: Domain and Topic have carried every field since 0001.
- Full docker compose stack verified: postgres, api, mcp, jobs, all three web
  apps. All five images build and were SCANNED for the first time on
  2026-09-23: 16 HIGH/CRITICAL, reduced to 0.
- 19 of 36 MCP tools registered; 66 API routes, every one with a declared
  policy. M7 added three reads the UI needed: GET /authoring/taxonomy (so no
  screen asks for a pasted UUID), GET /authoring/assessments, and
  GET /authoring/questions/:id. Question import added 2, taxonomy
  administration 5, and the Sync Manager 11 (2 read/aggregate plus 9 source
  administration).

Environment:

- Node.js, npm, Docker, Git all installed and working

Still Open:

- The UI is the MINIMUM that demonstrates the workflow. No dashboard, badges,
  certificates, reports, or assessment builder (assessment creation is one form
  on the Publish page). See MVP-READINESS.md 7.1 for the full exclusion list.
- The UI IS driven by tests now (tools/e2e, Playwright): sources, generation,
  review, gate 13, publish, and the learner attempt including resume and
  scoring. What it does NOT cover is named in tools/e2e/README.md —
  refreshers, the revalidation queue, the audit surfaces and the second-tab
  sequence conflict, because the platform does not implement them.
- No live Claude call. Generation uses a deterministic local generator and
  records modelId = knowzy-deterministic-local-1. Question QUALITY has never
  been tested against Claude, which is the product's actual purpose.
- CI first ran on 2026-09-21. Round 1 failed on `format:check`; round 2 passed
  static gates and supply chain, and failed on the integration job (fixtures)
  and all five image builds (an unresolvable action tag). Both fixed and
  verified locally. The trivy SCAN itself has still never executed against an
  image, so a base-image CVE could be the next red.
- 11 commits were pushed on 2026-09-23 and THE RESULT OF THAT RUN IS UNKNOWN
  from this machine: `gh` is not installed and the repository is private, so
  the Actions tab has to be read by a person. An unread run is not a pass.
- Deferred with reasons in docs/SECURITY-EXCEPTIONS.md: Next.js 15 -> 16 and
  Vitest 2 -> 5. Major upgrades whose advisories are not reachable here; both
  entries expire 2026-12-31.
- phase-1-validation is an old branch and can be deleted.
- The 36-step acceptance script (docs/initial-end-to-end-proof.md section 3)
  is automated for the built surface: steps 1-9, 11-18 and 21-29. The rest
  need capability that does not exist and are listed as exclusions rather
  than written as skipped tests, because a skipped test reads like coverage.
- Tenant values still required before Phase 7 — see
  docs/assumptions-and-tenant-configuration.md
- 9 recorded deviations from the design docs, each asserted by a test — see
  MVP-Plan.md "Recorded deviations".

Next Immediate Task:

1. SEND the T-29 request. It is drafted at
   docs/integrations/T29_PRIVACY_LEGAL_REQUEST.md and nobody in Privacy,
   Legal, InfoSec or Data Governance has seen it. Longest lead time on the
   critical path, and not an engineering action.
2. Read the CI result for the 2026-09-23 push. Eleven commits went up and the
   outcome has never been read from this machine (`gh` absent, repo private).
3. Measure blind-stem answerability on the published questions. The
   confidence-component half of this is DONE and recorded in
   docs/integrations/LIVE_CLAUDE_EVALUATION_PLAN.md section 2.5; the
   blind-stem half needs a person and no credential.
4. Build the budget and cost layer (LIVE_CLAUDE_IMPLEMENTATION_PLAN.md
   section 6). It must ship WITH the Claude client, not after it, and it can
   be built now against the deterministic generator.
5. Wire the live Claude generator behind the existing QuestionGenerator port
   (packages/claude-services/src/generator.ts) and run the recorded
   comparison. Blocked on T-29 and T-28.

Working Commands:

- Setup on a fresh clone requires three generate-once artifacts:
  npm install
  npm run db:generate
  npm run -w @knowzy/database bootstrap:init-migration
  npm run codegen
  npm run db:migrate
  npm run db:seed
- Then: npm run verify
- Stack: docker compose -f infrastructure/compose/docker-compose.yml up -d

Gotchas learned by execution (each of these cost real time):

- A host `npm install` DESYNCS the container's node_modules volume. Symptoms:
  "Cannot find module tsx/dist/preflight.cjs" or "@prisma/client did not
  initialize yet". Fix: docker compose ... up migrate (it runs npm ci and
  prisma generate inside the volume), then restart api and mcp.
- Integration tests share ONE database and are serialized to a single fork
  (vitest.workspace.ts). Never run two test processes at once — they delete
  each other's rows and the failures look like real defects.
- `npm run verify` DESTROYS whatever demo data is on screen. The integration
  suites share the dev database: they delete draft_question and
  published_question_reference, and their own fixtures are briefly visible in
  the taxonomy dropdowns while a suite runs. Ask before running it while
  somebody is clicking through the portals, and expect to re-import and
  re-publish afterwards. The mock question bank JSON SURVIVES the wipe, so a
  republish then reports ALREADY_PUBLISHED for ids the database no longer has —
  delete `fixtures/bank/.state/knowzy-question-bank.json` for a clean run.
- Audit `detail` keys are DROPPED unless declared in the allow-list in
  packages/observability/src/audit.ts. A dropped key shows up as
  `_droppedKeys` in the row. Check the LATEST audit rows when verifying, not
  the oldest — audit is append-only, so old rows keep their old shape.
- Adding an ErrorCode requires `npm run codegen` or verify fails on the
  contract check (G6).
- Boundary rules: @knowzy/domain may not reach @knowzy/knowledge-source-adapters
  or @knowzy/content-extraction, even transitively (B3). Shared PORTS and the
  normalization pipeline therefore live in @knowzy/shared-types; the adapters
  package implements them.
- Cross-package imports in tests resolve through the `@knowzy/*` -> src alias
  in vitest.workspace.ts. Without it they resolve to dist and a test can pass
  against code that no longer exists.
- When a suite passes first try, mutate the thing it claims to check and
  confirm it fails. Three "passing" mechanisms in this codebase were vacuous.
- The web containers DO NOT see host file edits (no inotify across the Windows
  bind mount). `next dev` compiles a route once and keeps serving it, so an
  edit looks like it did nothing. Fix: docker compose ... restart
  authoring-web live-web sync-web. This wasted a diagnosis; the code was right the whole
  time.
- A host `npm run build` can also break the container node_modules volume, not
  just `npm install`. Same fix: `up migrate`, then restart api and mcp.
- The MOCK question bank persists to a JSON file under the fixture root, so it
  survives a database teardown. After the integration tests wipe
  published_question_reference, a republish reports ALREADY_PUBLISHED for ids
  the bank still holds. That is the adapter being right about its own state;
  delete the file if a clean publish demo is wanted.
- `prisma migrate diff` (the CI drift gate) compares the MIGRATIONS against
  schema.prisma, and Prisma cannot express a raw GIN/trigram index by default.
  Migration 0003 creates four; the two on plain columns are now declared with
  `@@index([col(ops: raw("gin_trgm_ops"))], type: Gin)`, and the two on
  expressions (coalesce/to_tsvector) Prisma ignores. Add a raw index to a
  migration and you must declare it, or the drift gate fails.
- npm reports TWO severities per finding: the advisory's own and the package
  rollup. They often disagree (GHSA-qx2v-qp2m-jg93 is moderate while npm rolls
  postcss up to high). `--audit-level=high` blocks on the rollup, so the audit
  gate does too.
- A freshly migrated and seeded database has 1 knowledge source and ZERO
  documents: the seed leaves the source UNTESTED on purpose. Documents appear
  only after a synchronize. Three integration suites need an EXTRACTED
  document, so on a fresh database they skip themselves rather than fail
  loudly. If a suite reports "N tests | N skipped", look for a missing
  precondition before believing the summary.
- There was NO .dockerignore, so `COPY . .` in the build stage copied the
  host's node_modules over the one `npm ci` built inside the image, and
  `tsc -b` failed with "File '@knowzy/tsconfig/node.json' not found". CI never
  saw it (a fresh checkout has no node_modules); every local build hit it. The
  images had never been built anywhere before 2026-09-21.
- A GitHub Action tag must be exact: `aquasecurity/trivy-action@0.24.0` does
  not resolve (the tags carry a `v`). Actions are resolved BEFORE any step
  runs, so a bad tag fails the job in three seconds with nothing else
  attempted — the build error behind it stayed invisible for a whole round.
- Coverage and generation outcome are SEPARATE fields since 0004. `coverageStatus`
  answers only "does a question cite this section"; a generator's refusal goes
  to `lastGenerationOutcome = REFUSED` with `lastRefusalReason`. Writing a
  refusal into `coverageStatus` made preflight count every refusal as coverage
  (94.8% reported where the truth was 2.6%). A contract test now refuses it.
- `section_key` is `sha256(unscoped_key + sourceDocumentId)`. The unscoped form
  collided across every heading-less document — one key was shared by 21 pilot
  documents — and both resolvers use `Array.find()`, so a span could verify
  against the wrong document. `sectionize()` REQUIRES `documentScope`;
  `extractContent` defaults it to the file name, adapters pass the stronger
  `sourceDocumentId`.
- Questions published before 0004 keep their v1 section keys and CANNOT be
  rewritten: a trigger enforces I15 (draft_question lineage is immutable), and
  it refused the first attempt at that migration. Coverage matches on
  `sectionKey` OR `sectionKeyV1`. Never try to rewrite published lineage.
- `PromptVersion.body` is DERIVED from `framing.ts` via `canonicalPromptBody()`
  and pinned by `PROMPT_BODY_SHA256`. Editing the prompt fails the contract test
  until the hash and `PROMPT_SEMANTIC_VERSION` are updated together.
- A test can encode a defect. The suite asserted
  `coverageStatus === 'NON_ASSESSABLE'` on a refusal, so the defect could not
  fail a build. When a test fails after a fix, check which of the two is wrong.
- A CONCURRENCY GUARD WITH NO TIMEOUT IS AN OUTAGE WAITING FOR A CRASH. Both
  Sync Now and the scheduler refuse a source with a RUNNING
  knowledge_source_sync row, and one row left RUNNING by a killed container had
  frozen a real source permanently with nothing on screen explaining it.
  `reapStuckRuns` runs FIRST on every scheduler tick and fails a run past its
  window. Any new guard of this shape needs the same expiry.
- A SCHEDULED job must build its MCP envelope with `portal: 'SYSTEM'`, or the
  run it performs is recorded as `trigger: MANUAL` and every automatic sync
  looks like somebody's click. The enum value is `SCHEDULE`, not `SCHEDULED`.
- Trivy findings are declared in `.trivyignore` at the repo root, which the CI
  step reads via `trivyignores:`. It may name ONLY CVEs already classified in
  docs/SECURITY-EXCEPTIONS.md, and it inherits their expiry. The runtime images
  deliberately DELETE npm and npx (14 of the original 16 HIGH/CRITICAL were
  npm's, and no runtime stage invokes it) — fix the image, do not widen the
  register.
- preflight.offeredActions is ALWAYS the four workflows.md 4.2 actions and
  never includes GENERATE_NEW, which is what a never-processed document
  recommends. Any UI listing the offered actions must union in the
  recommendation or the recommended action cannot be chosen.

## Roles

Fourteen seeded roles. `KNOWZY_ADMINISTRATOR` is a permanent production role for
platform and product owners, knowledge managers, administrators, pilot leads and
operational platform support. It holds every permission key except
`question.publish`; the administrator USER also holds `PUBLISHER`, so the
identity has full access while access-control.md 2 rule 3 stays satisfied --
permissions are the union across a user's roles.

Full access is NOT exemption. Separation of duties is an identity comparison at
approval, not a permission, so an administrator cannot approve a question it
authored. Gate 13 refuses it. A second seeded identity,
`knowzy-administrator-2@local.invalid`, exists so a pilot run completes with one
deliberate switch at the approval step rather than a weakened gate.

`knowzy-administrator@local.invalid` is the DEFAULT identity in both portals'
local selectors. Validate the whole workflow as that role with:

PILOT_DEMO_AS_ADMIN=1 npx tsx scripts/pilot-demo.ts

Every existing role is unchanged. Do not grant one role both `question.approve`
and `question.publish` -- a contract test refuses it, and /docs backs it.

## Generation providers

Multi-provider generation is DESIGNED, NOT BUILT:
docs/integrations/MULTI_PROVIDER_GENERATION_ARCHITECTURE.md

Four things to know before touching it:

- It CONTRADICTS docs/architecture.md, which is explicitly single-provider
  (section 9, the technology table, the C4 diagram, boundary rule B4). /docs
  wins, so amending the specification is step 0 and no provider code precedes
  it.
- "User managed" is NOT uniform. Copilot and Azure OpenAI have delegated
  per-user execution; Anthropic has no on-behalf-of flow and a claude.ai seat
  is not an API credential. Anthropic is platform-managed only.
- A provider that performs its OWN retrieval cannot be used for grounded
  generation. Copilot grounds in Microsoft Graph, which either yields nothing
  or produces questions shaped by content the author never selected -- and the
  gate chain does not detect the second. `retrievalFree` is a declared,
  asserted capability.
- BankItemWrite.claudeModel is a provider-specific name in a provider-agnostic
  port, written into the PUBLISHED record. Rename it before the SharePoint bank
  adapter ships or it becomes tenant data migration.

## Question acquisition

Two ways a question enters the platform, ONE governance model.

Generation: provider-based. See "Generation providers" above.

Import: @knowzy/question-import plus runQuestionImport in @knowzy/domain.
The design rests on one decision -- THE UPLOADED FILE BECOMES A KNOWLEDGE
DOCUMENT, and a detected question's evidence span is the verbatim block it was
read from, at real offsets into that document. Every approval gate then passes
for the same reason it passes for a generated question. Import is a different
ACQUISITION path onto the same rails, never a second set of rails.

Things to know:

- `DraftQuestion.acquisition` is GENERATED or IMPORTED, and `importLocator`
  records where in the file ("row 7", "slide 4"). A reviewer needs both.
- An imported draft has NULL modelId, promptVersionId and generationJobId.
  Nothing generated it, and a sentinel model id would pollute every yield
  comparison.
- Import holds the SAME thresholds generation holds (15-char stem, four
  distinct options, 20-char explanation, 40-char evidence span). Two standards
  in one review queue would be indistinguishable after approval.
- Detection has THREE strategies, tried most-unambiguous first: TABULAR
  (header row), SLIDE_PAIR, PROSE. The first that finds anything wins.
- PROSE has to handle options INLINE as well as one-per-line: the markdown
  extractor joins a paragraph's lines and DOCX concatenates runs, so a bank
  written one-option-per-line arrives as a single line. Found by running an
  import end to end, not by reading the code.
- There is NO browser file upload. The file must reach a synchronized folder
  first. Adding upload means traversal, size, type and a writable mount -- four
  controls, deliberately its own change.
- `question.import` is its own permission key, not a reuse of
  `question.generate`: importing brings in content written outside the
  platform, which a tenant may reasonably allow or forbid separately.

## Browser acceptance tests

tools/e2e, Playwright, driving both portals against the RUNNING STACK. Read
tools/e2e/README.md before touching it: it records five selector traps that
cost real time, including that a disabled button's accessible name carries its
`disabledReason`, and that the publish checkboxes arrive pre-checked inside
their labels so `check()` toggles them OFF.

- `npm run test:e2e` (stack must be up). NOT part of `npm run verify`.
- `cdn.playwright.dev` is blocked on this network, so the bundled Chromium
  cannot be downloaded: run with `E2E_BROWSER_CHANNEL=chrome`. CI should leave
  it unset and use the bundled browser.
- `workers: 1`, always. The suite drives one shared database through the real
  workflow.
- The learner specs PROVISION their precondition (publish questions, create
  and publish an assessment) rather than skipping. A skipped test reads like
  coverage in a summary.

## Taxonomy

Domains and topics are managed at Administration -> Knowledge Domains
(`/administration/taxonomy`), `taxonomy.manage`. Notes:
docs/migrations/TAXONOMY_ADMINISTRATION_NOTES.md

- NO SCHEMA MIGRATION was needed: `Domain` and `Topic` have carried every field
  since 0001 (`code` unique, `Topic` unique on `[domainId, slug]`). What was
  missing was the write path.
- A DOMAIN CODE is inside every published `KNZ-{CODE}-{YYYY}-{SEQ}`, which lives
  in the SharePoint Question Bank outside this platform. It is editable only
  while NOTHING references the domain, and then refused with
  `TAXONOMY_CODE_IMMUTABLE`. Display names stay editable forever.
- Nothing is ever deleted. Deactivation removes a domain or topic from every
  selection surface and leaves existing lineage intact; a job against a
  deactivated domain is refused by `createGenerationJob`.
- A topic's SLUG is derived from its name and is the identity within its domain,
  so "SAP Integration" and "sap integration" are one topic. A topic never
  changes domain.
- AN IMPORT NEVER CREATES TAXONOMY. `resolveImportTaxonomy` matches the file's
  own Domain/Topic columns on a folded code or name; anything unmatched refuses
  the WHOLE file with `TAXONOMY_MAPPING_REQUIRED`. The screen's dropdown is a
  fallback only for a file that names nothing, never a substitute for a name
  that failed to match — a spreadsheet typo would mint a permanent code.
- The seed still ships ONE domain and ONE topic. Taxonomy beyond that is a
  tenant decision; do not seed a customer's domain model.

## UI Source of Truth

2
 
3
Primary AI-readable UI specification:

- `docs/ui/KNOWZY_UI_SOURCE_OF_TRUTH.md`
  6

Stakeholder Word specification:

- `docs/ui/KNOWZY_Master_UI_UX_Design_and_Development_Prompt.docx`

Approved design references:

design/dashboard.png
design/knowledge-sources.png
design/ai-quiz-generation.png
design/review-queue.png
design/approvals.png
design/question-bank.png
design/assessments.png
design/reports.png
design/administration.png

UI modernization guidance:

docs/ui/ui-modernization.md

## Live Learning Portal UI

Detailed learner UI specification:

- `docs/ui/KNOWZY_LIVE_PORTAL_UI_SOURCE_OF_TRUTH.md`

Approved learner visual references:

- `design/approved/live-portal/learner-home-page.png`
- `design/approved/live-portal/my-learnings.png`
- `design/approved/live-portal/assessments.png`
- `design/approved/live-portal/discover.png`
- `design/approved/live-portal/badges.png`
- `design/approved/live-portal/knowledge-library.png`
- `design/approved/live-portal/my-progress.png`
- `design/approved/live-portal/help-and-support.png`

The existing Live Learning Portal code and APIs are the functional source of truth.

The learner Markdown specification is the detailed AI-readable UI source of truth.

The approved images are visual references only.

## UI Modernization (Phase 8) planning artifacts

- `docs/ui/full-solution-capability-matrix.md` classifies every feature visible in all 17 approved
  mockups: 41 IMPLEMENTED, 25 PARTIALLY_IMPLEMENTED, 7 PLANNED, 67 REQUIRES_BACKEND_EXTENSION,
  7 DISABLED_IN_CURRENT_RELEASE. Read it before building any screen.
- `docs/ui/ui-modernization-plan.md` holds the rollout plans (shared design system, authoring,
  learner), accessibility, responsive, browser E2E, visual QA, API extension requirements,
  production integration dependencies, and the milestones UI-M1..UI-M11, LIVE-UI-M2, and
  LIVE-FULL-M1..M7.
- `docs/ui/live-portal-capability-matrix.md` is superseded by the full matrix and kept only for
  traceability.

Three things a redesign will be tempted to do and must not:

1. Reinterpret assessments as courses to populate My Learnings (learner spec 7.2 forbids it).
2. Show "vs last month" deltas — no KPI history is stored anywhere, so none is computable.
3. Publish from the generation screen because the mockup has the button (authoring spec 15
   forbids it; it would defeat separation of duties).

Do not implement fake functionality merely to match a mockup.

Before implementing a learner feature, classify it as:

- IMPLEMENTED
- PARTIALLY_IMPLEMENTED
- PLANNED
- REQUIRES_BACKEND_EXTENSION
- DISABLED_IN_CURRENT_RELEASE

Active quiz integrity, answer-key protection, deterministic scoring, server-side authorization, and learner-data privacy are non-negotiable.

## Approved UI Source of Truth

Authoring and Administration Portal:

- docs/ui/KNOWZY_UI_SOURCE_OF_TRUTH.md

Live Learning Portal:

- docs/ui/KNOWZY_LIVE_PORTAL_UI_SOURCE_OF_TRUTH.md

Approved Authoring Visual References:

- design/approved/*.png

Approved Learner Visual References:

- design/approved/live-portal/*.png

The existing repository remains the functional source of truth.

These specifications define:

- design language
- component architecture
- navigation
- UX behaviour
- accessibility
- responsive behaviour

The approved mockups are visual references.

Do not implement fake functionality merely to match a mockup.

Features must be classified as:

- IMPLEMENTED
- PARTIALLY_IMPLEMENTED
- PLANNED
- REQUIRES_BACKEND_EXTENSION
- DISABLED_IN_CURRENT_RELEASE

Preserve:

- server-side authorization
- evidence verification
- approval gates
- separation of duties
- question traceability
- deterministic scoring
- answer-key protection
- audit logging

### Approved Design Asset Library

Asset integration specification:

- `docs/ui/KNOWZY_DESIGN_ASSET_INTEGRATION_AND_UI_POLISH.md`

Approved source asset pack:

- `design/approved/knowzy_design_elements_asset_pack/`

The source asset pack is immutable reference material.

The asset pack is an approved visual library, not a feature specification.

Before using an asset, classify the related capability through the existing capability matrices.

Do not activate an unimplemented feature merely because a visual asset exists for it.

Runtime assets must be installed using the strategy documented during implementation.

Interactive controls must remain semantic HTML or React controls.

### SharePoint Sync Manager

UI Specification:

- docs/ui/SHAREPOINT_SYNC_MANAGER_UI_SOURCE_OF_TRUTH.md

Approved Design:

- design/approved/sharepoint-sync-manager/sharepoint-sync-manager-dashboard.png

This module is separate from:

- KNOWZY Authoring Portal
- KNOWZY Live Learning Portal

It is responsible only for:

- Workflow administration
- Scheduling
- Monitoring
- Synchronization governance

Do not use it for learning, assessments, question generation, badges, or reporting.

The image is the visual source of truth.

The Markdown specification is the AI-readable source of truth.

BUILT 2026-09-23, SYNC-M1..M4: `apps/sync-web` on :3002, one page, no side nav.
The specification's own header block records exactly what of it is implemented.

- THIS RELEASE SYNCHRONIZES INTO KNOWZY. There is no destination model, and the
  header's second line ("Knowledge-source synchronization into KNOWZY") is
  load-bearing. A destination site/library/folder, two-way sync, syncing
  deletes back, writing metadata back, and a SharePoint Graph source are all
  rendered DISABLED reading "Requires Microsoft Graph write integration and
  tenant approval.", sourced from GET /authoring/sync/capabilities so the
  reason and the re-enabling are one change in one place. Do not add a
  destination selector that stores values nothing reads.
- A LOCAL ROOT PATH IS TYPED, NOT BROWSED. `requireAllowedLocalRoot` validates
  server-side against configured allowed roots, refuses traversal, relative
  paths and null bytes BEFORE the allow-list, refuses everything when no root
  is configured, and `isWithinRoot` compares SEGMENTS (`/corpus-secrets`
  startsWith `/corpus` is true and must not be). Never give the browser a
  server directory listing.
- WEEKLY and MONTHLY are fixed 7- and 30-day INTERVALS from the last run, not
  calendar anchors, and the UI says "Every 7 days". Calendar anchoring needs a
  timezone-aware library and a stored anchor.
- The adapter list comes from the ADAPTER REGISTRY, so a provider that does not
  exist cannot be selected.
- Scheduling runs in apps/jobs on pg-boss, one singleton key per due window.
  See "Gotchas" for the stuck-run reaper and the SYSTEM portal.
- It is DEPLOYABLE and HAS NOT BEEN DEPLOYED. No hosting target, environment or
  pipeline exists: docs/operations/SHAREPOINT_SYNC_MANAGER_DEPLOYMENT.md.
  ``
