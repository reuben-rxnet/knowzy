# Knowzy

Architecture Source of Truth:
- /docs
- Where this file and /docs disagree, /docs wins.
- docs/MVP-READINESS.md is a STATUS REPORT, not a specification. If it and the
  code disagree, the code is right and the report is stale.

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
- Phases 1-6 complete. All seven MVP objectives verified end to end over HTTP
  on the mock adapters, with no tenant credentials.
  See docs/MVP-READINESS.md for the full assessment.
- Last live walkthrough: 5 questions generated from 2 documents, approved,
  published as KNZ-SUPPORT_OPS-2026-000001..005, an assessment published with
  its eligibility snapshot pinned, a session taken with resume mid-quiz,
  scored 75.00% PROFICIENT with per-topic accuracy.
- npm run verify passes: typecheck 30/30, lint 19/19, build 19/19,
  tests 430 passing + 6 todo across 14 files, boundaries 0 errors,
  codegen contract clean, format clean.
- 3 migrations apply from empty; seed is idempotent.
- Full docker compose stack verified: postgres, api, mcp, jobs, both web apps.
- 19 of 36 MCP tools registered; 45 API routes, every one with a declared
  policy.

Environment:
- Node.js, npm, Docker, Git all installed and working

Still Open:
- M7 (thin UI) is NOT built. Both web apps still serve Phase 1 shells, so
  nothing above is usable by a human without curl.
- No live Claude call. Generation uses a deterministic local generator and
  records modelId = knowzy-deterministic-local-1. Question QUALITY has never
  been tested against Claude, which is the product's actual purpose.
- CI has never executed (the workflow encodes gates that pass locally).
- No git remote configured. main is current; phase-1-validation is an old
  branch and can be deleted.
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
3. Then M7: the thin UI across both portals.

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
