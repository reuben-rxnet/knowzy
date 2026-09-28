# OpenAI Codex — Generation Readiness Review (OPENAI-CODEX-01)

**Reviewed:** 2026-09-27, against the repository at the start of OPENAI-CODEX-01, before the
generation client was written. **Outcome:** the governance chain is ready to receive a model's
proposals unchanged; **six gaps** in the plumbing around it were found and fixed in this milestone;
**two blockers** outside engineering remain, and they are why no live comparison has run.

**Scope.** OPENAI-CODEX-01 adds an OpenAI generation provider behind the existing provider
architecture. The provider **proposes** questions. It decides nothing: every proposal passes the same
gate chain as the deterministic generator's, then a person's review and a different person's
approval, and publication is unchanged. Companion documents:
[MULTI_PROVIDER_GENERATION_ARCHITECTURE.md](MULTI_PROVIDER_GENERATION_ARCHITECTURE.md),
[LIVE_CLAUDE_EVALUATION_PLAN.md](LIVE_CLAUDE_EVALUATION_PLAN.md) (the comparison protocol),
[OPENAI_CODEX_EVALUATION_RESULTS.md](OPENAI_CODEX_EVALUATION_RESULTS.md) (what was measured), and
[AI_PROVIDER_ADMINISTRATION.md](../governance/AI_PROVIDER_ADMINISTRATION.md) (secrets and readiness,
which is where the OpenAI *readiness* material requested as `OPENAI_CODEX_PROVIDER_READINESS.md`
lives — that file does not exist).

---

## 0. The two blockers, first

| # | Blocker | State on 2026-09-27 | Effect |
| --- | --- | --- | --- |
| **T-29** | Data-processing approval for sending corpus text to an external model | **Not recorded.** `llm.approvedProviders` is `["DETERMINISTIC_LOCAL"]` | The control registry refuses every OpenAI job with `PROVIDER_BLOCKED_BY_APPROVAL`, by design. No live comparison may run until it is recorded |
| **C-1** | A working OpenAI credential | **None.** Every OpenAI Test connection recorded today failed at CONFIGURATION (no base URL, model or reference saved); no request has ever been sent. The key the owner holds is a 32-character hexadecimal **gateway subscription key**, not an OpenAI key | Even with approval, nothing can be sent until the gateway's URL, auth header and API shape are known and configured |

Neither is engineering. Both are stated in the results document as the reason the OpenAI arm is
**not run**.

**Update 2026-09-28 (GATEWAY-M1) — C-1, the credential.** The approved route is now known: **Azure
OpenAI through the EssilorLuxottica API Management gateway**,
`https://dev-apim-ai.luxottica.com/codex/openai/v1`, deployment `gpt-5.3-codex_codeassist`, Responses
API, key as the `subscription-key` **query parameter**, fixed header `x-openai-supplier:
EssilorLuxottica`. Knowzy could not express that before; GATEWAY-M1 added query-parameter
authentication, fixed non-secret headers and one request builder for Test connection and generation
(see [AI_PROVIDER_ADMINISTRATION.md §4.3](../governance/AI_PROVIDER_ADMINISTRATION.md)). The host is
allow-listed on the local API service. OpenAI is configured with exactly those settings, **disabled**,
and **no approval is recorded**.

The first real Test connection, 2026-09-28 10:40 UTC. Content-free: two `GET …/models` requests,
one with the key and one without, no body:

| Check | Result | Observed |
| --- | --- | --- |
| Secret resolution | PASSED | `localstore://openai-api-key` resolved; value not recorded |
| Endpoint | PASSED | `dev-apim-ai.luxottica.com` answered over https in 721 ms — so **DNS resolves and TLS is trusted** from the API container; no `NODE_EXTRA_CA_CERTS` change is needed |
| Authentication | **NOT ATTEMPTED** | The gateway answered **404 both with and without the key**, so the comparison proves nothing: APIM matches the route before it checks the subscription |
| Model discovery | SKIPPED | The gateway exposes no `/models` route |
| Model execution | NOT ATTEMPTED | A test sends no prompt |
| Generation | NOT ATTEMPTED | — |

