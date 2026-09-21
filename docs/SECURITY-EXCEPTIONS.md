# Knowzy — Security Exceptions Register

**Status:** Live control document — CI reads it
**Last reviewed:** 2026-09-21
**Owner:** Knowzy maintainer (repository owner)
**Deviates from:** [security.md §14](security.md) — "a `high` or `critical` finding fails the
pipeline" — and [§15 G-DEP](security.md) — "Scan clean"

> **This document is machine-read.** The fenced JSON block in §4 is the register the CI gate
> parses. Editing the prose without editing the block changes nothing; editing the block without the
> prose leaves the next person with no reason. Both, or neither.

---

## 1. What this register is for

`npm audit` reports advisories against the dependency tree, including transitive packages Knowzy
does not call and development tooling that never reaches a running system. security.md §14 fails the
build on any high or critical finding, which is the right default and, taken literally, means a
vulnerability in a test runner blocks a security fix in the product.

This register is the exception mechanism, and it is deliberately narrow:

- An advisory **nobody has written down blocks the build.** Silence is never consent.
- An entry **past its review date blocks the build.** The entry expires; the vulnerability does not.
- An entry that **matches nothing in the tree blocks the build.** A register that keeps notes about
  advisories that have since been fixed stops describing the tree and starts excusing it.
- An advisory this register itself calls **reachable cannot be excepted at all.** That is not an
  exception, it is a note attached to a live vulnerability.

All four rules are enforced by `npm run audit:gate` and asserted by
`packages/testing/src/audit-exceptions.test.ts`, which fails if any of them is removed.

## 2. How a finding is classified

Every advisory is placed on two axes, because they lead to different decisions.

**Can it be fixed without a breaking change?**

| Classification | Meaning |
| --- | --- |
| **Non-breaking update** | A patch or minor release fixes it inside the declared range. Apply it; no exception |
| **Breaking change required** | The fix needs a major upgrade of a direct dependency, or of a transitive one its parent pins below the fixed version |

**Can the vulnerable code be reached in Knowzy?**

| Classification | Meaning |
| --- | --- |
| **Reachable vulnerability** | Some input a user or an external system controls can reach the vulnerable code path in a deployed Knowzy |
| **Non-reachable vulnerability** | The vulnerable path requires a mode Knowzy never runs, an input Knowzy never accepts, or a tool that exists only at build time |

An exception requires **breaking change required** *and* **non-reachable**. Anything
non-breaking gets fixed instead, and anything reachable gets fixed or removed regardless of cost.

"Non-reachable" is a claim about this codebase at a point in time, not about the advisory. Each entry
below states what would make it false.

## 3. Current findings

Assessed 2026-09-21 against the committed lockfile, with `npm run audit:gate`.

Severity is reported twice because npm reports it twice and the two disagree: the advisory carries
one severity, and npm rolls the containing package up to another. `npm audit --audit-level=high`
blocks on the **rollup**, so the gate decides on the rollup too — otherwise it would be quieter than
the rule it replaces. Ten advisory-and-package pairs reach that threshold.

| Advisory | Package (installed) | Path | Advisory / package severity | Fix | Reachable? | Decision |
| --- | --- | --- | --- | --- | --- | --- |
| GHSA-qx2v-qp2m-jg93 | postcss 8.4.31 | `next` → `postcss` | moderate / **HIGH** | Breaking change required | No | EX-001 |
| GHSA-6g55-p6wh-862q | postcss 8.4.31 | `next` → `postcss` | **HIGH** / **HIGH** | Breaking change required | No | EX-001 |
| GHSA-fxqj-rqcc-2cmp | postcss 8.4.31 | `next` → `postcss` | moderate / **HIGH** | Breaking change required | No | EX-001 |
| GHSA-r28c-9q8g-f849 | postcss 8.4.31 | `next` → `postcss` | **HIGH** / **HIGH** | Breaking change required | No | EX-001 |
| GHSA-5xrq-8626-4rwp | vitest 2.1.9 | dev dependency | **CRITICAL** / **CRITICAL** | Breaking change required | No | EX-002 |
| GHSA-82fw-gwwq-j7x9 | vitest 2.1.9 | dev dependency | moderate / **CRITICAL** | Breaking change required | No | EX-002 |
| GHSA-82fw-gwwq-j7x9 | @vitest/mocker 2.1.9 | `vitest` → `@vitest/mocker` | moderate / moderate | Breaking change required | No | Below the gate |
| GHSA-4w7w-66w2-5vf9 | vite 5.4.21 | `vitest` → `vite` | moderate / **HIGH** | Breaking change required | No | EX-002 |
| GHSA-v6wh-96g9-6wx3 | vite 5.4.21 | `vitest` → `vite` | moderate / **HIGH** | Breaking change required | No | EX-002 |
| GHSA-fx2h-pf6j-xcff | vite 5.4.21 | `vitest` → `vite` | **HIGH** / **HIGH** | Breaking change required | No | EX-002 |
| GHSA-ggr8-5vv4-36mx | deepmerge-ts 7.1.5 | `prisma` → `@prisma/config` → `deepmerge-ts` | **HIGH** / **HIGH** | Breaking change required | No | EX-003 |
| GHSA-67mh-4wv8-2f99 | esbuild 0.21.5 | `vite` → `esbuild` | moderate / moderate | Breaking change required | No | Below the gate |

