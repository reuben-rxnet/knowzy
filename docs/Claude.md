# Knowzy

Architecture Source of Truth:
- /docs
- Where this file and /docs disagree, /docs wins.

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
1. Foundation
2. Identity and access
3. Sources and documents (mock adapter)
4. Generation and governance
5. Review and approval
6. Assessment, quiz, and scoring
7. SharePoint read integration
8. Question Bank write integration
9. Refreshers and recognition
10. Reporting and audit surfaces
11. Hardening and release

Phase 2 is Identity and access, not Knowledge Sources. Sources come in Phase 3
and depend on it: every route must have a declared policy, and the registry
test fails the build on a handler without one.

Current Status:
- Design phase completed (26 documents in /docs)
- Phase 1 Foundation completed AND validated by execution
- All 7 Phase 1 exit criteria verified — see Phase-1-Completion.md
- npm run verify passes: typecheck 26/26, lint 19/19, boundaries 0 errors,
  tests 140/140, build 19/19, format clean
- 3 migrations apply from empty; seed is idempotent
- Full docker compose stack verified: postgres, api, mcp, jobs, both web apps

Environment:
- Node.js, npm, Docker, Git all installed and working

Still Open:
- CI has never executed (the workflow encodes gates that pass locally)
- main is behind branch phase-1-validation
- No git remote configured
- Tenant values still required before Phase 7 — see
  docs/assumptions-and-tenant-configuration.md

Next Immediate Task:
1. Begin Phase 2: Identity and access
2. Start with the policy registry and engine in @knowzy/authorization, not with
   authentication. The registry completeness test constrains every later route.
3. Use the local stub issuer; Entra app registrations (T-01 to T-05) are not
   blocking for most of Phase 2.

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
