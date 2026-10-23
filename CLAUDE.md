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
10. Reporting and audit surfaces R1 + R2 DONE (a visual dashboard to the
    approved design, twelve catalogue reports, nine read models, a daily
    append-only coverage snapshot, grid suppression, export, snapshots); the
    remaining catalogue entries, proficiency and recognition models NOT STARTED
11. Hardening and release NOT STARTED

Extension workstream (roadmap §3a), Competency and knowledge readiness:
COMPETENCY-M0/M1 DONE (specification, migration 0015, structure-only importer,
gap rule); COMPETENCY-M2 DONE 2026-10-07 (competency administration, migration
0016); AI DOCUMENT STUDIO M3 DONE 2026-10-14 (assessment preparation, migration
0018; see "AI Document Studio M3" below); M4 (upload) folded into M3; M5-M8
NOT STARTED. The 2026-10-07 brief was split into three slices: slice 1
(competency administration) and slice 2 (the Document Studio overview) are
DONE; slice 3, Knowledge Proficiency, is NOT STARTED and the owner said not to
begin it. See "Competency foundation" below.

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
- npm run verify passes: typecheck 35/35, lint 22/22,
  tests 1065 passing + 12 todo across 55 files, boundaries 0 errors,
  codegen contract clean, format clean. Re-counted 2026-09-27; see
  docs/project/STATUS_RECONCILIATION_2026-09-23.md for what was stale.
- `npm run verify`, `test`, `test:integration` and `db:reset` now WARN FIRST
  with the real row counts, what survives and what has to be redone
  (scripts/destructive-warning.ts). Interactive runs ask; CI prints and
  continues. They wiped a live walkthrough mid-click on 2026-09-26.
- npm run test:e2e: 79 passing + 1 skipped, 0 failed (re-run 2026-09-28 after UX-M2,
  with OpenAI approved and active; two specs that assumed it was not were made state-independent) across three projects, driving all three applications against the running stack. It is NOT part of verify —
  it needs the stack up. On a network that blocks cdn.playwright.dev, run it
  as E2E_BROWSER_CHANNEL=chrome npm run test:e2e.
- The integration project is 189 of those tests, and until 2026-09-21 three of
  its suites (152 tests) only passed on a database where somebody had
  SYNCHRONIZED the mock source by hand. On a fresh database their beforeAll
  threw and vitest skipped them, which reads like success. CI now synchronizes
  the fixtures before the suites run, and asserts an extracted document exists.
- 18 migrations apply from empty; seed is idempotent. 0018 is AI Document Studio
  M3: studio_upload, prepared_document, prepared_document_version and
  document_preparation_run, with READY/REJECTED CHECKs and a trigger refusing
  to delete a version questions descend from. 0017 is the Authoring Role
  Simplification: role.is_active, and the 0016 competency separation CHECKs
  dropped. 0016 is COMPETENCY-M2:
  version origin, definitions hash and editors; alias status; target editors and
  approved version; the append-only competency_definition_change; separation
  CHECKs. 0015 is COMPETENCY-M1:
  eleven competency REFERENCE-DEFINITION tables, no person-level table. 0014 is OPENAI-CODEX-01:
  estimated_input_tokens on generation_job and generation_provider_call. 0013 is Phase 10 R2:
  three read models and the append-only daily coverage_snapshot. 0012 is the reporting
  schema: six read models, a refresh ledger, a dataset cache, a snapshot store
  and three triggers on draft_question. 0011 is AI provider
  administration: `generation_provider_validation` (one row per readiness
  check) plus the `generation_provider_state` and `provider_validation_outcome`
  enums. 0010 is departments and roles. 0009 is the AI
  Generation Control Layer: REFUSED as a job state, the refusal-reason enum,
  cost columns, and generation_provider_call (one row per ATTEMPT). 0004 is PILOT-T2:
  section keys scoped per document, coverage split from generation outcome.
  0008 splits SKIPPED from FAILED on a sync. Taxonomy administration needed
  NO migration: Domain and Topic have carried every field since 0001.
- Full docker compose stack verified: postgres, api, mcp, jobs, all three web
  apps. All five images build and were SCANNED for the first time on
  2026-09-23: 16 HIGH/CRITICAL, reduced to 0.
