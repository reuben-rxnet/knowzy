# T-29 — Request for privacy and legal approval to use Anthropic Claude as a processor

**Document type:** Approval request. It asks for a decision; it does not record one.
**Requested from:** Privacy · Legal · Information Security · Data Governance
**Requested by:** Knowzy platform team
**Raised:** 2026-09-22
**Tenant value:** **T-29** — *"Approval to send question drafts and delimited source excerpts to
Anthropic"* ([`assumptions-and-tenant-configuration.md`](../assumptions-and-tenant-configuration.md)
§T-28–T-30)
**Assumption it resolves:** **A-05**, currently recorded as **Unconfirmed**
**Blocks:** LIVE-CLAUDE-01 — the live Claude generator
([`LIVE_CLAUDE_IMPLEMENTATION_PLAN.md`](LIVE_CLAUDE_IMPLEMENTATION_PLAN.md) §10, steps 5–6)

---

## 0. What is true today, before anything is approved

Stated first because it changes how the rest of this document should be read.

| | |
| --- | --- |
| Has any Knowzy data ever been sent to Anthropic? | **No.** |
| Is an Anthropic SDK a dependency of any workspace? | **No.** `grep` across every `package.json` returns nothing. |
| What generates questions today? | A deterministic local template engine, `packages/claude-services/src/generator.ts`. Every question in the platform records `modelId = knowzy-deterministic-local-1`. |
| Can a misconfiguration start calling Anthropic by accident? | **No.** There is no client to call with. The credential variable `ANTHROPIC_API_KEY_REF` exists and is unset, and two startup tests refuse a raw key. |
| What is being asked for? | Permission to **build and run** that client, under the conditions in §12. |

So this is a request made **before** the capability exists, not a disclosure made after it was used.
The prompt layer, the grounding checks and the audit columns were written for a model and are
exercised today by the local generator standing in for one — which is why §2 can describe the exact
payload that would be transmitted without a line of new code being written.

**If T-29 is refused, the platform still works.** Manual authoring, import of existing question
banks, review, approval, publishing, assessment, scoring and reporting are all deterministic and
unaffected. The consequence of refusal is that question *drafting* stays a template engine, which
today yields 3 accepted questions from 28 documents (§9).

---

## 1. Purpose of the Claude integration

### 1.1 What the product is for

Knowzy turns approved internal documentation — support SOPs and runbooks — into assessment
questions that a human reviews and approves, then publishes as reusable assets. The platform's
governing rules are that **human approval is required**, **nothing publishes automatically**, and
every question stays traceable to the document and the exact passage it came from.

### 1.2 The specific problem Claude is proposed to solve

The current generator is a sentence-matching template engine. It takes a declarative sentence from a
section, copies it verbatim as the correct option, and builds the three distractors by substituting
a quantity and a modal verb inside that same sentence.

Two measured consequences:

1. **Yield.** A section produces a question only if it contains a declarative sentence carrying one
   of nine rule words (`must`, `may`, `requires`, `never`, `only`, `shall`, `cannot`, …). Real
   support SOPs are imperative — *"Click Retry"*, *"Run the query"*. On the real corpus: **234
   sections, 115 assessable, 3 accepted questions, 106 recorded refusals**.
2. **Quality.** Because every distractor is a mutation of the correct answer, the correct option is
   identifiable from its form alone — it is the only one written in ordinary English. A question
   answerable without reading the source does not test the source, whatever its evidence citation
   says.

Both defects are in the generator, not in the documents and not in the platform. Claude is proposed
as a **drafting** step inside the existing governance, and nothing else.

### 1.3 What Claude would and would not decide

| Claude would | Claude would not |
| --- | --- |
| Draft candidate question text, four options, a proposed correct answer, an explanation, and cite the passage it used | Approve anything |
| Report that a section contains nothing testable | Publish anything |
| Report its own confidence, capped at 0.10 of a platform-computed composite | Decide who may see or do anything — authorization is server-side and never delegated to a model |
| — | Read the platform's database, call any tool, or retrieve any document itself (§3, §10) |

**A model's output enters the platform as a DRAFT and nothing more.** It travels the same path as a
question typed by a person or imported from a spreadsheet.

