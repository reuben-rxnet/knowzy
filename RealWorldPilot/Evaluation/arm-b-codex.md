# Deterministic generator baseline

**Captured:** 2026-09-28T14:01:56.870Z
**Generator:** `knowzy-deterministic-local-1` (no model call, no credential)
**Produced by:** `npx tsx scripts/baseline.ts --report --markdown <path>`

Every number is a query against the database after a real generation run through the real API, with the full gate chain unmodified. Nothing here is copied from a plan.

## Section accounting

| Source                                           | Documents | Sections | Assessable | Attempted | Generated | Refused | Unresolved | Coverage |
| ------------------------------------------------ | --------: | -------: | ---------: | --------: | --------: | ------: | ---------: | -------: |
| KNOWZY Generation-Ready Corpus (EVALUATION ONLY) |         7 |       78 |         76 |        76 |        42 |      32 |          2 |    55.3% |
| KNOWZY Imported Question Banks                   |         1 |        1 |          1 |         0 |         0 |       0 |          1 |     0.0% |
| KNOWZY Real-World Pilot SOP Corpus               |        36 |      250 |        122 |        93 |        52 |      39 |         31 |    42.6% |
| Mock Support Operations                          |         4 |       17 |         17 |        17 |        16 |       1 |          0 |    94.1% |

`Coverage` is generated / assessable. Since migration `0004` a refusal is recorded as `lastGenerationOutcome = REFUSED` and is **not** counted as coverage.

## Questions, evidence and duplicates

| Source                                           | Questions | STRICT | Exact spans | `EVIDENCE_UNVERIFIED` | Evidence success | Mean span | Duplicate rate | Max similarity |
| ------------------------------------------------ | --------: | -----: | ----------: | --------------------: | ---------------: | --------: | -------------: | -------------: |
| KNOWZY Generation-Ready Corpus (EVALUATION ONLY) |        51 |     51 |          51 |                     1 |            98.1% |       239 |           0.0% |          0.597 |
| KNOWZY Imported Question Banks                   |         0 |      0 |           0 |                     0 |                — |         — |              — |              — |
| KNOWZY Real-World Pilot SOP Corpus               |        56 |     56 |          56 |                     3 |            94.9% |       206 |           0.0% |          0.217 |
| Mock Support Operations                          |        23 |     23 |          23 |                     0 |           100.0% |       191 |           0.0% |          0.412 |

**Evidence success** is accepted / (accepted + `EVIDENCE_UNVERIFIED` rejections) — the proportion of candidates whose quoted span was really in the cited section. **Duplicate rate** is (flagged + blocked) / (accepted + blocked), where flagged means a score at or above the active profile's flag threshold. **Max similarity** is the highest score observed on any accepted draft, which is the number to read: a rate of 0% with a max well below the threshold says the corpus produced no near-duplicates at all.

## Confidence

| Source                                           |  Mean |   Min |   Max | Components (mean)                                                                                                                                                            |
| ------------------------------------------------ | ----: | ----: | ----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| KNOWZY Generation-Ready Corpus (EVALUATION ONLY) | 0.925 | 0.722 | 0.989 | duplicateDistance 0.805 · evidenceMatchQuality 0.992 · metadataCompleteness 1.000 · modelDeclaredConfidence 0.971 · optionDistinctness 0.886 · sectionCoverageAdequacy 0.821 |
| KNOWZY Imported Question Banks                   |     — |     — |     — | —                                                                                                                                                                            |
| KNOWZY Real-World Pilot SOP Corpus               | 0.922 | 0.772 | 0.986 | duplicateDistance 0.893 · evidenceMatchQuality 1.000 · metadataCompleteness 1.000 · modelDeclaredConfidence 0.956 · optionDistinctness 0.902 · sectionCoverageAdequacy 0.714 |
| Mock Support Operations                          | 0.862 | 0.663 | 0.990 | duplicateDistance 0.842 · evidenceMatchQuality 0.974 · metadataCompleteness 1.000 · modelDeclaredConfidence 0.863 · optionDistinctness 0.735 · sectionCoverageAdequacy 0.689 |

## Rejections by reason

**KNOWZY Generation-Ready Corpus (EVALUATION ONLY)**

- `INSUFFICIENT_EVIDENCE` — 482
- `EVIDENCE_UNVERIFIED` — 1

**KNOWZY Real-World Pilot SOP Corpus**

- `INSUFFICIENT_EVIDENCE` — 128
- `EVIDENCE_UNVERIFIED` — 3

**Mock Support Operations**

- `INSUFFICIENT_EVIDENCE` — 432

## Reading this honestly

- Both corpora derive from the SAME SOPs, so a duplicate match across them is expected and is not a property of the generator. The controlled arm in `docs/integrations/LIVE_CLAUDE_EVALUATION_PLAN.md` must run on a clean database.
- A question-bank import in the same database is part of the duplicate comparator. It is left in place deliberately: removing it would flatter the numbers.
- `coverage_status` is a denormalized claim. Deleting a draft does not clear it, so a baseline must be taken after `--reset`, which is why that subcommand exists.
