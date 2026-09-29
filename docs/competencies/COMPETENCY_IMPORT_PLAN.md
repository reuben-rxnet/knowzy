# Competency Import Plan — structure-only

**Status:** Normative, implemented 2026-09-29 (COMPETENCY-M0/M1).
**Implementation:** `readXlsxGrid` in `@knowzy/content-extraction`;
`buildCompetencyImportPlan` and `applyCompetencyImportPlan` in `@knowzy/domain`
(`src/competency/`); the operator command `scripts/competency-import.ts`.
**Governed by:** [COMPETENCY_PRIVACY_AND_GOVERNANCE.md](COMPETENCY_PRIVACY_AND_GOVERNANCE.md).
**Produces:** the entities in [COMPETENCY_MODEL.md](COMPETENCY_MODEL.md).

---

## 1. What "structure-only" means

The importer reads a workbook's **headers** and produces **reference definitions**: categories,
competencies, a level vocabulary, aliases, and the provenance of each. It reads **no person row**. It
counts person rows so that the dry run can say how many it skipped. It does not read what is in them.

That is enforced in three layers:

| Layer | Mechanism |
| --- | --- |
| Reader | `readXlsxGrid` keeps cell text for the first `retainRows` rows only (default 6). Every later row is **counted, never decoded**: its cells are not resolved against the shared-string table |
| Planner | For a person matrix, only the rows above and including the detected header row are read. Rows below it contribute a count |
| Test | A synthetic workbook plants names, employee numbers, roles, vendor names and ratings in person rows, and the test asserts that none of them appears anywhere in the serialized plan, dry-run report or findings (§7) |

Workbook parts that name people are **never opened**: `xl/comments*.xml`, `xl/threadedComments/*`,
`xl/persons/*`, `docProps/*` and `customXml/*`. The reader opens `xl/workbook.xml`, its relationships,
`xl/sharedStrings.xml` and the worksheet parts, and nothing else.

## 2. Sheet classification

Every sheet is classified by its header region alone, deterministically, before anything is taken
from it.

| Class | Detected by | Taken from it | Not taken |
| --- | --- | --- | --- |
| `PERSON_MATRIX` | A person-identity header (`Full Name`, `Name`, `Employee number`, `Sr #`) in the first three rows, and at least one category band to its right | Category bands, competency headers, their cells | Every row below the header; every person-attribute column |
| `TRAINING_MATRIX` | As above, with bands `Present` and `Target` | The competency headers under `Present`; the training-status scale | The `Target` block (per-person targets, not role targets), the training-plan column, every row below the header |
| `DISTRIBUTION_SUMMARY` | No identity header; level labels (`Not Involved`, `Limited …`, `Competency Improving`, `Competent`) in the first column of a block | The level label **text**, as source labels | Every count and percentage (§2.2 of the privacy document) |
| `AGGREGATE_SUMMARY` | No identity header; a category band over team-by-level rows | Nothing | Everything — computed aggregates with unverified denominators |
| `UNRECOGNIZED` | None of the above | Nothing | Everything, with a `WARNING` finding |
| *(hidden sheet)* | `state="hidden"` or `veryHidden` | Nothing | Everything, with a `WARNING` finding |

**Person-attribute columns** are recognized by header and recorded only as "excluded column: *Role*"
style findings: `Full Name`, `Name`, `Employee number`, `Sr #`, `Role`, `Critical`, `Int/Ext`,
`int / ext`, `Project`, `Vendor`, `Experience` (and its `Overall`/`Essilor`/`External` sub-headers),
`Location`, `Product/Service`, `Team details`, `Training plan to implement`.

## 3. Header detection in a person matrix

1. **Identity row.** A person-identity header among rows 1–3 marks the sheet as a matrix.
   Person-attribute columns are excluded, widened across any merge their header sits in (so
   `Experience` over `Overall` / `Essilor` / `External` excludes all three).
2. **Competency header row.** The **lowest** of rows 1–3 with any cell outside the person columns —
   sub-headers sit under their bands. **Row 4 is never a candidate**: on the reference workbook it
   is the first person row, and a fully rated person row is as dense as a header. A row whose cells
   are mostly rating codes is refused as a header for the same reason.
3. **Category band row.** The densest row above the header row. Row 1 on some sheets, row 2 on
   others — both occur.