---

## 2. Data sent to Claude

### 2.1 The mechanism, so the list can be verified rather than trusted

Exactly one module builds the prompt: `packages/claude-services/src/framing.ts`, function
`frameGenerationPrompt`. It takes a typed argument object and returns the system prompt, one user
turn, a per-call nonce and an empty tool grant. **A field that is not on that argument type cannot
reach Anthropic**, because nothing else assembles a request.

The argument type, in full, as it exists in the repository:

```ts
export interface FramingArgs {
  readonly sections: readonly FramedSection[];   // sectionKey, label, text
  readonly doNotDuplicate: readonly string[];    // existing question stems
  readonly requestedQuestionCount: number;
  readonly domainName: string;
  readonly topicName: string;
  readonly nonce?: string;                       // test seam only
}
```

### 2.2 What each field contains

| Field | Content | Example (shape, not real data) |
| --- | --- | --- |
| `sections[].text` | The **normalized extracted text of a document section** — the substantive payload. Internal operational procedure written by the support team | *"A certificate must be renewed no later than thirty days before its expiry date…"* |
| `sections[].label` | The section's **heading as it appears in the document**. Never invented — extraction invariant X4 forbids synthesizing a heading | *"5. Scenario 1 - Single Order Cancellation"* |
| `sections[].sectionKey` | A 64-character SHA-256 hex digest identifying the section. Opaque; carries no file name or path | `9925ff4a…` |
| `doNotDuplicate[]` | The **stems of questions that already exist** for this material, so the model does not re-ask them. Stems only — never the options, never the answer key, never the explanation | *"Which team owns a stuck orchestration record?"* |
| `domainName`, `topicName` | Managed taxonomy labels, e.g. *"Support Operations"*, *"Escalation and Billing"* | — |
| `requestedQuestionCount` | An integer | `6` |

The system prompt is **fixed text containing no customer data**: a role sentence, the untrusted-data
statement, and six numbered rules. It is reproducible from code and pinned by hash
(`PROMPT_BODY_SHA256` in `prompt-version.ts`).

### 2.3 Volume, measured

| | |
| --- | --- |
| Pilot corpus section text | **122,106 characters ≈ 31,000 tokens** |
| One generation job over the ten selected documents | **≈ 20,000–35,000 input tokens**, a few thousand output tokens |
| Calls per job, v1 | **One** |

### 2.4 Two transformations applied before transmission

Both are in `framing.ts` and both are security controls rather than formatting:

1. **Nonce stripping.** Document text is wrapped in `<<<KNOWZY-SOURCE-{9 random bytes}>>>`
   delimiters, fresh per call, and any text in the document that matches this call's nonce is
   replaced with `[removed]` rather than trusted to be improbable.
2. **NUL stripping.** Removed with a plain string replace, deliberately not a regex, because a
   control character inside a regex literal is invisible to a reviewer.

### 2.5 The honest summary for a privacy reviewer

**What leaves the tenant is internal operational documentation plus taxonomy labels.** It is not
personal data as a category — but see §9.3 and §11 Q6, because *what is inside the SOPs* is a
question this document puts to Data Governance rather than answering.

---

## 3. Data not sent to Claude

Each row names the **mechanism** that prevents it, because a list of intentions is not a control.

