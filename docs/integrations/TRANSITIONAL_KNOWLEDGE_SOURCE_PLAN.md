# Transitional Knowledge Source Plan

**Status:** Plan. Planning artifact only — no code changed.
**Purpose:** get **real corporate documents** into Knowzy while Entra, Graph and `Sites.Selected` are
unavailable, without pretending the platform has governance properties it does not.
**Premise:** [ACCESS_DISCOVERY_REPORT.md](ACCESS_DISCOVERY_REPORT.md) — Graph SharePoint returns 403
and needs admin consent; a signed-in user can browse and download from the sites.
**Out of scope by instruction:** Entra, Microsoft Graph, `Sites.Selected`, SharePoint Graph adapters.

---

## 0. The trade-off, stated once

[SHAREPOINT_DISCOVERY_PLAN.md](SHAREPOINT_DISCOVERY_PLAN.md) §9 cautioned against ingesting documents
by a non-SharePoint route. That caution stands and this plan proceeds anyway, because the direction is
given and the caution was about *how*, not *whether*:

| Property | With the Graph adapter | On this transitional path |
| --- | --- | --- |
| Per-user permission trimming | SharePoint's own decision, per user | **Lost.** Knowzy's own layers only |
| Source version labels | Real SharePoint versions | **Lost.** Content hash only |
| SharePoint column metadata | Read from the library | **Lost** unless recorded by hand |
| Corpus boundary | The configured paths | **One individual's access** (§4.4) |

Those four are real losses. The plan is built so that **each one is declared, not emulated** — which
is the difference between a legitimate transitional adapter and a misleading one. Adapter template
rule **P1** is explicit: *"Honest `AdapterCapabilities`. Emulating a capability is a contract
violation."* The contract already has a vocabulary for saying "I cannot do this", and using it is what
makes this path defensible.

What is gained is large and otherwise unreachable: real documents, in real formats, through the real
extractors, which retires the largest unknown in the programme (§1.4, §7).

---

## 1. Supported initial sources

Three source *kinds*, and the central recommendation of this plan is that they are **one adapter with
three roots**, not three adapters.

### 1.1 Tier 1 — Synced SharePoint document library (recommended primary)

The OneDrive sync client can mirror a SharePoint document library to a local directory — *Sync*, or
*Add shortcut to OneDrive*. This needs **no app registration, no admin consent and no Graph call**: it
uses the signed-in user's existing SharePoint permissions through Microsoft's own client.

The result is a local directory tree whose structure, filenames and folder hierarchy are the real
library's, kept current by Microsoft rather than by us.

**This is the highest-value tier** and should be the pilot's first real source:

- real documents in real formats, exercising the real extractors;
- real folder structure, which is what `KnowledgeSourcePath.folderPath` and the taxonomy mapping are
  built on;
- the local path is **mechanically convertible** to the document's true SharePoint URL (§2.4), so
  traceability survives;
- it is continuously refreshed, so change detection is exercised rather than simulated.

**Caveat, and it is not small:** the mirror contains exactly what **one person** can see. See §4.4.

### 1.2 Tier 2 — OneDrive-accessible files

Two sub-cases that must not be conflated:

| Route | Available today? | Notes |
| --- | --- | --- |
| A user's **synced OneDrive folder** on disk | **Yes** | Mechanically identical to tier 1. Same adapter, different root |
| Graph `/me/drive` | **No** | `Files.Read` (own files) *is* user-consentable and would not need an administrator — but requesting it needs an **app registration**, which is unavailable. Blocked by the registration gap, not by consent |

So tier 2 is served by the same synced-folder mechanism as tier 1. **Graph OneDrive is explicitly out
of scope** and is noted only so nobody spends a week discovering the registration gap independently.

A caution on content: personal OneDrive is where drafts, personal copies and unapproved material live.
Prefer libraries. Where OneDrive is used, it should be a deliberately curated folder, not a home
directory.

