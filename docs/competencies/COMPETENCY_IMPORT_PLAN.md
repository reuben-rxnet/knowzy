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

1. **Identity row.** The first row, among rows 1–3, containing a person-identity header.
2. **Competency header row.** Among rows 1–4, the row with the most non-empty cells to the right of
   the first category column. On the reference workbook this is row 3 on every team sheet.
3. **Category band row.** The nearest row above the header row with at least two labels in the
   competency region. Row 1 on some sheets, row 2 on others — both occur.
4. **Category spans.** A band label covers its own column up to the column before the next band
   label, or its merged range if one is declared. The last band extends to the last header column.
5. **A band with no sub-header** (a vertically merged `DevOps` cell) is its own competency, recorded
   with an `INFO` finding `CATEGORY_IS_OWN_COMPETENCY`.
6. **A header that is a bare number** (the reference workbook has `46294`, a date serial, beside the
   Power Skills band on two sheets) is not a competency: `WARNING` `NUMERIC_HEADER_IGNORED`.
7. **An empty header inside a span** is skipped silently: a spreadsheet omits empty cells, and a gap
   is not a finding.

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
- no key named like a person field (`name`, `employee`, `rating`, `vendor`, …) appears in any
  definition;
- the person-row count per sheet is correct, which proves the rows were seen and skipped rather than
  missed.

A second test runs the same assertion end to end through `readXlsxGrid` on a synthetic `.xlsx` built
in memory, so a regression in the reader's row limit is caught too. Both were checked by mutation:
copying one person cell into a finding makes them fail.

## 8. Limitations

- One reference profile exists (`RX_COMPETENCY_MATRIX_2024`). Another organization's matrix needs
  its own declared normalization table; the fold and decision order are generic, the table is not.
- Cached values only; formulas are never evaluated (the reader's existing rule).
- No screen. Import is an operator command until competency administration is built (CM-6).