- 19 of 36 MCP tools registered; 122 API routes (COMPETENCY-M2 added 14, Document Studio Slice 2 added 2, M3 added 13, Simple mode 2, question review 1), every one with a declared
  policy. M7 added three reads the UI needed: GET /authoring/taxonomy (so no
  screen asks for a pasted UUID), GET /authoring/assessments, and
  GET /authoring/questions/:id. Question import added 2, taxonomy
  administration 5, the Sync Manager 11 (2 read/aggregate plus 9 source
  administration), AI Usage & Budgets 2 (one read, one write), the four-axis
  filing 1 (PUT a question's filing), AI Providers 5 (one read plus settings,
  approval, active provider and validate), Phase 10 R1 reporting 7 (the
  catalogue, a dataset, an export, a snapshot write, a snapshot list, one
  snapshot, and an on-demand refresh), and R2 2 (coverage history, and an AI
  usage summary through the governance read), and P-5 1 (secret-source health), and GEN-PROVIDER-M1 1 (GET
  /authoring/generation/providers, under question.generate: the Generate
  screen's provider menu -- a menu, never the control).

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
- No live model call of any kind. Generation uses a deterministic local
  generator and records modelId = knowzy-deterministic-local-1. Question
  QUALITY has never been tested against a model, which is the product's actual
  purpose. The CEILINGS around a model call now exist and are enforced (see
  "AI Generation Control Layer"), so the day a credential arrives is a
  configuration change and a comparison, not a scramble.
- CI first ran on 2026-09-21. Runs #17 and #18 were RED, and 2026-09-24 found
  why: the SCHEMA DRIFT GATE had been failing since 0006 created
  draft_question_acquisition_idx that schema.prisma never declared, so
  `prisma migrate diff --exit-code` wanted to drop it. It reproduced nowhere
  locally because the gate needs a shadow database only CI creates. Fixed by
  declaring the index. To run the gate by hand:
  docker compose ... exec -T postgres psql -U knowzy -d postgres -c "CREATE DATABASE knowzy_shadow OWNER knowzy;"
  then npx prisma migrate diff --from-migrations packages/database/prisma/migrations
  --to-schema-datamodel packages/database/prisma/schema.prisma
  --shadow-database-url postgresql://knowzy:knowzy@localhost:5432/knowzy_shadow --exit-code
- CI HAD BEEN RED ON EVERY PUSH FROM 2026-09-24 TO 2026-10-14, unread because
  `gh` was absent. `gh` is installed and authenticated since 2026-10-21 (`gh run
list`, `gh run view <id> --log-failed`). The 2026-10-14 run failed three ways:
  the audit gate on newly published advisories, the fixture-sync step still
  acting as a DEPROVISIONED identity (source-administrator), and the image
  scan on deepmerge-ts shipped through the Prisma CLI (an optional peer of
  @prisma/client survives `npm prune --omit=dev`). All three fixed 2026-10-21,
  and fixing them exposed three more in the fixture-sync step: no package
  build before starting the api/mcp with tsx (exports point at dist), the
  job's KNOWZY_ENV=test making the SEED skip the local identities and the mock
  source (the step now seeds as local), and a Python f-string the runner
  rejected. RUN 39637973641 (2026-10-21) IS GREEN: every job, integration
  369/369 in 24 files with 4 fixtures extracted, all six images scanned clean.
  THE AUDIT GATE AND TRIVY READ LIVE ADVISORY DATABASES: a green run goes red
  with no commit. Read the run after every push; an unread run is not a pass.
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

0. AUTHORING ROLE SIMPLIFICATION DONE (2026-10-07): two active roles,
   separation of duties configured off (see "Roles"). If T-29 relied on
   two-person approval as a control, it needs restating
   (ENTERPRISE_PILOT_READINESS.md §12.15).
   XLSX-INTEGRITY-M1 is DONE (2026-09-29): cells placed by reference through
   one shared row parser; measured impact on the pilot was zero, so no re-sync.
   Open follow-up it exposed: NOTHING WRITES draft_question.needsRevalidation,
   so a draft is not proactively flagged when its section changes; gate 12
   re-verifying the evidence at approval is the control that actually holds.
1. SEND the T-29 request, and raise CP-5 (Document Studio: restructuring whole
   documents is a DIFFERENT processing purpose, not covered by the Codex
   generation approval) in the same conversation. It is drafted at
   docs/integrations/T29_PRIVACY_LEGAL_REQUEST.md and nobody in Privacy,
   Legal, InfoSec or Data Governance has seen it. Longest lead time on the
   critical path, and not an engineering action.
2. CI is now read with `gh` (installed 2026-10-21). Check every push.
3. Measure blind-stem answerability on the published questions. The
   confidence-component half of this is DONE and recorded in
   docs/integrations/LIVE_CLAUDE_EVALUATION_PLAN.md section 2.5; the
   blind-stem half needs a person and no credential.
4. Build the budget and cost layer -- DONE 2026-09-24 (AI-CONTROL-M1), with
   provider administration on top of it 2026-09-26 (AI-PROVIDER-M1). What
   remains of it was P-5: a SECRET RESOLVER -- BUILT 2026-09-27 for the local
   environment (see "Secret resolution and OpenAI readiness"); a deployed
   environment still needs Key Vault and a managed identity.
5. Wire the live Claude generator behind the existing QuestionGenerator port
   (packages/claude-services/src/generator.ts) and run the recorded
   comparison. Blocked on T-29 and T-28. Everything around it is now in place:
   enabling it is a configuration change made in a browser and audited, not a
   release.

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

- THE SOP SOURCE READS /corpus, WHICH FALLS BACK TO fixtures/pilot-mirror WHEN
  PILOT_CORPUS_HOST_PATH IS UNSET -- silently, 12 fixture files instead of the
  real SharePoint mirror. The path now lives in the git-ignored
  infrastructure/compose/.env. Before any measurement check
  `docker compose ... exec mcp sh -c 'find /corpus -type f | wc -l'` reads 32,
  not 12. A FULL sync does NOT mark vanished documents deleted (six fixture
  rows remain on the SOP source; EVAL-M1 finding F2).
- THE CODEX EVALUATION (EVAL-M1, 2026-09-28): Codex 56 / 49 accepted vs the
  deterministic 4 / 14 on the SOP / GenerationReady scope; coverage 44.1% vs
  3.4% on the SOPs. NOT yet adoptable under LIVE_CLAUDE_EVALUATION_PLAN.md 7:
  rubric, blind-stem and SME approval are unmeasured, cost is unobservable.
  Packets in RealWorldPilot/Evaluation/; tooling scripts/evaluation.ts. Never
  relax a 7 criterion after seeing results -- iterate the PROMPT instead.
- A host `npm install` DESYNCS the container's node_modules volume. Symptoms:
  "Cannot find module tsx/dist/preflight.cjs" or "@prisma/client did not
  initialize yet". Fix: docker compose ... up migrate (it runs npm ci and
  prisma generate inside the volume), then restart api and mcp.
- THREE INTEGRATION FILES WIPE THE DEV DATABASE WHEN RUN, EVEN ALONE: assessment-session,
  question-filing and review-pipeline `deleteMany({})` every draft question, job, preflight,
  published reference, assessment, session and result -- not just their own rows. "Run by file"
  is NOT safe. On 2026-10-22 one run destroyed the owner's own quizzes and every published
  question; there is no backup and WAL archiving is off. Grep a file for unscoped deletes and ASK
  before running it on the dev database, with a pg_dump first. Afterwards the mock bank JSON
  still lists the deleted ids (clear it, see below).
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
- `docker compose ... start <web containers>` RE-RUNS THE `migrate` SERVICE
  (every node service depends_on it), which runs `npm ci` and pulls
  node_modules out from under a RUNNING api: it dies minutes later with
  "Cannot find module tsx/dist/preflight.cjs", and a browser run fails with
  "socket hang up" from that point. Cost two full runs on 2026-10-07. ORDER:
  start the web containers FIRST, let migrate finish, THEN restart api mcp
  jobs and check `/repo/node_modules/tsx/dist/preflight.cjs` exists.
- SINCE 2026-10-22 `migrate` SKIPS `npm ci` and `prisma generate` when the
  lockfile and schema fingerprints in node_modules/.knowzy-stamps match. Docker
  restarts every container together after a reboot, and the unconditional
  `npm ci` killed a starting api ("Cannot find module .../fastify.js") twice.
  A changed lockfile or schema still reinstalls -- and then the ORDER above
  still applies.
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
- A MIGRATION PINS ITS OWN VERSION IN FOUR PLACES. `EXPECTED_MIGRATION` in
  apps/api/src/startup.ts, `expectedMigrationVersion` in apps/jobs and
  apps/mcp-server, and `MIGRATION` in packages/configuration/src/startup.test.ts.
  Add a migration without updating all four and every service REFUSES TO START
  with "The database is not at the expected migration version" -- which is the
  control working, and costs ten minutes if you do not know where to look.
- THE API CONTAINER RUNS A PACKAGE'S `dist`, NOT ITS `src`. `tsx watch` reloads
  apps/api, but `@knowzy/reporting` (and every other `@knowzy/*`) resolves
  through its package exports to `dist/index.js`. An edit to a package looked
  like it did nothing -- a 500 for a column already fixed. Fix: `npx tsc -b
packages/<name>`, then restart api. The tests do not see this, because
  vitest aliases `@knowzy/*` to `src`.
- A SCHEMA CHANGE NEEDS PRISMA GENERATE INSIDE THE CONTAINER VOLUME, not just
  on the host. Symptom: `PrismaClientValidationError: Unknown field X for
select statement on model Y` from the api while the host typechecks clean.
  Fix: docker compose ... up migrate, then restart api mcp jobs.
- NEVER MATCH AN XML ELEMENT WITH A `<x\b([^>]*)>...</x>` REGEX. `[^>]*` takes
  the `/` of a self-closing `<x .../>`, which then "opens" and swallows its
  neighbour. It hit XLSX `<c>`, `<row>`, `<si>` and `<t>` (XLSX-INTEGRITY-M1).
  Use elementsOf() in content-extraction/src/extractors/xlsx.ts: `/>` is empty,
  otherwise read to the element's OWN closing tag. A "no change" impact result
  is believed only beside a control run that shows a change.