### 1.3 Tier 3 — Local upload

A file placed into a managed directory, either by an authoring-portal upload control or by an
operator dropping it there.

**Recommendation: treat upload as a *root*, not as a feature.** An uploaded file is a document in a
file-repository source whose root happens to be a managed upload directory. That choice means:

- no new source type, no new lifecycle state, no new question field — satisfying rule **P8**;
- uploads pass the identical extraction, preflight, generation, review and publication path;
- the upload *control* becomes optional. **Defer the UI**; an operator-managed drop directory
  delivers tier 3's value with none of tier 3's risk (§4.2).

Tier 3 is the weakest tier — no provenance, no version, no permission signal, no owner — so it should
carry the narrowest capability declaration and, ideally, not be used for the pilot at all.

### 1.4 Why this is worth doing rather than waiting

**Only three extractors exist**: plain text, Markdown and HTML. PDF, DOCX, PPTX, XLSX and SharePoint
Pages have none ([ACCESS_DISCOVERY_REPORT.md](ACCESS_DISCOVERY_REPORT.md) §5.1). A real library is
mostly the formats that do not work.

That work is on the Phase 7 critical path **whether or not Graph ever opens**, and it can only be
validated against real documents. This path supplies them. If the access conversation resolves in a
week, none of this is wasted; if it takes a quarter, the programme still advances.

---

## 2. Required code changes

Grounded in the tree at `31cb663`. Ordered by dependency.

### 2.1 A binary-capable extraction entry point — the largest item

`packages/content-extraction/src/extract.ts`:

```ts
export interface ExtractInput {
  readonly fileName: string;
  /** Decoded text. Binary formats are not supported yet (see below). */
  readonly content: string;
  readonly sizeBytes?: number;
}
```

`content` is a **`string`**. A PDF cannot be passed through it. The module's own comment calls new
extractors "additive — a new entry in this map plus a conformance fixture", which is true for text
formats and **optimistic for binary ones**: this is a signature change to the extraction entry point,
and every caller changes with it.

| Change | Note |
| --- | --- |
| `ExtractInput.content` accepts bytes as well as text | Keep the text path intact; existing extractors and their invariant tests must not change behaviour |
| Register `pdf`, `docx`, `pptx`, `xlsx` extractors | Each must satisfy **X2** — offsets round-trip into the extracted text, or evidence spans cannot re-locate |
| Preserve X5 / X6 / X7 / X8 | No text on failure; truncation reported; SHA-256 of normalized text; deterministic |
| Leave `SHAREPOINT_PAGE` unregistered | It is a Graph canvas-layout concern and is out of scope here. `UNSUPPORTED` with a reason is the correct behaviour |

**Sequencing recommendation:** PDF and DOCX first — they are the bulk of a real library. Decide PPTX
and XLSX from the measured distribution (discovery checklist B1), and question whether slide and
spreadsheet content states testable rules at all before building for it.

**X2 is the hard part, not the parsing.** Extracting text from a PDF is a library call; producing
offsets that let a stored evidence span be found again years later is the requirement, and it is what
makes evidence verification meaningful.

### 2.2 A real `FILE_REPOSITORY` adapter — and it must not be the mock

`FILE_REPOSITORY` is already a declared `SourceType` with a documented template
([knowledge-source-adapters.md §7.6](../knowledge-source-adapters.md)). The mock adapter already reads
a directory tree with sidecars, so the temptation is to point the mock at a different root.

**That cannot be done, and the reason is a startup check.** `packages/configuration/src/startup.ts`
fails `MOCK_ISOLATION` outside `local` when `MOCK_FIXTURE_ROOT`/`MOCK_FAULTS` is set **or when
`mockAdaptersRegistered()` returns true**. A mock adapter serving a deployed environment is exactly
what that check exists to prevent, and it is right.

