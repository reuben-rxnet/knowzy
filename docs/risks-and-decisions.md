# Risks, Assumptions, Dependencies, and Decisions

**What this document adds:** the architecture decision records, the risk register, the dependency
register, and the change-control rules for both. Tenant-specific unknowns are catalogued separately in
[assumptions-and-tenant-configuration.md](assumptions-and-tenant-configuration.md).

---

## 1. How to read this document

| Section | Contents |
| --- | --- |
| §2 | Decision status conventions |
| §3 | Architecture decision records (ADR-001 … ADR-014) |
| §4 | Rejected alternatives that recur often enough to be worth recording |
| §5 | Risk register (R-01 … R-16) |
| §6 | Dependency register |
| §7 | Change control for decisions and risks |

An ADR records a decision that was genuinely contested and is expensive to reverse. A choice with no
credible alternative (TypeScript, HTTPS, UTC storage) is not an ADR — it is a convention, recorded
where it is used.

---

## 2. Status conventions

| Status | Meaning |
| --- | --- |
| **Accepted** | In force. Changing it is an architecture change requiring a superseding ADR |
| **Accepted (provisional)** | In force, with a named trigger for revisiting |
| **Deferred** | Deliberately not decided in release 1; the design keeps the option open and states how |
| **Superseded** | Replaced; retained with a pointer to the replacement |

---

## 3. Architecture decision records

### ADR-001: Two separately deployable portals over one application

**Status:** Accepted

**Context.** Authors, administrators, reviewers, and learners could share one Next.js application with
role-filtered navigation, which is cheaper to build and operate.

**Decision.** Two independently deployable applications (`authoring-web`, `live-web`) with separate
Entra app registrations, separate API scopes, separate authorization policy sets, separate audit
categories, and separate telemetry identifiers.