| Not sent | Prevented by |
| --- | --- |
| **Any identity** — no user id, UPN, display name, email, job title, department or team | Not on `FramingArgs`. Generation reads document sections and existing stems only |
| **Any permission, role or policy context** | Not on `FramingArgs`. Authorization is server-side; `security.md` forbids delegating it |
| **Any learner data** — quiz sessions, responses, scores, results, topic performance, badges, certificates | A different bounded context entirely. No code path connects assessment data to the generator |
| **Answer keys of existing questions** | Only `doNotDuplicate` stems are passed. The learner projection that hides answer keys is a separate explicit field list (control K4) |
| **The source file name, folder path, or SharePoint URL** | `FramedSection` carries `sectionKey`, `label` and `text`. The document's name and URL are not fields on it |
| **Any local filesystem path** | Established as a rule during PILOT-T1: no local path may reach an emitted artifact, and a prompt is an emitted artifact |
| **The tenant hostname** | Content rule **C2** — no tenant hostname in source — enforced by lint |
| **Any credential or secret** | `ANTHROPIC_API_KEY_REF` accepts only `keyvault://{vault}/secrets/{name}`; content rule **C3** confines `process.env` reads to one package |
| **Database access, or any tool at all** | `GENERATION_TOOL_GRANT` is typed `readonly never[]`. The request will carry **no `tools` key at all** — asserted by test, not by convention |
| **Author free text** | No such field exists today. `security.md` control I2 anticipates optional author guidance with a 1,000-character cap **inside** the untrusted region; it is **not implemented**, and if it is added it becomes a new free-text channel that needs its own review (§11 Q7) |
| **A conversation history** | There is no transcript. Each job is a fresh single-turn call. If a repair attempt is ever built it is a fresh framed call under a new nonce, asserted non-recursive |

---

## 4. Evidence-verification controls

The control that makes model output auditable: **a question must quote its source, and the quote is
checked mechanically against the stored document text.**

### 4.1 The check

| | |
| --- | --- |
| Where | `packages/claude-services/src/evidence.ts` |
| `STRICT` mode | The span must appear as an **exact substring** of the cited section |
| `STANDARD` mode | Trigram similarity **≥ 0.95** against the cited section |
| Length bounds | **40–1,200 characters.** Below 40 is not evidence; above 1,200 is a section, not a citation |
| On failure | The candidate is **rejected**, counted on the job, and no draft is created |

### 4.2 The three points at which it is enforced

1. **At generation.** A candidate whose span does not verify never becomes a draft.
2. **At approval — gate 1 and gate 11.** Gate 1 refuses a question with no evidence; gate 11
   re-verifies the span character by character.
3. **At publication — gate 12.** The span is re-located in the *current* document text, so a
   document that changed after approval cannot carry a stale question into the bank.

### 4.3 Scope enforcement

A generation job pins the list of section keys it may use (`GenerationJob.resolvedSectionKeys`). A
candidate citing a section outside that list is rejected. **A model instructed by document content
to quote a different document therefore has nowhere to land.** Since migration `0004`, a section key
is `sha256(unscoped_key + sourceDocumentId)` — scoped per document, so a span cannot verify against
the wrong file.

### 4.4 What this does and does not prove

| Claim | Status |
| --- | --- |
| The quoted passage genuinely exists in the cited document | **Proven mechanically** |
| The question is answerable from that passage | **Human judgment.** Gates cannot establish it |
| The proposed answer is the right one | **Human judgment.** This is what review is for |

Stated plainly for the reviewers: **evidence verification prevents fabricated citations. It does not
prevent a wrong answer.** The control against a wrong answer is human approval (§5), not the gate
chain.

---

## 5. Review and approval controls

### 5.1 A model's output is a DRAFT

Model output enters as `DraftQuestion` with `status = DRAFT`. The platform's rules — **human
approval required**, **no automatic publishing** — are not policy statements in a document; they are
the absence of any code path from generation to publication.

### 5.2 The lifecycle a question must complete

```
GENERATED → DRAFT → AUTHOR_REVIEW → SUBMITTED_FOR_APPROVAL → APPROVED → PUBLISHED
```

Each step is a declared transition carrying its required permission, its comment requirement and
whether the 13 gates are evaluated. An undeclared transition does not exist, and the state machine
is asserted by test.

### 5.3 The thirteen gates

Evaluated at submit **and** re-evaluated at approval **and** again at publication — *"the gates are
re-evaluated at the moment of the write, so an approval from before a source change cannot carry a
question into the bank."* They cover missing evidence, incomplete questions, missing or duplicate
options, an invalid answer, a missing explanation, an undispositioned duplicate, evidence that no
longer verifies, and an approval that predates the current version.

### 5.4 Gate 13 — separation of duties

**The approver may not be the author or the last editor of the version being approved.** It is a
comparison of two identities, not a permission, so no role can be granted both sides of it. This was
verified end to end on 2026-09-22: an identity holding all 47 platform permissions was **refused**
when approving a question it had authored, and the same question was approved by a second identity.