`@prisma/config` and `prisma` are also reported as high, as the *path* to GHSA-ggr8-5vv4-36mx rather
than as findings of their own. Fixing `deepmerge-ts` clears all three.

### 3.1 What was fixed rather than excepted

`npm audit fix` was run and applied every semver-compatible update available. It cleared nothing at
high or critical, and the reason matters for the entries below:

- **`prisma` 6.19.3 is the newest 6.x**, and the advisory range for its `deepmerge-ts` dependency is
  `6.13.0-dev.1 – 8.1.0-dev.4` — every published Prisma release, including 8.0.2, pins a vulnerable
  `deepmerge-ts`. npm reports `fixAvailable: true` because it *could* rewrite the transitive pin; in
  practice the only fix is `deepmerge-ts` 8, a major release of a package Prisma's config loader
  depends on.
- **postcss is fixed in 8.5.23+**, which is a *patch-level* bump inside 8.x — but Next 15 pins
  `postcss` to exactly 8.4.31, and npm will only take the newer patch through a full lockfile
  re-resolution (`overrides` alone leaves the installed tree at 8.4.31 and merely marks it invalid).
  Regenerating the whole lockfile would shift transitive versions across the tree days after the MVP
  was verified, to fix a build-time advisory that nothing can reach. Deferred to the Next upgrade,
  where the version moves for a reason.
- **vite is fixed in 6.4.3+**, which Vitest 2 cannot accept — it requires `vite ^5`. The fix is
  Vitest 5.

## 4. The register

<!-- knowzy:security-exceptions -->

```json
{
  "version": 1,
  "exceptions": [
    {
      "id": "EX-001",
      "advisories": [
        "GHSA-qx2v-qp2m-jg93",
        "GHSA-6g55-p6wh-862q",
        "GHSA-fxqj-rqcc-2cmp",
        "GHSA-r28c-9q8g-f849"
      ],
      "packages": ["postcss"],
      "expires": "2026-12-31",
      "classification": "breaking-change-required",
      "reachability": "not-reachable",
      "reason": "postcss runs inside Next's build-time CSS pipeline over two static stylesheets committed to this repository. Knowzy accepts no CSS from any user, has no postcss configuration, no CSS-in-JS, and no runtime CSS compilation. All four advisories require attacker-controlled CSS text or an attacker-controlled sourceMappingURL comment to reach the stringifier or the source-map loader. Deferred with the Next.js 15 to 16 upgrade."
    },
    {
      "id": "EX-002",
      "advisories": [
        "GHSA-5xrq-8626-4rwp",
        "GHSA-82fw-gwwq-j7x9",
        "GHSA-4w7w-66w2-5vf9",
        "GHSA-v6wh-96g9-6wx3",
        "GHSA-fx2h-pf6j-xcff"
      ],
      "packages": ["vitest", "@vitest/mocker", "vite"],
      "expires": "2026-12-31",
      "classification": "breaking-change-required",
      "reachability": "not-reachable",
      "reason": "Test tooling. The critical advisory requires the Vitest UI server to be listening; @vitest/ui is not installed and --ui appears nowhere in this repository. The vite advisories require a running vite dev server; the web apps use Next's own bundler and no vite server exists. Neither reaches a runtime image: Dockerfile.service prunes dev dependencies and Dockerfile.web ships only Next's traced standalone output. Deferred with the Vitest 2 to 5 upgrade."
    },
    {
      "id": "EX-003",
      "advisories": ["GHSA-ggr8-5vv4-36mx"],
      "packages": ["deepmerge-ts", "@prisma/config", "prisma"],
      "expires": "2026-12-31",
      "classification": "breaking-change-required",
      "reachability": "not-reachable",
      "reason": "deepmerge-ts is used by the Prisma CLI's configuration loader, at generate and migrate time, merging Prisma's own configuration objects from files committed to this repository. The advisory is stack exhaustion when merging a recursive object graph; nothing outside the repository feeds that merge. The CLI is a dev dependency and is absent from both runtime images. Every published Prisma release pins a vulnerable deepmerge-ts, so there is no version to move to."
    }
  ]
}
```