- THE SELF-CLOSING TRAP WAS ALSO IN DOCX, PPTX AND stripElements until
  2026-10-22: an empty `<w:p/>` swallowed the next table (one pilot SOP
  extracted half its text) and stripping an always-self-closing element
  (`w:commentRangeStart`, `c:chart`) deleted the rest of the part. Use
  topLevelElements() in content-extraction/src/extractors/ooxml.ts for any
  OOXML element; a `<w:br/>` must become a TEXT RUN, since only `<w:t>` is read.
- A SYNC RE-EXTRACTS EVERY FILE ON EVERY RUN: the adapter's STATE_CHECKPOINT is
  never passed back (mcp-server source-administration.ts), so INCREMENTAL
  behaves as FULL and deletion detection never runs. An extractor change
  therefore reaches every document at the next sync, as a new version. Open.
- CONSECUTIVE BLANK CELLS NORMALIZE TO `- - -` WITH SHARED SPACES, and
  split(' - ') loses them. question-import's splitRow splits on / -(?= )/.
- `\b` INSIDE A JAVASCRIPT STRING LITERAL IS A BACKSPACE, not a regex word
  boundary. `new RegExp('^Author\b')` matches nothing and prints as
  /^Author/ in the failure message, so the character is invisible in the log
  too. This has now cost time twice (once via a Bash heredoc, once written
  directly). Use an explicit alternation such as '^Author( |$)'.
- A TEST HELPER CAN ASSERT NOTHING. `actAs` clicked the identity radio and then
  asserted the radio was checked -- which the click itself guarantees, so a
  switch that never reached the server read as success. It was invisible while
  every spec switched to identities whose pages look the same either way, and
  surfaced only when one asserted a REFUSAL. It now asserts the SHELL's
  acting-as label, which is server state.
- preflight.offeredActions is ALWAYS the four workflows.md 4.2 actions and
  never includes GENERATE_NEW, which is what a never-processed document
  recommends. Any UI listing the offered actions must union in the
  recommendation or the recommended action cannot be chosen.

## Roles

AUTHORING ROLE SIMPLIFICATION (2026-10-07, access-control.md §2.0, migration
0017). TWO ACTIVE ROLES: `KNOWZY_ADMINISTRATOR`, shown as "Authoring
Administrator" and holding EVERY permission key including `question.publish`,
and `LEARNER`. The other twelve roles are DEACTIVATED (`role.is_active =
false`), never deleted: history names them. A grant on an inactive role confers
NOTHING -- the identity reads filter on it, and a test fails if the filter goes.

SEPARATION OF DUTIES IS CONFIGURED OFF, NOT REMOVED. `loadSeparationSettings`
(packages/domain/src/review/separation-settings.ts) reads
`approval.authorMayApproveOwn`, `editorMayApproveOwn`, `approverMayPublishOwn`,
`competencyVersionEditorMayApprove` and `competencyTargetEditorMayApprove`
from platform configuration for the review, publish (API and MCP) and
competency services. Before 2026-10-07 those keys were declared but NEVER
READ. Code defaults stay STRICT, a malformed value reads as strict, and a
service called without settings is strict. The seed applies the decision ONCE
per key, marked in configuration_change with correlation
`authoring-role-simplification-2026-10-07`, so a later re-enable survives any
re-seed. 0017 dropped the 0016 competency separation CHECKs (a CHECK cannot
read a setting); creator, editors and approver are still written everywhere.

The retired local identities (author, approver, publisher, source and
assessment managers, the second administrator, manager...) are still SEEDED as
DEPROVISIONED users with revoked grants: audit rows name them, and the domain
integration suites use them as distinct people when testing the strict logic.
They appear in no identity menu, and a request as one is refused with
PORTAL_ACCESS_DENIED. The e2e suite has two identities, administrator and
learner; permission-refusal specs act as the Learner.

Rule 3 (no role holds approve and publish) still binds the SPECIALIST roles,
and a contract test checks it; the administrator is exempt by recorded
decision. Re-activating a specialist role restores the separation.

IDENTITY SWITCHING IS IN THE HEADER on every page of both portals since
2026-09-26 (`components/IdentityMenu.tsx`), not on the home page. Three things
learned building it: a `<details>` menu produces a HYDRATION MISMATCH because
the browser owns `open`, so it is a controlled client component with
`aria-expanded`; a client component MAY NOT import `lib/identity`, which reads
`next/headers`, so the layout passes the list in as data; and the e2e helper
asserts the SHELL's acting-as label, which is server state.

`knowzy-administrator@local.invalid` is the DEFAULT identity in every local
selector. Validate the whole workflow as that one identity with:

npx tsx scripts/pilot-demo.ts

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

## Competency foundation

BUILT 2026-09-29, COMPETENCY-M0/M1. Specification: docs/architecture.md §14 and
docs/competencies/ (seven documents; COMPETENCY_PRIVACY_AND_GOVERNANCE.md owns
the boundary). Migration 0015. It DOES NOT AUTHORIZE EMPLOYEE PERFORMANCE
EVALUATION, and the specification says so in those words.

- REFERENCE DEFINITIONS ONLY. No table holds a rating, self-assessment, manager
  assessment or imported per-person baseline. Adding one is a change to the
  privacy document first (decisions CP-1..CP-4 are open).
- THE REFERENCE WORKBOOK IS NEVER COMMITTED OR SENT ANYWHERE.
  RealWorldPilot/CompetencyModels/ is in .gitignore: it names people, their
  employee numbers, vendors and individual ratings. Test fixtures are synthetic,
  with planted values that tests assert never escape.
- Import: `npx tsx scripts/competency-import.ts --file <xlsx>` (dry run, no DB
  connection) then `--apply --version-label <label>`. Needs a built dist of
  domain, content-extraction and shared-types (`npx tsc -b packages/domain`).
  Apply is audited (ADMIN.COMPETENCY.IMPORT_APPLIED, counts only) and
  idempotent: a re-apply records NO_CHANGES. The dev database is migrated to
  0015 and deliberately NOT populated.
- NORMALIZATION IS A DECLARED TABLE (packages/domain/src/competency/
  reference-profile.ts), not an algorithm. One fold decides equality; an
  undeclared NEAR MATCH (edit distance <= 2) BLOCKS the apply rather than
  merging. "Oracle" under Database and under ERP are two competencies.
- readXlsxGrid keeps text for the first 6 rows and COUNTS the rest without
  decoding them. The planner reads header rows 1-3 only, takes the LOWEST
  header-region row, and refuses a row of rating codes as a header: row 4 is the
  first person row and a fully rated one is as dense as a header.
- THE ROLE CATALOGUE IS JobRole. The workbook's Role column is free-text person
  assignments and is never read. role_competency_expectation has no write path,
  and a CHECK refuses APPROVED without approver, time and reference.
- evaluateCompetencyGap returns NOT_CALCULABLE naming EVERY missing
  precondition (population, approved target, same-scale valid observation,
  declared source, as-of date). There is no data to run it on, and that is
  correct.
- The audit-family contract (packages/testing/contracts/registries.test.ts)
  counts families: 29 since ADMIN.COMPETENCY.