For this request, the relevant consequence is: **a Claude-drafted question cannot be approved by
"the AI", nor by an automated identity acting on its behalf, nor by a single person who wears both
hats.** Two human identities are structurally required between a model's output and publication.

### 5.5 Confidence authorizes nothing

Each draft carries a composite confidence score from six weighted components. **The model's own
self-reported confidence is capped at 0.10 of that composite**, and the composite gates nothing — it
orders the review queue lowest-confidence-first. A model cannot raise its own standing.

---

## 6. Auditability

### 6.1 The properties of the audit store

| Property | Implementation |
| --- | --- |
| Append-only | No `UPDATE` or `DELETE` grant on the table for the application role (invariant I13) |
| Coupled to the state change | `transactWithAudit` — *"a transition that cannot be audited does not commit"* (U1). Asserted by an integration test that leaves no audit row when the state change fails |
| Retention | **7 years** by default, minimum 1 year, configurable upward; executed by monthly partition drop under a separate maintenance role, and the execution is itself audited |
| Closed vocabulary | Audit actions are a closed union; `detail` keys are dropped unless declared in an allow-list, and a dropped key is recorded as `_droppedKeys` rather than silently lost |

### 6.2 What a generation job records

`AUTHORING.GENERATION.JOB_COMPLETED` declares these detail keys today:

`jobStatus`, `requestedQuestionCount`, `acceptedQuestionCount`, `rejectionCounts`, `modelId`,
`inputTokenCount`, `outputTokenCount`, `providerId`, `providerVersion`, `executionMode`,
`tokenUsageReported`

Plus, on the rows themselves:

| Record | Column |
| --- | --- |
| Which model produced each question | `DraftQuestion.modelId`, and `GenerationJob.modelId` |
| Under which prompt | `promptVersionId` → an **immutable** `PromptVersion` row whose body is derived from the framing code and pinned by hash |
| Over which sections | `GenerationJob.resolvedSectionKeys` |
| What was rejected and why | `GenerationJobRejection` — reason, detail, and a candidate payload **redacted to the stem** |
| Cost | `GenerationJob.estimatedCost`, `Decimal(12,6)` — the column exists and is **not yet written** (§11 Q8) |

### 6.3 What is deliberately not stored

- **The raw model response is not persisted.** There is no column for it. Accepted candidates become
  draft rows; rejected ones are reduced to a reason and a redacted stem.
- **No prompt transcript is stored.** Reproducibility comes from the pinned section keys plus the
  immutable prompt version, not from a saved copy of the text sent.

A reviewer should read that as a deliberate minimization, and also as a limitation: **the platform
can prove which prompt version and which sections were used, not replay the exact bytes sent.**

### 6.4 Which generator ran is an audited configuration decision

The switch is a declared configuration key (`llm.activeProvider` — renamed from
`generation.generatorKind` on 2026-09-24 to keep one configuration family; same control,
same audit record), resolved through the
audited configuration layer — explicitly **not** "call Claude if a credential happens to be
present", because that would make a key rotation or a vault misconfiguration silently change which
generator produced a question.

---

## 7. Data retention assumptions

Two separate questions. The platform's own retention is **known**. Anthropic's is **assumed and
must be confirmed by Legal** — this document does not assert Anthropic's contractual terms.

### 7.1 Inside Knowzy — known

| Data | Default retention |
| --- | --- |
| `AuditEvent` | 7 years, monthly partition drop, minimum 1 year |
| `GenerationJob` + rejections | Indefinite, configurable with a floor of 2 years |
| `DraftQuestion` in `REJECTED` / `ARCHIVED` | 2 years after the terminal transition |
| Knowledge document extracted text | Retained while the source is registered — evidence re-verification years later depends on it |
| Model raw responses | **Not stored at all** |

### 7.2 At Anthropic — assumed, and the assumption is the point of this section

The build plan proceeds on these assumptions. **Each needs written confirmation before LIVE-CLAUDE-01
ships**, and any one of them being false is a reason to refuse or to re-scope:

| # | Assumption | Why it matters |
| --- | --- | --- |
| R1 | Inputs and outputs submitted through the commercial API are **not used to train models** | The corpus is internal operational documentation |
| R2 | Retention of request and response content is **limited and stated**, with a zero-retention or short-retention option available if required | Determines whether SOP text persists outside the tenant |
| R3 | The processing **region** is known and acceptable | The platform is otherwise single-tenant, single-region |
| R4 | **Sub-processors** are disclosed | Standard processor due diligence |
| R5 | A **data processing agreement** covering this use is in force or obtainable | P-3 records that this is per-provider: T-29 covers Anthropic only |
| R6 | Deletion on request is available and its mechanics are stated | Needed to answer a data-subject request that touches transmitted content |

### 7.3 What the platform will hold regardless

Even under the most restrictive retention terms, Knowzy keeps the **provenance** of every model
interaction for 7 years: which model, which prompt version, which sections, how many tokens, what
was accepted and what was rejected. Refusing retention at the processor does not create a gap in the
tenant's own accountability record.

---

## 8. User-managed versus platform-managed provider options

The platform's provider model declares two execution modes. The distinction matters to this request
because *whose entitlement is consumed* changes who the data controller is talking to.

### 8.1 The modes

| Mode | Meaning | Anthropic |
| --- | --- | --- |
| `PLATFORM_MANAGED` | The platform's own credential, from Key Vault, used for all authors | **The only supported mode** |
| `USER_MANAGED` | A delegated token for the acting author, against a resource that author is entitled to | **Not available** |

### 8.2 Why Anthropic is platform-managed only

1. **There is no on-behalf-of flow.** Anthropic offers no delegated-identity execution comparable to
   Entra OBO.
2. **A claude.ai subscription is not an API credential.** An author who "has Claude" does not have
   an API entitlement; they would have to obtain and pay for a separate one.
3. **Per-user API keys are refused in v1** for four recorded reasons: they collide with the
   `keyvault://` secret model; they make the platform custodian of personal credentials with a blast
   radius proportional to the number of authors; the label "use my own Claude" would be misleading;
   and they buy little, since the delegated providers already give genuine user-managed execution.

### 8.3 What this means for the approval being requested

**T-29 is a request about one credential and one processor relationship, held by the platform team.**
It is not a request to let individual authors send documents to Anthropic under their own accounts,
and it grants no such capability.

### 8.4 The other providers are out of scope here

A multi-provider architecture is designed but not built. **Microsoft Copilot** and **Azure OpenAI**
need their own assessments (**P-3**), and Copilot has an additional unresolved technical question
(**P-2**): it performs its own retrieval over Microsoft Graph, which either yields nothing for
grounded generation or produces questions shaped by content the author never selected. Neither is
approved or requested by this document.

---

## 9. Real SOP corpus usage

### 9.1 What the corpus is

| | |
| --- | --- |
| Location | A **locally synchronized mirror** of an approved SharePoint folder, read through a file-repository knowledge source |
| Files discovered | **29** (27 DOCX, 1 PDF, 1 CSV with no registered extractor) |
| Selectable after extraction | **28** |
| Sections extracted | **234** · assessable by length **115** |
| Characters extracted | **122,106** |
| Content | Internal support SOPs and runbooks: incident procedures, certificate renewal, printer management, order cancellation, database connection-pool exhaustion, job retriggering |

### 9.2 How access is currently enforced, stated honestly

Graph access is unavailable, so the corpus is read from a mirror produced by **one person's**
SharePoint access, and the mirroring account is recorded on the source. Consequently:

- **The corpus contains exactly what that account could see**, not what a given author is entitled
  to see.
- **Access is enforced by Knowzy, not by SharePoint.** Test Connection states this on screen rather
  than implying SharePoint permissions are being honoured.

For this request the implication is direct: **approving T-29 means approving transmission of the
mirrored content**, and Data Governance should confirm that the mirrored folder is the right scope
and that mirroring through an individual account is acceptable for the pilot.

### 9.3 A finding Data Governance should see before deciding

Reviewing the corpus for this document surfaced something material: **at least one SOP documents a
database login procedure in the form `sqlplus <user>/<password>`** — that is, a credential-shaped
string embedded in operational documentation. It also reached an imported question bank as an
answer option, because the bank was written from the SOP.

