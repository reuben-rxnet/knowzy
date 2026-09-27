# Deterministic generator baseline

**Captured:** 2026-09-27T11:45:52.276Z
**Generator:** `knowzy-deterministic-local-1` (no model call, no credential)
**Produced by:** `npx tsx scripts/baseline.ts --report --markdown <path>`

Every number is a query against the database after a real generation run through the real API, with the full gate chain unmodified. Nothing here is copied from a plan.

## Section accounting

| Source                                           | Documents | Sections | Assessable | Attempted | Generated | Refused | Unresolved | Coverage |
| ------------------------------------------------ | --------: | -------: | ---------: | --------: | --------: | ------: | ---------: | -------: |
| KNOWZY Generation-Ready Corpus (EVALUATION ONLY) |         7 |       78 |         76 |        76 |        16 |      60 |          0 |    21.1% |
| KNOWZY Imported Question Banks                   |         1 |        1 |          1 |         0 |         0 |       0 |          1 |     0.0% |
| KNOWZY Real-World Pilot SOP Corpus               |        30 |      238 |        118 |        93 |         4 |      89 |         25 |     3.4% |
| Mock Support Operations                          |         4 |       17 |         17 |        17 |         4 |       8 |          5 |    23.5% |

`Coverage` is generated / assessable. Since migration `0004` a refusal is recorded as `lastGenerationOutcome = REFUSED` and is **not** counted as coverage.

## Questions, evidence and duplicates

| Source                                           | Questions | STRICT | Exact spans | `EVIDENCE_UNVERIFIED` | Evidence success | Mean span | Duplicate rate | Max similarity |
| ------------------------------------------------ | --------: | -----: | ----------: | --------------------: | ---------------: | --------: | -------------: | -------------: |
| KNOWZY Generation-Ready Corpus (EVALUATION ONLY) |        16 |     16 |          16 |                     0 |           100.0% |       170 |           0.0% |          0.483 |
| KNOWZY Imported Question Banks                   |         0 |      0 |           0 |                     0 |                — |         — |              — |              — |
| KNOWZY Real-World Pilot SOP Corpus               |         4 |      4 |           4 |                     0 |           100.0% |       108 |           0.0% |          0.594 |
| Mock Support Operations                          |         6 |      6 |           6 |                     0 |           100.0% |       115 |           0.0% |          0.412 |

**Evidence success** is accepted / (accepted + `EVIDENCE_UNVERIFIED` rejections) — the proportion of candidates whose quoted span was really in the cited section. **Duplicate rate** is (flagged + blocked) / (accepted + blocked), where flagged means a score at or above the active profile's flag threshold. **Max similarity** is the highest score observed on any accepted draft, which is the number to read: a rate of 0% with a max well below the threshold says the corpus produced no near-duplicates at all.

## Confidence

| Source                                           |  Mean |   Min |   Max | Components (mean)                                                                                                                                                            |
| ------------------------------------------------ | ----: | ----: | ----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| KNOWZY Generation-Ready Corpus (EVALUATION ONLY) | 0.709 | 0.658 | 0.760 | duplicateDistance 0.623 · evidenceMatchQuality 0.945 · metadataCompleteness 1.000 · modelDeclaredConfidence 0.600 · optionDistinctness 0.168 · sectionCoverageAdequacy 0.815 |
| KNOWZY Imported Question Banks                   |     — |     — |     — | —                                                                                                                                                                            |
| KNOWZY Real-World Pilot SOP Corpus               | 0.734 | 0.680 | 0.778 | duplicateDistance 0.651 · evidenceMatchQuality 0.936 · metadataCompleteness 1.000 · modelDeclaredConfidence 0.600 · optionDistinctness 0.256 · sectionCoverageAdequacy 0.869 |
| Mock Support Operations                          | 0.722 | 0.663 | 0.786 | duplicateDistance 0.757 · evidenceMatchQuality 0.919 · metadataCompleteness 1.000 · modelDeclaredConfidence 0.600 · optionDistinctness 0.213 · sectionCoverageAdequacy 0.810 |

## Rejections by reason

**KNOWZY Generation-Ready Corpus (EVALUATION ONLY)**

- `INSUFFICIENT_EVIDENCE` — 152

**KNOWZY Real-World Pilot SOP Corpus**

- `INSUFFICIENT_EVIDENCE` — 178

**Mock Support Operations**

- `INSUFFICIENT_EVIDENCE` — 346

## Reading this honestly

- Both corpora derive from the SAME SOPs, so a duplicate match across them is expected and is not a property of the generator. The controlled arm in `docs/integrations/LIVE_CLAUDE_EVALUATION_PLAN.md` must run on a clean database.
- A question-bank import in the same database is part of the duplicate comparator. It is left in place deliberately: removing it would flatter the numbers.
- `coverage_status` is a denormalized claim. Deleting a draft does not clear it, so a baseline must be taken after `--reset`, which is why that subcommand exists.
