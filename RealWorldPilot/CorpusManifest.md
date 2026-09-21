# KNOWZY Real-World Pilot Corpus Manifest

**This file is the authoritative pilot-corpus register.** It is updated in the same commit as every
real pilot-corpus change.

> **Real-corpus status: `BLOCKED_BY_LOCAL_SYNC_CONFIGURATION`.**
>
> The approved pilot folder is **not synchronized to this workstation**. The Document Register below
> is therefore populated from the **fixture mirror** that ships in the repository, and every row is
> labelled as such. No row describes a real business document, and nothing here claims the SharePoint
> web URL was read directly — it was not. §1.2 records exactly what was checked.

---

## 1. Pilot Source

### 1.1 The approved source

| Field                              | Value                                                                                                                                  |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Site**                           | Central Rx Operations Support                                                                                                          |
| **Library**                        | Shared Documents                                                                                                                       |
| **Folder**                         | `Reuben / Projects / Knowzy`                                                                                                           |
| **Initial corpus subfolder**       | `SOPs`                                                                                                                                 |
| **Canonical SharePoint URL**       | `https://luxotticagroup.sharepoint.com/sites/CentralRxOperationsSupport/Shared%20Documents/Reuben/Projects/Knowzy`                     |
| **Synchronization method**         | OneDrive synchronization client (_Add shortcut to OneDrive_ or _Sync_). No Microsoft Graph call, no app registration, no admin consent |
| **Named synchronization identity** | The current corporate OneDrive account. **Transitional pilot decision** — §2.4                                                         |
| **Local synchronized root**        | **Not configured.** See §1.2 and §6                                                                                                    |
| **Data classification**            | Internal. Not yet confirmed per document — the `Classification` column is captured per document where a sidecar supplies it            |
| **Business owner**                 | Not yet assigned                                                                                                                       |
| **Technical owner**                | Not yet assigned                                                                                                                       |
| **Pilot status**                   | `BLOCKED_BY_LOCAL_SYNC_CONFIGURATION` for the real corpus; code and fixture-backed validation complete                                 |
| **Last validation date**           | 2026-09-21                                                                                                                             |

The **sharing URL** supplied by the business is deliberately **not recorded here and never persisted**.
It carries a sharing token (`?d=…&csf=1&web=1&e=…`) which is credential-shaped and expires, so storing
it would both leak a secret into every document record and rot as provenance.
`normalizeWebUrlBase()` refuses a URL with a query string or a `/:f:/` sharing segment at
configuration time.

### 1.2 What was checked on this workstation, and what was found

Checked against the authoritative OneDrive sync-engine registry
(`HKCU:\SOFTWARE\SyncEngines\Providers\OneDrive`) rather than by guessing paths, and with one bounded
search inside the OneDrive root only. No unrelated user directory was scanned.

| #   | Check                                                                            | Result                                                                                                                                                                                     |
| --- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | OneDrive commercial root exists                                                  | **Yes**                                                                                                                                                                                    |
| 2   | A sync mount exists for `sites/CentralRxOperationsSupport/Shared Documents/`     | **Yes** — mounted as a shortcut named **`Knowledge Base`**                                                                                                                                 |
| 3   | That mount contains `Reuben / Projects / Knowzy`                                 | **No.** It is a _different_ subfolder of the same library, holding `AEL Support Documents`, `Aichi Lab`, `OFS & CAFE`, and similar                                                         |
| 4   | `Reuben`, `Projects` or `Knowzy` present anywhere in the OneDrive root (depth 3) | **No match.** Two near-misses, both rejected: `Desktop/home docs/Reuben` is the _personal_ OneDrive namespace, and `Documents IT Process & Services…/Projects` belongs to a different site |
| 5   | SOPs folder exists locally                                                       | **No** — follows from 3 and 4                                                                                                                                                              |
| 6   | Files locally available, not placeholders                                        | **Not reached**                                                                                                                                                                            |
| 7   | Discovered file count plausible                                                  | **Not reached**                                                                                                                                                                            |
| 8   | Supported formats present                                                        | **Not reached**                                                                                                                                                                            |
| 9   | Canonical URL maps to local relative paths                                       | **Verified against the fixture mirror**, not against the real corpus                                                                                                                       |