**Rationale.** The platform's highest-value secret during normal operation is the answer key. In a
single application, a routing or data-fetching bug can expose an authoring capability to a learner; in
two, the authoring routes are **not present in the learner's bundle** and the learner's API scope has
no route capable of returning an answer key. The blast radius of an authoring release also stops
touching in-flight assessments. Full comparison:
[architecture.md §6.3](architecture.md#63-why-two-applications-rather-than-one-with-hidden-menus).

**Consequences.** Two build and deploy pipelines; a shared design system must be a real package;
cross-portal navigation does not exist. Accepted.

---

### ADR-002: Option A — SharePoint List as the Question Bank of record

**Status:** Accepted (confirmed with the business)

**Context.** Approved question content could live in PostgreSQL (Option B) or in a SharePoint List
(Option A). Option B gives strong querying, transactions, and no throttling. Option A puts governed
content where the enterprise already governs content.

**Decision.** Approved and published question **content** is authoritative in a SharePoint List named
**Knowzy Question Bank**. PostgreSQL holds application, workflow, session, security, and reporting
data, plus a `PublishedQuestionReference` projection of each bank item.

**Rationale.** Native versioning, native permissions, native retention and eDiscovery, and a
repository that survives the application. The question bank is an enterprise knowledge asset, not
application state.

**Consequences, stated plainly.** SharePoint list querying is weak, throttling is real, filtering
requires indexed columns, and internal field names vary by environment. The design absorbs all four:
a PostgreSQL projection for every query pattern the platform needs, eight mandatory indexed columns, a
read-once-per-session content path, mapping profiles, and reconciliation for drift
([sharepoint-question-bank.md §10](sharepoint-question-bank.md#10-known-constraints-and-how-the-design-absorbs-them)).
The cost is real: reconciliation, mapping profiles, and the projection are work that Option B would
not require, and manual edits in SharePoint become drift rather than being impossible.

**Reversal path.** The `QuestionBankAdapter` port means a future move to a relational bank is an
adapter plus a migration, not a redesign. This was a deliberate shape choice, not a coincidence.

---

### ADR-003: MCP as the sole gateway to knowledge sources and the Question Bank

**Status:** Accepted

**Context.** The API could call Microsoft Graph directly through a client library. MCP adds a network
hop, a second authorization surface, and operational complexity.

**Decision.** All knowledge-source and Question Bank access goes through the Knowzy MCP server, which
is the only component holding Graph credentials and is never internet-reachable.

**Rationale.** Three concrete properties, not decoration: one audited, schema-validated gateway with
no alternative path; a model-safe tool surface where Claude receives a read-only subset of the **same**
tools under the **same** authorization envelope, so there is no second weaker code path; and source
pluggability, since a tool contract stays identical while adapters differ
([architecture.md §7.4](architecture.md#74-why-mcp-sits-between-the-api-and-sharepoint)).

**Consequences.** One extra hop's latency on source operations; a tool registry to maintain; envelope
signing and verification. MCP is deliberately **not** used as a generic internal RPC layer — domain
services call PostgreSQL in process ([mcp-tools.md §1.1](mcp-tools.md#11-what-mcp-is-not-used-for)).

---

### ADR-004: Claude drafts and summarizes; it never decides

**Status:** Accepted

**Context.** The model could plausibly be given more authority — auto-approving high-confidence
questions, selecting assessment questions, scoring short answers, deciding badge eligibility.

**Decision.** Scoring, approval, publishing, selection, badge and certificate eligibility, weak-topic
identification, and duplicate blocking are **deterministic backend functions with unit tests**. Claude
drafts questions, writes refresher summaries, optionally reorders candidate section IDs, and optionally
offers an advisory duplicate verdict. Nothing it returns authorizes anything.

**Rationale.** Goal G2 requires that every published question carry a named human approver, and goal
G4 requires defensible proficiency measurement. A non-deterministic scorer cannot be unit-tested, a
non-deterministic approver cannot be audited, and neither can be explained to a learner who disputes a
result.

**Consequences.** Some plausible automation is off the table, and confidence scores authorize nothing
even at 0.99. Accepted, and the confidence indicator is deliberately platform-computed rather than
model-self-reported ([workflows.md §2.8](workflows.md#28-confidence-indicator)).

---

### ADR-005: Evidence verification is mechanical and cannot be disabled

**Status:** Accepted

**Context.** Grounding could be requested in the prompt and checked by reviewers, which is how most
AI-authoring tools work.

**Decision.** A generated question is not persisted unless its `supportingEvidence` matches a
normalized span of the supplied section text — exact substring under `STRICT`, ≥0.95 trigram
similarity under `STANDARD` — within a section that was part of the pinned generation scope, with the
matched offsets stored. `STRICT` cannot be switched off; only the tolerance varies
([workflows.md §2.5](workflows.md#25-evidence-verification-normative)).

**Rationale.** This single control is what prevents plausible-sounding fabrication from ever reaching
a reviewer. Asking a reviewer to catch fabrication at volume is asking them to do the one thing
volume review is worst at.

**Consequences.** Some legitimate questions synthesizing across sections are rejected as
`EVIDENCE_UNVERIFIED`, and the yield is lower than an ungrounded generator's. Accepted: the platform
would rather produce fewer questions than unverifiable ones, and `insufficientEvidence` is a
first-class success result so the model has an honest way to decline.

---

### ADR-006: Generation requires explicit document selection and a recorded preflight decision

**Status:** Accepted

**Context.** "Generate questions from this library" is the obvious feature request and the obvious
path to duplicate sprawl and unreviewable batches.

**Decision.** `GenerationService.run()` accepts a `ResolvedGenerationScope` constructible only from an
explicit, non-empty document ID list (1–10) plus a scope selector, and the service has **no injected
adapter capable of listing documents**. Every job additionally requires a justification reason code
and a valid, unexpired `GenerationPreflight` decision
([generation-governance.md §1.1](generation-governance.md#11-hard-prohibitions)).

**Rationale.** "Generate from everything" is made **inexpressible in the type system**, not merely
discouraged by policy. Review capacity, not generation capacity, is the constraint on this platform.

**Consequences.** A 10-document cap per job; no bulk library processing; an extra click before every
generation. The preflight's four actions make reuse the cheap default, which is the intended effect.

---

### ADR-007: PostgreSQL-backed job queue (pg-boss) over Redis/BullMQ

**Status:** Accepted (provisional)

**Context.** Sync, generation, publishing, exports, and certificate rendering need a durable queue.
Redis with BullMQ is the conventional choice.

**Decision.** pg-boss on the existing PostgreSQL instance for release 1.

**Rationale.** It removes an entire stateful dependency from the deployment, backup, failover, and
security surface. Queue state joins transactionally with domain state, so "create a `PublishOperation`
and enqueue its job atomically" is a single transaction rather than a two-system coordination problem —
which is precisely where idempotency bugs live. Expected throughput (tens of jobs per minute, not
thousands per second) is far inside pg-boss's range. It also removes the temptation of a shared
distributed cache, which is where answer keys would eventually leak
([error-handling.md §9](error-handling.md#9-caching-rules) A12).

**Revisit trigger.** Sustained queue depth above 10,000, or job-claim latency p95 above 2 s, or a
requirement for cross-region workers. The job runner speaks a `JobQueue` interface, so the swap is
contained.

**Consequences.** Queue load lands on the primary database; queue tables participate in backups and
need their own retention. Accepted and monitored.

---

### ADR-008: Lexical duplicate detection first; semantic detection deferred

**Status:** Accepted, with a deferred extension

**Context.** Paraphrased duplicates are the common case, and embedding-based cosine similarity would
catch them.

**Decision.** Release 1 ships composite **lexical** scoring (trigram, token Jaccard, option overlap,
same-section, same-answer-semantics) across all domains. A `pgvector` column and HNSW index are
reserved; no embedding provider is integrated.

**Rationale.** Lexical detection needs no embedding infrastructure, no per-question embedding cost, no
re-embedding on edit, and is deterministic and explainable — a reviewer can see *why* two questions
scored 0.81. Four independent controls already surround it: prompt-level suppression, block and flag
thresholds, similarity clusters at pool level, and the reviewer.

**Consequences, stated plainly.** Lexical detection **will** miss paraphrases. This is stated in the
UI rather than implied away, and the reviewer is the backstop. Tracked as R-07.

---

### ADR-009: `pdf-lib` for certificate rendering

**Status:** Accepted

**Context.** Certificates could be rendered from HTML with a headless browser (Puppeteer), which gives
richer layout control.

**Decision.** `pdf-lib` with embedded font subsets, no headless browser in any container.

**Rationale.** Determinism and attack surface. A certificate must re-render byte-identically for the
`renderedHash` integrity check to mean anything, and a headless browser is neither deterministic
across versions nor small: it adds ~300 MB to an image, a process-spawning surface, and a renderer
that loads remote resources by default. Certificate layout is a fixed template with substituted
fields — the richer layout control buys nothing here.

**Consequences.** Layout is coded rather than authored in HTML, so template changes are code changes.
Accepted; `templateVersion` is stored per certificate so an issued certificate is never altered by a
later template change.

---

### ADR-010: Fastify for the API runtime

**Status:** Accepted (provisional)

**Context.** Express is the default; NestJS offers more structure; the Next.js route handlers could
host the API directly.

**Decision.** Fastify 5 as a standalone API application.

**Rationale.** Schema-first routing pairs naturally with the Zod-everywhere contract, so one schema
serves REST validation, the MCP tool definition, and Claude output parsing without a translation
layer. A standalone API keeps the two portals as pure presentation and prevents the API surface from
being coupled to either portal's release cadence — which ADR-001 requires. NestJS's structure is
largely what the package boundaries in
[repository-structure.md §5](repository-structure.md#5-dependency-rules) already enforce, without the
decorator and DI overhead.

**Reversal cost.** Low and contained: Express is an acceptable substitute, and the domain layer has no
framework dependency, so a swap touches only route registration and the request pipeline.

---

### ADR-011: Roles resolved from the Knowzy database, not from token claims

**Status:** Accepted

**Context.** Entra group claims are in the token and would require no reconciliation.

**Decision.** `UserRole` in PostgreSQL is authoritative; group claims are a provisioning hint
processed by a reconciliation job that **adds** grants and **flags** removals without auto-revoking
([access-control.md §3](access-control.md#3-role-source-of-truth)).

**Rationale.** Group claims are overage-truncated above roughly 200 groups, are stale for the token's
lifetime, and carry no Knowzy audit record. Goal G2 requires that a historical approval be explainable
— "who was permitted to do this, on that date" must be answerable from Knowzy's own append-only
record, not reconstructed from a directory that has since changed.

**Consequences.** A reconciliation job, a removals worklist, and a deliberate lag between a group
change and a Knowzy role change. Accepted: an accidental group edit must not silently strip an
approver mid-review.

---

### ADR-012: Server-side session snapshot, read once from the bank

**Status:** Accepted

**Context.** The quiz could read questions from the bank per question, keeping content fresh.

**Decision.** At session creation the platform reads the selected questions once and stores an
immutable snapshot — including answer keys — server-side. The quiz never calls the source again except
in an audited recovery path
([live-learning-portal.md §4.2](live-learning-portal.md#42-the-session-snapshot-is-authoritative)).

**Rationale.** Three properties at once: an in-flight attempt cannot be changed by a mid-session edit,
retirement, or republication; a scored attempt is reproducible years later; and SharePoint throttling
cannot interrupt a learner mid-assessment. It also collapses the answer-key exposure window to a
single call guarded by a one-time session token.

**Consequences.** Answer-key copies exist in session rows, which is why retention deletes them as
early as policy allows and why column-level access discipline applies
([security.md §8](security.md#8-answer-key-protection) K4).

---

### ADR-013: Source changes never modify approved questions automatically

**Status:** Accepted

**Context.** When a source document changes, the questions derived from it may be wrong. Automatic
retirement or unpublishing would be the safe-looking response.

**Decision.** A content-hash change **flags** dependent questions for revalidation. No approved
question is automatically modified, retired, unpublished, or deactivated. Affected published questions
remain fully available to learners while flagged, and a human resolves each flag
([knowledge-source-administration.md §6.4](knowledge-source-administration.md#64-revalidation-policy-specification-33-normative)).

**Rationale.** Most content changes are immaterial to a given question, and the hash cannot tell which.
Automatic retirement would let a typo fix in a runbook silently empty an assessment pool mid-campaign —
a worse failure than a briefly stale question, and one nobody would notice until a learner saw
"temporarily unavailable". Availability is a human decision.

**Consequences.** A revalidation backlog that must be worked, with reporting on unresolved age.
Accepted, and the queue is a first-class dashboard panel rather than a hidden list.

---

### ADR-014: Four-option multiple choice only in release 1

**Status:** Accepted, with the extension designed

**Context.** Multi-select, true/false, short answer, and scenario ordering are all wanted.

**Decision.** `MULTIPLE_CHOICE_4` only. The `QuestionType` enum, the discriminated `AnswerPayload`
union, the pluggable scorer registry, and the per-type learner projection are all present from day one
([data-model.md §7](data-model.md#7-question-type-extensibility)).

**Rationale.** Scope control where it costs least. One type means one generation prompt shape, one
scorer, one renderer, and one set of validation gates to get right — and the review workspace, which is
the real constraint on throughput, only has to be excellent for one shape.

**Consequences.** Some knowledge is poorly assessed by four-option multiple choice, and the platform
says so rather than pretending otherwise. Adding a type is a new enum value already in the database, a
payload schema, a scorer, a projection, a renderer, and mapping-profile entries — no change to
lifecycle, publishing, assessment, session, reporting, or audit code.

---

## 4. Rejected alternatives worth recording

| Alternative | Why rejected |
| --- | --- |
| Auto-approve questions above a confidence threshold | Hollows out goal G2. Confidence is platform-computed and advisory; it authorizes nothing (ADR-004) |
| Let Claude select assessment questions | Selection must be reproducible from a stored seed and auditable against an eligibility snapshot |
| Store the question bank in both SharePoint **and** PostgreSQL as full copies | Two authorities for one fact. The projection deliberately excludes answer content (ADR-002) |
| A shared Redis cache for question content | The one place answer keys would eventually leak. In-process caches only, per-scope (ADR-007) |
| Generate questions at quiz time | Destroys reuse, review, approval, and reproducibility simultaneously |
| Machine-translate questions for other locales | An approved question's wording is what a human approved; translation would publish unapproved content |
| Proctoring, lockdown browser, webcam identity checks | Disproportionate for internal proficiency measurement; an explicit non-goal |
| Learner leaderboards | Cultural and privacy risk, and no read model exists that could produce one |
| A single "Approve all" action | Bulk approve exists but is permission-gated, capped, and enumerates item IDs in its confirmation |
| Content approval enabled on the SharePoint list | Two conflicting sources of governance truth; Knowzy owns approval with the full gate evaluation |
| Auto-healing reconciliation drift | Could destroy a deliberate human governance action; every difference requires an operator decision |
| A second, approximate permission-preview implementation for the UI | It would eventually disagree with enforcement, invisibly. The preview calls the real resolver |

---

## 5. Risk register

Likelihood and impact are `L` / `M` / `H`. Every risk has a named owner role and a **detection**
mechanism — a risk nobody would notice materializing is not managed.

| ID | Risk | L | I | Mitigation | Detection | Owner |
| --- | --- | --- | --- | --- | --- | --- |
| R-01 | **Answer key leaks** through a new route, projection, cache, or export | L | **H** | Seven independent controls ([security.md §8](security.md#8-answer-key-protection)); build-time contract tests; runtime response-shape assertion; reflective leakage suite over every tool and route | K3 violations page immediately; leakage suite fails the build | Security architect |
| R-02 | **SharePoint throttling** degrades publishing or session creation | **M** | M | Token bucket per resource, `Retry-After` honoured, circuit breaker per source, read-once-per-session, off-peak reconciliation, resumable publish operations | Throttling events on the source health report; circuit-open alerts | Platform engineer |
| R-03 | **Permission-aware retrieval misconfigured** so Knowzy is more permissive than SharePoint under app-only mode | M | **H** | `DELEGATED_OBO` default for interactive paths; restriction layers can only narrow; enforcement labelled in the UI; per-retrieval permission outcomes recorded ([security.md §7.1](security.md#71-residual-risk-stated)) | Source configuration review; permission-mode column on the source registry | Source administrator |
| R-04 | **Review capacity becomes the bottleneck**, and generated drafts accumulate unreviewed | **H** | M | Keyboard-first review workspace; preflight that makes reuse the cheap default; 10-document job cap; turnaround reporting; pipeline counts on the dashboard | Awaiting-review count and turnaround p90 trending up | Delivery lead |
| R-05 | **Question quality is poor** despite grounding — trivial, ambiguous, or badly distractored questions | M | M | Generation profiles with distractor rules; composite confidence with component breakdown; item analytics after 30 attempts; yield analytics per prompt version; the review gate | Below-chance and single-distractor flags on the item quality report; edit distance generated→approved | Quiz author lead |
| R-06 | **Scanned or image-only PDFs** yield no text, and a source appears usable but produces nothing | **H** | L | `EXTRACTION_EMPTY` with a clear administrator message, never a silent empty chunk set; extraction failure rate alert above 10 % per run; OCR explicitly out of scope | Extraction failure report; source health notification | Source administrator |
| R-07 | **Paraphrased duplicates escape** lexical detection | **M** | M | Prompt-level suppression; composite lexical scoring across all domains; similarity clusters at pool level; reviewer backstop; `pgvector` reserved (ADR-008) | Cluster size distribution; reviewer disposition rate; learner reports of repeated questions | AI engineer |
| R-08 | **Revalidation backlog grows** and stale questions stay live | **M** | M | Dashboard queue; notifications to author, source owner, and domain reviewers; diff view with previous and current text; unresolved-age reporting | Revalidation backlog report, unresolved > 30 days | Approver lead |
| R-09 | **Bank drift** from manual SharePoint edits, especially to `CorrectAnswer` | L | **H** | Nightly hash-based reconciliation; answer-key drift is high-severity and excludes the question from **new** selection; write access to the list discouraged for humans | Reconciliation report; high-severity notification | Platform administrator |
| R-10 | **Assessment pool insufficiency** surfaces to learners as "temporarily unavailable" | M | M | Pool feasibility checked at publish **and** at session start; `droppedSinceSnapshot` as an early warning; honest shortfall reporting rather than silent under-fill | Assessment pool health report; session-creation failure alerts | Assessment manager |
| R-11 | **Claude cost or rate limits** exceed budget | M | M | Per-job, per-tenant, and per-day token budgets; concurrency cap; per-objective prompts keep inputs small; 429 backoff; budget exhaustion ends a job as `PARTIAL` with counts achieved | Token usage per job and per day; budget-exceeded events | Platform administrator |
| R-12 | **Prompt injection** in a source document alters platform behaviour | M | M | No tools during generation; per-call nonce delimiters; schema-validated output; citations built by the platform from opaque candidate IDs; canary assertion ([security.md §6](security.md#6-prompt-injection-controls)) | `PROMPT_CANARY_DETECTED` pages; citation-validation failures | Security architect |
| R-13 | **Field-mapping misconfiguration** writes values into the wrong bank columns | L | **H** | Mapping profiles with 12 validation checks; auto-generated mappings require human confirmation; dry-run showing the exact resolved payload before writes are enabled; nightly validation of the active profile | Profile validation failures; dry-run review before enabling `sharepoint.write.enabled` | Platform administrator |
| R-14 | **Tenant values unavailable at build time**, blocking integration work | **H** | M | Mock adapter and mock bank make the entire pipeline buildable and testable with zero tenant values; every required value catalogued with an owner ([assumptions-and-tenant-configuration.md](assumptions-and-tenant-configuration.md)) | Open items on the tenant-configuration checklist | Delivery lead |
| R-15 | **Proficiency figures are disputed** because a metric was computed differently than a stakeholder assumed | **M** | M | Normative longitudinal semantics ([reporting.md §5](reporting.md#5-proficiency-semantics)); `NOT_ASSESSED` as a distinct value; `NOT_ASSESSED` count always shown beside readiness; formula shown with every metric; thresholds copied onto results | Stakeholder review of the proficiency reports before release | Reporting lead |
| R-16 | **Proficiency data misused** in performance management, damaging adoption | M | **H** | Aggregate-only manager views; minimum group size with complementary suppression and no override; no leaderboards or percentiles; learner sees only their own results; purpose limitation documented | Access and export audit review; suppression counts | Privacy owner |

### 5.1 Risks explicitly accepted without mitigation

| Risk | Position |
| --- | --- |
| Cheating by collaboration between learners | Accepted. No proctoring is in scope; assessments measure proficiency for development, not certification of identity ([security.md §1.2](security.md#12-explicit-non-threats-for-release-1)) |
| Question pool exhaustion through repeated attempts | Partially mitigated by attempt limits and `showAnswersAfterCompletion = false`; not prevented |
| A malicious Platform Administrator | Constrained by audit and optional two-person admin grants; not prevented |
| Audit insertion by a privileged database actor in the current month | Sealed partitions detect modification of closed months only; external notarization is out of scope and stated as such ([audit-model.md §6.1](audit-model.md#61-what-integrity-does-and-does-not-guarantee)) |
| Historical team membership cannot be reconstructed | Team rollups resolve membership as of query time, and every such report says so |

---

## 6. Dependency register

| Dependency | Type | Criticality | Failure behaviour | Owner |
| --- | --- | --- | --- | --- |
| Microsoft Entra ID | External, tenant | **Blocking** | No sign-in. Cached JWKS serves within its TTL; in-flight sessions continue until token expiry | Tenant identity team |
| Microsoft Graph — knowledge document sites | External, tenant | High | Browsing and generation unavailable; drafts, review, assessments, and quizzes unaffected | Tenant M365 team |
| Microsoft Graph — Question Bank site | External, tenant | High | Publishing queues and resumes; **session creation fails** (retryable); in-flight sessions unaffected | Tenant M365 team |
| Anthropic Claude API | External, vendor | Medium | Generation jobs pause and resume; refreshers fall back to the approved explanation; **no learner-facing decision depends on it** | Platform team |
| Azure Container Apps | Infrastructure | Blocking | Platform unavailable | Platform team |
| Azure Database for PostgreSQL | Infrastructure | **Blocking** | Platform unavailable. RPO 15 min via PITR, RTO 4 h | Platform team |
| Azure Key Vault | Infrastructure | Blocking at startup | Startup fails fast; running instances continue on cached secrets within TTL | Platform team |
| Azure Blob Storage | Infrastructure | Low | Certificate rows still issue; rendering queues; exports queue | Platform team |
| Azure Monitor / App Insights | Infrastructure | Low | Telemetry lost; **audit is unaffected** because it is a database write in the transaction | Platform team |
| `Sites.Selected` grant per site | Tenant governance | Blocking per source | That source is inaccessible with a specific, honest diagnostic | Tenant M365 team |
| Tenant configuration values | Tenant input | Blocking per environment | Mock adapter keeps development and testing unblocked | Delivery lead |
| Anthropic data-processing decision | Tenant legal | Blocking for `prod` | Generation cannot be enabled in production until recorded | Tenant privacy owner |

---

## 7. Change control

| Change | Requires |
| --- | --- |
| Reversing an ADR | A superseding ADR stating the new decision, what changed in the context, and the migration path. The original is retained as `Superseded` |
| Changing one of the **ten design invariants** ([README.md](README.md#ten-design-invariants)) | An ADR plus explicit business sign-off. These are not implementation details |
| Adding a risk | An entry with owner, likelihood, impact, mitigation, **and detection**. A risk with no detection mechanism is not accepted into the register |
| Closing a risk | Evidence that the mitigation is in place and the detection mechanism has been observed working, not merely implemented |
| Adding an adapter conformance assertion | A contract change, reviewed as such and recorded here ([knowledge-source-adapters.md §8](knowledge-source-adapters.md#8-adapter-conformance-suite)) |
| Deprecating an MCP tool | A new tool, a deprecation note, and a removal date recorded here |
| Changing a reporting metric definition | An entry here plus a version note on the report, because published figures must remain interpretable |

The register is reviewed at each phase gate in
[implementation-roadmap.md](implementation-roadmap.md), and R-01, R-03, R-04, and R-16 are reviewed
every phase regardless of status — they are the four whose materialization would most damage the
platform's purpose.