4. **Category spans.** A band label covers its own column up to the column before the next band
   label, or its merged range if one is declared. The last band extends to the last header column.
5. **A band with no sub-header** (a vertically merged `DevOps` cell) is its own competency, recorded
   with an `INFO` finding `CATEGORY_IS_OWN_COMPETENCY`.
6. **A header that is a bare number** (the reference workbook has `46294`, a date serial, beside the
   Power Skills band on two sheets) is not a competency: `WARNING` `NUMERIC_HEADER_IGNORED`.
7. **An empty header inside a span** is skipped silently: a spreadsheet omits empty cells, and a gap
   is not a finding.
8. **A header outside every band** is not imported, because its category is unknown:
   `WARNING` `HEADER_OUTSIDE_CATEGORY_BAND`. The reference workbook has three — a merge drawn one or
   two columns short — and each of those competencies is still defined from the other sheets.
9. **A band that is not a declared category** blocks the apply (`UNDECLARED_CATEGORY`): a category
   needs a *kind*, which cannot be inferred.

**A reader defect this found.** The first dry run of the reference workbook reported 61 blocking
findings on band labels such as "5" and "212". The cell matcher tried the open-tag form first, so a
styled empty cell (`<c r="G1" s="5"/>`) matched as an opening tag and swallowed the next cell,
printing that cell's shared-string index in the wrong column. `readXlsxGrid` now matches the
self-closing form first, with a regression test. **`extractXlsx`, the generation extractor, carries
the same matcher and the same defect**; it is not changed here because fixing it changes the
extracted text and section hashes of the two XLSX documents already ingested in the pilot corpus,
mid-evaluation. It is recorded as an `it.todo` and in the project history as its own change.

## 4. Normalization