| Change | Note |
| --- | --- |
| Extract the tree reader from `mock/fixture-tree.ts` into a shared internal module | Reuses tested code — path normalization, forward-slashed IDs so they match on Windows, lazy content reads, sidecar parsing |
| New `file-repository/` adapter registered under `SourceType = 'FILE_REPOSITORY'` | A **distinct** adapter. The mock stays local-only and keeps its own identity |
| Its own `AdapterCapabilities` (§3.2) | Honest, per P1 |
| Test Connection mapped onto the nine checks, returning `NOT_RUN` where a check cannot apply — **never `PASS`** | Rule P3 |
| Reject `DELEGATED_OBO` at configuration time | Rule P6. A filesystem has no per-user model; accepting the mode would misrepresent who enforces access |
| Throttling and retry policy declared to the resilience wrapper | Rule P7. Trivial for a local mount, still declared |
| Fixture set plus a passing conformance suite | Rule P5 |

### 2.3 Release scope and the generated contract

`packages/shared-types/src/enums.ts`:

```ts
export const RELEASE_1_SOURCE_TYPES: readonly SourceType[] = ['SHAREPOINT', 'MOCK'];
```

Adding `FILE_REPOSITORY` is a **release-scope change, not a workaround**, and it is consumed by
`packages/shared-types/scripts/codegen.ts` — so it requires `npm run codegen` or `verify` fails the G6
contract check. Good: the widening is visible in a committed diff rather than implicit.

### 2.4 Source URL reconstruction — small change, large consequence

`KnowledgeDocument.sourceUrl` is **non-nullable**, and `BankItemWrite.sourceUrl` carries it into the
published bank record. The mock emits `webUrl: mock://{relativePath}` — honest for a mock.

A file-repository source over a synced library must **not** emit a local path. Two reasons:

1. **Traceability breaks.** A reviewer, or an auditor reading a published question years later, needs
   a link that opens the source document. `C:\Users\someone\OneDrive - Contoso\...` opens nothing for
   anyone else.
2. **It leaks a local path into the question bank** — a username and machine layout written into a
   SharePoint list that is authoritative for published content and is not going to be rewritten.

**Required:** `connection.webUrlBase` on the source, plus deterministic local-path → SharePoint-URL
mapping, so `sourceUrl` is the document's **true SharePoint URL** even though the bytes came from
disk. This is the single change that lets the transitional path produce publishable questions whose
provenance survives the migration in §5.

For tier 3 (upload) there is no real URL. Emit an explicit non-resolving scheme — as the mock does —
never a local path, and let it be visibly provisional.

### 2.5 Metadata sidecars

The sync client brings **file bytes, not SharePoint columns**. So `includedMetadata` has nothing to
read, and `domainMapping` / `topicMapping` lose their input.

The mock's `{file}.meta.json` sidecar is already the right shape — `sourceVersion`, timestamps,
`mimeType`, a `metadata` map of column values, and an `access` map with per-principal decisions. The
file-repository adapter should read the same sidecar, so the discovery work in
[SHAREPOINT_DISCOVERY_PLAN.md](SHAREPOINT_DISCOVERY_PLAN.md) Phase D **is** the metadata capture.

Two honest limits: sidecars are hand-maintained, so they go stale silently; and they are only as
accurate as the discovery. Where no sidecar exists, the adapter must fall back to filesystem facts and
declare the metadata absent — never invent a version label.

### 2.6 Configuration

A root path must be a **declared** configuration key. `MOCK_FIXTURE_ROOT` cannot be reused: it is
`forbiddenIn` every non-local environment by the env contract, and reusing it would fail
`MOCK_ISOLATION`.

| Change | Note |
| --- | --- |
| A new declared env var for the file-repository root, permitted in deployed environments | `packages/configuration/src/env.ts`; C3 keeps `process.env` reads in one place |
| Any new tunable (size caps, scan interval) declared in `CONFIG_KEYS` | An undeclared key cannot be read (P1 of the configuration catalogue) |

