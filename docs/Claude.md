# Knowzy

Architecture Source of Truth:
- /docs

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
1. Foundation
2. Knowledge Sources
3. MCP
4. Authoring
5. Question Bank
6. Live Portal
7. Refreshers
8. Reporting
9. Badges & Certificates

Current Status:
- Design phase completed
- Architecture and design documentation available in /docs
- Phase 1 Foundation completed
- Monorepo structure generated
- Prisma schema generated
- Shared packages generated
- CI/CD and configuration generated

Important:
- Node.js not installed
- npm not installed
- Docker not installed
- No build, lint, test, migration, or runtime validation has been executed yet

Next Immediate Task:
1. Install Node.js LTS
2. Install Docker Desktop (if permitted)
3. Run:
   npm install
   npm run verify
   npm run build
4. Fix any issues surfaced during validation
5. Only then begin Phase 2: Knowledge Source Administration