The specific value is not reproduced here. The point is structural:

- **Sending SOP text to any processor sends whatever the SOP contains**, including anything of this
  kind that nobody remembered was in there.
- Evidence verification makes this *worse* in one narrow sense: a question grounded in that sentence
  quotes it verbatim by design.
- This is a **corpus hygiene** problem that exists independently of Claude — the string is already
  in the platform's database and in the mock question bank today.

Proposed handling is in §10 (M7) and the decision is requested as **Q6**.

### 9.4 Why the real corpus, rather than synthetic documents

The workstream's deliverable is a **comparison**, not a feature: whether a model drafts better
questions than a template engine, measured on the material the product will actually be used on. A
synthetic corpus would answer a different question. If the pilot must run on sanitized or
purpose-written documents, that is a legitimate constraint and §12 offers it as a conditional
approval option — it changes what the pilot can conclude, and the team would rather say so than
discover it afterwards.

---

## 10. Mitigations

Controls already built are marked **BUILT**; controls that land with the generator in the same
milestone are **COMMITTED**.

| # | Mitigation | State |
| --- | --- | --- |
| M1 | **Untrusted-content framing.** Document text is delimited by a per-call random nonce, with an explicit system-prompt statement that content inside cannot change the rules, the schema, the role or the tool grant | **BUILT** (`framing.ts`) |
| M2 | **No tools granted.** `GENERATION_TOOL_GRANT` is typed `readonly never[]`; the request will carry no `tools` key at all, asserted by test | **BUILT** / assertion **COMMITTED** |
| M3 | **Strict output contract.** Zod `.strict()` parse; unknown fields rejected, so a response cannot smuggle structure | **BUILT** |
| M4 | **Mechanical grounding and scope enforcement.** §4 | **BUILT** |
| M5 | **Human approval with separation of duties.** §5 | **BUILT**, demonstrated 2026-09-22 |
| M6 | **Minimized payload.** No identity, no learner data, no answer keys, no file names, no paths, no hostnames, no author free text (§3) | **BUILT** — by the shape of `FramingArgs` |
| M7 | **Pre-transmission corpus screening for secrets.** A scan of section text for credential-shaped patterns before a document is eligible for model generation, with a refusal rather than a redaction, so the SOP gets fixed at source | **NOT BUILT** — proposed, see Q6 |
| M8 | **No repair loop in v1.** A malformed response is a job-level rejection. If repair is ever added it is a fresh framed call under a new nonce with no transcript, bounded to one, asserted non-recursive | **COMMITTED** |
| M9 | **Spend controls.** Per-job input-token ceiling enforced *before* the call, a daily token budget across jobs, concurrency capped at 1 for the pilot, retries only on 429/5xx with jittered backoff counting against the budget | **COMMITTED** — currently absent, and required in the same milestone |
| M10 | **Generator choice is audited configuration**, not credential presence (§6.4) | **COMMITTED** |
| M11 | **Provenance integrity.** The recorded `PromptVersion.body` is derived from the framing code and hash-pinned; the model id is constructed from the generation profile, with a test asserting the recorded id equals the configured one | **BUILT** for the prompt hash, **COMMITTED** for the per-profile construction |
| M12 | **Kill switch.** Setting `llm.activeProvider` back to `deterministic-local` stops all model calls without a deployment, and the change is audited | **COMMITTED** |
| M13 | **Identical gate chain for both generators.** No per-provider thresholds, ever, so nothing is relaxed to accommodate model output | **BUILT** and asserted |

### 10.1 Residual risks that no control removes

| Risk | Residual position |
| --- | --- |
| A document induces a question with a **wrong answer** | Nothing mechanical prevents it. Human review and gate 13 are the control, and the evaluation plan measures it |
| A model emits prompt-injection text **as question text** | Not scanned for. A reviewer sees it before approval; a cheap scan is proposed but not a blocker |
| Model output is fluent but pedagogically poor | Precisely what the pre-registered evaluation exists to measure; fluency is not correctness |
| The corpus itself contains injected content | Low today — internal SOPs authored by the support team — and rises the day uploads become user-facing |