### 2.7 Only if the upload UI is built (recommended deferred)

A new API route with a declared policy — the registry test fails the build on a handler without one —
plus every control in §4.2. Omitting this is how tier 3 stays cheap.

### 2.8 What must **not** change

Rule **P8**: no new lifecycle state, no new question field, no change to any domain service. If the
adapter appears to need one, that is a finding to escalate, not a local workaround. This plan
introduces none, which is the main evidence that it is a genuine adapter rather than a parallel
ingestion path.

---

## 3. Recommended adapter strategy

### 3.1 One adapter, three roots, one declared provenance

```
                         FILE_REPOSITORY adapter
                                   │
        ┌──────────────────────────┼──────────────────────────┐
   synced SharePoint          synced OneDrive            managed upload
      library folder             folder                    directory
        │                          │                          │
  webUrlBase → real SP URL   webUrlBase → real URL      no real URL
  sidecars from discovery    sidecars optional          no sidecars
  TIER 1 (recommended)       TIER 2                     TIER 3 (defer)
```

Why one adapter rather than three: the conformance suite asserts the *contract*, and three adapters
means three fixture sets and three chances to diverge. The differences between the tiers are
**configuration and declared provenance**, not behaviour.

**Recommendation:** record the provenance explicitly on the source `connection` — something an
operator sets and the UI can display — so a screen can state *"synchronized from a SharePoint library
mirror; permissions enforced by Knowzy"* rather than leaving a reader to infer it from a source name.

### 3.2 The capability declaration, which is the heart of it

| Capability | Value | Why |
| --- | --- | --- |
| `supportsContainers` | `true` | The root, or a top-level directory |
| `supportsFolderHierarchy` | `true` | Real directories |
| `supportsLiveSearch` | `false` | Indexed only, and the UI already labels that |
| `supportsFullTextSearch` | `true` | Over extracted text |
| `supportsIncrementalSync` | `true` for a local mount; `false` where the mount is slow | Template §7.6 |
| `supportsPermissionCheck` | **`false`** | **The important one.** A filesystem carries no per-user SharePoint decision. Forces `getEffectiveAccess` to return `UNKNOWN` — never `ALLOWED` |
| `supportsDelegatedAccess` | **`false`** | `DELEGATED_OBO` is rejected at configuration time (P6) |
| `supportsVersionLabels` | **`false`** | `mtime` is unreliable — touch, copy, restore all move it. Change detection relies on `contentHash` alone, and preflight reports `CONTENT_CHANGED_UNVERSIONED` honestly rather than implying a version signal exists |
| `supportedDocumentTypes` | Exactly what has a registered extractor | Declaring PDF before the extractor exists is the P1 violation to avoid |
| `writeCapable` | `false` | The literal type. Not expressible otherwise |

`AccessDecision` therefore returns `decision: 'UNKNOWN'`, `enforcement: 'PLATFORM'`, and a summary
saying so. That single value is what propagates the truth up to the interface, and the contract was
built for exactly this case: `UNKNOWN` is "a first-class outcome, not an error: a source that cannot
answer the question must say so rather than have the platform assume either answer."

### 3.3 Keep the mock

It is the conformance substrate and the zero-credential path. Both adapters pass the same suite; that
is the mechanism that makes the transitional adapter trustworthy rather than merely present.

---

## 4. Security considerations

### 4.1 The corpus is not permission-trimmed, and the platform must say so

`enforcement: 'PLATFORM'` means visibility is decided by Knowzy's own layers — role, domain, team,
business function, `UserSourceAccess` — and not by SharePoint. The rule that already exists and now
carries the whole weight:

> A document discovered by a background job is **not** automatically visible to a user. Visibility is
> re-evaluated against the user at read time.

**Consequences to accept deliberately:**

- The mirrored corpus must be treated as **more broadly visible than the original library**.
- Any library with **broken permission inheritance** or item-level restrictions is a poor candidate:
  those are precisely the cases delegated trimming handles and platform trimming approximates.
