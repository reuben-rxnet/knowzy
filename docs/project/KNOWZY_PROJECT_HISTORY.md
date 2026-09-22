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

**Follow-up in the same milestone.** The header was rebuilt a second time against the approved
header mockup, supplied after the first attempt: bigger marks, an 80px bar, and no tile — the
mockup is `EssilorLuxottica | KNOWZY` and nothing else. That also fixed a disclosure bug the first
version had: the role strings are full sentences, so "· Local Development Identity" was truncated
away at every width. It now comes first on that line, so truncation eats the role instead of the
§34 disclosure.

An approved icon reference sheet arrived at the same time. It is a composite image — none of the
individual files it names exist — so it was used as a reference and gave four changes: a green
action button for Start and Resume, a soft blue "Planned" pill, and two learner nav icons. Its
course thumbnails, level badges, streak and points stats, and Copilot recommendation callout were
all left alone, being exactly what this milestone excludes.

**Two self-inflicted outages during this work**, both from running `npm run build` on the host while
the containers were up — the trap this repository already documents twice. The first overwrote the
dev servers' `.next` and produced `Could not find the module .../global-error.js in the React Client
Manifest`; the second desynced the shared `node_modules` volume and took the API down, which the
portals correctly reported as **API unreachable** rather than as an empty page. Recovery is
`rm -rf apps/*/.next` and a web restart for the first, `docker compose … up migrate` and an
api/mcp restart for the second. Worth knowing that the build deliverable and a running demo cannot
share a machine state.

---

## Design Asset Integration

| | |
| --- | --- |
| **Commit** | `bbacf9a` · 2026-09-21 · plan §24 |

The approved 82-file asset pack integrated into both portals: 4 branding marks, 11 navigation
icons, 5 illustrations and 3 backdrops in use; the other 59 files classified with a reason each in
`docs/ui/knowzy-design-asset-inventory.md`.

The strategy is a synchronization script from the immutable pack into each application's `public`,
with a contract test that fails the build on a missing copy, an **edited** copy (byte comparison
against the approved source), or a served file nothing references. All three faults were planted and
confirmed to fail before the approach was trusted — copying approved artwork is only defensible if
something verifies the copies.

Two facts about the pack decided most of the classifications, and both are worth knowing before
anyone reaches for it again:

- Two thirds of its "icons" are a **Unicode character rendered as `<text>` in Arial**, not a
  drawing. They render only where the host font carries the glyph, so in a container they can come
  out as missing-character boxes. Sixteen files deferred on that basis.
- Text baked into an image cannot be read by a screen reader, translated or selected. That ruled
  out the level badges, the quote card, and `pill_planned` — whose style had already been adopted
  in UI-M3 without the file.

Nothing was activated because an asset existed for it. Badges, Discover, Knowledge Library, My
Learnings and My Progress now show approved icons and remain non-navigable with their capability
status unchanged.

`npm run verify` green: 495 tests, 22 files. 13 routes browser-validated with no console errors and
no accessibility findings.

**A process lesson, recorded because it cost time three separate ways in one session:** never run
the test suite in the background while validating in a browser. The integration suites truncate the
development database, so screens come back empty mid-screenshot and it reads as a data-loading
defect. Browser validation first, then `verify`, then re-seed.

---

## UI-M3 — depth on the implemented screens

**Delivered 2026-09-21.** Full record: [`ui-modernization-plan.md` §25](../ui/ui-modernization-plan.md).

The brief was to raise the quality of the implemented screens using only real backend data, to a
standard fit for CIO, CTO, enterprise-architecture and application-support review. No new route,
endpoint, domain model or capability was added.

The pass did not start from the mockups. It started by diffing every hand-written response
interface in both applications against the fields the components actually referenced, which found
real payload the screens were discarding. That is where the work went.

**What the screens now say that they could not before:**

- **AI Quiz Generation.** The six preflight checks were a seven-column table with room for one
  status badge each. They are now a per-document checklist shaped like the approval gate checklist,
  carrying each check's own sentence and the counts behind its verdict — so "similarity risk: HIGH"
  is accompanied by the three questions over three assessable sections that caused it. The
  generation result gained the rejection breakdown, which names which control refused how many
  candidates; before, the screen could say "7 rejections" without saying what refused them.
- **Question detail.** A new `TraceabilityChain` draws Knowledge → Evidence → Review → Approval →
  Publication above the gate card, with the source document, its version at generation, the section,
  the evidence offsets, the model, the drafting identity, each decision's version and time, and the
  bank id. Every stage is lit by a row existing, never by a parsed status string — and the approval
  stage is filtered to an `APPROVED` decision, because `approvals` also holds rejections and
  counting them would say the opposite of the truth on exactly the question where it matters.

**Two things were refused rather than filled in:**

- **Reviewer and approver identity.** Requested, and not in the payload: reviews and approvals carry
  an outcome, a version and a timestamp, and no user id. The decision is shown; the person is not.
- **Learner progress, proficiency history and knowledge gaps on the learner home.** There is no
  per-learner results list among the 48 routes — `results/:resultId` serves one result by id — so
  the page states the absence through `PlannedState` instead of estimating it.

**Honesty became a build gate.** `no-fabricated-metrics.test.ts` scans both `copy.ts` files, which
content rule C1 makes sufficient. It forbids comparison phrasing outright, and forbids a
fabrication-prone concept only when the string also interpolates a value — so "this release keeps no
badges, points, streaks or levels" passes and `{count} badges earned` fails. That distinction is the
whole point: naming an absent capability is the required empty state, giving it a number is the
fabrication. Both fault classes were planted and confirmed to fail before the test was trusted.

`npm run verify` exit 0: 501 tests across 23 files, 19/19 typecheck, lint and build, boundaries 0
errors. 13 routes driven in Chrome with no console errors; the accessibility audit reports 0
findings with all 15 checks holding on every route.

**A defect found by looking at a screenshot rather than at source:** the sidebar tagline is
uppercase at `tracking-widest`, which is wider than the sidebar's content box, so the nav clipped it
horizontally. Fixed by wrapping at normal tracking. Half of what looked wrong turned out to be
Next's dev-mode indicator sitting on top of the sidebar footer — dev-only, absent in production. The
first diagnosis was wrong, and both halves are recorded so the next person does not chase the wrong
one.

---

## Enterprise Pilot readiness assessment (Phase 9.1 as commissioned)

**Delivered 2026-09-21.** Planning artifacts only; no application code changed.

Primary artifact: [`ENTERPRISE_PILOT_READINESS.md`](ENTERPRISE_PILOT_READINESS.md), with four
integration plans beside it — [SharePoint](integration-plan-sharepoint.md),
[Microsoft Graph](integration-plan-microsoft-graph.md), [Entra ID](integration-plan-entra-id.md) and
[Claude](integration-plan-claude.md).

**The brief's phase number was wrong and the correction changes the plan.** The work was commissioned
as "Phase 9.1". By the authoritative roadmap, SharePoint read is **Phase 7**, Question Bank write is
**Phase 8**, Entra is the deferred half of **Phase 2**, and the live Claude generator is the deferred
half of **Phase 4** — while roadmap **Phase 9 is refreshers, badges and certificates**, which the
brief explicitly excludes. So "Phase 9.1" named the one phase this work is not. The roadmap's numbers
were kept and the grouping is called the **Pilot Workstream**; renumbering the roadmap to match a
passing instruction would have edited the source of truth.

**The central finding: the platform is architecturally ready and operationally unready.** Every
external dependency already sits behind a port written for the real implementation rather than for
the mock — delta checkpoints as opaque state, `ifMatch` as a required parameter, both Graph permission
modes threaded through every adapter call, `writeCapable: false` as a literal type, a fail-closed
identity resolver, and a `QuestionGenerator` port whose `'anthropic'` variant is declared and
unimplemented. That is the expensive half and it is done. What is missing is every line of code that
speaks to a Microsoft or Anthropic endpoint, plus the tenant grants to speak to them with. **Nothing
in the repository has ever contacted SharePoint, Graph, Entra or Anthropic.**

A reusable conformance suite already exists and its own header says the SharePoint adapter "will be
handed this same function, and the groups it cannot yet satisfy are the work it has left". Three of
its six `it.todo` assertions are precisely the Graph behaviours Phase 7 must prove — 429 with
`Retry-After`, circuit opening, and a metadata-only change yielding a new `sourceVersion` with an
unchanged hash. The work to be done was already written down as pending tests rather than as prose.

**Two recommendations that depart from the brief:**

1. **Entra goes first, not SharePoint.** `createEntraResolver()` throws, so every non-local
   deployment fails every request today. There is no environment for a pilot to happen in until it
   lands, and no parallel path around it.
2. **Claude goes last, with a parallel quality spike.** It is the only integration gated on an
   unconfirmed approval (A-05/T-29, owned by privacy and legal), and its quality can only be judged
   against real documents. But question quality is the product's central unknown, so the answer is a
   time-boxed blind comparison against the deterministic generator run alongside Entra — not a
   reordering that makes the dependency chain hostage to a legal review.

**Thirteen gaps registered, and two of them are approvals rather than code.** T-29 (permission to
send drafts and source excerpts to Anthropic) and T-22 (`Sites.Selected` **Write** on the governance
site) have external owners, sit on the critical path, and are blocked by nothing. Requesting both is
a week-0 action.

**Four decisions the plans surface that were not written down anywhere**, each recorded with a
recommendation rather than decided unilaterally: delegated-token cache keying (keyed on scope alone,
one principal's token would serve another — it fails silently and its blast radius is cross-user
exposure); the session mechanism between browser and BFF; whether the profile's configured `modelId`
actually governs the model (it is currently stored and ignored, and the obvious fix hardcodes a
constant while appearing to honour configuration); and how the permitted single repair attempt avoids
becoming a re-injection surface.

**Two things the assessment refused to claim.** Reporting is genuinely unbuilt — `@knowzy/reporting`
is an 18-line placeholder that exports its own `IMPLEMENTED_IN = 'Phase 10'` — so a pilot described
to stakeholders as including dashboards has an unmet expectation that no integration work in this
workstream changes. And the container image vulnerability scan has still never executed, making a
base-image CVE an unknown rather than an absence.

**Two new tenant values are proposed, not written.** T-39 (a dev-site document restricted from a
named test principal, without which the delegated-trimming exit criterion is unfalsifiable) and T-40
(permission to capture and scrub recorded Graph fixtures, without which conformance cannot run in CI).
Both belong to `assumptions-and-tenant-configuration.md`'s register, so they are proposed here for
its owner rather than appended by a plan.

The single recommendation these documents would most defend: **automate the 36-step acceptance script
before swapping any adapter.** Four integrations are about to be replaced underneath a platform whose
only end-to-end verification is a person clicking through it. Build the net before the trapeze.

---

## Enterprise access discovery, and a transitional path to real content

**Delivered 2026-09-21.** Planning artifacts only; no application code changed.

Four documents under `docs/integrations/`:
[ACCESS_DISCOVERY_REPORT.md](../integrations/ACCESS_DISCOVERY_REPORT.md) ·
[SHAREPOINT_DISCOVERY_PLAN.md](../integrations/SHAREPOINT_DISCOVERY_PLAN.md) ·
[TENANT_ADMIN_REQUESTS.md](../integrations/TENANT_ADMIN_REQUESTS.md) ·
[TRANSITIONAL_KNOWLEDGE_SOURCE_PLAN.md](../integrations/TRANSITIONAL_KNOWLEDGE_SOURCE_PLAN.md).

**Access findings.** No Entra administrative or app-registration access. Graph authentication works
and `/me` succeeds. Graph SharePoint queries return 403. A signed-in user can browse and download
from the sites directly.

**The diagnosis, which matters more than the findings.** A **403 rather than a 401** means
authenticated but not authorized — so the token is valid and a consented scope is missing, which rules
out credential, tenant and network causes entirely. Every Graph delegated permission that reads
SharePoint site content requires admin consent, while `User.Read` does not. That is exactly why `/me`
succeeds and `/sites` does not, and it means **no Graph SharePoint access is reachable by any
self-service route.** Recorded so nobody spends a week looking for one. Self-registering an app would
not help either: it can only obtain user-consentable scopes, so it reaches `/me` and stops.

Also recorded: "Graph authentication works" reads like progress toward integration and is not. That
token belongs to whatever first-party client made the call. Knowzy has no app registration, therefore
no audience, therefore cannot be issued a token at all.

**A correction to the readiness report, found while checking the access story.** Knowledge Sources
were rated "ready behind a mock". That understated one thing materially: **only three extractors
exist** — plain text, Markdown and HTML. PDF, DOCX, PPTX, XLSX and SharePoint Pages have none, and
`ExtractInput.content` is typed `string`, so binary support is a **signature change** to the
extraction entry point rather than the "additive map entry" the code comment suggests. A real
SharePoint library is mostly the formats that do not work. Connecting Graph tomorrow would have
surfaced a library the platform cannot read, so finding this before access rather than after is the
most useful thing the investigation produced.

**The transitional path, and a reversed caution.** The SharePoint discovery plan originally cautioned
against ingesting documents by a non-Graph route. The direction was then given to do exactly that, so
the caution now points at the plan that governs it instead of arguing against it — the objection was
always about *how*, not *whether*.

The mechanism: the OneDrive sync client mirrors a SharePoint document library to a local directory
using the signed-in user's existing permissions, with no app registration, no consent and no Graph
call. Knowzy reads it through a `FILE_REPOSITORY` adapter — a `SourceType` that already exists with a
documented template. One adapter, three roots: synced library, synced OneDrive, managed upload
directory. Graph `/me/drive` is explicitly out of scope; `Files.Read` is user-consentable, but
requesting it still needs a registration.

**What makes it defensible rather than expedient.** Template rule P1 makes emulating a capability a
contract violation, so the four real losses are **declared, not hidden**:
`supportsPermissionCheck: false` forces `getEffectiveAccess` to return `UNKNOWN` with
`enforcement: 'PLATFORM'`; `supportsDelegatedAccess: false` rejects `DELEGATED_OBO` at configuration
time; `supportsVersionLabels: false` makes the content hash decide and lets preflight report
`CONTENT_CHANGED_UNVERSIONED` honestly. The losses stay visible on screen instead of fading into
normality.

**Three findings that shaped the design:**

- **It cannot be the mock adapter pointed at another directory.** Startup check `MOCK_ISOLATION` fails
  outside `local` when a mock adapter is registered, which is precisely what that check exists to
  prevent. The tree reader is shared; the adapter is distinct.
- **`sourceUrl` must be reconstructed to the real SharePoint URL.** It is non-nullable and flows into
  the published bank record, so a local path would both break traceability for any future auditor and
  write a username and machine layout into a SharePoint list that is authoritative and long-lived.
  This single change is what determines whether the transitional path is a stepping stone or a
  throwaway — everything else migrates for free.
- **The corpus boundary is one person's access.** A mirrored library contains exactly what the syncing
  user can see. That boundary is a *person*, which is not a governance boundary and cannot be audited
  from the data. It needs a named documented account decided in week 1, because it cannot be recovered
  after the fact.

**Milestone PILOT-T1** sequences it: binary-capable extraction with PDF and DOCX first and round-trip
X2 offset assertions, then the adapter, then URL reconstruction with a test asserting no emitted
`sourceUrl` is a local path, then sidecars and the release-scope widening, then measure the real format
distribution and `EXTRACTION_EMPTY` rate, then one library end to end, then the blind Claude quality
comparison on real content. Steps 1 to 4 are gated on nobody.

The tenant request document is written to be sent as-is, including a section on what is **not** being
asked for — no `Sites.Read.All`, no `FullControl`, no directory read, no privileged roles for the
team — offered so an administrator can check the scope rather than take it on trust.

---

## Transitional knowledge source — implementation design

**Delivered 2026-09-21.** Planning artifact only; no application code changed.
[TRANSITIONAL_KNOWLEDGE_SOURCE_IMPLEMENTATION.md](../integrations/TRANSITIONAL_KNOWLEDGE_SOURCE_IMPLEMENTATION.md).

The review this required found **two errors in the strategy document written hours earlier**, both now
corrected in place. Recording them because one of them would have produced an adapter that could not
work at all, and because they point in opposite directions.

**The design-breaking one.** The strategy specified `supportsPermissionCheck: false` on honesty
grounds — a filesystem carries no per-user SharePoint decision. Read against the code, that is
unworkable: the contract says `false` forces `getEffectiveAccess` to return `UNKNOWN`, and both
`extractContent` and `synchronize` refuse on any non-`ALLOWED` decision **including `UNKNOWN`**, with
the comment *"content is the thing worth protecting, so the cautious direction is the default."* So the
adapter would have extracted nothing and synchronized zero documents. That safety posture is correct
and should not be weakened; the resolution is `supportsPermissionCheck: true` (the capability means
"can I answer") with `enforcement: 'PLATFORM'` on every decision (which says "on whose authority"),
and `supportsDelegatedAccess: false` as the flag that actually carries the loss. The alternative —
permitting `UNKNOWN` through the refusal when enforcement is platform-level — changes a shared safety
default and was rejected as something to escalate rather than do locally.

**The one that made the work smaller.** The strategy said *"X2 is the hard part, not the parsing"* —
that producing round-trip offsets was the real requirement for a binary extractor. Wrong.
`structure.ts` splits the work so an extractor **never computes an offset and never sees the final
text**: it emits headings and paragraphs, and the sectionizer owns the string, which is what makes X2
true by construction. A PDF extractor is `bytes -> Block[]` and nothing more. Materially less work
and less risk than stated.

**Two further findings from the same review:**

- **Search reads files as UTF-8 too**, not only extraction — `readFixtureContent(...).toLowerCase()`
  for matching and again for the snippet. So binary support is three call sites, and the
  file-repository adapter must search extracted text rather than raw bytes, or a PDF yields nonsense
  matches and a snippet of binary garbage on screen.
- **Section keys survive the migration by construction.** `sectionKey` is
  `sha256(heading path + ordinal)` and explicitly stable across re-extraction — derived from content,
  not from the source. Since the adapter only supplies bytes and the extraction pipeline is
  source-agnostic, the same document yields identical keys whether the bytes came from a local mirror
  or from Graph. Every evidence span and every published `sourceSectionKey` re-locates after migration
  with no data fix. SharePoint Pages are the one clean exception: they have no file in a synced
  library, so they first extract under Phase 7 and have no keys to preserve.

**Three operational traps the implementation design has to close**, none of which are visible from the
strategy level: OneDrive **Files On-Demand** placeholders, where a file lists at its real size with no
local bytes, so folders must be pinned and Test Connection must detect it; **partial-sync mass
deletion**, where a paused or throttled client presents a half-populated directory that a naive scan
reads as mass deletion — guarded by aborting a run whose document count falls below a fraction of the
previous one and emitting no delete events; and **sync-client artifacts**, including `desktop.ini`,
which would extract successfully as a text document and produce a nonsense section, which is worse
than failing.

The nine Test Connection checks — flagged as unenumerated in the Phase 7 plan — are proposed
canonically here with this adapter's outcome for each. Check 5 earns its place: it reports "140 of 200
matched documents have no registered extractor" at configuration time rather than after a sync.

**Milestone PILOT-T1** is sequenced with steps 1–5 gated on nobody: binary-capable extraction with PDF
and DOCX added to the *parameterized* invariant suite so they inherit X1–X6; the tree reader extracted
from the mock; the adapter, distinct from the mock because `MOCK_ISOLATION` fails startup outside
`local` when a mock adapter is registered; `webUrlBase` mapping plus a build-failing assertion that no
emitted `sourceUrl` matches a local-path shape; then sidecars, the partial-sync guard and the
release-scope widening. Then one library end to end, then the blind Claude comparison on real content.

Two decisions are needed before step 1, and both get settled by accident if nobody names them: **whose
account defines the corpus**, and **which library** — where the binding criterion is content that
states testable rules, because the most likely way this pilot disappoints is a well-integrated source
whose content states nothing worth testing.

---

## PILOT-T1 — real-document ingestion from a synchronized folder

**Delivered 2026-09-21.** Implementation, not a plan.
Register: [`RealWorldPilot/CorpusManifest.md`](../../RealWorldPilot/CorpusManifest.md).
Design: [`TRANSITIONAL_KNOWLEDGE_SOURCE_IMPLEMENTATION.md`](../integrations/TRANSITIONAL_KNOWLEDGE_SOURCE_IMPLEMENTATION.md).

**Real-corpus status: `BLOCKED_BY_LOCAL_SYNC_CONFIGURATION`.** The approved pilot folder is not
synchronized to this workstation, and the check was done properly rather than by guessing paths: the
OneDrive sync-engine registry lists exactly one mount for
`sites/CentralRxOperationsSupport/Shared Documents/`, and it is a shortcut named **`Knowledge Base`**
pointing at a *different* subfolder of the same library. One bounded search inside the OneDrive root
found no `Reuben`, `Projects` or `Knowzy` folder; the two near-misses were rejected because one is the
personal OneDrive namespace and the other belongs to a different site. Per the instruction not to
choose silently, no root was selected. Everything else was built and validated against a committed
fixture mirror, and nothing claims the SharePoint web URL was read directly.

### What was built

**Four binary extractors, and one architectural correction that made them cheap.** `structure.ts`
splits the work so an extractor **never computes an offset and never sees the final text** — it emits
headings and paragraphs, and the sectionizer owns the string, which makes X2 true by construction. So
each extractor is `bytes -> Block[]` and nothing more:

- **PDF** through pdf.js, text only, with page numbers preserved, encrypted documents refused,
  image-only documents reported `EMPTY` rather than as success, and no eval or canvas path.
- **DOCX** through a purpose-written OOXML reader. The consequential policy: **tracked deletions are
  excluded and insertions included**, because a question grounded in deleted text is a wrong question
  that passes evidence verification. Comments, headers, footers, hidden runs and field instructions
  are excluded, each with the reason written at the code.
- **PPTX** in **presentation order** resolved from `presentation.xml`, not filename order — a
  reordered deck otherwise reads backwards and silently changes how sections split.
- **XLSX** with sheet names carried (they are what make a cell interpretable) and formula *results*
  read rather than formulas.

PPTX and XLSX were added mid-milestone on request. `.doc`/`.xls`/`.ppt` are deliberately absent: OLE
compound files share no code with OOXML. `SHAREPOINT_PAGE` stays absent because a page has no file.

The ZIP reader is written here rather than taken from a library, because **the reader is the security
control**: ratio and absolute caps checked against the declared size *before* inflating and against
the actual size after, an entry-count cap, encrypted-entry refusal, and traversal-shaped names
rejected so they never reach a log line.

**The FILE_REPOSITORY adapter**, distinct from the mock — which is not a style preference:
`MOCK_ISOLATION` fails startup outside `local` when a mock adapter is registered, so re-pointing the
mock would make every deployed environment refuse to start. The tree reader is shared; the identities
are not.

**The canonical URL reconstruction**, which is the whole reason this path is a stepping stone rather
than a throwaway. `sourceUrl` is non-nullable and flows into the published Question Bank record, so a
local path there would break traceability permanently *and* write a username and machine layout into a
SharePoint list nobody will rewrite. A build-failing test asserts no emitted `sourceUrl` or `webUrl`
matches a local-path shape across every adapter method, and the detector itself is mutation-tested.
Sharing URLs are refused at configuration time because their query string carries a credential-shaped
token that also expires.

### Four bugs the tests found that reading the code did not

- **`Stats.blocks` is not populated on Windows.** It is `0` for every file, so the placeholder
  heuristic marked the entire corpus as cloud placeholders, denied every document, and the adapter
  served nothing. Now POSIX-only and **advisory**: a placeholder is detected where it actually
  manifests — the read fails — and reported with the OneDrive setting to change. Denying on a
  heuristic was worse than the problem it detected.
- **`destroy()` is on the pdf.js loading task, not the document proxy.** Calling it on the proxy threw
  a `TypeError` in a `finally`, which discarded text that had already been extracted successfully.
- **The conformance suite replays a flat `id -> version` checkpoint.** A bespoke state envelope made
  every replayed state unparseable, so the adapter silently degraded each incremental run to a full
  scan and never reported a deletion. The checkpoint now matches the shape the mock uses.
- **`listItems` and `getDocument` did not filter by access**, so a document declared not accessible
  appeared in listings. The suite caught it immediately.

Two of my own test assertions were also wrong rather than the code: the em dash separator is folded to
a hyphen by X1 normalization, and the fixture's "deleted" paragraph was never actually wrapped in
`w:del`, so that assertion had been proving nothing.

### The capability declaration, which is the argument for the whole adapter

`supportsDelegatedAccess: false`, `supportsVersionLabels: false`, `writeCapable: false`, and every
access decision `enforcement: 'PLATFORM'`. `supportsPermissionCheck` is **`true`**, and the earlier
plan's `false` would have been unworkable — the contract forces `UNKNOWN`, and extraction and
synchronization refuse any non-`ALLOWED` decision including `UNKNOWN`, so the adapter could never have
served a document. The shared refusal rule was not weakened; the capability answers "can you answer",
and `enforcement` answers "on whose authority".

`supportedDocumentTypes` is **derived from the extractor registry** rather than written out, so the
declaration cannot drift from what the platform can actually read.

### Verification

`npm run verify` exit 0 — **624 tests across 25 files**, up from 501. `build` 19/19. Boundaries 0
errors, codegen clean, format clean. The audit gate passes: `pdfjs-dist` and `zod` introduced no new
advisories.

The **full adapter conformance suite passes against the real FILE_REPOSITORY adapter with no
assertion relaxed and no group skipped** — 59 passed — which is what makes a transitional adapter
trustworthy rather than merely present. X1–X8 are parameterized over all four binary formats, so each
inherits every invariant rather than being spot-checked.

Two gates earned their keep during the work: the boundary cruiser caught `zod` used without being
declared a dependency, and content rule **C2** caught a SharePoint tenant hostname in a doc comment.
The real tenant hostname was then removed from the conformance test too — it asserts the path-to-URL
mapping, not a tenant, and the approved URL belongs in the corpus manifest.

### What is measured, and what is not

Against the fixture mirror: 12 discovered, 7 included, 5 excluded with a reason each, 7 extracted, 0
failures, 13 sections of which **4 assessable**. Generation, review, approval, publication, assessment
and learner attempts are recorded as **Not yet executed** rather than as zero.

One observation worth carrying to the real corpus: the PPTX and XLSX fixtures produced **no**
assessable sections. That is partly fixture size, but it previews the real finding — slide and
spreadsheet content rarely states a complete rule, and extracting a format successfully is not the
same as generating well from it.

---

## Demonstration environment restored on the pilot corpus path

**2026-09-21.** Register: [`RealWorldPilot/CorpusManifest.md`](../../RealWorldPilot/CorpusManifest.md) §4.

The old synthetic demonstration data was **not** restored. The environment now runs the
**transitional pilot path** — the real `FILE_REPOSITORY` adapter over real PDF, DOCX, PPTX, XLSX,
Markdown and text documents — which is second in the stated priority order and the best available,
because the first is blocked.

**Real corpus: still `BLOCKED_BY_LOCAL_SYNC_CONFIGURATION`, and the diagnosis changed.** The business
confirmed the corpus exists and supplied a screenshot of it, which settled two things the approved
pilot decision had answered differently:

- The documents are in the owner's **personal OneDrive** (`Documents / Reuben / Projects / Knowzy /
  SOPs / SOPs`), **not** in the `CentralRxOperationsSupport` site library.
- **The approved canonical URL therefore points at the wrong place.** Had it been configured as-is
  while the bytes came from personal OneDrive, every document record and every published Question
  Bank item would have carried a provenance link resolving to nothing — the exact failure
  `web-url.ts` exists to prevent, arriving by a route nobody had considered. `provenance` should also
  be `ONEDRIVE_MIRROR` rather than `SHAREPOINT_MIRROR`.

Neither location is synchronized to this workstation. Verified six ways, including testing the exact
breadcrumb path from the screenshot and checking for anything modified under the OneDrive root in the
previous six hours. The folder is cloud-only or excluded from selective sync; no root was chosen
silently.

### What was closed to make this run at all

PILOT-T1 had shipped the adapter but never wired it in, which only executing the milestone revealed:

- **The adapter was not registered.** `FILE_REPOSITORY` now registers in the MCP adapter registry, in
  every environment and with no fixture gate, because it is a real adapter — the environment
  prohibition belongs to the mock. Its honesty lives in the capability declaration instead.
- **No pilot source existed.** The seed now creates one, idempotently, with a repository-relative
  `localRoot` so a fresh clone has a working demonstration and no machine-specific path is committed.
  `PILOT_MIRROR_ROOT` overrides it from the environment and is passed through compose.
- **`folderPath` normalization.** A database check constraint requires a leading `/` and normalizes a
  container root to exactly `/`; the adapter had treated that as a folder *name* and matched nothing.

### The placeholder heuristic, removed after a second failure

`Stats.blocks` was already known to be unpopulated on Windows. Restricting the heuristic to POSIX did
not help either: the services run in a **Linux container over a Windows bind mount**, which also
reports `blocks: 0`. Test Connection therefore failed with "2 of 7 documents are cloud placeholders"
for seven perfectly readable files.

A heuristic that **denies content** on an unreliable field is worse than the problem it detects, so
the inference is gone. Availability is now **proved by reading a byte** from a sample (`probeReadable`),
and a failed read reports the OneDrive setting to change. Proving a file is readable by reading it is
both always correct and easier to reason about.

### The run

Test Connection 11 checks, 7 PASS / 4 SKIP / 0 FAIL — the four SKIPs being capabilities this source
genuinely lacks. Synchronize: 6 documents, 2,432 characters, 0 failures. Generation: **4 accepted of 6
requested, 0 rejections, 0 insufficient-evidence sections**, every evidence span verified against text
extracted from a DOCX, a TXT and a Markdown file. The author's attempt to approve their own draft was
**refused with HTTP 403** before anything was recorded; a second identity approved all four. Published
4 of 4. Assessment created, validated, approved, published with a pinned pool of 4. One learner
attempt: 3 of 4 correct, **75%, PASSED, PROFICIENT**, with no correct-option field anywhere in the
served payload.

### Two things the run exposed that no test had

**A reset database plus a surviving bank file can bind new questions to old bank items, and report
success.** `verify` had truncated the database, restarting the QuestionID sequence at `…-000001`,
while the mock bank's JSON file — which lives outside the database — still held items under those
identifiers. The adapter matched on **QuestionID, not content**, returned `ALREADY_PUBLISHED` for all
four, and marked them published against four unrelated items. Recovery required clearing the
projection, the publish-operation ledger and the bank file together. On a real bank this is a
reconciliation case, which is what Phase 8 drift detection is for — but the failure mode deserves
naming: the publish looked like it worked.

**Assessment approval has no separation of duties.** `assessment.manage`, `assessment.approve` and
`assessment.publish` all belong to the single `Assessment Manager` role, so one identity created,
approved and published the assessment. Question approval enforces gate 13 strictly; assessment
approval does not. An observation about the seeded role matrix rather than a defect, but a reviewer
comparing the two workflows will notice.

### A note for whoever demonstrates this

Every one of the four questions came from **Markdown, DOCX or plain text**. The PDF, PowerPoint and
Excel documents extracted cleanly — correct text, page numbers, slide order, sheet names — and
produced **nothing**, because no section reached the assessable length threshold. Partly fixture size;
mostly the real lesson, which is that extracting a format is not the same as generating well from it.

---

## The real SOP corpus, processed end to end

**2026-09-22.** Registers:
[`RealWorldPilot/CorpusManifest.md`](../../RealWorldPilot/CorpusManifest.md) ·
[`PILOT-T1-CORPUS-SELECTION.md`](../integrations/PILOT-T1-CORPUS-SELECTION.md).

The approved pilot corpus is synchronized locally and has been processed: **28 real SOP documents,
122,106 characters, 234 sections**, through generation, review, approval by a second identity,
publication, a pinned assessment and a scored learner attempt. No fixture content took part.

### Finding the corpus took three attempts, and the method was the problem

The corpus was first reported absent, then located in the wrong library, before the approved root
settled it. All three readings came from the same mistake: **deriving a filesystem path from what a
OneDrive web breadcrumb implied.** The breadcrumb showed
`Documents / Reuben / Projects / Knowzy / SOPs / SOPs` under personal OneDrive, but the folders were
shortcuts, so every path derived from it was missing on disk — and a filename search then found the
same 29 filenames under an unrelated synced library, which produced a second confident wrong answer.

**Searching for a distinctive filename is the right first move; trusting it to identify the owning
library is not.** Recorded because the wasted effort was entirely avoidable.

The container could not see the host folder either, so `/corpus` is now a **read-only** bind mount.
Read-only is a control rather than a convenience: a knowledge source is read-only to the platform by
contract (`writeCapable: false`), and mounting a customer's synchronized folder writable would make
that a promise instead of a property.

### The run

28 of 29 files processed — the 29th is a CSV with no registered extractor, reported by Test Connection
**before** synchronization rather than discovered as a failure after it. 0 extraction failures.
Generation accepted **3** questions; evidence verification refused **1** candidate on real content,
which is the grounding control working on documents nobody here wrote. The author's attempt to
approve their own draft was refused with **403** before anything was recorded. Three published as
`KNZ-SUPPORT_OPS-2026-000001…000003`, assessment pinned at a pool of 3, learner attempt **3/3, 100%,
PASSED, EXPERT**, with no answer key anywhere in the served payload.

### A real defect: generation was mutating a curated flag

Generation wrote `isAssessable: false` on any section it could not build a question from, citing §6.
**The spec does not say that.** §6.2 reserves `NON_ASSESSABLE` for the document's own structure —
contents pages, revision histories, legal notices, sections below the length threshold — and makes the
flag author-curated, flippable only "with an audited reason". A generator's inability to form four
plausible options is a fact about that generator.

Measured on real content: **101 sections, every one over the 300-character threshold, were marked
unassessable by a single run.** Consequences — the coverage denominator shrank silently so coverage
read artificially complete; a second run over the same documents failed `GENERATION_SCOPE_EMPTY`,
which is what blocked generation from the UI; and it destroys the baseline for comparing generators,
since a model asked to work the corpus afterwards would be handed one claiming almost nothing is
assessable. That last consequence makes it a **blocker for the T-29 comparison**, not a cosmetic
issue.

Fixed: the insufficiency is still recorded on the job and still sets `coverageStatus` with its reason,
but `isAssessable` is left alone. The affected rows were restored from their stored character counts,
which is safe because the reason string is unique to that path and every restored row is over the
threshold. Assessable sections went from 21 back to 115.

### The finding that survived, after two wrong ones

Restoring the flags produced **no** additional questions. A fresh run over 93 sections accepted 0; a
second job aimed specifically at the documents whose assessable sections had never been tried
accepted **0 of 10**, with all 14 sections insufficient.

So low yield was never caused by the defect. The deterministic generator requires a **declarative
sentence containing a modal** — `must|may|requires|never|only|shall|cannot` — from which three
distinct distractors can be formed. Real support SOPs are **imperative**: *"Click Retry"*, *"Run the
query"*, *"Check the log"*. They tell a reader what to do next, which is right for their purpose and
structurally invisible to this generator. The three questions that exist came from sections that
happen to contain a modal, such as a decision matrix.

Two conclusions were drafted and withdrawn along the way, both recorded in the documents rather than
quietly deleted: that long procedural SOPs contain nothing assessable (an artifact of the defect), and
that section count anti-correlates with assessability (the data is simply inconsistent — 29 sections
with 27 assessable, 49 sections with 7).

**The honest yield for this corpus and this generator is 3 questions from 28 documents**, and the
platform declines to fabricate the rest with a reason recorded per section. That is now the strongest
available argument for T-29: a model can read a procedure and ask what a technician must know; sentence
matching cannot. The **106 recorded refusals are the baseline** to measure a model against — and that
baseline only survives because the defect above is fixed.

Until that comparison runs, low yield is a property of **the generator**, not of the documents, and
the two must not be conflated when reporting to stakeholders.

---

## Live Claude Generation workstream — planning, and a defect the planning found

**2026-09-22.** Planning artifacts:
[`LIVE_CLAUDE_IMPLEMENTATION_PLAN.md`](../integrations/LIVE_CLAUDE_IMPLEMENTATION_PLAN.md) ·
[`LIVE_CLAUDE_EVALUATION_PLAN.md`](../integrations/LIVE_CLAUDE_EVALUATION_PLAN.md).
No code written; the workstream is blocked on **T-29**.

PILOT-T1 proved the platform ingests real documents, grounds questions in them, and carries them
through review, approval, publication and a scored attempt. What it also proved is that the
remaining bottleneck is **question quality**, and that the bottleneck is in the generator.

### What the deterministic generator actually does

Worth recording plainly, because the published question everyone has now seen invites the assumption
that a model wrote it. Nothing did. `KNZ-SUPPORT_OPS-2026-000001` was assembled by
`generator.ts`: the stem is a fixed template over the section heading, option A is the section's own
sentence copied verbatim, option B swaps the first quantity (`one` → `three`) through
`NUMERIC_SWAPS`, option C swaps the first modal (`only` → `in addition to any other case`) through
`MODAL_SWAPS`, option D applies both, and the explanation is a second fixed template.
`modelConfidence` is the constant `0.6`.

So every distractor is a **mutation of the correct answer**, which produces a quality defect worth
stating precisely: the correct option is identifiable from **form alone**, because it is the only one
written in ordinary English. A question answerable without reading the source does not test the
source, whatever its evidence span says. The evaluation plan turns that into a measurement — the
**blind-stem test** — rather than leaving it an assertion, and that test needs no API key and no
approval, so the baseline can be measured now.

### A defect: my earlier fix was half a fix

On the same day, generation was found writing `isAssessable: false` on any section it could not build
a question from, and that was fixed. Reading `preflight.ts` against `generation-service.ts` while
planning the evaluation showed **the same conflation had simply moved**. Generation still writes
`coverageStatus = 'NON_ASSESSABLE'` on insufficiency, and preflight counts a section as uncovered
only when its status is `NOT_COVERED` or `PARTIALLY_COVERED`. So a section the generator failed on
stays in the denominator and is **excluded from the uncovered set**: the failure is counted as
coverage.

Measured on the pilot corpus rather than argued:

| | Sections |
| --- | ---: |
| Assessable | 115 |
| Genuinely carrying a question | **3** |
| Marked `NON_ASSESSABLE` by generation, and so treated as covered | **106** |
| Counted as uncovered | 6 |

Preflight therefore reports **94.8% coverage** where the truth is **2.6%**. The 106 is exactly the
106 recorded insufficiency reasons — **every refusal became a claim of coverage.** The mock source in
the same database reads honestly (17 assessable, 17 uncovered) precisely because nothing has ever
generated from it.

Two lessons, both recorded because both cost something:

1. **A fix to a conflation must follow the conflated value everywhere it is written**, not just where
   it was noticed. Two columns carried the same wrong idea and only one was corrected.
2. **`npm run verify` passed throughout.** 624 tests, and none of them asserts that a coverage
   percentage means what the screen says it means. The gap was found by reading two files against
   each other while planning a measurement — which is an argument for planning measurements.

### What the planning settled

- The seam is **one HTTP client and a budget layer**. The prompt (`framing.ts`, nonce-delimited
  untrusted framing with an empty tool grant), the strict output schema, evidence verification,
  integrity, composite confidence, scope enforcement, per-question model provenance and token
  accounting are all built and are exercised today by the deterministic generator standing in for a
  model.
- **`ANTHROPIC_API_KEY_REF` already exists** and its schema refuses a raw key — two tests assert that
  `sk-ant-…` fails at startup. So the pilot needs a local secret *resolver*, not a relaxed rule.
- **The recorded prompt version is not the prompt that would be sent.** `PromptVersion.body` is
  seeded as a hand-written paraphrase of what `framing.ts` builds in code. Harmless while no model
  reads the prompt; permanently wrong provenance the moment one does, because the table is immutable
  by design. The body must be derived from the framing code and guarded by a contract test.
- The profile's `modelId`, `temperature` and `maxOutputTokens` are **stored and ignored**, and
  `estimatedCost` is a column that is never written. The obvious fix — a hardcoded model constant in
  the new generator — would produce correct-looking audit rows and still ignore the profile, so
  per-profile construction plus an equality assertion is the decision.
- Budgets, the concurrency cap and 429 backoff are specified in `architecture.md` §9 and **absent**.
  They land with the generator, not after it.
- The **decision rule is pre-registered** in the evaluation plan, before any model output is seen,
  and explicitly excludes "the questions look better" — fluent text reads better than a template,
  and fluency is not correctness.

Steps 1–4 of the sequence — the coverage fix, the prompt-version fix, the blind-stem baseline and a
control run — are **not blocked on T-29** and are worth doing regardless of what the approval
decides.

---

## Source-document authoring guide, and a section-key collision found measuring for it

**2026-09-22.** Artifact:
[`SOURCE_DOCUMENT_AUTHORING_GUIDE.md`](../integrations/SOURCE_DOCUMENT_AUTHORING_GUIDE.md).

A practical guide for SOP owners, built entirely from measurements of the real corpus rather than
from advice. Every number is recomputable from `document_section`, `generation_job_rejection` and
`draft_question`.

### What the measurement showed

| | |
| --- | ---: |
| Documents with **no headings at all** | **15 of 28** |
| Sections with no heading | **81 of 234** |
| Documents reduced to a **single section** | **11** |
| Sections below the 300-character assessable floor | **118 of 234** |
| Documents with **zero** assessable sections | **0** |

The decisive finding is that **heading placement, not content quality, predicts yield**, and three
documents make the case on their own — all long, headed, professionally written:

| Document | Sections | Assessable | Share |
| --- | ---: | ---: | ---: |
| `RxNet_L2_SSL_Certificate_Renewal_SOP.docx` — headings per **topic** | 29 | 26 | **90%** |
| `TRACELAB_Support_SOP.docx` — headings per **step** | 32 | 6 | 19% |
| `Rxnet Eolp Database Connection Pool Exhaustion Sop.docx` — headings per **step** | 49 | 7 | 14% |

And the refusal reasons, grouped: **187 of 194 refusals** say the section states nothing a person
could be wrong about — 124 (58 sections) *"states no procedure, threshold, or decision rule"*, 63 (26
sections) *"no set of four distinct, plausible options could be formed without inventing content"*.
Support SOPs describe actions, not knowledge.

The guide is deliberately hedged on one point: §3–§4 (headings, section size) help any generator, but
§5 (rewriting imperatives as rule sentences) is partly a workaround for a sentence-matching
generator that is about to be replaced. **Advising a business to rewrite 28 working runbooks to suit
a template engine would have been bad advice**, so the guide says so and ranks the formatting actions
first.

### A defect: `section_key` collides across documents

Found while checking why a query attributed one draft question to two documents.

`section_key` is `sha256(heading path + ordinal)`. For a section with **no heading** the heading path
is empty, so the key reduces to a hash of the ordinal alone — **identical in every heading-less
document**. Measured: one key is shared by **21 documents**, another by **10**, and five more by
three each.

Both places that resolve a section key use `Array.find()`, which returns the *first* match:

- `evidence.ts` — `args.sections.find((c) => c.sectionKey === args.sectionKey)`
- `generation-service.ts` — `scope.sections.find((s) => s.sectionKey === candidate.sectionKey)`

So when two colliding sections are in one pinned scope, the span is verified against whichever
section is ordered first, and the question's lineage — `sourceDocumentId`, `sourceUrl`,
`sourceDocumentName` — is taken from that section's document.

**Checked rather than assumed on the published questions.** `KNZ-SUPPORT_OPS-2026-000003` cites a key
shared by `Tickets SOP's.docx` and `EOLP Support SOP.pdf`, and is attributed to the former. Its span
was located in `Tickets SOP's.docx` at offset 12,984 and is **absent** from the PDF, so the
attribution is **correct** — but correct by ordering, not by construction. Two consequences remain:

1. **A false refusal** whenever the first-ordered colliding section does not contain the span, which
   is the common case and looks exactly like a generator failure.
2. **A false attribution** whenever both colliding sections *do* contain the span — repeated
   boilerplate, a shared preamble, a paragraph copied between SOPs. With 21 documents on one key that
   is a live risk, not a theoretical one, and it would publish a governed asset citing the wrong
   document.

Currently costing one recorded suppression (*"a question testing this section already exists"* fired
on a colliding key), so it is a small bill today and a growing one: the collision rate rises with
every heading-less document added.

The fix is to include the document in the key's derivation, or to resolve sections by id rather than
by key inside a scope. Recorded rather than fixed, because this commit is a documentation
deliverable — but it belongs ahead of the live-Claude work, since a model will cite section keys far
more often than a sentence matcher does.

**Third defect in two days whose common shape is the same:** a value that is correct for the case it
was designed for (a headed section, a curated flag, a coverage status) being reused for a case it
cannot represent. Worth watching for.

---

## Generation-ready corpus, and the measurement that narrowed the authoring advice

**2026-09-22.** Artifacts: `RealWorldPilot/GenerationReady/` (7 documents) ·
[`GENERATION_READY_CORPUS_SUMMARY.md`](../integrations/GENERATION_READY_CORPUS_SUMMARY.md) ·
[`CorpusManifest.md` §7](../../RealWorldPilot/CorpusManifest.md).

Seven pilot SOPs restructured into generation-optimised Markdown so that the generator comparison has
a corpus whose structure is not the limiting factor. **The originals were not opened for writing**;
every derived document was produced from the platform's own stored `extracted_text`, and the
authoritative register in §3 is unchanged. The derived files are evaluation assets, each carrying a
header block that says so.

### Measured, not predicted

Both corpora were run through the real `extractContent`, the real `createDeterministicGenerator`,
evidence verification in STRICT mode and the integrity gate.

| | Original 7 | Generation-ready 7 |
| --- | ---: | ---: |
| Sections | 144 | 78 |
| Sections with a heading | 122 | **78 (100%)** |
| Assessable | 67 (46.5%) | **76 (97.4%)** |
| **Questions accepted** | **4** | **16** |

**A 4× yield increase, all sixteen evidence-verified and integrity-passing.** The largest single gain
was `SOP - Printer Management`, a 3,053-character monolith with no internal structure, which went
from 1 assessable section to 11 and from 0 questions to 3.

### Two results that contradicted the expectation

**Restructuring the best-structured document made it worse.**
`RxNet_L2_SSL_Certificate_Renewal_SOP` was included as a control precisely to test whether
restructuring helps unconditionally. It went from 26 assessable sections to 12 — consolidation
replaces many small sections with fewer large ones — and produced **zero questions before and zero
after**, despite twelve rule-dense sections averaging 965 characters. That document did not need
converting, and "restructure everything" is therefore the wrong instruction.

**Yield tracks quantities in rule sentences, not structural quality.** The generator builds its three
distractors by swapping a quantity, a modal, or a known actor noun. A sentence carrying one modal, no
number and no recognised actor yields **one** distractor and the section is refused for want of
three. That is exactly the SSL document's style — *"L2 must not wait for business impact"* — a
perfectly good rule with nothing to vary. The two documents that produced five questions each are
full of numbers: TRACELAB carries version `1.6.0.2`, `HTTP 200 OK`, "seven situations", "thirteen
checks"; Order Cancellation carries `NO = 1` and the one-versus-three job distinction.

So the measured rule is narrower than
[`SOURCE_DOCUMENT_AUTHORING_GUIDE.md`](../integrations/SOURCE_DOCUMENT_AUTHORING_GUIDE.md) §5.3
implied as advice:

> **Headings and section size make a document assessable. A stated quantity makes it generate.**

Both findings are about **this** generator. A model reading *"L2 must not wait for business impact"*
can construct three plausible wrong answers without a number to vary; whether it does is what the
comparison exists to establish, and this corpus is now where that happens on equal structural
footing.

### Three judgement calls recorded rather than made silently

1. **Format sections were omitted rather than filled.** The requested nine-section template and the
   instruction not to invent knowledge conflict for any document that states no thresholds. Writing
   plausible thresholds would have been exactly the fabrication the platform exists to prevent, so
   `Thresholds`, `Exceptions` and `Validation Criteria` are absent where the source states none, and
   each file records its own omissions.
2. **`Tickets SOP's.docx` was only partially converted.** It is not a single SOP but a collection of
   unrelated ticket notes, and its other topics carry real job numbers, live SQL, internal server
   identifiers and an AWS instance IP. Only the SAP-to-Rx.Net interface reference (F1–F15) was
   converted, and the file is named for what it contains rather than for its parent — a deliberate
   departure from the requested naming convention.
3. **Identifiers were redacted.** Named individuals, mailbox addresses, server FQDNs, an AWS instance
   IP, customer order identifiers and job numbers were removed before anything reached version
   control. No operational rule depends on any of them.

### One governance constraint

A question generated from this corpus carries provenance pointing at a **derived asset** rather than
a document of record. That is fine for evaluation and not acceptable for publication, so **no
question generated from this corpus may be published to the Question Bank**. Recorded in
`CorpusManifest.md` §7.5 as well as here, because it is the kind of constraint that gets forgotten
once the corpus starts producing better questions than the real one.

---

## PILOT-T2 — grounding integrity and coverage that tells the truth

**2026-09-22.** Migration `0004_grounding_integrity`. Gates:
`packages/testing/contracts/grounding-integrity.test.ts` (10 tests). Reporting:
`scripts/coverage-report.ts`, `scripts/verify-section-keys.ts`.

Three defects fixed before any Claude work, because all three corrupt the measurement the Claude
comparison depends on. `npm run verify` passes: **634 tests across 26 files**, up from 624.

### 1. Coverage counted refusals as coverage

`coverage_status` carried two unrelated facts. Generation wrote `NON_ASSESSABLE` on a refusal, and
preflight counted a section as uncovered only when its status was `NOT_COVERED` or
`PARTIALLY_COVERED` — so a refused section stayed in the denominator and disappeared from the
complement of the numerator. **Every refusal was counted as coverage.**

The five states are now separate fields and separate concepts:

| Concept | Where it lives | Means |
| --- | --- | --- |
| **assessable** | `is_assessable` | Long enough, not curated out. The denominator |
| **attempted** | `generation_attempt_count` | Has been in a job's scope |
| **generated** | `coverage_status = COVERED` | A question cites it. This, over assessable, IS coverage |
| **refused** | `last_generation_outcome = REFUSED` | A run found nothing testable. A fact about the run |
| **unresolved** | neither of the above | Assessable, no question, no refusal |

`UNRESOLVED` exists as a fourth outcome value because a section blocked by the duplicate gate was
attempted and is neither generated nor refused. Recording it as `NOT_ATTEMPTED` would have been the
same class of lie.

Measured on the pilot corpus, before and after:

| | Reported before | Actual |
| --- | ---: | ---: |
| Assessable | 115 | 115 |
| Coverage | **94.8%** | **2.6%** |
| Generated | — | 3 |
| Refused | hidden | 106 |
| Unresolved | — | 6 |

### 2. Section keys collided across documents

`section_key` was `sha256(heading path + ordinal)`, so a section with no heading hashed
`segment:N#N` — identical in every heading-less document. One key was shared by **21 documents**,
another by 10, five more by three each: **53 collisions across 251 sections.** Both resolvers use
`Array.find()`, which returns the first match, so a span could verify against another document's
section and the question's lineage would follow that document.

The key is now `sha256(unscoped_key + sourceDocumentId)`. Two properties made the migration
possible: the unscoped key is a fixed 64 hex characters, so the concatenation is unambiguous without
a separator; and the new key is a pure function of the old one, so SQL can recompute it. After
migration: **251 sections, 251 distinct keys, 0 collisions**, and
`scripts/verify-section-keys.ts` confirms all 251 agree with the TypeScript derivation.

**The migration ran into I15 and lost, which was correct.** The first attempt tried to rewrite
`draft_question.section_key`, and a trigger refused it: *"draft_question lineage is immutable; edits
create a new version."* Rewriting a published question's section key would have changed what the
platform claims was published, after the fact, with no new version and no audit record. So an
existing question keeps its v1 key permanently, `document_section.section_key_v1` keeps that key
resolvable, and coverage matches on either. The two job-level tables are rewritten only where
exactly one of the job's documents owns the key; where the collision made it genuinely ambiguous the
old value is left in place rather than guessed at.

### 3. The recorded prompt was not the prompt

`PromptVersion.body` held a hand-written paraphrase of the generation rules while `framing.ts`
assembled a different text at call time. Harmless only because the deterministic generator never
reads the prompt — and permanently wrong provenance the moment a model does, because the table is
immutable by design.

The body is now `canonicalPromptBody()`, rendered by the code that builds the prompt with the
per-call nonce placeheld, pinned by `PROMPT_BODY_SHA256`, at version **1.2.0**. Editing the prompt
fails the contract test until the hash and the semantic version are updated together.

### What this cost, and the lesson

The three defects shared one shape: **a field correct for the case it was designed for, reused for a
case it cannot represent.** `coverage_status` was asked to carry a run outcome. `section_key` was
asked to identify a section globally when it only identified one within a document. `PromptVersion.body`
was asked to be a record when it was written as a description.

All three passed 624 tests. Two of the three were found by reading two files against each other, and
one of them — the coverage conflation — was a **residual of a fix made hours earlier**: that fix
stopped the bad write to `isAssessable` and left the identical bad write to `coverage_status`
untouched. A fix to a conflation must follow the conflated value everywhere it is written.

The test that asserted `coverageStatus === 'NON_ASSESSABLE'` is the clearest artifact of that: **the
suite encoded the defect**, so the defect could not fail a build. It now asserts the split.

---

## KNOWZY Administrator — a full-access role that is not an exemption

**2026-09-22.** Role: `KNOWZY_ADMINISTRATOR`. Identities:
`knowzy-administrator@local.invalid` (default in both portals) and
`knowzy-administrator-2@local.invalid`.

A permanent production role for platform owners, product owners, knowledge managers,
administrators, pilot leads and operational platform support. It holds **all 46 permission keys**,
so no screen in the platform refuses it for want of a capability. Every existing role is unchanged.

### The rule that shaped the implementation

The obvious build — one role holding every permission — **failed a contract test**, which cited
access-control.md §2 rule 3: *"No role grants both `question.approve` and `question.publish` by
default. A tenant may combine them by assigning both roles, which is a visible, audited decision
rather than a default."*

The gate was right and the spec outranks the convenience, so the role was composed the way the rule
prescribes rather than by exempting the role from the rule:

- `KNOWZY_ADMINISTRATOR` holds every key **except** `question.publish`.
- The administrator **user** also holds `PUBLISHER`.
- Permissions are the union across a user's roles, so the identity holds all 46.

Two `user_role` rows, both audited, instead of one role with a special case and a weakened test.
Verified in the database: both administrator identities resolve **46 of 46** permission keys.

### Full access is not exemption, and the validation proves it

The brief asked for one identity to complete Source → Generate → Review → Approve → Publish →
Assessment without switching, **and** for separation-of-duties controls to stay intact. Those two
requirements cannot both hold, and the reason is structural rather than a matter of configuration:
separation of duties is an **identity comparison** made at approval (`authorMayApproveOwn: false`),
so no permission set can satisfy it.

Rather than pick one requirement silently, the role delivers everything a permission can give and
the gate keeps the one thing it is for. A second administrator identity makes the pilot completable
with a single deliberate switch at approval.

`PILOT_DEMO_AS_ADMIN=1 npx tsx scripts/pilot-demo.ts` runs the whole workflow as the administrator.
The recorded run:

| Step | Identity | Result |
| --- | --- | --- |
| Test Connection, Synchronize | administrator | 11 checks, 8 PASS; 28 documents, 122,106 chars |
| Preflight, decision, Generate | administrator | `GENERATE_NEW`; **4 accepted** of 6, 89 insufficient |
| Claim, submit | administrator | 4 submitted |
| **Approve own draft** | administrator | **REFUSED 403 — gate 13, before anything was recorded** |
| Approve | administrator-2 | 4 approved |
| Publish | administrator | 1 published as `KNZ-SUPPORT_OPS-2026-000004`, 3 already published |
| Assessment | administrator | Validated, published with a pinned pool of 4 |
| Learner attempt | administrator | 4 answered, 3 correct, **75% PASSED PROFICIENT** |

The 403 in the middle is the point of the exercise. An administrator with every permission in the
system is still refused when it tries to approve its own work.

**Generation accepted 4 questions where the same job previously accepted 3** — a PILOT-T2 side
effect, not a role effect: with refusals no longer suppressing sections, a section that had been
hidden became available again.

### One omission this caught

Restarting the API after PILOT-T2 failed its own startup check: *"expected
0003_platform_constraints, found 0004_grounding_integrity."* Four files pin the expected migration
and PILOT-T2 updated none of them. The check did exactly its job — it refuses to run an application
against a schema it was not built for — and the constant is now `0004_grounding_integrity` in all
four places.