---

## 11. Open questions requiring review

Each needs an owner's answer. **Q1–Q6 are blocking**; Q7–Q9 are decisions the team will otherwise
make by default, recorded here so they are not made silently.

| # | Question | Owner |
| --- | --- | --- |
| **Q1** | Are the §7.2 retention and training assumptions (**R1–R6**) confirmed in writing, and is a **DPA** covering this use in force or obtainable? | Legal |
| **Q2** | Is the **processing region** acceptable, given the platform is otherwise single-tenant and single-region? | Privacy + Legal |
| **Q3** | Is internal support-SOP content an acceptable **data classification** to send to an external processor at all? If only some classifications qualify, which? | Data Governance |
| **Q4** | Is a **zero-retention or short-retention** configuration required as a condition of approval, if one is available? | Privacy |
| **Q5** | Is a **DPIA** required for this processing? The platform's documentation provides the inputs — assets, data categories, retention — and explicitly does not assert that an assessment has been performed | Privacy |
| **Q6** | Given §9.3, is **corpus screening (M7) a precondition** of transmission, or is remediating the affected SOPs at source sufficient? Either answer is workable; the team needs to know which | Information Security + Data Governance |
| **Q7** | Should **author free-text guidance** (control I2, unimplemented) be permitted to reach the prompt later, or ruled out now? It would be a new uncontrolled channel into a processor request | Privacy + InfoSec |
| **Q8** | Cost recording adds `estimatedCost` to an audit detail allow-list. Any objection to **spend figures in a 7-year audit store**? | Data Governance |
| **Q9** | Is the **mirrored-folder scope** (§9.2), read through one individual's SharePoint access, acceptable for the pilot — and does approval need to name the folder? | Data Governance |

---

## 12. Requested approval

### 12.1 What is requested

Approval to transmit, to Anthropic, under a platform-held credential:

1. **Normalized text of sections of approved internal knowledge documents**, delimited as untrusted
   data;
2. **Section headings and opaque section identifiers**;
3. **Stems of existing questions**, so drafts are not duplicated;
4. **Managed taxonomy labels** (domain and topic names) and a requested question count;

for the sole purpose of **drafting candidate assessment questions**, which enter the platform as
DRAFT and require human review and approval by a second identity before publication.

### 12.2 What is explicitly not requested

- **No personal data**, and no learner assessment data of any kind.
- **No per-author API keys** and no user-managed Anthropic execution (§8.3).
- **No approval for Microsoft Copilot or Azure OpenAI** — they need their own (P-3, P-2).
- **No automated approval or publication**, now or later. That would require changing controls this
  request treats as fixed.
- **No production enablement on approval alone.** T-28 (a key in Key Vault) and T-30 (model
  selection and budgets) are separate and also required.

### 12.3 Conditions the platform team accepts as part of this request

The team proposes these as binding conditions, whether or not the reviewers impose them:

1. The **entire existing gate chain runs unmodified** for model output — no threshold moved.
2. **Human approval by a second identity** remains structurally required (gate 13 unchanged).
3. **Spend controls (M9) ship in the same milestone** as the client, not after it.
4. **The deterministic generator is never deleted**; it remains the zero-credential path and the
   comparison control.
5. **The kill switch (M12) is configuration**, so model calls can be stopped without a deployment.
6. **Provenance is derived, not asserted** (M11): a hardcoded model id or a prompt body that was
   never sent fails the test suite.
7. **The pilot is a measured comparison** against a pre-registered decision rule, not a
   demonstration.

### 12.4 Decision options

| Option | Consequence |
| --- | --- |
| **A — Approve as scoped** | LIVE-CLAUDE-01 proceeds on the real corpus under §12.3. A-05 becomes Confirmed |
| **B — Approve with conditions** (e.g. corpus screening first, zero-retention required, named folder only) | The team implements the conditions before the first call. Please state them against the Q numbers |
| **C — Approve for a sanitized or purpose-written corpus only** | Technically simple; the comparison then measures model quality on material the product is not used on, and the pilot's conclusion is weaker. §9.4 |
| **D — Refuse** | The generator stays deterministic. Every other platform capability is unaffected (§0). The team will record the refusal against A-05 and stop the workstream rather than leave it open |