- COMPETENCY-M2 (2026-10-07): Administration -> Competencies,
  docs/competencies/COMPETENCY_ADMINISTRATION.md. Four things to keep:
  - `competency.manage` is held by KNOWZY_ADMINISTRATOR ONLY (a contract test);
    reads are `taxonomy.read`.
  - SEPARATION OF APPROVAL FROM EDITING IS A SETTING since the Authoring Role
    Simplification (`approval.competencyVersionEditorMayApprove`,
    `approval.competencyTargetEditorMayApprove`, both TRUE on this platform,
    strict by default). When strict, a version's creator and editors and a
    target's proposer and editors cannot approve it. The 0016 CHECKs were
    dropped in 0017. Editors of a version are READ from
    competency_definition_change, which is append-only (trigger) and has NO FK,
    as audit_log -- so a test can delete its framework.
  - A VERSION IS A SNAPSHOT: approval recomputes `definitionsSha256` inside the
    transaction; any later edit makes a DRAFT stale. The importer records the
    hash once, at version creation.
  - The dev database HOLDS the real RxSolutions framework (decision A4): 16
    categories, 71 competencies, 93 aliases, version 2024-05 DRAFT. NEVER write
    to it from a browser test or approve it from one (CM-1 is the owner's): the
    e2e spec is refusal-only, and write paths run on a throwaway framework in
    packages/domain/test/competency-administration.test.ts.
- AI DOCUMENT STUDIO SLICE 2 BUILT 2026-10-07 (AI_DOCUMENT_STUDIO_ARCHITECTURE.md
  §10), superseded in part by M3 (below): `/document-studio`, its own sidebar entry. Purpose
  DOCUMENT_RESTRUCTURE's approvals live in `llm.purposeApprovals`, NEVER in
  `llm.approvedProviders` -- a contract test scans both directions. Readiness
  (exists > capability > approval > client > configuration) yields
  BLOCKED_BY_APPROVAL / NOT_BUILT / READY; since M3 RESTRUCTURING_CLIENTS is
  ['OPENAI'], so READY needs the approval AND the configuration. Each status
  read audits PURPOSE_STATUS_EVALUATED.
- My Competencies, My Certifications, recommendations and competency
  reporting are DESIGNED ONLY. None gets a navigation item until it has a
  backend (capability matrix, last section).

## AI Document Studio M3

BUILT 2026-10-14. Specification: docs/competencies/AI_DOCUMENT_STUDIO_ARCHITECTURE.md
§11, which supersedes §2-§8 where they disagree. Add document -> Prepare ->
Review/edit -> Download Word/PDF -> Add to Question Generation Repository ->
Generate questions. Migration 0018, permission `document.prepare`, audit
family AUTHORING.DOCUMENT_PREPARATION (30 families).

- LIVE AI PREPARATION IS REFUSED UNTIL CP-5 IS RECORDED. The OpenAI preparer
  (claude-services document-preparation.ts, providerFetch, no tools,
  store:false, prompt hash-pinned) is built only when readiness is READY. NEVER
  record a DOCUMENT_RESTRUCTURE approval for OpenAI yourself: it is the real
  decision. Without one every page says the brief's sentence, "AI document
  preparation is not yet enabled for this environment. Contact your
  administrator."
- CP-5 IS RECORDED IN THE LOCAL ENVIRONMENT since 2026-10-14 12:01 UTC, by the
  OWNER as the Authoring Administrator ("Admin approval via email"), so OpenAI
  reads READY and the Studio prepares LIVE through the APIM gateway. The
  journey e2e spec therefore SKIPS (it must not send documents to a model) and
  the full run reads 2 skipped. The T-29 request is still unsent.
- THE TEST PREPARER IS NOT AI. Provider id TEST_PREPARATION (outside
  GENERATION_PROVIDER), flag documentStudio.testPreparation.enabled with
  ceiling ['local'] ONLY; the API treats an unknown environment as prod. It
  keeps the original's sentences verbatim, and the screen and downloads say
  "Test preparation — not AI". Do not relabel it.
- THE ORIGINAL IS NEVER WRITTEN. An upload is a server-named file
  (`<uuid>.<ext>`, written `wx`) in DOCUMENT_STUDIO_STORAGE_DIR
  (`/repo/.document-studio`, git- and docker-ignored), synchronized through
  MCP into the system source "AI Document Studio — Originals"
  (usableForGeneration false). A version added to the repository is a NEW
  file `<title> - Assessment-prepared v<n> (<8 hex>).md` in
  "Assessment-prepared documents". System sources are FOUND BY ROOT PATH, not
  name; a second root gets its name suffixed with the root.
- B2 STILL HOLDS: the API may not import content-extraction. The upload byte
  checks are domain policy (domain/document-studio/upload-inspection.ts, its
  own central-directory reader); the Word/PDF writers live in
  @knowzy/certificate-generator; extraction happens in the sync, and a file
  it cannot read is removed and its row marked DELETED.
- A HEADING IS NOT IN extracted_text for Markdown and Word: the sectionizer
  keeps it as the section's heading. Anything comparing against "the
  original" must use readOriginalText().comparisonText, or every original
  heading reads as "Added heading" and a figure in a heading as invented.
  Found by the browser run, not by a unit test.
- SIMPLE MODE IS THE DEFAULT since 2026-10-22 (spec §12): `documentStudio.mode` SIMPLE|FULL,
  switched at the foot of either Studio (PUT .../document-studio/mode, governance.ai.manage).
  Upload -> settings -> Generate quiz, from the upload directly, NO preparation. Uploads go to a
  THIRD system source, "Quick quiz uploads" (folder `quiz`, usable for generation); the Originals
  source stays unusable. One click is still preflight -> decide -> job (quick-actions.ts), only
  for GENERATE_NEW/GENERATE_ADDITIONAL, never REGENERATE; nothing publishes. Multiple choice,
  Yes/No and languages are DISABLED "Coming later" -- they need a new question kind / prompt.
  Then Approve selected (each question ticked by a person, unticked by default, NO select-all;
  claim -> submit -> approve per question) and Publish quiz (bank publish, then a FIXED_SET
  assessment of exactly those questions: `questionIds` are DRAFT ids, resolved to KNZ ids --
  published_question_reference.questionId is the KNZ id, and draft_question has its OWN
  internalQuestionId column, so join through the `question` relation). SIMPLE also trims the
  sidebar to Dashboard/Sources/Studio/Administration (layout reads the unaudited GET .../mode).
  The e2e suite pins FULL in globalSetup and restores it in globalTeardown, so the portal shows
  the full Studio while it runs. The Simple spec never clicks Generate (the active provider is
  live); its publish test uses a DETERMINISTIC job made through the API.
  A value exported from a 'use client' module is a client REFERENCE in a server component
  ("APPROVABLE.has is not a function"): shared constants go in a plain module (quiz-status.ts).
  SINCE 2026-10-23 SIMPLE IS THE ONLY STUDIO OFFERED: no switch on its page (FULL only via the
  setting). After approval: Publish as a quiz now, or Add to the question bank only (intent=bank,
  no assessment). /question-bank is the simple read-only bank. Learners get Review your answers
  via GET /learning/results/:id/review -- THE ONE LEARNER ROUTE THAT CARRIES AN ANSWER KEY, gated
  on own result + session not IN_PROGRESS + showAnswersAfterCompletion; it deliberately skips
  assertNoAnswerKey. "Build a quiz from the bank" (?from=bank) is BUILT: RANDOM_POOL over a
  topic or a whole domain, pinned at publication; the bank read's poolCounts cap the count.
  Learner self-service practice is NOT started and needs a written decision first.
- THE ROUTE-POLICY REGISTRY TEST SKIPPED EVERY NESTED ROUTE until 2026-10-23: Fastify's
  printRoutes prints a route extending another as an indented child under a vertical-bar tree
  line, and the line pattern did not allow that character. It now resolves children by column
  and expands merged param alternatives (:sourceDocumentId|:documentId).
- PREPARATION RUNS IN PARTS since 2026-10-22 (chunked-preparation.ts, prompt
  prepare-1.1.0): ~6,000 characters, three at once, a part under 85% word
  coverage retried once strictly. One call per document kept 69% of a
  25,000-character SOP. CONTENT_REDUCED warns under 90% coverage of the whole.
  Measure with word coverage WITH repetition, never a set.
- An invented FIGURE (digits) REFUSES a provider's output; changed must/should
  and possibly removed warnings are WARNINGS. A person's edit is never refused.
  Missing-information markers go into downloads, NEVER into the repository text.
- Superseded and REVALIDATION_REQUIRED versions are excluded through
  knowledge_document.isExcludedFromGeneration, which Generate already
  honours. revalidatePreparedVersions runs on Studio reads, prepare, add, the
  generation job route and after the API's sync routes -- NOT in the jobs
  scheduler, so a scheduled sync is caught at the next of those.
- Preparation tokens count in the SAME budget windows (usedTokensIn sums
  document_preparation_run too). A RUNNING run older than ten minutes is failed
  by the next request.
- A prepared document is the IMMEDIATE EVIDENCE SOURCE (STRICT verification
  against the prepared text). DS-1 dual verification is superseded. The
  question page shows the lineage note; GET /authoring/questions/:id carries
  source.prepared.
- E2E: fill a textarea only after `waitForLoadState('networkidle')` on a full
  navigation, or hydration replaces the typed value and the save sends the
  old text (looked like a working save: "Changes saved." and edited_at set).
  The journey spec skips unless the test preparer and storage exist, and
  refuses to run if a live provider is READY.

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
- Import has NO browser file upload. The file must reach a synchronized folder
  first. (The AI Document Studio accepts uploads since M3, with its own
  controls; an upload there becomes a document to prepare, not a bank to import.)
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

## AI Generation Control Layer

BUILT 2026-09-24. Provider-independent, enforced on EVERY provider including
the deterministic one, and validated against it with no credential anywhere.
Specification: architecture.md 9.0 (amended in the same change, because 9 was
explicitly single-provider and /docs outranks the code). Full detail:
docs/governance/AI_USAGE_AND_BUDGETS.md.

- `runGenerationJob` REQUIRES a `control` argument. Required, not optional: an
  optional control layer is one a caller forgets, and the caller most likely to
  forget it is a future one adding a provider that bills per token. A contract
  test asserts the service contains no direct `provider.generate(` call.
- REFUSED is a JobState. A control decision is not a failure; recording one as
  FAILED would count every working budget as a defect in the metrics that exist
  to show the controls holding. `refusalReason` is a closed enum and always set
  with that state.
- AN UNOBSERVABLE COST IS NULL, NEVER 0. Written only where the provider
  declares `reportsCost` AND the run is PLATFORM_MANAGED. A per-seat licence, a
  user-managed run and a missing price all record null with a reason. The
  deterministic provider is the ONE case where 0 is a measurement.
  `aggregateCost` refuses a total when any contributor is unobservable, because
  summing only the observable part presents an undercount as a total.
- THE ACCOUNTING UNIT IS THE ATTEMPT: one `generation_provider_call` row per
  call. That is what makes "retries count against the budget" true, and it is
  the sample set for provider health and metrics. Budget windows therefore read
  call rows and start at this milestone, while activity figures read
  generation_job and go back further -- the page says so rather than
  back-filling rows nobody measured.
- PROVIDER STATE HAS FIVE VALUES AND THE ORDER OF THE CHECKS IS THE POLICY:
  capability, then approval, then implementation, then credential -- most
  permanent first. Reversing the first two would tell somebody to get Copilot
  approved for a use it can never satisfy. `BLOCKED_BY_APPROVAL` is how T-29
  becomes a control: a credential is not enough.
- Configuration is one family, `llm.*`, and the per-provider part is a VALUE
  (`llm.providerLimits`) rather than five key names per provider. Two plans
  named the same ceilings differently and were CORRECTED rather than duplicated
  -- a second family of names is how two budgets end up half-enforced.
- An administrator sets a per-provider ceiling from Governance -> AI Usage &
  Budgets (`platform.configure`). It is the platform's FIRST configuration write
  path: application_configuration + configuration_change + an audited
  previous/new value. Clearing every field REMOVES the override; setting 0
  forbids generation. Two different gestures, deliberately.
- MALFORMED_OUTPUT is not retryable. A response that arrived and failed to parse
  is the bounded single repair path -- the tokens are already spent, and
  retrying could double-charge a partial success. Anything unrecognised is
  treated as permanent.
- OPENAI is DECLARED, not registered. No provider client exists in this build,
  so every external provider reads UNAVAILABLE or BLOCKED_* with its reason on
  the page. Do not register a stand-in.
- PROVIDER STATE HAS SIX VALUES SINCE 2026-09-26, and the sixth is different in
  kind. `OVER_BUDGET` is assigned by the USAGE READ MODEL, never by the
  registry: the registry has no database (B4) and budget consumption is a
  query. It applies only to a provider the registry already called AVAILABLE,
  its test matches what `checkWindowBudgets` enforces so the page cannot
  disagree with the refusal, and it is NEVER PERSISTED -- a stored OVER_BUDGET
  is false the moment a window rolls over. The DB enum has five members and the
  TS union has six, deliberately.
- THERE IS NO QUEUE for a job over the concurrency cap, and the page says so.
  Generation runs inside the request that asks for it, so a "queued" figure
  would be zero forever -- a number that can only be zero implies a mechanism
  that does not exist. What IS shown is the ACTIVE count, from the same query
  the refusal makes. Real queueing means a job runner consuming JobState.QUEUED
  and a different Generate screen; it is its own milestone.

## AI Providers administration

BUILT 2026-09-26, AI-PROVIDER-M1. Administration -> AI Providers
(`/administration/providers`), migration 0011. Full detail:
docs/governance/AI_PROVIDER_ADMINISTRATION.md. Specification: architecture.md
9.0 rules 7 and 8, added in the same change.

- FOUR SEPARATE WRITES, and the split that matters is SETTINGS vs APPROVAL.
  `llm.providerSettings` (enabled, endpoint, model, credential REFERENCE,
  sampling), `llm.approvedProviders` (its own dialog, REQUIRES a reference to
  where the approval is held), `llm.activeProvider` (refused unless the
  provider is AVAILABLE), and a recorded validation. An "Approved" checkbox
  beside "Enabled" is one somebody ticks on the way past, and
  BLOCKED_BY_APPROVAL is the control that makes T-29 real.
- A CREDENTIAL IS A REFERENCE, NEVER A VALUE. `keyvault://{vault}/secrets/{name}`,
  validated by `SecretReferenceSchema`; a pasted key is refused at the schema.
  `redact()` in provider-administration.ts strips `apiKeyRef` before any audit
  or configuration_change row is written -- at WRITE time (audit-model.md 7).
  Verified: zero rows in either table contain `keyvault://`. The form field is
  write-only and starts empty.
- AN UNDECIDED PROVIDER IS DISABLED. Absent `enabled` is not enablement: a
  provider nobody turned on must not start billing because a credential
  appeared. DETERMINISTIC_LOCAL is exempt and cannot be disabled -- it is the
  floor, and a test asserts it.
- VALIDATE DOES NOT CALL A PROVIDER, and the result says so per check.
  Capability, approval, implementation, credential, live call; each PASSED,
  FAILED or NOT_ATTEMPTED; outcome PASSED, FAILED or INCOMPLETE. LIVE_CALL is
  always NOT_ATTEMPTED for an external provider and its detail says
  authentication, reachability and model availability are UNVERIFIED. Never add
  an outcome meaning "probably fine", and never report a pass from a
  configuration read -- that is the sentence somebody quotes in an incident.
- ONE VALIDATION ROW PER ATTEMPT (`generation_provider_validation`), not a
  mutable last-validation column: the question is "what did it say, and has
  anybody checked since". The history survives a settings reset.
- THREE NEW SECRET-REF ENV VARS are declared and OPTIONAL IN EVERY ENVIRONMENT:
  OPENAI_API_KEY_REF, AZURE_OPENAI_KEY_REF, COPILOT_CLIENT_ID_REF. Nothing can
  spend them, so requiring one would block a deployment; declaring them means
  the day one arrives it is validated AS A REFERENCE.
- P-5 (2026-09-26 text, now superseded -- see the next section): there was no secret resolver,
  so a recorded reference reports "recorded, unresolvable here". Do not treat
  "a reference is recorded" as "a credential works".

## Secret resolution and OpenAI readiness

BUILT 2026-09-27, P-5 and OPENAI-CODEX-00. Provider order agreed: OpenAI Codex,
then Claude, then Copilot, then Azure OpenAI. Specification: architecture.md
9.0 rules 9 and 10; detail in docs/governance/AI_PROVIDER_ADMINISTRATION.md
3.2, 4.1 and 5.1.

- A REFERENCE IS `localstore://{name}` OR `keyvault://{vault}/secrets/{name}`.
  The local secure store is LOCAL ONLY (the resolver and startup both refuse it
  elsewhere); Key Vault is declared and reports SOURCE_UNAVAILABLE -- no client.
- A KEY ENTERS THE STORE ONLY THROUGH `npm run secrets -- set <name>` (hidden
  prompt or stdin). The store is `.secrets/` at the repo root, in .gitignore
  AND .dockerignore, seen by the api container at /repo/.secrets
  (KNOWZY_LOCAL_SECRET_DIR). Never add an upload, route or form field for a key.
- A RESOLVED SECRET IS A `SecretValue` and `reveal()` is called in ONE
  production file since GATEWAY-M1: packages/claude-services/src/
  provider-request.ts (`providerFetch`), which BOTH Test connection and
  generation send through. A contract test fails on a second call site. Resolutions are audited as SECRET_VALIDATED with a
  reference FINGERPRINT, never the reference.
- OPENAI GENERATES SINCE OPENAI-CODEX-01 (2026-09-27), and FIRST RAN LIVE on
  2026-09-28 through the Azure APIM Codex gateway, on the SYNTHETIC Mock
  Support Operations source only: 17/17 accepted, 0 rejected, all STRICT
  evidence, 3,564/3,234 tokens, cost not observable (no price). The approval
  is a Teams message, recorded with that reference. OpenAI is ENABLED and
  the ACTIVE provider, so the Generate screen now defaults to Codex -- and its
  source is the FIRST usable one (the GenerationReady corpus), not Mock. openai.ts stays readiness-only (GET, a
  contract test forbids a POST there); openai-generation.ts POSTs ONLY to
  /responses or /chat/completions with the shared framed prompt, a strict
  schema, `tools: GENERATION_TOOL_GRANT` and `store: false`. Settings gain
  `apiStyle` and `authHeaderName` (a gateway's own header). The route takes
  the job's model from the provider's settings and refuses with no model.
  Readiness: docs/integrations/OPENAI_CODEX_GENERATION_READINESS.md; results
  (Arm A measured, Arm B refused): OPENAI_CODEX_EVALUATION_RESULTS.md.
- A PROVIDER THAT THROWS ENDS ITS JOB FAILED (`recordJobFailure`, audit
  JOB_FAILED with the error CLASS). Before 0014 anything but a control refusal
  left the job RUNNING forever. `TimeoutError` classifies as TIMEOUT.
- THERE ARE TWO PROVIDER REGISTRIES: the control registry decides state inside
  invokeWithControls; the API registry (apps/api provider-registry.ts)
  constructs the instance. A new provider must be in both.
- THE KEY GOES ONLY TO AN ALLOW-LISTED HOST (api.openai.com, plus
  LLM_ENDPOINT_ALLOWLIST from the deployment, never from the screen), https
  only (loopback excepted), redirects refused, and the provider's error
  MESSAGE is discarded -- OpenAI's 401 quotes a masked key.
- LIVE READINESS CHECKS RUN BEFORE THE T-29 APPROVAL. They carry no data.
  Generation remains BLOCKED_BY_APPROVAL. Put this in front of Privacy.
- READINESS (CONFIGURED/RESOLVED/AUTHENTICATED/...) IS DERIVED, NEVER STORED,
  and only from a validation whose settings fingerprint matches the settings
  in force. It is not a ProviderState; the gate is unchanged.
- AN EMPTY CREDENTIAL BOX NOW KEEPS THE RECORDED REFERENCE. Before P-5 a
  re-save silently dropped it. Removing it is the `removeApiKeyRef` flag.
- apps/api/test/provider-readiness.test.ts drives the whole path against a
  FAKE OpenAI on 127.0.0.1 and a temporary store, and RESTORES
  llm.providerSettings afterwards. The e2e suite assumes OpenAI unconfigured.
- GATEWAY-M1 (2026-09-28): the Azure APIM Codex gateway. Settings gain
  `authLocation` (HEADER | QUERY_PARAMETER, no fallback), `authQueryParameterName`
  and `extraHeaders` (non-secret, max 5, credential-shaped/protocol names
  refused). `sanitizeUrl` redacts CREDENTIAL_QUERY_PARAMETERS by exact name.
  LLM_ENDPOINT_ALLOWLIST=dev-apim-ai.luxottica.com on the compose api service.
  The gateway answers 404 for /models WITH AND WITHOUT the key, so Test
  connection cannot observe authentication: it reports AUTHENTICATION
  NOT_ATTEMPTED, MODEL SKIPPED, readiness RESOLVED. That is correct; do not
  "fix" it with a Responses call. MODEL_EXECUTION is a tenth check, always
  NOT_ATTEMPTED; SKIPPED is never a pass. The AI Providers e2e spec SAVES,
  CLEARS and RESTORES OpenAI's settings, and never touches its approval.
  OpenAI is configured, APPROVED (Teams message, 2026-09-28), ENABLED and ACTIVE.
- GEN-PROVIDER-M1: the Generate screen lists every provider, unavailable ones
  DISABLED with their reason, defaulting to the ACTIVE provider when it can
  run. A job with no providerId still defaults to DETERMINISTIC_LOCAL in the
  API, so only the screen's default follows the active provider. THE E2E
  GENERATION SPEC PINS DETERMINISTIC_LOCAL -- once a network provider is
  active it would otherwise send real documents out. "Enable and make active"
  and "Replace reference" are on AI Providers.
- scripts/baseline.ts --generate "<source>" --provider <id> --outcomes <file>
  runs one comparison arm and records a refusal as the arm's result. --reset
  KEEPS drafts with published lineage (FK) and says so.

## Taxonomy

FOUR catalogues are managed at Administration -> Knowledge Domains
(`/administration/taxonomy`), `taxonomy.manage`: domains, topics, DEPARTMENTS
and ROLES. Notes: docs/migrations/TAXONOMY_ADMINISTRATION_NOTES.md

A question is filed under Department, Role, Domain and Topic. The first two
arrived 2026-09-26 (migration 0010) on request; things to know:

- The model is `JobRole` (table `job_role`), NOT `Role`. `Role` is the RBAC role,
  with `role_permission` and `user_role` beside it. Two concepts sharing one
  name in one schema is how a permission check ends up reading an org chart.
  The UI says "Role", which is what a person calls it.
- `departmentId` and `jobRoleId` are NULLABLE on draft_question,
  published_question_reference and generation_job. Every question drafted before
  0010 has neither, and a NOT NULL column would have meant inventing values or
  refusing to migrate.
- A ROLE IS INDEPENDENT OF A DEPARTMENT. No FK between them: an organization
  files by both axes, and a hierarchy would make every role of one department
  unusable by another. A test asserts it, so reintroducing the hierarchy means
  deleting that test on purpose.
- Both codes are normalized by the SAME `normalizeDomainCode`, so `support-ng`
  and `Support NG` are one code. A code is editable only while nothing
  references it, then refused with `TAXONOMY_CODE_IMMUTABLE` -- it is copied
  into the published record and is what past reports grouped by. Display names
  stay editable forever.
- Filing against a DEACTIVATED department or role is refused with
  `TAXONOMY_INACTIVE`. Deactivation that only hid the row would let a stale
  dropdown keep filing for months.
- A department is NOT a security boundary. Authorization is roles and DataScope;
  these are labels for filing and reporting.
- THE FILING TAB (`/review/<id>?tab=filing`, built 2026-09-26) shows all four
  axes and edits only two. Domain and topic have NO CONTROL at all: the domain
  code is inside the published `KNZ-{CODE}-{YYYY}-{SEQ}` and the topic is what
  the preflight authorized. Department and role are editable in DRAFT,
  AUTHOR_REVIEW and CHANGES_REQUESTED and READ-ONLY after, because a question is
  approved AS FILED -- the gates and the approval record are taken at that
  moment. `setQuestionFiling` writes a new version with
  `evidenceReverified: false` (re-filing touches no text, and claiming a check
  that never ran in an append-only table is a permanent lie) and audits
  previous/new BY CODE, never by id.
- ABSENT IS NOT THE SAME AS NULL IN A UI, and this cost a screenshot. The
  filing badge tested `=== null` while the API response had no such key, so it
  printed the word "undefined" twice on screen. `filingOf()` normalizes both to
  null before any rendering decision. Any optional object from an API needs the
  same treatment.

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

UX-M2 PRODUCT POLISH (2026-09-28): docs/ui/UX_M2_PRODUCT_POLISH_REVIEW.md
records the findings, the changes and the remaining debt (D1-D8). Four
things a later change must keep: the Generate "Before you generate" panel
shows only what the form will SEND (it re-reads the DOM after React's
post-action reset); the AI Providers "At a glance" overview is a CARD LIST,
not a table, because the e2e specs locate provider rows by id with
`.first()` and a second grid of rows would take their matches; the KPI
formulas live in one disclosure under the cards, not in each caption; and
`components/Problem.tsx` maps codes to a "What you can do" sentence, with
generation controls rendered as REFUSALS, never as errors.

LEARNER PREVIEW PAGES (LIVE-PREVIEW-M1, 2026-09-27, product owner's request):
/my-learnings, /discover, /knowledge-library and /help are PREVIEWS. The nav
item keeps its unreleased status and gains `preview: true` (a test refuses a
preview marked IMPLEMENTED). Illustrative content goes ONLY inside
`ExampleRegion` (dashed, tagged on screen), every control in one is disabled,
and every string -- examples included, under `ex.*` -- lives in
apps/live-web/src/copy.ts so no-fabricated-metrics scans it.
ALL EIGHT learner destinations open (M2 added /badges and /my-progress); a
test asserts every LEARNER_NAV item has an href. The list is
docs/ui/PLANNED_FEATURE_SCREEN_CATALOG.md.
NAVIGATION AT EVERY WIDTH (UX-M1): lg+ full sidebar, md-lg `SideNav
variant="rail"`, below lg a `NavDrawer` (header menu button, same SideNav,
dialog focus trap, focus on the current link). A `knowzy-sr-only` element
inside a scroll box escapes it unless an ancestor is positioned -- DataTable
and Card are `relative` for that reason -- and a TABLE cannot be made sr-only
at all (CSS will not shrink it): hide it with a wrapper div. Real sections use
only GET /learning/assessments and carry the "Live" tag. Promoting a preview to
real means removing its frames, not relabelling them.

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

### Reporting & Analytics (Phase 10)

UI Specification:

- docs/ui/REPORTING_AND_ANALYTICS_UI_SOURCE_OF_TRUTH.md

Approved Design:

- design/approved/reporting-and-analytics/KNOWZY-reporting-and-analytics-dashboard.png

The image is the visual source of truth. The Markdown is the AI-readable source
of truth. reporting.md is the authority on read models, the catalogue,
suppression and the publication lifecycle, and it OUTRANKS the mockup.

PHASE 10 R1 BUILT 2026-09-26: migration 0012, six read models, `/reports` with
five reports, suppression, an audited export and snapshots. The specification's
section 15 records what landed against each of the ten sections.

The specification's section 0 names four
widgets that cannot be built as drawn, and each one is a thing an implementer
would otherwise ship and be believed about:

- "VS PREVIOUS PERIOD" ON EVERY KPI CARD. No KPI history is stored. Phase 10's
  day-grained read models make a delta honest for metrics derived from DATED
  rows (generations, publications, attempts) and still impossible for
  point-in-time state: COVERAGE HAS NO HISTORY and neither does a source count.
  The spec marks each of the eight cards individually.
- PROVIDER FIGURES FOR CODEX, CLAUDE AND COPILOT. No client exists for any of
  them, so the honest values are "Not Yet Recorded"; Copilot is a per-seat
  licence whose cost is "Not observable" by design; and the deterministic
  provider's cost is 0.000000, not $12.54. All four read "Healthy" in the
  mockup where the truth is UNKNOWN -- and UNKNOWN is not healthy.
- "AI PROVIDER VALIDATED -- CLAUDE CONNECTION VERIFIED" in the activity feed.
  Nothing in this build can verify a connection; a validation marks the live
  call NOT_ATTEMPTED.
- THE LEARNER PERFORMANCE HEATMAP (BUILT IN R2, see below), 30 cells of learner averages with no
  suppression anywhere. That is the identifying aggregate reporting.md 7 S1
  governs, so some cells WILL read SUPPRESSED and the design has to accept that
  before it is built. It is also blocked twice more: a learner has no
  department (department is a label on a QUESTION), and the person-grouping
  model Team/UserTeam has existed since 0001 with ZERO ROWS AND NO WRITE PATH --
  the same shape taxonomy had.

Two navigation decisions the mockup forces, both recorded in the spec: AI Usage
& Budgets and the Audit Explorer ALREADY EXIST under Governance and must not be
duplicated as reporting screens, and the eight sidebar entries should be a tab
strip under one Reports rail entry, as Governance and Administration already
are.

Phase 10 R1 delivered sections 3 (partly), 4, 5, 6 and 8. PHASE 10 R2 BUILT
2026-09-27 (migration 0013) delivers ALL TEN, after two product decisions:

- D-1: DEPARTMENT + JOB ROLE IS THE REPORTING HIERARCHY. Do not build team
  administration, screens or APIs; Team stays a future extensibility point.
  The learner heatmap groups by the department the QUESTIONS were filed under
  (rm_topic_attempt), because a learner has no department.
- R-1: COVERAGE HISTORY IS PERMANENT. reporting.coverage_snapshot, one row per
  UTC day, APPEND-ONLY (UPDATE and DELETE are refused by trigger), NEVER
  BACK-FILLED, captured at 00:05 UTC by the jobs runner. A STATE KPI compares
  against the snapshot of the period's start day; a FLOW KPI against the
  previous window of its dated rows. No base reads "Not Yet Available".
  NEVER PLANT A BACK-DATED SNAPSHOT IN A TEST: it can never be deleted from the
  shared database.
- "VS PREVIOUS" COPY IS ALLOWED ONLY UNDER `rep.cmp*`, rendered only by
  components/KpiComparison.tsx, whose first branch is the non-AVAILABLE
  wording. no-fabricated-metrics.test.ts enforces all three. Everywhere else
  the comparison ban stands.
- Completions are audited as LEARNING.RESULT.SCORED. LEARNING.SESSION.COMPLETED
  is registered and has never been written.

## Reporting read models (Phase 10 R1)

BUILT 2026-09-26, migration 0012. Specification: docs/reporting.md, which
OUTRANKS the mockup. Six read models in their OWN PostgreSQL schema,
`reporting`, none of them modelled in Prisma.

- THE SCHEMA IS INVISIBLE TO PRISMA, and that is what makes it work without the
  `multiSchema` preview feature: `prisma migrate diff` only sees the schema its
  connection string names, so the drift gate passes with six read models,
  three triggers and four functions it knows nothing about. Four of the six are
  MATERIALIZED VIEWS, which Prisma cannot express anyway.
- `rm_question_pipeline` IS MAINTAINED BY A DATABASE TRIGGER, not by a call
  site. D1 asks for the counter to be written in the transition's own
  transaction; `draft_question` is moved by at least eight paths and a ninth
  will be added by somebody who has not read this file. Three statement-level
  triggers (INSERT/UPDATE/DELETE, with transition tables) call one function per
  affected domain. The UPDATE trigger reads BOTH the old and new tables,
  because `domain_id` is not in the immutability list and a question that moves
  domain leaves two counters wrong.
- IT RECOMPUTES A DOMAIN, IT DOES NOT INCREMENT. A +1/-1 counter is correct
  until somebody adds a lifecycle state or a transaction half-rolls-back, and
  then it is wrong forever with nothing on screen saying so. A GROUP BY over
  one domain costs a few milliseconds and cannot drift.
- `REFRESH MATERIALIZED VIEW CONCURRENTLY` REQUIRES A UNIQUE INDEX ON PLAIN
  COLUMNS. `rm_filing_coverage` first used a COALESCE expression index over its
  nullable department and role, and the refresh failed with
  `55000: cannot refresh materialized view concurrently`. It now carries
  `department_key`/`job_role_key` columns coalesced to the nil uuid for the
  index, and the nullable ids for reading. THE NIL UUID IS NEVER DISPLAYED.
- `asOf` COMES FROM `reporting.refresh_state`, NEVER FROM `now()`. A model that
  has never refreshed reports null and the screen says "never refreshed" rather
  than drawing zeros. A FAILED refresh does not touch `refreshed_at`, so the
  age keeps rising and the panel is labelled -- it is never blanked.
- SEED THE LEDGER BEFORE THE FIRST BUILD. The migration's first version
  inserted the `refresh_state` rows at the END, so the first build's UPDATE
  matched nothing and the model held correct data while reading PENDING.
- SUPPRESSION IS PURE AND HAS NO OVERRIDE. `applySuppression` takes rows and a
  threshold. It implements S1 and, unusually, S3 -- COMPLEMENTARY suppression:
  hiding one cell while publishing the total that reveals it is not
  suppression. `minimumGroupSize` is clamped UPWARD only, so a configured 2
  becomes 5. It applies to ONE of the five reports, because a question is not a
  person and suppressing question counts by department protects nobody.
- A WITHHELD TOTAL IS NOT ZERO. S4 keeps a suppressed row out of every visible
  total, so a report whose only row is suppressed has a total of 0 -- which
  reads as "none". Every dataset carries `totalsPartial` per metric and the
  screens render "Withheld" or `>= n`. Found in a screenshot, not in a test.
- THE DATASET CACHE KEY INCLUDES THE CALLER'S SCOPE HASH AND THE MODEL'S asOf.
  Scope, because a cache keyed on the report alone would serve one caller's
  suppressed dataset to another. `asOf`, because a refresh then invalidates
  every entry BY CONSTRUCTION rather than by a sweep somebody forgets. A
  dataset whose model has never refreshed is NOT cached: its key would be
  `...:never` and the first refresh would not displace it.
- A SNAPSHOT IS NOT A PUBLICATION. reporting.md 8.2 U1: a publication is a
  definition plus an audience, re-rendered per viewer under their own scope. A
  snapshot is a fixed, audited capture, and it stores withheld cells AS
  WITHHELD -- storing the pre-suppression rows "for someone with more access"
  would make the table a way to read around S1.
- DRIFT IS REPORTED, NEVER CORRECTED (D7). The nightly reconciler FULL OUTER
  JOINs the counter against `draft_question` and raises one
  PlatformConsistencyFinding per discrepancy. The outer join is the point: a
  counter row with no questions behind it and a question group with no counter
  row are both drift, and the second is what a dropped trigger looks like.
- RAW SQL BELONGS IN @knowzy/reporting, NOT IN THE API. Content rule C4 is
  relaxed for that package and enforced everywhere else; the first version of
  the reports route read `refresh_state` directly and was refused by lint.
  `readFreshness` and `readAllFreshness` exist for that reason.
- ONE QUERY PATH. The screen, the CSV and a snapshot all call `runDataset`, so
  scope, window and suppression cannot differ between them (B1/B2).

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