Readiness: **RESOLVED** (the key was read; the gateway reached; authentication unverified). Gate:
**BLOCKED_BY_APPROVAL**. **Whether the key is accepted cannot be observed without a request the
gateway routes — for this gateway, only a Responses call — and a Responses call is exactly what a
test connection may not make.** The key is first exercised by the first generation run, which T-29
governs. Nothing was retried by weakening TLS, widening the allow-list or exposing the key.

---

## 1. Component review

| # | Component | Verdict | What was checked, and what was found |
| --- | --- | --- | --- |
| 1 | **QuestionGenerator / provider port** | READY | `GenerationProvider` (`claude-services/src/provider.ts`) takes `GenerateArgs` and returns `ProviderGenerateResult` with `providerId`, `providerVersion`, `modelId`, tokens and `tokenUsageReported`. A multi-section result lists empty sections in `insufficientSections`. Nothing provider-specific is needed |
| 2 | **Prompt** | READY | `frameGenerationPrompt` (framing.ts) is provider-agnostic; its system prompt says "matching the provided schema" without naming a shape, so the structured-output schema OpenAI needs is supplied beside the prompt and **PromptVersion 1.2.0 is unchanged** — both arms use the same prompt, byte for byte |
| 3 | **Output schema** | READY, with a mapping | `GenerationOutputSchema` is a union (questions OR one insufficient result). OpenAI strict structured outputs need an object root with every field required, so the client sends `{questions[], insufficient[]}` and maps back; the platform's own schema still parses the result |
| 4 | **Provider registries** | GAP → fixed | There are **two**: the control registry (decides state inside `invokeWithControls`) and the API registry (constructs the instance a job uses). Both had to accept OpenAI. The API registry's credential check was a **static set built at startup**, which cannot see a reference configured on a screen a minute ago — replaced with a per-request check |
| 5 | **Model selection** | GAP → fixed | The job's model came only from the generation profile, whose model is `claude-sonnet-5`. An OpenAI job would have recorded the wrong model on every attempt row and priced itself against it. The route now uses the provider's configured model, and refuses before creating a job when none is set |
| 6 | **Generation pipeline — failure** | **GAP → fixed** | `runGenerationJob` recorded a control refusal and **rethrew every other error with the job left RUNNING forever**. Harmless for an in-process generator; an outage-shaped hole for a network call. A provider that breaks now ends the job `FAILED` with `AUTHORING.GENERATION.JOB_FAILED` carrying the error CLASS, never its message |
| 7 | **Retry policy** | GAP → fixed | `AbortSignal.timeout` throws `TimeoutError`, which `classifyError` did not recognise: a timeout was UNKNOWN and never retried. Now TIMEOUT, retried within `llm.maxAttempts` |
| 8 | **Malformed output** | READY, as documented | A response that does not parse is `MALFORMED_OUTPUT` and **not retried** — the tokens are spent. The documented "single repair" does not exist in code; this milestone does not add it, and the job now ends FAILED rather than RUNNING |
| 9 | **Evidence verification** | READY, unchanged | `verifyEvidence` checks every span character by character (STRICT) against the cited section; out-of-scope keys, short, long and absent spans are refused. Proven against OpenAI output: an integration test sends a verbatim span and a fabricated one — the first is accepted, the second refused `EVIDENCE_UNVERIFIED` |
| 10 | **Duplicate detection** | READY, unchanged | `assessDuplicate` blocks ≥ 0.92 and flags ≥ 0.75 against the whole corpus, including drafts accepted earlier in the same run; the do-not-duplicate list is framed into the prompt |
| 11 | **Coverage tracking** | READY, unchanged | Coverage and generation outcome stay separate fields (0004); a model refusal is recorded per section as INSUFFICIENT_EVIDENCE, never as coverage |
| 12 | **Review, approval, publication** | READY, untouched | Nothing in this milestone touches them. An accepted OpenAI proposal is a DRAFT like any other — the integration test asserts it is neither APPROVED nor PUBLISHED |
| 13 | **Filing / Department / Role** | READY, untouched | Filing is taken from the job request exactly as for the deterministic generator |
| 14 | **AI Usage & Budgets** | READY | Per-job and window budgets, concurrency and retry caps apply to OpenAI through `invokeWithControls`, which every provider goes through |
| 15 | **Token accounting** | GAP → fixed | Reported tokens are recorded with `tokenUsageReported`. The control layer's pre-call ESTIMATE was computed and discarded; migration `0014_generation_estimates` keeps it (`estimated_input_tokens` on the job and every attempt) so estimate and measurement sit side by side |
| 16 | **Cost accounting** | READY, honestly limited | Estimated cost = reported tokens × `llm.tokenPrices`. **No OpenAI price is configured**, so the cost is recorded as *not observable* rather than a guess. `measured_cost` stays NULL: OpenAI's API reports usage, not a billed amount |
| 17 | **Audit** | GAP → fixed | `JOB_FAILED`'s allow-list lacked the new keys; the first edit put them on `JOB_COMPLETED` only — the trap the neighbouring comment describes — and the dropped-keys test caught it |