**Conclusion.** Exactly one candidate root for the _library_ exists, and it does not contain the
approved folder. Per the instruction not to choose silently, no root was selected and the real-corpus
configuration is marked blocked.

**To unblock:** open the canonical folder in a browser, choose **Add shortcut to OneDrive** (or
**Sync**), wait for synchronization to finish, mark the folder **Always keep on this device**, then set
`PILOT_MIRROR_ROOT` to the resulting local path and re-run
`npx tsx scripts/corpus-report.ts "$PILOT_MIRROR_ROOT"`.

### 1.3 Operational configuration — machine-specific, not provenance

> **Restricted section.** Everything here is **machine-specific operational configuration**. It is
> never persisted as authoritative source provenance, never written to a document record, an audit
> detail, a citation, a published question or a Question Bank item, and never returned in a browser
> response.

| Field                                    | Value                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------ |
| `PILOT_MIRROR_ROOT` (real corpus)        | **Not set.** Supply in a local `.env`; never committed                               |
| `PILOT_MIRROR_ROOT` (fixture, committed) | `./fixtures/pilot-mirror`                                                            |
| Example real value                       | `C:/Users/<you>/OneDrive - <Org>/<Shortcut>/Projects/Knowzy` — **illustrative only** |

A build-failing test asserts that **no emitted `sourceUrl` or `webUrl` matches a local-path shape** —
drive letter, UNC prefix, `file://`, POSIX home or mount path, or a OneDrive folder name — across
`listItems`, `getDocument`, `searchDocuments` and `synchronize`. The detector itself is mutation-tested,
so the assertion cannot quietly stop matching.

---

## 2. Corpus Governance

### 2.1 Inclusion criteria

A document enters the corpus when all of these hold:

1. It sits beneath the configured root and the configured corpus subfolder.
2. Its extension has a **registered extractor** — `pdf`, `docx`, `pptx`, `xlsx`, `txt`, `md`, `html`.
3. It is not a sync-client or Office artifact (§2.2).
4. Its bytes are **locally available** — not a Files On-Demand placeholder.
5. Its access decision is `ALLOWED`.
6. **It states testable rules.** The binding criterion in practice, and the one no code can check: a
   narrative, a status deck or a minute states no procedure, threshold or decision rule, and yields an
   honest `insufficientEvidence` refusal rather than a question.

### 2.2 Exclusion criteria

| Excluded                                                             | Why                                                                                                                                                                                                |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `desktop.ini`                                                        | Written by the OneDrive client. **Readable text**, so without an explicit exclusion it extracts _successfully_ into a nonsense section — worse than failing, because nothing draws attention to it |
| `~$*`, `._*`, `*.tmp`, `*.partial`, `*.crdownload`, `*.lnk`, `*.url` | Office lock files, partial downloads and shortcuts                                                                                                                                                 |
| `.DS_Store`, `Thumbs.db`                                             | Platform artifacts                                                                                                                                                                                 |
| `*.meta.json`                                                        | Sidecars are metadata INPUT, not documents                                                                                                                                                         |
| Symbolic links and junctions                                         | Skipped, never followed. A link in a synced folder can point anywhere on the workstation                                                                                                           |
| Anything resolving outside the root                                  | Refused after normalization                                                                                                                                                                        |
| Unsupported formats (`.rtf`, `.doc`, `.xls`, `.ppt`, …)              | No registered extractor. Reported at configuration time by Test Connection check 5, not discovered after a sync                                                                                    |
| Documents declared not accessible by a sidecar                       | Absent from listing and search, and refused for extraction                                                                                                                                         |

### 2.3 Supported formats

