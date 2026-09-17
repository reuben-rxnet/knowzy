# Phase 1 — Foundation: Completion Report

**Status:** Complete. All seven exit criteria verified by execution.
**Date:** 2026-09-17
**Specified by:** [docs/implementation-roadmap.md](docs/implementation-roadmap.md) Phase 1

This is a delivery record, not a design document. The design lives in
[docs/](docs/README.md) and remains the source of truth.

---

## Exit criteria

| #   | Criterion                                                   | Evidence                                                                                 |
| --- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1   | Stack runs with no tenant credentials                       | 7 containers up; mock source; zero credentials                                           |
| 2   | Boundary rules fail on a planted violation                  | 8 rules + clean-tree control, 9 tests                                                    |
| 3   | Full schema migrates from empty                             | 66 tables, 64 enums, partitioned audit table, 26 CHECKs, 37 triggers, 14 partial indexes |
| 4   | Startup exits non-zero on each fail-fast check              | 33 tests                                                                                 |
| 5   | Audit rolls back with its state change                      | 7 tests, both directions plus append-only                                                |
| 6   | Redactor proven against secret- and content-shaped fixtures | 58 tests                                                                                 |
| 7   | Codegen diff empty and CI-enforced                          | `codegen:check` current                                                                  |

## Gates

`npm run verify` → exit 0

| Gate       | Result                       |
| ---------- | ---------------------------- |
| typecheck  | 26/26                        |
| lint       | 19/19                        |
| boundaries | 0 errors (103 edges cruised) |
| tests      | 140/140 across 6 files       |
| build      | 19/19                        |
| format     | clean                        |

## Stack

| Service       | Verification                                                              |
| ------------- | ------------------------------------------------------------------------- |
| postgres      | healthy; 3 migrations from empty; seed idempotent                         |
| api           | healthy; `/health/live` 200, `/health/ready` 200, 404 → problem+json      |
| mcp           | 200 at `mcp:8081` inside the network, **unreachable from the host**       |
| jobs          | scheduled job ran: 13 partitions ensured, `SYSTEM`-attributed audit event |
| authoring-web | 200                                                                       |
| live-web      | 200                                                                       |

Architectural guarantees verified, not just liveness: MCP internal-ingress-only
holds in both directions (ADR-003); a scheduled job mints its own correlation ID
with `actorType=SYSTEM` (N5); audit rows land in the correct monthly partition
with the default partition empty.

## What validation found

Phase 1 was written without an executable environment, so nothing in it had run.
Executing the gates surfaced **22 defects**. Two were substantive:

1. **The boundary rules were vacuous for cross-package imports.** Those imports
   resolve through each package's `exports` map into `dist/`, which the
   dependency-cruiser `exclude` dropped — so B1–B9 matched nothing and the clean
   tree "passed" while checking 71 edges instead of 103. The planted-violation
   suite is what caught it.
2. **A documented uniqueness constraint was not enforced.** PostgreSQL treats
   NULLs as distinct, so `@@unique([key, scope, scopeId])` did not prevent
   duplicate PLATFORM configuration rows — the case the platform uses most.
   Partial unique indexes added in migration `0003`.

The remaining 20 were environment, tooling, and configuration defects: npm 11
withholding install scripts, `execFileSync` on `.cmd` failing on Node 20+ (twice,
once _silently_ inside a test), CRLF defeating a comment stripper, an invalid
ESLint rule option that failed all 19 lint tasks, a missing dependency that took
down three services, and Prisma running on the wrong query engine because the
container image lacked `openssl`.

## Not verified

- **CI has never executed.** The workflow encodes the gates that pass locally,
  but GitHub Actions has not run it.
- Production images are built by CI only; they have not been built or run here.

## Next

Phase 2 — Identity and access. Begin with the policy registry and engine in
`@knowzy/authorization`, not with authentication: the registry completeness test
constrains every route added in later phases. The local stub issuer unblocks most
of the phase, so Entra app registrations are not on the critical path.