---

## 2. What was built

- **`createOpenAIGenerationProvider`** (`packages/claude-services/src/openai-generation.ts`):
  - It sends the shared framed prompt and a strict JSON schema, grants no tools and sets `store: false`.
  - It supports two API styles, `RESPONSES` (default; Codex models are served only there) and `CHAT_COMPLETIONS`, and a configurable **auth header name**. The default is a Bearer token in `authorization`; a gateway can use its own header, such as `api-key` or `Ocp-Apim-Subscription-Key`.
  - The key is resolved per call through the audited Secret Resolution Layer (`SECRET_VALIDATED`, purpose `GENERATION`). It goes only to an allow-listed host, over https, with redirects refused. Only the provider's error code is kept, never its message.
  - Failures are classified for the control layer: 429 is RATE_LIMIT, 5xx is SERVER_ERROR, a timeout is TIMEOUT (all retried), and unparseable output is MALFORMED_OUTPUT (not retried).
  - It records the model OpenAI **served** (a dated snapshot), not only the alias configured.
- **The readiness-only client is retired.** OpenAI's catalogue entry now declares
  `supportsGeneration: true`. The registry still refuses OpenAI until an approval is recorded, it is
  enabled, and its credential is configured.
- **Settings:** `apiStyle` and `authHeaderName`, editable in Administration → AI Providers.
- **Provenance recorded per job and per attempt:**
  - `providerId`, `providerVersion`, `executionMode`, `promptVersionId`
  - `modelId` (served)
  - `estimatedInputTokens` (new), input and output tokens with `tokenUsageReported`
  - `estimatedCost` / `costObservable`, `measuredCost` (NULL, and why)
  - `startedAt` / `completedAt`
- **The comparison harness:** `scripts/baseline.ts --generate "<source>" --provider <id>
  --outcomes <path>`. It runs the same measured procedure for any provider and records a refusal as
  the arm's result instead of crashing. `--reset` now keeps retired drafts that carry published
  lineage and says so; before, the advice it printed ("retire them first") could never work.

---

## 3. What enabling it takes, once the blockers clear

1. **The credential.** Get the gateway's base URL, header name and API style for the key, and
   whether the key may be used by an application. Store the key with
   `npm run secrets -- set openai-api-key`, then configure OPENAI: base URL, model,
   `localstore://openai-api-key`, API style and auth header.
2. **The allow-list.** Add the gateway host to `LLM_ENDPOINT_ALLOWLIST` in the deployment. It is
   deliberately not a screen setting.
3. **A price** in `llm.tokenPrices` (e.g. `OPENAI:<model>`), or the cost is recorded as not
   observable.
4. **Test connection** must show endpoint, authentication and model PASSED.
5. **T-29.** Record the approval with its reference, then enable OpenAI.
6. **Run the comparison** per [OPENAI_CODEX_EVALUATION_RESULTS.md](OPENAI_CODEX_EVALUATION_RESULTS.md)
   §9, on a clean database as the evaluation plan requires.