| Format              | Extractor         | Notes                                                                                                                                                                                                                      |
| ------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PDF**             | pdf.js, text only | Page numbers preserved. No heading structure claimed (X4). Image-only PDFs report `EMPTY` — **no OCR** (risk R-06). Encrypted PDFs are refused, never guessed at. Two-column layouts are not reconstructed                 |
| **DOCX**            | own OOXML reader  | Real heading structure, tables as prose, multi-run sentences joined without inserting spaces. **Tracked deletions excluded; insertions included.** Comments, headers, footers, hidden text and field instructions excluded |
| **PPTX**            | own OOXML reader  | **Presentation order**, resolved from `presentation.xml`, not filename order. Speaker notes excluded. Slide text is the format least likely to state a complete rule                                                       |
| **XLSX**            | own OOXML reader  | Sheet names carried (they are what make a cell interpretable). Formula _results_ read, not formulas. Number formats not applied — a date serial reads as its stored number                                                 |
| **TXT / MD / HTML** | pre-existing      | Unchanged by this milestone                                                                                                                                                                                                |

**Not supported, deliberately:** `SHAREPOINT_PAGE` (no file exists in a document library — it is Graph
canvas content, roadmap Phase 7), and the legacy binary Office formats `.doc`, `.xls`, `.ppt` (OLE
compound files, an entirely different container sharing no code with OOXML).

### 2.4 Permission assumptions

> **This is a transitional pilot decision and is not equivalent to delegated per-user SharePoint
> permission trimming.**

|                                                                                       |                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The synchronized account defines the visible corpus.**                              | A mirror contains exactly what that person can see. The corpus boundary is therefore **a person**, which is not a governance boundary and cannot be audited from the data — which is why `mirrorAccountUpn` is a **required** field on the source |
| **Enforcement is `PLATFORM`, never `SOURCE`.**                                        | Every access decision says so. Access is governed by the configured corpus boundary, operating-system access to the mirror, and Knowzy's own server-side authorization                                                                            |
| **`supportsDelegatedAccess: false`.**                                                 | `DELEGATED_OBO` is **refused at configuration time**, not approximated                                                                                                                                                                            |
| **`UNKNOWN` never passes.**                                                           | Extraction and synchronization refuse any non-`ALLOWED` decision. The shared refusal rule was not weakened                                                                                                                                        |
| **Production rollout requires the approved Entra, Graph and SharePoint integration.** | See [`TENANT_ADMIN_REQUESTS.md`](../docs/integrations/TENANT_ADMIN_REQUESTS.md)                                                                                                                                                                   |

`restrictions` and `UserSourceAccess` must be configured **before** the first synchronization of a real
corpus. On this path they are not a convenience; they are the only access control over the content.

### 2.5 Synchronization limitations

| Limitation                                                               | Consequence                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No version labels.** `mtime` moves on touch, copy, restore and re-sync | The **content hash decides**, combined with any operator-declared sidecar version. Preflight reports a content change without a version                                                                                                                                                                                                                                           |
| **Files On-Demand placeholders**                                         | A placeholder lists at its real size with no local bytes. Folders must be marked _Always keep on this device_. Test Connection reports placeholder-only content; a read failure reports the OneDrive setting to change. **Placeholder detection is advisory and POSIX-only** — `Stats.blocks` is not populated on Windows, and denying on that heuristic denied the entire corpus |
| **Partial synchronization**                                              | A paused or mid-run client presents a half-populated directory. A run finding fewer than `partialSyncFloor` (default 0.8) of the previous run's documents **aborts and emits no delete events**                                                                                                                                                                                   |
| **No SharePoint column metadata**                                        | The sync client brings bytes, not columns. Columns arrive through hand-maintained `.meta.json` sidecars, which go stale silently                                                                                                                                                                                                                                                  |
| **Indexed search only**                                                  | `supportsLiveSearch: false`. Search runs over already-extracted text, so a document added since the last synchronization is not yet findable                                                                                                                                                                                                                                      |

