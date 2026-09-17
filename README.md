# Knowzy

AI-powered knowledge proficiency platform. Turns existing enterprise knowledge
into approved, reusable assessments.

**The design is the source of truth. It lives in [`docs/`](docs/README.md).**
This file covers only how to run and work on the code; it deliberately repeats
nothing from the design set. Where code and documentation disagree, the
documentation is right and the code is the defect.

| I want to…                        | Read                                                             |
| --------------------------------- | ---------------------------------------------------------------- |
| Understand what this is           | [docs/executive-summary.md](docs/executive-summary.md)           |
| Understand how it is built        | [docs/architecture.md](docs/architecture.md)                     |
| Find my way around the repository | [docs/repository-structure.md](docs/repository-structure.md)     |
| Know what ships when              | [docs/implementation-roadmap.md](docs/implementation-roadmap.md) |
| Know what a term means            | [docs/glossary.md](docs/glossary.md)                             |

---

## Status: Phase 1 — Foundation

Phase 1 of eleven ([implementation-roadmap.md §3](docs/implementation-roadmap.md)).
What exists and what does not:

| Built                                                    | Not built yet                             |
| -------------------------------------------------------- | ----------------------------------------- |
| Monorepo, package boundaries enforced in CI              | Identity and authorization (Phase 2)      |
| Full Prisma schema, migrations, seeds                    | Knowledge sources and documents (Phase 3) |
| Layered configuration, feature flags, startup validation | Generation and governance (Phase 4)       |
| Redaction, structured logging, correlation               | Review and approval (Phase 5)             |
| Transactional audit writer                               | Assessments, quiz, scoring (Phase 6)      |
| Local Docker topology, CI pipeline                       | Everything in Phases 7–11                 |

Nine of the fourteen packages are deliberate placeholders. They exist so the
boundary rules apply from the first commit — a rule that only starts applying
once the code arrives is a rule the code will already have broken. Each one
names the phase that implements it.

---

## Running it locally

**No tenant credentials are needed, and none will be requested.** `local` uses
the mock adapter and the mock question bank, so the whole pipeline is
exercisable with nothing from a Microsoft 365 tenant
([environment-and-configuration.md §2](docs/environment-and-configuration.md) V1).

### Prerequisites

- Node.js 22 LTS
- Docker with Compose v2

### First run

```bash
cp .env.example .env
docker compose -f infrastructure/compose/docker-compose.yml up -d
docker compose -f infrastructure/compose/docker-compose.yml logs -f migrate
```

The `migrate` service installs dependencies, generates the Prisma client,
generates the init migration on first run, applies migrations, and seeds. Every
other service waits for it to finish successfully, so nothing starts against an
unmigrated database.

| Service              | URL                                           |
| -------------------- | --------------------------------------------- |
| Authoring Portal     | http://localhost:3000                         |
| Live Learning Portal | http://localhost:3001                         |
| API                  | http://localhost:8080/internal/health/live    |
| Startup report       | http://localhost:8080/internal/health/startup |
| Mailpit              | http://localhost:8025                         |
| PostgreSQL           | `localhost:5432` (`knowzy` / `knowzy`)        |

The MCP server publishes **no port**, locally or in deployment. It is the only
component that will hold Graph credentials, and keeping it unreachable from the
host makes that property honest rather than aspirational.

### Without Docker

```bash
npm install                                            # writes package-lock.json
npm run db:generate
npm run -w @knowzy/database bootstrap:init-migration   # first clone only
npm run codegen                                        # first clone only
npm run db:migrate
npm run db:seed
npm run dev
```

### Three artifacts are generated once and committed

CI does not create them; it fails with an actionable message if they are
missing, because generating them silently would hide a setup mistake.

| Artifact                                         | Command                                                | Why it is committed                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `package-lock.json`                              | `npm install`                                          | CI installs with a frozen lockfile ([§6](docs/repository-structure.md#6-tooling))                        |
| `packages/database/prisma/migrations/0002_init/` | `npm run -w @knowzy/database bootstrap:init-migration` | Migrations are checked in ([data-model.md §15](docs/data-model.md#15-prisma-conventions-and-migrations)) |
| `packages/shared-types/generated/`               | `npm run codegen`                                      | The contract is diff-checked against the Zod validators (G6)                                             |

Migrations `0001` and `0003` are hand-written for what Prisma cannot express —
extensions, the UUIDv7 generator, the partitioned audit table, CHECK
constraints, partial and expression indexes, and the append-only triggers.
`0002_init` is the generated delta between them, diffed from
`prisma/prerequisites.prisma` so no shadow database is needed.

### Reset

```bash
npm run db:reset    # drop, migrate, seed
```

---

## Working on it

```bash
npm run verify      # everything CI checks, in CI's order
```

Individually:

| Command                    | Enforces                                                                        |
| -------------------------- | ------------------------------------------------------------------------------- |
| `npm run typecheck`        | Strict TypeScript across every package                                          |
| `npm run lint`             | Content rules C1–C8 ([§5.2](docs/repository-structure.md#52-content-rules))     |
| `npm run lint:boundaries`  | Import-graph rules B1–B10 ([§5.1](docs/repository-structure.md#51-layer-rules)) |
| `npm run codegen:check`    | Generated contract matches the Zod validators                                   |
| `npm run test:unit`        | Pure functions, including the redactor                                          |
| `npm run test:contract`    | Registries, answer-key protection, planted boundary violations                  |
| `npm run test:integration` | Needs `DATABASE_URL`; skips itself without one                                  |

### Things the tooling will stop you doing

Each is a documented rule, not a style preference. The error message names the
rule.

- Importing `@knowzy/database` from a web app, or `@knowzy/knowledge-source-adapters` from the API.
- Reading `process.env` outside `@knowzy/configuration`.
- Writing `new Date()` in `@knowzy/domain` or `@knowzy/database` — use the injected `Clock`.
- Using `dangerouslySetInnerHTML` in either portal.
- Putting a SharePoint internal field name (`field_4`) or a tenant hostname anywhere outside the adapter package.
- Adding an answer-key field to `LearnerQuestionDto`.
- Emitting an audit action the taxonomy does not declare.
- Committing a Zod schema change without regenerating the contract.

### Adding a state change

Use `transactWithAudit`. The audit event and the state change share one
transaction, so a transition that cannot be audited does not commit
([audit-model.md §1](docs/audit-model.md) U1). There is no API that writes state
without an accompanying event, and the coupling is verified by
`packages/database/test/audit-transaction.test.ts`.

---

## Layout

```
apps/        authoring-web · live-web · api · mcp-server · jobs
packages/    14 packages; boundaries in docs/repository-structure.md §5
fixtures/    mock source documents and bank state (no tenant values)
infrastructure/
  compose/   local topology
  docker/    production images, one per deployable
docs/        the design baseline — the source of truth
tools/       shared tsconfig, eslint config with the content rules
```

---

## Conventions worth knowing before your first change

- **Status is observed, never assumed.** A source is `UNTESTED` until a probe
  runs, and the probe timestamp is always displayed with the status. Nothing in
  this codebase may report a state it has not measured.
- **Nothing with lineage is deleted.** Questions retire, awards are revoked,
  users are deprovisioned. Audit and versions are append-only, enforced by
  database triggers.
- **Empty scope means unrestricted.** Every data-scope check reads "set is empty
  OR intersects". Getting this backwards silently grants or denies everything.
- **Secrets are references.** Configuration stores `keyvault://…`, never a
  value. The redactor strips by key name and by value shape, before any sink.
- **Estimates are labelled.** A modelled figure carries its constants and the
  word "estimated" wherever it appears.
