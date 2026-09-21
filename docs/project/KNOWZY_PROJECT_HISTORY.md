# KNOWZY — Project History

**Purpose:** what was delivered, when, and what it cost to learn. One entry per milestone, in
order, each traceable to a commit.

**Standing rule:** this file is updated in the **same commit** as every milestone completion. A
milestone is not finished until its entry is here.

**What belongs in an entry:** what shipped, what was deliberately not built and why, and any defect
the milestone found — especially one it introduced. An entry that records only successes is not a
history, it is marketing.

Related documents: [`docs/USER-GUIDE.md`](../USER-GUIDE.md) describes the software as it is now;
[`docs/ui/ui-modernization-plan.md`](../ui/ui-modernization-plan.md) holds the UI milestone plan and
the delivery record for each one; [`CLAUDE.md`](../../CLAUDE.md) holds current status.

---

## Phase 1 — Foundation

| | |
| --- | --- |
| **Commits** | `629b0d1`, `1678433`, `654c368`, `62aa7f3` |
| **Dates** | 2026-09-17 |

The monorepo, the boundary rules (B1–B10) enforced by dependency-cruiser, the content rules (C1–C8),
Prisma with PostgreSQL, the compose stack, and the test projects.

Validation found and fixed **19 defects** in the foundation itself, then three more that only appear
inside a container. A fourth commit resolved a phase-order discrepancy in `CLAUDE.md`: it said
Knowledge Sources came second, and the roadmap said Identity — the roadmap was right, because every
route needs a declared policy before a source can be read.

---

## MVP M1–M6 — the platform

| | |
| --- | --- |
| **Commits** | `2d8ee3f`, `d7a50af`, `e2e9d70`, `30afe78`, `8d2df76`, `e1b6db3` |
| **Dates** | 2026-09-18 |

- **M1** — the authorization spine: the local stub issuer, the policy registry, and the test that
  fails the build on a handler without a declared policy.
- **M2** — knowledge sources and document selection: containers, folders, documents, sections,
  extraction, and the `isSelectable` gate.
- **M3** — grounded generation: every question quotes a verified span, with character offsets that
  must round-trip against the extracted text (X2).
- **M4+M5** — review, approval, and publishing: the state machine, the thirteen gates, separation of
  duties, and idempotent publication.
- **M6** — assessment, quiz session, and deterministic scoring: pinned eligibility snapshots, the
  server-side answer store, and bands copied into each result at scoring time.

`e1b6db3` added `docs/MVP-READINESS.md`, which is a status report and not a specification.

---

## M7 — the minimum browser experience

| | |
| --- | --- |
| **Commit** | `1762cc7` · 2026-09-18 |

Six authoring screens and four learner screens, server-rendered, with server actions as the BFF: the
browser never calls the API and never holds a subject header. Deliberately minimum — no dashboard,
badges, certificates, reports, or assessment builder.

The walkthrough recorded here claimed the whole workflow was driven through the browser. It was not
entirely: see `865131d`, which found that four of those controls returned a 400.

---

## The user guide

| | |
| --- | --- |
| **Commit** | `a2df335` · 2026-09-18 |

`docs/USER-GUIDE.md`, plus the standing rule that it is updated in the same commit as any change to
what a person sees or does.

---

## CI repair, rounds one and two

| | |
| --- | --- |
| **Commits** | `9fc324f`, `abb1c45`, `bbb9df6` · 2026-09-21 |

CI ran for the first time and failed.

- **Round one:** 31 files had never been through Prettier; then two gates — schema drift (two
  trigram indexes existed in migrations but not in `schema.prisma`) and the dependency audit.
- **Round two:** the integration job and all five image builds. The integration suites needed an
  EXTRACTED fixture document that only a synchronize creates, so 152 tests had only ever passed on a
  hand-prepared database — on a fresh one their `beforeAll` threw and vitest skipped them, which
  reads like success. CI now synchronizes the fixtures first and asserts the document exists. The
  image builds failed on a missing `.dockerignore` and an unresolvable action tag.

Corrections made in the open during this work: a claimed non-breaking Prisma fix did not exist, and
the audit gate initially decided on advisory severity rather than npm's package rollup, which made
it quieter than the command it was meant to enforce.

`docs/SECURITY-EXCEPTIONS.md` records the deferred Next.js and Vitest major upgrades. Its JSON block
is parsed by `npm run audit:gate` — it is a control document, not prose.

---

## MVP review — defects found by the reviewer

| | |
| --- | --- |
| **Commit** | `17c45a6` · 2026-09-21 |

The reported symptoms were `NaN / ` on the learner home and a 404 on resume. Neither cause was among
the four candidates suggested:

- The home card declared `currentIndex` and `totalQuestions`, which the API never sent. A
  hand-written interface is an assertion, not a contract; the API sends `answeredOf` as a string.