### 2.6 Privacy requirements

- No customer document enters this repository. Every fixture is built from bytes the repository
  controls by `fixtures/build-pilot-mirror.mjs` and
  `packages/content-extraction/test/fixtures/build-fixtures.mjs`.
- Extracted **text** is persisted in Knowzy's database for indexing and evidence verification. **Raw
  bytes are never persisted and never served.**
- Sidecar `metadata` is an explicit allow-list per path. A column carrying personal data is not
  captured; a column with no stated use is not captured.
- No local path, username or machine name reaches a document record, an audit detail, a citation, a
  published question or a Question Bank item — asserted by a build-failing test.
- Retention (T-36) and the sensitivity exclusions must be confirmed **before** the first real
  synchronization. **Not yet confirmed.**

### 2.7 Retention and cleanup requirements

| Item                                    | Requirement                                                                      | Status                |
| --------------------------------------- | -------------------------------------------------------------------------------- | --------------------- |
| Extracted text                          | Per T-36, to be confirmed                                                        | **Not yet confirmed** |
| The local mirror                        | Operator-managed, outside Knowzy. Removing the shortcut removes the mirror       | n/a                   |
| Sidecars                                | Live beside the documents; carry a capture date so staleness is visible          | Fixture only          |
| Fixture mirror                          | Committed, regenerable, contains no customer content                             | Committed             |
| Draft questions from a retired document | Existing retention rules apply unchanged — this path adds no new lifecycle state | Unchanged             |

### 2.8 Migration path to Microsoft Graph

Full plan: [`TRANSITIONAL_KNOWLEDGE_SOURCE_IMPLEMENTATION.md` §7](../docs/integrations/TRANSITIONAL_KNOWLEDGE_SOURCE_IMPLEMENTATION.md).

What migrates without a data fix: the four binary extractors (they are format work, not source work,
and roadmap Phase 7 needs exactly them), the extraction measurements, the taxonomy, and — critically —
**every section key, evidence span and published question**, because `sectionKey` is
`sha256(heading path + ordinal)` over content and the extraction pipeline is source-agnostic. The same
bytes through the same extractor yield the same keys whether they arrived from a mirror or from Graph.

The one migration-critical mapping is local relative path → Graph item id, which the canonical URL
makes derivable. **That is why the canonical URL is implemented now rather than later**: skip it and
published questions carry a local path and do not migrate at all.

---

## 3. Document Register

> **Populated from files that actually exist in the configured root**, by
> `npx tsx scripts/corpus-report.ts <root>`. Never written by hand and never invented.
> **Relative paths only.**
>
> **Source of these rows: the FIXTURE MIRROR (`fixtures/pilot-mirror`), not the real pilot corpus.**
> The real corpus is `BLOCKED_BY_LOCAL_SYNC_CONFIGURATION` (§1.2). Every row below describes a
> repository-controlled fixture document.