### 12.5 Record of decision

| | |
| --- | --- |
| Privacy | Name · Decision · Date · Conditions |
| Legal | Name · Decision · Date · Conditions |
| Information Security | Name · Decision · Date · Conditions |
| Data Governance | Name · Decision · Date · Conditions |

On a decision, update **A-05** and **T-29** in
[`assumptions-and-tenant-configuration.md`](../assumptions-and-tenant-configuration.md) in the same
change, and record the outcome in
[`ENTERPRISE_PILOT_READINESS.md`](../project/ENTERPRISE_PILOT_READINESS.md) where T-29 is listed as a
blocker. **An approval that is not recorded against the assumption has not been captured**, because
the assumption register is what the rest of the documentation reads.

---

## 13. Traceability

Every factual claim above is drawn from the repository or its documentation, read on 2026-09-22.

| Section | Source |
| --- | --- |
| §0 current state | `packages/claude-services/src/generator.ts`; every `package.json` (no Anthropic dependency); `packages/configuration/src/env.ts`, `startup.test.ts` |
| §1 generator behaviour and yield | `generator.ts`; [`PILOT-T1-CORPUS-SELECTION.md`](PILOT-T1-CORPUS-SELECTION.md) §2, §4–5 |
| §2 payload | `packages/claude-services/src/framing.ts` (`FramingArgs`, `frameGenerationPrompt`, `sanitize`) |
| §2.3 volumes | [`PILOT-T1-CORPUS-SELECTION.md`](PILOT-T1-CORPUS-SELECTION.md) §2; [`LIVE_CLAUDE_IMPLEMENTATION_PLAN.md`](LIVE_CLAUDE_IMPLEMENTATION_PLAN.md) §6.6 |
| §3 exclusions | `framing.ts`; [`LIVE_CLAUDE_IMPLEMENTATION_PLAN.md`](LIVE_CLAUDE_IMPLEMENTATION_PLAN.md) §5.3, §7; [`MULTI_PROVIDER_GENERATION_ARCHITECTURE.md`](MULTI_PROVIDER_GENERATION_ARCHITECTURE.md) §4.3; content rules C2, C3 |
| §4 evidence | `packages/claude-services/src/evidence.ts`; `packages/domain/src/generation/generation-service.ts`; `packages/domain/src/review/gates.ts`; migration `0004_grounding_integrity` |
| §5 review and approval | `packages/domain/src/review/transitions.ts`, `gates.ts`, `separation-of-duties.ts`; verified over HTTP 2026-09-22 |
| §6 audit | `docs/audit-model.md` §6; `docs/data-model.md` §13–14; `packages/observability/src/audit.ts`; `schema.prisma` `GenerationJob`, `GenerationJobRejection`, `PromptVersion` |
| §7 retention | `docs/data-model.md` §14; `docs/security.md` §13 |
| §8 execution modes | [`MULTI_PROVIDER_GENERATION_ARCHITECTURE.md`](MULTI_PROVIDER_GENERATION_ARCHITECTURE.md) §0.2, §4.4; `packages/claude-services/src/provider.ts` |
| §9 corpus | [`PILOT-T1-CORPUS-SELECTION.md`](PILOT-T1-CORPUS-SELECTION.md) §2–3; [`TRANSITIONAL_KNOWLEDGE_SOURCE_IMPLEMENTATION.md`](TRANSITIONAL_KNOWLEDGE_SOURCE_IMPLEMENTATION.md); the platform's own `knowledge_document` rows |
| §10 mitigations | [`LIVE_CLAUDE_IMPLEMENTATION_PLAN.md`](LIVE_CLAUDE_IMPLEMENTATION_PLAN.md) §6–7; `docs/security.md` §5 |
| §11 open questions | This document; P-2 and P-3 from [`ENTERPRISE_PILOT_READINESS.md`](../project/ENTERPRISE_PILOT_READINESS.md) |
| T-28 / T-29 / T-30 / A-05 / O-01 | [`assumptions-and-tenant-configuration.md`](../assumptions-and-tenant-configuration.md) |