- Resume 404: a fully answered but unfinished session (`currentIndex === totalQuestions`) made both
  the current-question read and session start throw. Fixed with a presentation-index clamp, with two
  integration tests, and removing the clamp was verified to fail them.
- Also: the generation screen offered step 3 after a `VIEW_EXISTING` decision, which the server
  always refused; and a `documentId` filter could not match, because `draft_question` stores the
  source hash rather than the platform UUID.

---

## Phase 8 planning

| | |
| --- | --- |
| **Commits** | `27bd1b8`, `de69ddb`, `409815f`, `3c8ccba` · 2026-09-21 |

The approved UI specifications and mockups, then the analysis: 17 mockups, **147 features**
classified — 41 implemented, 25 partial, 7 planned, 67 requiring a backend extension, 7 disabled in
this release. `docs/ui/full-solution-capability-matrix.md` and
`docs/ui/ui-modernization-plan.md` came out of it. Planning artifacts only; no behaviour changed.

---

## UI-M1 — the shared shell

| | |
| --- | --- |
| **Commit** | `40e7490` · 2026-09-21 · plan §19 |

Design tokens as the single brand definition (Tailwind v4 reads the same `@theme` block that
declares the CSS variables), Lucide icons, both shells, the global header, both navigations, the
workflow ribbon, and the card, badge, status, drawer, modal and page-state systems. Applied to all
eleven routes with no page redesigned.

Four defects found by rendering rather than reading: `legacy.css` painted the shell's own disabled
controls so they looked enabled; the wordmark overflowed across the search field; nav labels
truncated to `Admini…`; and two sidebar destinations highlighted at once.

---

## The 400 on every bodyless POST

| | |
| --- | --- |
| **Commit** | `865131d` · 2026-09-21 |

A learner clicking **Finish and score** got `VALIDATION_FAILED` from a control that supplies no
information. Both portals' API clients sent `content-type: application/json` on every request,
including the POSTs with no body; Fastify rejects a request that declares a JSON body and sends none,
before any handler runs.

One defect, four broken controls: Finish and score, Test connection, Claim/Submit, and the three
assessment steps. Fixed in the client, where the request is built. Two regression tests, both proven
to fail against the old code.

---

## UI-M2 — the authoring workflow chain

| | |
| --- | --- |
| **Commit** | `0fc5ed8` · 2026-09-21 · plan §21 |

Knowledge Sources → document selection → AI generation → Review Queue → Approval → Question Bank,
all on the design system, with no behaviour change. Absorbed what the plan had listed as UI-M3
through UI-M7; the dashboard moved to UI-M2b.

This milestone gave the repository its first way to drive a browser — Node 24 ships a global
WebSocket, so a small CDP script clicks the flows and reports console errors. It immediately found a
**hydration failure** (a `<dl>` passed into a `<p>` slot) and two highlighted destinations on
`/publish`. A regression I introduced and fixed: the quiz page has two `<article>` roots and only
one got the legacy opt-in class, so it rendered with no styling at all.

---

## UI-M2b — real data only

| | |
| --- | --- |
| **Commit** | `66e9e9c` · 2026-09-21 · plan §22 |

The authoring dashboard (previously an identity picker), the approval gate checklist, Question Bank
traceability, learner assessment cards, and the results screen with per-topic bars and the band
scale. Every figure traceable to an existing response.

Answered the open dashboard-honesty question by shipping only the figures that are real, with **no**
"Planned" placeholder cards. A figure the caller may not read is absent rather than zero, and the
dashboard names the refused read.

Found: `appliedThresholds` is an array of band objects, and the results page had it typed `unknown`
and read with `Object.entries` — so "Bands applied to this attempt" was rendering raw JSON on screen.

---

## UI-M3 — branding refinement and screen quality

| | |
| --- | --- |
| **Commit** | `3149141` · 2026-09-21 · plan §23 |

The header lock-up rebuilt around the approved assets, and the implemented screens improved on
existing data. The `favicon.ico.svg` tile turned out to be the only real drawn artwork in the
approved set and was being used for nothing but the browser tab; it is now the product mark in the
header.

**Contrast was failing and the documentation said it was not.** UI-M1 asserted its ratios by hand;
computing them found six pairs below WCAG 2.2 AA, including a badge whose own label failed against
its own background, and `ink-subtle` — used for every caption in both portals — at 3.93:1 on a
sunken surface. Two semantic tokens were darkened, brand green and brand blue were reassigned to the
surfaces where they measure up (neither colour altered), and
`packages/shared-ui/src/contrast.test.ts` now computes all of it from `tokens.css`, so the claim is
checked rather than written down.

Also: the learner portal's refusal panel had been rendering as loose unstyled text since UI-M2b —
its `Problem.tsx` still depended on the stylesheet those pages had left behind. And the authoring
portal's `legacy.css` was deleted: every one of its pages is now on the design system.

Two brief items could not be built from existing data and were not faked: learner result and
proficiency visibility on the home page need an endpoint that lists a learner's results, and none
exists. See plan §23.6.