| Document ID    | Relative Path                            | Document Name                     | Format | Domain           | Topic            | Knowledge Status                   | Content Hash   | Source Version | Extraction Status | Section Count | Generation Status | Draft Count | Approved Count | Published Count | Last Synchronized | Last Generated   | Notes                                                                         |
| -------------- | ---------------------------------------- | --------------------------------- | ------ | ---------------- | ---------------- | ---------------------------------- | -------------- | -------------- | ----------------: | ------------- | ----------------: | ----------: | -------------: | --------------- | ----------------- | ---------------- | ----------------------------------------------------------------------------- |
| `53b5c1047c05` | `Policies/restricted-board-pay.md`       | restricted-board-pay.md           | MD     | Not yet assigned | Not yet assigned | EXCLUDED (declared not accessible) | `7f8952edf27f` | 2.0            |         EXTRACTED | 1             |  Not yet executed |           0 |              0 | 0               | 2025-06-01        | Not yet executed | Sidecar declares DENIED; excluded from listing, search and extraction         |
| `82a57964bbc8` | `SOPs/acceptable-use.txt`                | acceptable-use.txt                | TXT    | Not yet assigned | Not yet assigned | INCLUDED                           | `8adcea30f1a0` | None declared  |         EXTRACTED | 1             |  Not yet executed |           0 |              0 | 0               | 2026-09-21        | Not yet executed | 1 assessable section                                                          |
| `90af6dac00b5` | `SOPs/certificate-renewal-procedure.pdf` | certificate-renewal-procedure.pdf | PDF    | Not yet assigned | Not yet assigned | INCLUDED                           | `427c65fad466` | None declared  |         EXTRACTED | 2             |  Not yet executed |           0 |              0 | 0               | 2026-09-21        | Not yet executed | 2 sections, page references preserved; 0 assessable (fixture pages are short) |
| `71e623b587da` | `SOPs/certificate-renewal.docx`          | certificate-renewal.docx          | DOCX   | Not yet assigned | Not yet assigned | INCLUDED                           | `0cdf39fa48cb` | 4.2            |         EXTRACTED | 2             |  Not yet executed |           0 |              0 | 0               | 2025-08-20        | Not yet executed | Real heading structure; sidecar supplies version and columns; 1 assessable    |
| `04c390fb996d` | `SOPs/escalation-matrix.md`              | escalation-matrix.md              | MD     | Not yet assigned | Not yet assigned | INCLUDED                           | `8c91312212a3` | None declared  |         EXTRACTED | 4             |  Not yet executed |           0 |              0 | 0               | 2026-09-21        | Not yet executed | 2 assessable sections                                                         |
| `07944374bcbc` | `SOPs/knowledge-transfer.pptx`           | knowledge-transfer.pptx           | PPTX   | Not yet assigned | Not yet assigned | INCLUDED                           | `051b959b9d29` | None declared  |         EXTRACTED | 2             |  Not yet executed |           0 |              0 | 0               | 2026-09-21        | Not yet executed | Presentation order verified; 0 assessable (slide text is fragmentary)         |
| `e6687d6efd0d` | `SOPs/renewal-windows.xlsx`              | renewal-windows.xlsx              | XLSX   | Not yet assigned | Not yet assigned | INCLUDED                           | `6e0e0e4ceea2` | None declared  |         EXTRACTED | 1             |  Not yet executed |           0 |              0 | 0               | 2026-09-21        | Not yet executed | Sheet name carried; formula result read, not the formula; 0 assessable        |

### 3.1 Excluded, with the reason

| Relative Path                                | Reason                                     |
| -------------------------------------------- | ------------------------------------------ |
| `SOPs/desktop.ini`                           | ARTIFACT — OneDrive client file            |
| `SOPs/~$certificate-renewal.docx`            | ARTIFACT — Office lock file                |
| `SOPs/notes.rtf`                             | UNSUPPORTED_TYPE — no registered extractor |
| `SOPs/certificate-renewal.docx.meta.json`    | SIDECAR — metadata input, not a document   |
| `Policies/restricted-board-pay.md.meta.json` | SIDECAR — metadata input, not a document   |

---

## 4. Pilot Results

**Measured against the fixture mirror.** Values marked _Not yet executed_ have not been run; values
marked _Not measured_ are not recorded anywhere. **No value below is a placeholder zero.**

