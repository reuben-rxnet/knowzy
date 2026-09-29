# XLSX Extraction Correction

**Milestone:** XLSX-INTEGRITY-M1, 2026-09-29.
**Normative rule added:** [knowledge-source-adapters.md §2.4 X9](../knowledge-source-adapters.md#24-normative-extraction-requirements).
**Code:** `packages/content-extraction/src/extractors/xlsx.ts` (one element scanner and one row parser,
shared by `extractXlsx` and `readXlsxGrid`); `packages/question-import/src/detect.ts` (`splitRow`).
**Found by:** COMPETENCY-M1, processing the competency reference workbook (project history).

---

## 1. Root cause

Every XLSX element was matched with a body regex of the form

```
/<c\b([^>]*)>([\s\S]*?)<\/c>/
```

`[^>]*` accepts a `/`, so the pattern also matches a **self-closing** element such as a styled empty
cell `<c r="C1" s="5"/>`, treating it as an **opening** tag. Its "body" then runs to the **next**
element's closing tag. For a cell, that next element's content is read as this cell's value: often a
**shared-string index**, printed as a bare number, **in the wrong column**, while the real value
disappears.

The same shape affected four elements:

| Element | Self-closing form | Effect |
| --- | --- | --- |
| `<c>` | a styled empty cell | the next cell's value, or its shared-string index, appears one or more columns early, and the real value is lost |
| `<row>` | an empty or spacer row | the next row is swallowed and attributed to the empty row's number |
| `<si>` | an empty shared string | **skipped**, so every later shared-string index resolves to the entry after the right one: a wrong word in the right place |
| `<t>` | `<t xml:space="preserve"/>` | the following run is swallowed |

A second defect sat downstream, in question import. Consecutive blank cells survive normalization
only as extra hyphens sharing single spaces: `C —  —  — Topic` normalizes to `C - - - Topic`.
`split(' - ')` consumes the shared spaces and returned `[C, '-', Topic]`. Two blank columns were
lost, a literal `-` became the Explanation, and later values shifted left.

## 2. Corrected interpretation

- An element is found by its opening tag. A tag ending `/>` is **empty**; otherwise its body runs to
  **its own** closing tag. The scanned elements (`c`, `row`, `si`, `t`, `v`, `is`) never nest within
  themselves, which is what makes this correct.
- A cell goes where its `r` says. `D1` stays column D whether `C1` is omitted or styled-empty. Only a
  cell without `r` falls back to "the column after the previous one". If two cells claim one column,
  the first **non-empty** one wins.
- Values are what the cell **shows**:

  | Cell | Text |
  | --- | --- |
  | Shared string | The string; an unresolvable index gives nothing, never the index |
  | Inline string | Every run |
  | Boolean | `TRUE` / `FALSE`, not the stored `1` / `0` |
  | Formula | The cached result, never the formula |
  | Error | Its code, such as `#N/A` |

- Every `<si>` is a table entry, including an empty one.
- **One row parser** serves generation (`extractXlsx`) and the competency importer (`readXlsxGrid`).
  A parity test holds them to the same answer. The importer's rows beyond its limit are still
  counted, never decoded.
- Question import splits the normalized form on every ` -` that is followed by a space, so `k` blanks
  stay `k` empty columns, including a blank first cell. A row with no consecutive blanks splits
  exactly as before.

**Unchanged:**
- block structure and the cell separator (` — `);
- normalization, sectioning and offsets;
- ZIP limits and decompression protection, including the per-part isolation that skips a refused
  worksheet;
- hidden sheets, which are still extracted as before (a recorded limitation);
- merged cells, whose value still appears once, in the first cell.

## 3. Affected file types

**XLSX only.** DOCX, PPTX, PDF, TXT, Markdown and HTML extractors were not modified. DOCX shares the
cell separator but not the cell parser. Question import is affected only for tabular rows with
**consecutive** blank cells.

## 4. Impact-analysis method

`scripts/xlsx-extraction-impact.ts --root <host dir> [--root …]` is **read-only**. For every
synchronized XLSX document it:

1. finds the source file by name under the given roots;
2. re-extracts it through `extractContent` with the adapter's own `documentScope`
   (`sourceDocumentId`);
3. compares the recomputed content hash and every section key and section-content hash with the
   stored ones;
4. counts drafts and published questions referencing the document, and those citing a section that
   was removed or changed (current or v1 key), with their evidence spans.

It prints hashes, counts and keys, and never extracted text.

**The control.** A "no change" is believed only if the method can see a change. The pre-fix extractor
(`git show` of the previous `xlsx.ts`) was run beside the corrected one:

| Workbook | Lines differing, old vs new |
| --- | --- |
| Competency reference workbook | **143 of 380** (reported by count only; the workbook's content is not reproduced) |
| Both ingested pilot XLSX files | 0 |
| The committed `policy.xlsx` fixture | 0 |

### 4.1 Result, 2026-09-29

| Document | Source | Stored = recomputed hash | Sections | Drafts | Published | Evidence spans at risk |
| --- | --- | --- | --- | --- | --- | --- |
| `Quiz_Question_Bank_Template.xlsx` (`01a0c894-421d-7e11-bed6-82e531645a27`) | Real-World Pilot SOP Corpus | **Yes** (`e8c7b6b0…97a8`) | 3 / 3, none changed | 0 | 0 | 0 |
| `renewal-windows.xlsx` (`01a0e7aa-4517-78dd-b5d1-1a080c7666af`) | Real-World Pilot SOP Corpus (a fixture-mirror row left by EVAL-M1 F2) | **Yes** (`6e0e0e4c…cd97`) | 1 / 1 | 0 | 0 | 0 |

The Quiz template does contain styled empty cells (73). None is followed by a valued cell in the same
row, so the old and new readings coincide. **No draft, published question or evidence span depends on
either document**, measured by document id and by section key.

**The competency reference workbook is not a synchronized document** and never has been. It is read
only by the structure-only importer. Its structure-only dry run is unchanged in every count
(16 categories, 71 competencies, 297 person rows counted and not read, 0 blocking). The one
difference is **correct**: three band cells now report row 2, as their own references say, where the
swallowed spacer row had made them read as row 1.

## 5. Draft revalidation behaviour — what exists, stated exactly

A re-synchronization re-extracts the document. The sync compares the new content hash with the
stored one, bumps the document's version on a change, and replaces its sections. For an unpublished
draft citing a changed section, protection is **at approval, not at sync**:

- **Gate 12** re-locates the draft's evidence span against the section **as it reads now**.
- The gate refuses if the section no longer exists, or if the span no longer verifies in the draft's
  evidence mode.
- A draft whose evidence was changed or invalidated by the correction therefore **cannot be
  approved** until an author re-grounds it, and the refusal is on screen.

**What does not exist, and is recorded rather than implied:**

- `draft_question.needsRevalidation` is read by gate 12 but **written by nothing**.
- No revalidation queue exists, which tools/e2e/README.md already lists as unimplemented.

A draft is therefore not *proactively* marked when its section changes. It is refused when somebody
tries to approve it. Proactive marking needs a writer for `needsRevalidation` on the sync path, and it
is recorded as follow-up work in the project history.

On 2026-09-29 no draft cited an XLSX section, so none needed either.

## 6. Published-lineage behaviour

A published question is **never** rewritten in place:

- `draft_question` lineage is immutable (I15, trigger-enforced).
- The published projection keeps the section key, the v1 key and the hash it was approved against.

A re-extraction therefore cannot alter a published claim; it can only make that claim stale. **No
automatic finding is raised for a stale published question today**, for the same reason as §5.

The procedure for a non-zero impact is manual and append-only:

1. Record the affected published ids from the impact script.
2. Raise a `PlatformConsistencyFinding` or a remediation ticket per question.
3. Route any correction through a new draft version and a new approval, never through an edit of the
   published record.

On 2026-09-29 no published question referenced an XLSX document, measured by document id and by
section key, so there was nothing to raise.

## 7. Resynchronization instructions

For a deployment that finds a non-zero impact:

1. Run the impact script and keep its JSON output (`--json`). That is the before-state.
2. Export the affected drafts' ids, states, section keys and evidence offsets.
3. Synchronize **only** the affected source (Sync Manager → Sync Now, or
   `synchronize_knowledge_source`). No reset, and no broad re-sync.
4. Re-run the impact script. Every changed section should now show stored = recomputed.
5. For each draft listed in step 2, open its review screen and check gate 12, which re-verifies the evidence against the current text. Return any failing draft to its author. For published lineage, follow §6. Never edit a published record.
   findings; never edit a published record.
6. Confirm documents of other types kept their content hashes (compare
   `knowledge_document.content_hash` for non-XLSX rows before and after).

On 2026-09-29 step 3 was **not needed**, because the measured impact was zero, and it was not
performed.

## 8. Rollback

The change is code-only: no migration and no data rewrite. Rollback is `git revert` of the
XLSX-INTEGRITY-M1 commits, a rebuild of `@knowzy/content-extraction` and `@knowzy/question-import`,
and a restart of api, mcp and jobs (they run package `dist`). Because no stored extraction changed,
a rollback also needs no re-sync. If one was performed under the corrected extractor, re-sync the same
source again after rollback, and the section hashes return to the pre-correction values.