## 5. The entries in full

### EX-001 — postcss, via Next.js

| | |
| --- | --- |
| **Advisories** | GHSA-qx2v-qp2m-jg93, GHSA-6g55-p6wh-862q, GHSA-fxqj-rqcc-2cmp, GHSA-r28c-9q8g-f849 |
| **Severity** | HIGH ×4 |
| **Installed** | postcss 8.4.31, pinned by `next` 15 |
| **Fixed in** | postcss 8.5.23+ (patch), reachable in practice only via Next 16 |
| **Classification** | Breaking change required · Non-reachable |
| **Expires** | 2026-12-31 |

**Why it is not reachable.** The CSS surface of this platform is two files:
`apps/authoring-web/src/app/globals.css` and `apps/live-web/src/app/globals.css`. Both are written
by hand, committed, and compiled once at build time. There is no postcss configuration file, no
Tailwind or CSS-in-JS pipeline, no stylesheet upload, and no route that accepts or echoes CSS. Two
of the four advisories are XSS through the CSS stringifier, which needs attacker-controlled CSS to
stringify; the other two are file read and path traversal through `sourceMappingURL` comments, which
needs an attacker-controlled comment in a stylesheet being processed. Neither input exists.

**Compensating controls.** CSS is compiled in CI from a tagged commit, not at runtime. The runtime
web image contains only Next's traced standalone output, and nothing in it invokes postcss.

**What would make this false.** Any feature that processes CSS the platform did not author — a
theming editor, a tenant stylesheet upload, a component that compiles CSS at request time, or a
build step that pulls stylesheets from a knowledge source. Any of those turns this entry into a
fix-now.

**Planned fix.** Next.js 15 → 16. Deferred because Next 16 changes App Router and server-action
behaviour that the M7 UI depends on, and this advisory is not reachable, so the upgrade should be its
own milestone with its own verification rather than a security scramble.

### EX-002 — vitest, @vitest/mocker, and vite

| | |
| --- | --- |
| **Advisories** | GHSA-5xrq-8626-4rwp, GHSA-82fw-gwwq-j7x9, GHSA-4w7w-66w2-5vf9, GHSA-v6wh-96g9-6wx3, GHSA-fx2h-pf6j-xcff |
| **Severity** | CRITICAL ×2, HIGH ×3 |
| **Installed** | vitest 2.1.9, @vitest/mocker 2.1.9, vite 5.4.21 |
| **Fixed in** | vitest 3.2.6 / 4.1.11 depending on the advisory; vite 6.4.3+ |
| **Classification** | Breaking change required · Non-reachable |
| **Expires** | 2026-12-31 |

**Why it is not reachable.** Every package here is test tooling, invoked by `vitest run` on a
developer machine and in CI. The critical file-read-and-execute advisory is conditional on the
**Vitest UI server listening**: `@vitest/ui` is not installed, and no script, workflow, or config in
this repository passes `--ui`. The vite advisories require a **vite dev server** to be serving
requests; Knowzy's two web applications are built with Next's own bundler, and vite exists here only
as vitest's transform pipeline — no server is ever started. The esbuild advisory below the gate
threshold has the same shape.