Per [COMPETENCY_MODEL.md §5](COMPETENCY_MODEL.md#5-normalization-and-aliases): one fold, a declared
normalization table, and a decision order in which a **near match nobody declared blocks the apply**.
A competency seen on several sheets is **one** definition with several provenance rows. That is a
"duplicate definition" in the dry-run count, and it is expected — the reference workbook repeats the
same matrix on six team sheets.

A competency seen under two different categories (the reference workbook's `RXSolun OFS`) is
resolved only by a declared placement, reported every time as `PROVISIONAL`. Without one it would
become two competencies that are really one, so it is a `BLOCKING` finding `CATEGORY_CONFLICT`.

## 5. Findings

| Severity | Meaning | Effect on apply |
| --- | --- | --- |
| `INFO` | Recorded for the reviewer: an undeclared label created as written, a band that is its own competency | None |
| `WARNING` | Something was skipped: an unrecognized or hidden sheet, a numeric header, an aggregate sheet | None |
| `DECISION_REQUIRED` | Applied under a provisional declaration that an SME must confirm | None, but listed on every run |
| `BLOCKING` | An undeclared near match, a category conflict with no declaration, or no competency found at all | **Apply refuses** |

A finding carries a code, a sheet name, a cell reference into a **header** row, the header label
concerned, and a sentence. It never carries anything from a person row, because nothing from a
person row is read.

## 6. Modes

```
npx tsx scripts/competency-import.ts --file "<workbook.xlsx>" --version-label 2024-05            # dry run
npx tsx scripts/competency-import.ts --file "<workbook.xlsx>" --version-label 2024-05 --apply    # apply
npx tsx scripts/competency-import.ts ... --report <out.json>                                     # also write the report
```

| | Dry run (default) | Apply |
| --- | --- | --- |
| Reads the file | Yes | Yes |
| Touches the database | **No** — no connection is opened | One transaction |
| Reports | Sheets inspected and their class · categories · competencies · aliases proposed · ambiguities · person rows skipped per sheet · excluded columns · duplicate definitions · decisions required · blocking findings | The same, plus created / matched counts and the batch id |
| Refuses on a `BLOCKING` finding | Reports it | **Yes**, before any write |

**Apply is idempotent.** The framework is matched by code, the version by content hash, and every
definition by its framework-scoped code; provenance is unique per version, sheet and cell. A second
apply of the same file writes one `competency_import_batch` row with outcome `NO_CHANGES` and
creates no definition. A different file with the same `--version-label` is refused: a version label
names one file.

**The apply is audited** as `ADMIN.COMPETENCY.IMPORT_APPLIED` inside the same transaction, with
counts only. The actor is `SYSTEM`, portal `SYSTEM`: the command runs on a host with no identity
provider, and recording an invented user would make the audit row a lie. The operator is named in
the batch's `actorLabel` from `--operator`, which is free text and says so.

**What apply never does:** create a `JobRole`, a `RoleCompetencyExpectation`, a framework-version
approval, or anything person-level.

## 7. The test that proves no person-level record escapes

`packages/domain/src/competency/import-plan.test.ts` builds a synthetic grid shaped like the
reference workbook — a team sheet with a category band, a header row and person rows; an Agile sheet
with Present and Target; a distribution sheet; a summary sheet — and **plants** values in every
person-level position: invented names, employee numbers, role titles, vendor names, project names,
experience years, training plans, and a rating in every competency cell.

It then asserts, over `JSON.stringify` of the plan **and** of the dry-run report:

- none of the planted strings appears;
- no key named like a person attribute (`fullName`, `employee`, `rating`, `vendor`, `role`,
  `target`, …) appears anywhere in the plan;
- no provenance or finding on a matrix sheet references a row below 3;
- the person-row count per sheet is correct, which proves the rows were seen and skipped rather than
  missed.

A second test (`scripts/lib/competency-workbook.test.ts`) runs the same assertion end to end through
`readXlsxGrid` on a synthetic `.xlsx` built in memory, with person rows both inside and beyond the
reader's row limit, so a regression in either half is caught. Checked by mutation: copying one
person cell into a finding fails the planner test, and ignoring the reader's row limit fails three
reader tests.

## 7a. Verified against the real workbook (2026-09-29)

Beyond the synthetic tests, the reference workbook was applied to a **scratch database migrated from
empty** (not the development database) and then checked for leakage by a throwaway local script,
which collected every string of four or more characters from the workbook's person rows **in memory**
(322 distinct values) and searched every text column the import wrote, plus the audit detail.

| Result | Value |
| --- | --- |
| Person-row strings found in the imported data | **14**, all vocabulary: 9 are also header labels or declared levels (product names in the Agile sheet's Product/Service column, "Trained", "Certified", …); 5 are substrings of a declared name, a declared level label or a sheet name ("Rx-Suite", "Product", "DevSecOps", …) |
| Names, employee numbers, vendor names or ratings found | **0** |

The script printed only counts and our own stored text, never a person-row value.

## 8. Limitations

- One reference profile exists (`RX_COMPETENCY_MATRIX_2024`). Another organization's matrix needs
  its own declared normalization table; the fold and decision order are generic, the table is not.
- Cached values only; formulas are never evaluated (the reader's existing rule).
- No screen. Import is an operator command until competency administration is built (CM-6).

## 9. Reference dry run and apply (2026-09-29)

`07 RxSolutions Competency matrix - May 2024.xlsx`, sha256
`274dfda235b121b37356c04cc6df8625c14bdff9657edd8d1a8ac53346c825be`, profile
`RX_COMPETENCY_MATRIX_2024`.

| Measure | Value |
| --- | --- |
| Sheets inspected | 14 — six person matrices, one training matrix, one aggregate summary, six distribution summaries |
| Categories | 16 |
| Competencies | 71, every one declared; none undeclared |
| Aliases | 93 |
| Duplicate definitions | 289 header occurrences resolving to a definition already seen (the matrix is repeated on six team sheets) |
| Person rows counted and not read | 297 — 132 on the six team sheets, 165 on the Agile sheet |
| Excluded person columns | Full Name · Role · Critical · Int/Ext · Project · Sr # · Employee number · Vendor · Experience · Team details · Name · Product/Service · Location · Training plan to implement |
| Blocking | **0** |
| Decisions required | 4 — Rx-Universe/Rx-Suite (CM-7), RXSolun OFS placement (CM-8, reported twice: the mapping and the one sheet that places it under LMS), and the declared Agile training scale |
| Warnings | 13 — two numeric headers, three headers outside every band, the Agile per-person Target block, seven aggregate sheets |

**Apply, to a scratch database migrated from empty:** first apply `APPLIED` — framework 1, version 1
(`DRAFT`), scales 2, levels 7, categories 16, competencies 71, aliases 93, provenance 632. Second
apply of the same file `NO_CHANGES`, every count 0. Two batches, two `ADMIN.COMPETENCY.IMPORT_APPLIED`
audit events, zero role targets. The development database was migrated to 0015 but **not** populated.