- `restrictions` on the source and `UserSourceAccess` grants are no longer conveniences — they are
  the only access control over this content. Configure them before synchronizing, not after.

### 4.2 Untrusted file input (tier 3)

If the upload control is built, uploaded bytes are untrusted input from a user. Minimum controls:

| Control | Why |
| --- | --- |
| Extension **and** content-sniff agreement; reject on mismatch | A `.txt` that is a PDF, or worse |
| Size cap applied **before** the file is fully read | Already the contract's posture: streamed to the extractor with the cap applied before download completes |
| Decompression bounds on DOCX/PPTX/XLSX — they are ZIP containers | Zip bombs, and entry-path traversal inside the archive |
| Reject archives, executables, macro-enabled formats | Nothing needs them |
| Filename sanitization; the stored name never used as a path | Path traversal |
| Store outside any web root; never serve the original bytes back | Raw bytes are never persisted or served today, and that should remain true |
| The route declares a policy and requires an authoring permission | The registry test enforces the declaration |
| Every upload audited with uploader, name, size and hash | Provenance is otherwise absent entirely |

**This list is the argument for deferring tier 3.** An operator-managed drop directory obtains the
same documents with none of these controls to build and get right. If upload is wanted later, it is
additive.

### 4.3 Prompt-injection posture is unchanged, and worth confirming

Document text is **data, never instruction**: nonce-delimited framing per call, delimiter-like text
stripped, and `GENERATION_TOOL_GRANT = []` so generation grants no tools. Real corporate documents
change nothing about this — but they are the first genuinely untrusted content the platform has
processed, since fixtures were written in-house.

**Recommendation:** when the first real corpus lands, include a document containing
instruction-shaped text and confirm the framing holds. The controls exist; this is the first
opportunity to see them work on content nobody on the team wrote.

### 4.4 The corpus reflects one individual's access

The subtlest risk here. A synced library contains exactly what the **syncing user** can see:

- if that person has broad access, Knowzy ingests documents most staff cannot see — and then serves
  questions derived from them;
- if narrow, coverage is arbitrary and nobody can tell from inside the platform.

Either way the corpus boundary is **a person**, which is not a governance boundary and cannot be
audited from the data.

**Recommendations:** use a **named, documented account** for the mirror rather than whichever laptop
was convenient; record whose access defines the corpus on the source itself; prefer a library with
uniform inherited permissions; and re-state the boundary whenever the corpus is discussed, because it
is invisible once the documents are in.

### 4.5 Local-path and credential hygiene

Two specifics: `sourceUrl` must never carry a local path (§2.4) — it reaches the published bank
record, which is authoritative and long-lived. And the sync client holds the user's own credentials;
the mount is a **user-context artifact**, so a deployed service reading a developer's synced folder
would be reading through that developer's identity. If this runs anywhere but a workstation, the mount
belongs to a service-operated account.

### 4.6 Data residency and retention

Extracted text is persisted in Knowzy's database as it is today; raw bytes are not. The material
change is that the text is now **real internal content**, so retention (T-36) and the sensitivity
exclusions from the discovery checklist (A6, D3) stop being theoretical. Confirm both before the first
synchronization, not after.

---

## 5. Migration path

Designed so the transitional path is a **stepping stone, not a fork**. The whole point of the port is
that this is possible.

### 5.1 What migrates for free

| Asset | Survives? | Why |
| --- | --- | --- |
| Binary extractors (§2.1) | **Entirely** | Format work, not source work. Phase 7 needs exactly these |
| Extraction measurements | **Entirely** | The `EXTRACTION_EMPTY` rate is a property of the corpus |
| Taxonomy, domain codes, mappings | **Entirely** | Business decisions |
| Generated, approved, published questions | **Entirely, if §2.4 is done** | `sourceUrl`, `sourceDocumentId`, `sourceSectionKey`, `sourceContentHash` all point at the real document |
| The discovery catalog | **Entirely** | It was written into the platform's own shape |
| The Claude quality evidence | **Entirely** | Judged on real content |
| The conformance suite | **Entirely** | The SharePoint adapter is handed the same function |