Neither package can reach a deployed system: `Dockerfile.service` runs `npm prune --omit=dev` before
the runtime stage, and `Dockerfile.web` copies only `.next/standalone`, `.next/static`, and `public`
into a runtime image that runs as `node`.

**Compensating controls.** Test runs are non-interactive (`vitest run`, never `vitest --ui`, never
`vitest watch` in CI). CI runners are ephemeral. The only machines that execute this tooling are
developer workstations and CI.

**What would make this false.** Enabling the Vitest UI, starting a vite dev server for any surface,
shipping vitest into an image, or running tests against untrusted input on a machine that also holds
secrets.

**Planned fix.** Vitest 2 → 5. Deferred because Vitest 3 replaced `vitest.workspace.ts` with a
`projects` configuration, and this repository's entire test topology — three projects, the
`@knowzy/*`-to-source aliasing that keeps tests from asserting against stale `dist`, and the
single-fork serialization that stops integration suites deleting each other's rows — is expressed in
that file. Migrating it is a focused piece of work with a real chance of silently weakening the test
setup, which is the opposite of what a security upgrade should do in a hurry.

### EX-003 — deepmerge-ts, via the Prisma CLI

| | |
| --- | --- |
| **Advisory** | GHSA-ggr8-5vv4-36mx |
| **Severity** | HIGH |
| **Installed** | deepmerge-ts 7.1.5, via `@prisma/config` 6.19.3, via `prisma` 6.19.3 |
| **Fixed in** | deepmerge-ts 8.0.0 — no published Prisma release depends on it |
| **Classification** | Breaking change required · Non-reachable |
| **Expires** | 2026-12-31 |

**Why it is not reachable.** `deepmerge-ts` is used by the Prisma CLI when it loads and merges
configuration, which happens during `prisma generate`, `prisma migrate`, and `prisma validate`. The
objects merged are Prisma's own defaults and the settings in `packages/database/prisma/schema.prisma`
— all committed to this repository. The advisory is stack exhaustion when merging a recursive object
graph, which requires supplying such a graph to the merge. Nothing outside the repository reaches it,
and the CLI does not run in a deployed system: `@prisma/client` is the runtime dependency, `prisma`
is a dev dependency of `@knowzy/database`.

**Compensating controls.** Migrations are applied by a pipeline step from a tagged commit, not by
user action. A denial of service against a build step is a failed build, which is visible.

**What would make this false.** Any path that lets an external input shape Prisma configuration —
a generated `prisma.config.ts`, a schema assembled at runtime, or a CLI invocation with
user-supplied arguments.

**Planned fix.** Adopt the first Prisma release that depends on `deepmerge-ts` 8, and drop this
entry. Tracked by the expiry date rather than by a version, because the release does not exist yet.

## 6. Findings below the gate

Reported for completeness; `--audit-level=high` does not block on them and neither does the gate.

| Advisory | Package | Severity | Note |
| --- | --- | --- | --- |
| GHSA-67mh-4wv8-2f99 | esbuild 0.21.5 (via vite) | moderate | Requires a running esbuild dev server. Same reasoning as EX-002; fixed by the same upgrade |
| GHSA-82fw-gwwq-j7x9 | @vitest/mocker | moderate | The same advisory as the critical one against `vitest`, reported at a second path. Covered by EX-002 |

## 7. Review procedure

1. Run `npm run audit:gate`. It prints every high and critical advisory, which exception covers it,
   and what is blocking.
2. For a **new** advisory: classify it on both axes (§2). If it is non-breaking, update the
   dependency — do not write an entry. If it is reachable, fix it or remove the code path — an
   entry is refused by the gate.
3. For an **expiring** entry: re-assess. Either the upgrade has landed and the entry is deleted, or
   the reasoning still holds and the expiry moves with a note saying why, in this document, in the
   same commit.
4. Never extend an expiry without re-reading the reachability argument. That argument is the whole
   justification, and it is a statement about code that changes weekly.

## 8. Change log

| Date | Change |
| --- | --- |
| 2026-09-21 | Created. EX-001 (postcss/Next), EX-002 (vitest/vite), EX-003 (deepmerge-ts/Prisma). `npm audit fix` applied first; it cleared nothing high or critical, for the reasons in §3.1 |