| Metric                                      | Value                | Basis                                                                                                                                 |
| ------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Documents discovered                        | **12**               | Fixture mirror scan                                                                                                                   |
| Documents included                          | **7**                | Registered extractor, not an artifact, bytes available                                                                                |
| Documents excluded                          | **5**                | §3.1                                                                                                                                  |
| Documents successfully extracted            | **7**                | All included documents                                                                                                                |
| Extraction failures                         | **0**                | —                                                                                                                                     |
| Empty-content documents                     | **0**                | The image-only PDF is a unit fixture, not part of the mirror                                                                          |
| Sections generated                          | **13**               | Sectionizer output                                                                                                                    |
| — of which assessable                       | **4**                | Below `minAssessableChars` otherwise                                                                                                  |
| Questions generated                         | **Not yet executed** | Generation not run against this corpus                                                                                                |
| Questions rejected by evidence verification | **Not yet executed** | —                                                                                                                                     |
| Questions submitted for review              | **Not yet executed** | —                                                                                                                                     |
| Questions approved                          | **Not yet executed** | —                                                                                                                                     |
| Questions published                         | **Not yet executed** | —                                                                                                                                     |
| Assessments created                         | **Not yet executed** | —                                                                                                                                     |
| Learner attempts                            | **Not yet executed** | —                                                                                                                                     |
| Generation-quality findings                 | **Not measured**     | Requires the real corpus **and** T-29 (approval to send excerpts to Anthropic). Generation today is the deterministic local generator |

### 4.1 Format distribution

| Format | Count | Extractable                      |
| ------ | ----: | -------------------------------- |
| MD     |     2 | Yes                              |
| TXT    |     1 | Yes                              |
| PDF    |     1 | Yes                              |
| DOCX   |     1 | Yes                              |
| PPTX   |     1 | Yes                              |
| XLSX   |     1 | Yes                              |
| RTF    |     1 | **No — no registered extractor** |

This table is the single most useful measurement to repeat against the **real** corpus: it states what
fraction of a library the platform can read at all, and therefore how much extractor work stands
between discovery and a working pilot.

### 4.2 An observation worth carrying forward

Only **4 of 13** fixture sections are assessable, and the PPTX and XLSX documents produced **none**.
That is the fixture being small rather than a defect — but it previews the real finding: **slide and
spreadsheet content rarely states a complete rule.** "Renewal: 30 days" is a fragment, and the
generator needs a sentence. Extracting PPTX and XLSX successfully is not the same as generating well
from them, and the coverage report will show that honestly rather than the platform pretending.

---

## 5. Verification

| Gate                                                                              | Result                                    |
| --------------------------------------------------------------------------------- | ----------------------------------------- |
| Adapter conformance suite, **unrelaxed**, against `FileRepositoryKnowledgeSource` | **59 passed, 6 todo**                     |
| Extraction invariants X1–X8, parameterized over PDF/DOCX/PPTX/XLSX                | **Passing**                               |
| No emitted `sourceUrl`/`webUrl` is a local path (mutation-tested detector)        | **Passing**                               |
| Partial-sync guard refuses a run and emits no deletions                           | **Passing**                               |
| Symlink, traversal and root-containment refusals                                  | **Passing**                               |
| Zip-bomb ratio guard refuses before inflating                                     | **Passing**                               |
| `desktop.ini` and lock files excluded                                             | **Passing**                               |
| Real-corpus run                                                                   | **`BLOCKED_BY_LOCAL_SYNC_CONFIGURATION`** |

---

## 6. To unblock the real corpus

1. Open the canonical folder (§1.1) in a browser as the named synchronization identity.
2. **Add shortcut to OneDrive**, or **Sync**.
3. Wait for synchronization to complete; mark the folder **Always keep on this device** so no file
   remains a placeholder.
4. Set `PILOT_MIRROR_ROOT` in a local `.env` to the resulting path. **Do not commit it.**
5. Record the **named synchronization identity** on the source as `mirrorAccountUpn`, and confirm with
   the business that this person's access is an acceptable corpus boundary (§2.4).
6. Configure `restrictions` and `UserSourceAccess` **before** synchronizing.
7. Confirm retention (T-36) and the sensitivity exclusions.
8. Run `npx tsx scripts/corpus-report.ts "$PILOT_MIRROR_ROOT"` and replace §3, §3.1 and §4 with its
   output — in the same commit, per the standing rule.
9. Run Test Connection and confirm all nine checks, especially check 5 (extractor coverage) and
   _Files are locally available_.