**If §2.4 is skipped, questions published from this path do not migrate** — their provenance points at
a local path. That is the single decision that determines whether this is a stepping stone or a
throwaway.

### 5.2 Migration to Graph and the SharePoint API

When R3–R5 land:

1. Implement the Graph client, then the SharePoint adapter, per the existing plans.
2. Register it. Both adapters coexist — `KnowledgeSource.sourceType` is per source.
3. **Re-point a source, do not re-create it.** The `KnowledgeSourcePath` rows carry the folder paths
   already; the SharePoint adapter resolves site and drive IDs via Test Connection and stores them.
4. Re-synchronize. Documents are matched by `sourceDocumentId` — so the mapping from local path to
   SharePoint item id is the one migration-critical detail, and §2.4's `webUrlBase` is what makes it
   derivable rather than guesswork.
5. Capabilities become honest upward: `supportsPermissionCheck` and `supportsVersionLabels` become
   `true`, `DELEGATED_OBO` becomes available, and preflight stops reporting
   `CONTENT_CHANGED_UNVERSIONED`. **Nothing in the domain changes**, because the capability flags were
   truthful all along.
6. Retire the file-repository source, or keep it for genuinely non-SharePoint content.

**Recommendation:** plan a re-synchronization, not an in-place conversion. It is cheap, it re-derives
every hash, and it proves the SharePoint adapter against content whose extraction is already known
good — which is a far better first test than an unknown library.

### 5.3 Migration to Entra ID

Independent of all of the above and unblocked by it. The transitional path runs on the local stub
issuer in `local`, which is the only environment it can run in until Entra lands — and that is the
right constraint, because a deployed environment serving platform-trimmed real content with no
authentication is precisely what should be impossible. It already is: `createEntraResolver()` throws.

**Sequence: Entra first, then deploy anything.** This path does not change that.

---

## 6. Risks

| # | Risk | Severity | Likelihood | Mitigation | Residual |
| --- | --- | --- | --- | --- | --- |
| R-T1 | **Platform-trimmed content is treated as SharePoint-trimmed** by someone reading a screen | **High** | Medium | `enforcement: 'PLATFORM'`, `UNKNOWN` decisions, declared provenance, UI statement | Human interpretation. Repeat it in every stakeholder conversation |
| R-T2 | **The corpus boundary is one person's access** (§4.4) | **High** | **High** | Named documented account; record whose access defines it; prefer uniform-permission libraries | Invisible from the data. Cannot be fully mitigated on this path |
| R-T3 | Published questions carry a local `sourceUrl`, breaking traceability and leaking a path into the bank | **High** | **High if §2.4 is skipped** | Do §2.4. Assert in a test that no emitted `sourceUrl` is a local path | None once tested |
| R-T4 | X2 offsets wrong in a binary extractor, so stored evidence spans cannot re-locate | High | Medium | Round-trip offset assertions per format in the conformance fixtures | Silent until someone audits an old question — so test it now |
| R-T5 | Sidecar metadata goes stale and nobody notices | Medium | High | Record capture date; treat sidecars as discovery output, not a live feed | Accepted for the pilot |
| R-T6 | `mtime` churn from sync, copy or restore triggers mass re-extraction and regeneration candidacy | Medium | Medium | `supportsVersionLabels: false` and hash-decides — the same rule as the eTag trap | Sync duration on a large mirror |
| R-T7 | Predominantly scanned PDFs: no OCR, so `EXTRACTION_EMPTY` (A-04, R-06) | Medium | **Medium-high** | Measure early (checklist B4) | A business scope conversation, not an engineering fix |
| R-T8 | Untrusted upload becomes an attack surface | High | Low if tier 3 deferred | §4.2, or defer | Defer and it is zero |
| R-T9 | The transitional path becomes permanent because it works | **Medium, and underrated** | Medium | Record it as transitional in the history; the capability flags make the losses visible; the §5 migration is designed | Organizational, not technical |
| R-T10 | Widening `RELEASE_1_SOURCE_TYPES` is read as endorsing arbitrary file sources | Low | Medium | The codegen diff makes it explicit; §7.6 template rules constrain it | Documentation |
| R-T11 | Real internal content retained without a retention or sensitivity decision | Medium | Medium | Confirm T-36 and checklist A6/D3 **before** first sync | None if done first |
| R-T12 | Effort is wasted if Graph opens next week | **Low** | Medium | §5.1 — nearly everything migrates | Minimal, and that is the strongest argument for proceeding |

