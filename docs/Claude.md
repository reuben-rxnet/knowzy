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
1. Foundation                          DONE
2. Identity and access                 DONE (local stub issuer; Entra deferred)
3. Sources and documents (mock)        DONE
4. Generation and governance           DONE (deterministic local generator)
5. Review and approval                 DONE
6. Assessment, quiz, and scoring       DONE
7. SharePoint read integration         NOT STARTED
8. Question Bank write integration     PORT + MOCK DONE; adapter NOT STARTED
9. Refreshers and recognition          NOT STARTED
10. Reporting and audit surfaces       NOT STARTED
11. Hardening and release              NOT STARTED

Phase 2 is Identity and access, not Knowledge Sources. Sources come in Phase 3
and depend on it: every route must have a declared policy, and the registry
test fails the build on a handler without one.

Current Status:
- Phases 1-6 complete, plus M7 (the thin UI). All seven MVP objectives verified
  end to end IN A BROWSER on the mock adapters, with no tenant credentials.
  See docs/MVP-READINESS.md for the full assessment.
- Both portals serve real screens: authoring on :3000 (sources, document
  browser, generate, review queue, question approval, publish) and learning on
  :3001 (assessment list, start, quiz, results). Server components plus server
  actions — the browser never calls the API and never holds a subject header.
- Last live walkthrough (M7, through the two portals): source tested and
  synchronized, 6 drafts generated from 4 documents, claimed, submitted,
  approved by a different identity, published as
  KNZ-SUPPORT_OPS-2026-000001..006, an assessment published with a pinned pool
  of 6, three learner attempts including a mid-quiz resume, scored 100.00%
  EXPERT on the attempt answered correctly. Gate 13 failed for the author and
  passed for the approver, on screen, which is separation of duties visible in
  the UI.
- npm run verify passes: typecheck 30/30, lint 19/19, build 19/19,
  tests 430 passing + 6 todo across 14 files, boundaries 0 errors,
  codegen contract clean, format clean.
- The integration project is 189 of those tests, and until 2026-09-21 three of
  its suites (152 tests) only passed on a database where somebody had
  SYNCHRONIZED the mock source by hand. On a fresh database their beforeAll
  threw and vitest skipped them, which reads like success. CI now synchronizes
  the fixtures before the suites run, and asserts an extracted document exists.
- 3 migrations apply from empty; seed is idempotent.
- Full docker compose stack verified: postgres, api, mcp, jobs, both web apps.
- 19 of 36 MCP tools registered; 48 API routes, every one with a declared
  policy. M7 added three reads the UI needed: GET /authoring/taxonomy (so no
  screen asks for a pasted UUID), GET /authoring/assessments, and
  GET /authoring/questions/:id.

Environment:
- Node.js, npm, Docker, Git all installed and working

Still Open:
- The UI is the MINIMUM that demonstrates the workflow. No dashboard, badges,
  certificates, reports, or assessment builder (assessment creation is one form
  on the Publish page). See MVP-READINESS.md 7.1 for the full exclusion list.
- No test drives the UI. A broken screen is found by a person, not the build.
- No live Claude call. Generation uses a deterministic local generator and
  records modelId = knowzy-deterministic-local-1. Question QUALITY has never
  been tested against Claude, which is the product's actual purpose.
- CI first ran on 2026-09-21. Round 1 failed on `format:check`; round 2 passed
  static gates and supply chain, and failed on the integration job (fixtures)
  and all five image builds (an unresolvable action tag). Both fixed and
  verified locally. The trivy SCAN itself has still never executed against an
  image, so a base-image CVE could be the next red.
- Deferred with reasons in docs/SECURITY-EXCEPTIONS.md: Next.js 15 -> 16 and
  Vitest 2 -> 5. Major upgrades whose advisories are not reachable here; both
  entries expire 2026-12-31.
- phase-1-validation is an old branch and can be deleted.
- No automated end-to-end test. docs/initial-end-to-end-proof.md section 3
  defines a 36-step acceptance script; the equivalent has only ever been run
  by hand.
- Tenant values still required before Phase 7 — see
  docs/assumptions-and-tenant-configuration.md
- 9 recorded deviations from the design docs, each asserted by a test — see
  MVP-Plan.md "Recorded deviations".

Next Immediate Task:
1. Configure the git remote and let CI run once. Everything else is harder to
   trust until something outside this machine has verified the tree.
2. Wire the live Claude generator behind the existing QuestionGenerator port
   (packages/claude-services/src/generator.ts) and review a real batch.
3. Automate the end-to-end acceptance script, now that there is a UI to drive.

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
  authoring-web live-web. This wasted a diagnosis; the code was right the whole
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
- preflight.offeredActions is ALWAYS the four workflows.md 4.2 actions and
  never includes GENERATE_NEW, which is what a never-processed document
  recommends. Any UI listing the offered actions must union in the
  recommendation or the recommended action cannot be chosen.