R-T9 deserves a sentence of its own. The most likely long-term failure is not that this path breaks;
it is that it works well enough that the Graph integration is never finished, and the platform keeps
platform-trimmed access to real content indefinitely. The honest capability flags are the guard,
because they keep the loss visible on screen instead of letting it fade into normality.

---

## 7. Recommended implementation milestone

### PILOT-T1 — Real documents through real extractors

**Deliver in this order.** Each step is independently useful, and the first two need no decisions from
anyone outside the team.

| # | Step | Depends on |
| --- | --- | --- |
| 1 | Binary-capable `ExtractInput`; **PDF and DOCX** extractors with round-trip X2 offset assertions | Nothing |
| 2 | `FILE_REPOSITORY` adapter — distinct from the mock, honest capabilities, nine Test Connection checks with `NOT_RUN`, `DELEGATED_OBO` rejected at configuration time, conformance suite passing | 1 |
| 3 | `webUrlBase` source-URL reconstruction, with a test asserting **no emitted `sourceUrl` is a local path** | 2 |
| 4 | Sidecar metadata reading; `RELEASE_1_SOURCE_TYPES` widened plus `npm run codegen` | 2 |
| 5 | Discovery Phases A–B on one candidate library; **report the format distribution and the `EXTRACTION_EMPTY` rate** | Business |
| 6 | Mirror one library; configure `restrictions` and `UserSourceAccess` **before** synchronizing; synchronize; generate; review; approve; publish | 3, 4, 5 |
| 7 | The Claude quality comparison on real content, blind, against the deterministic generator | 6, plus T-29 |

**Explicitly not in PILOT-T1:** the upload UI (§4.2 — defer), PPTX and XLSX extractors (decide from
step 5's measurement), `SHAREPOINT_PAGE`, and anything touching Entra, Graph or `Sites.Selected`.

### 7.1 Definition of done

Steps 1–4 merged with the conformance suite passing **unrelaxed** and the no-local-path test in the
build; step 5's measurement reported to the business; step 6 completed end to end with a question
published whose `sourceUrl` opens the real SharePoint document; and the corpus boundary from §4.4
recorded on the source.

It is **not** done when documents appear in the browser. The two things that make this path defensible
rather than expedient are the **honest capability declaration** and the **real `sourceUrl`** — and
both are invisible in a demo.

### 7.2 Why this and not the alternatives

Against **waiting for Graph**: the extractor work is on the critical path regardless, and waiting
produces nothing.

Against **the Claude spike first**: it needs real documents to be worth anything, and gating it on
T-29 means it may not start. Steps 1–4 are gated on nobody.

Against **building the upload UI first**: it is the weakest tier, carries the most security work, and
supplies documents with no provenance. The mirror supplies better documents with less code.

### 7.3 The one thing to decide before starting

**Whose account defines the corpus** (§4.4, R-T2). It is a governance decision, it cannot be recovered
after the fact, and it is the kind of thing that gets settled by whoever happened to have the library
synced already. Settle it deliberately, in week 1.
