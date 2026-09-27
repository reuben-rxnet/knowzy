# AI Provider Administration

**Screen:** Administration → AI Providers (`/administration/providers`, authoring portal)
**Built:** 2026-09-26
**Migration:** `0011_ai_provider_administration`
**Authority:** [architecture.md §9.0](../architecture.md#90-provider-independence--amended-2026-09-24)
is the specification. Where this document and the code disagree, the code is right and this is
stale.
**Companion documents:** [AI_USAGE_AND_BUDGETS.md](AI_USAGE_AND_BUDGETS.md) (what a provider is
spending), [../integrations/LIVE_AI_CONTROL_LAYER.md](../integrations/LIVE_AI_CONTROL_LAYER.md)
(what stops it spending more).

---

## 1. Purpose

Configure a generation provider **through the product**, not through a deployment.

Before this, every `llm.*` value except the per-provider ceilings was read-only: a provider could
be declared, priced and budgeted, and turning one on still meant a code change, a review, and a
release. That is not a usable control for the person who owns the platform, and it is how the
first external provider would have arrived — as a configuration commit written under time
pressure, on the day a credential appeared.

What the screen answers, per provider, in one glance:

- **can this provider run a job** — and if not, which of four reasons applies
- **who decided it was legally cleared**, and on the strength of what record
- **is a credential reference recorded** — never what it is
- **what did the last readiness check find**, and when, and who ran it
- **what ceilings apply** to it

---

## 2. The four writes, and why they are four

| Write | Configuration key | Audit action | Refusals |
| --- | --- | --- | --- |
| Settings | `llm.providerSettings` | `ADMIN.CONFIGURATION.PROVIDER_UPDATED` | a pasted key; enabling an incomplete provider |
| Approval | `llm.approvedProviders` | `ADMIN.CONFIGURATION.PROVIDER_APPROVAL_CHANGED` | no reference; a provider that can never ground |
| Active provider | `llm.activeProvider` | `ADMIN.CONFIGURATION.PROVIDER_ACTIVATED` | a provider that is not `AVAILABLE` |
| Validation | *(none — its own table)* | `ADMIN.CONFIGURATION.PROVIDER_VALIDATED` | — |

They are four separate acts on purpose, and the split that matters is **settings vs approval**.

`BLOCKED_BY_APPROVAL` is the control that makes T-29 real: a credential is not authorization. If
"approved" were a checkbox beside "Enabled", it would be a checkbox somebody ticks on the way past
— and the control would exist in the code and not in the organization. So recording an approval:

- is a **separate dialog**, reached by its own button;
- **requires a reference** to where the approval is held — a document id, a ticket, a signed
  decision. A four-character minimum, refused below it, because the question asked in nine months
  is "who cleared this, and on the strength of what", and a boolean cannot answer the second half;
- is **audited with previous and new value** (H2), and the reference is retained in `detail`;
- can be **withdrawn without a reference**, because withdrawal must never be the harder action.

An approval is also refused outright for a provider that is `BLOCKED_BY_CAPABILITY`. Approving
Microsoft Copilot for grounded generation would create a durable record asserting something
untrue, and send somebody to chase a credential for a provider that can never be used.

### 2.1 `enabled` is not `approved`, and neither is "configured"

Three different facts, three different columns on the screen:

| Fact | Means | Who changes it |
| --- | --- | --- |
| **Enabled** | an administrator intends to use it | an administrator, here |
| **Approved** | a data-processing approval is recorded | an administrator, here, with a reference |
| **Client built** | a provider client exists in this build | a release |

A provider with no `enabled` decision is treated as **disabled**, not as enabled-by-default. "Not
decided" is not "on": a provider nobody turned on must not begin billing the day a credential
appears in the environment. The deterministic generator is the single exception — it is the floor
the platform always has, it costs nothing, and there is no configuration in which the platform has
no generator at all.

Enabling a provider whose endpoint, model or credential reference is missing is **refused here**,
with the missing fields named. An enabled-but-incomplete provider would be refused at generation
time instead, where the reason is much harder to find.

---

## 3. Secrets

> **Since 2026-09-27 (P-5) a reference can be RESOLVED.** §3.2 describes the Secret Resolution Layer.
> The rules in the table below still hold, with one deliberate change: a read model now returns the
> **reference** (it names a secret and is not one), and audit and change rows carry a
> **fingerprint** of it. The value itself still appears nowhere.

**The platform stores a REFERENCE to a secret. It never stores, returns, logs or displays a
secret.**

| Rule | Where it is enforced |
| --- | --- |
| The value must be `keyvault://{vault}/secrets/{name}` or `localstore://{name}` | `SecretReferenceSchema`, `packages/shared-types/src/generation-control.ts` |
| A pasted key is refused before storage | the route's `ProviderSettingsSchema.safeParse` |
| The row is marked as holding a reference | `application_configuration.is_secret_ref = true` |
| The reference is shown; the value never is | `readProviderAdministration` returns `credentialReference` and `credentialSource` since P-5; no route returns a value |
| No audit row can reconstruct it | `redact()` strips `apiKeyRef` before `previousValue`/`newValue`/`detail` are written |
| No configuration-change row holds it | the same `redact()`, applied to that row too |
| The form never shows one back | the input is write-only and starts empty, with `autocomplete="off"` |

Redaction happens at **write** time, not read time — [audit-model.md §7](../audit-model.md). That
is what makes an auditor's unscoped read safe by construction rather than by a filter somebody
could forget.

Verified on 2026-09-26 by configuring a reference through the product and then querying the store:
zero rows in `audit_event` and zero in `configuration_change` contain the string `keyvault://`.

### 3.1 The environment variables

| Variable | Deployables | Required | Note |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY_REF` | api, jobs | in deployed environments | Predates this screen |
| `OPENAI_API_KEY_REF` | api, jobs | **no** | Declared 2026-09-26 |
| `AZURE_OPENAI_KEY_REF` | api, jobs | **no** | Declared 2026-09-26 |
| `COPILOT_CLIENT_ID_REF` | api, jobs | **no** | Declared 2026-09-26 |

The three new ones are optional in **every** environment, unlike `ANTHROPIC_API_KEY_REF`. No client
for any of them exists in this build, so requiring one in a deployed environment would block a
deployment on a credential nothing can spend. They are declared now so that the day one arrives it
is validated **as a reference** — an undeclared variable is one somebody sets to a raw key.

Added 2026-09-27: `KNOWZY_LOCAL_SECRET_DIR` (api, jobs; **forbidden** outside local) names the
local secure store's directory, and `LLM_ENDPOINT_ALLOWLIST` (api, jobs; optional) adds hosts a
provider credential may be sent to. A `localstore://` value in any `*_REF` variable is refused at
startup outside the local environment.

### 3.2 The Secret Resolution Layer (P-5)

| Part | Where | What it does |
| --- | --- | --- |
| `SecretValue` | `packages/configuration/src/secrets/secret-value.ts` | Holds a value in a private field. `${v}`, `JSON.stringify`, `console.log` and `util.inspect` all print `[redacted]`; `reveal()` is the one way out |
| `SecretSourceProvider` | `…/secrets/resolver.ts` | The interface: `resolve(reference)` and `health()` |
| `LOCAL_SECURE_STORE` | `…/secrets/local-store.ts` | `store.key` (32 random bytes) and `store.json` (AES-256-GCM per entry, fresh IV, the secret's name as AAD). Local only |
| `AZURE_KEY_VAULT` | `keyVaultPlaceholderSource` | Declared; every resolution is `SOURCE_UNAVAILABLE` with the reason. Needs a managed identity and a client |
| `SecretResolver` | `createSecretResolver` | Parses the reference, enforces the environment fence, routes by scheme, never falls back, never caches, reports every resolution |
| The audit observer | `apps/api/src/secrets/platform-secrets.ts` | Writes `ADMIN.CONFIGURATION.SECRET_VALIDATED` with source, reference fingerprint, status, purpose and duration |
| The operator CLI | `npm run secrets -- init / set / remove / list / status` | The only way a secret enters the store. The value comes from a hidden prompt or stdin, never an argument |

Resolution statuses: `RESOLVED`, `NOT_FOUND`, `SOURCE_UNAVAILABLE`, `SOURCE_FORBIDDEN`,
`INVALID_REFERENCE`. Secret health (**Secret sources** on the screen,
`GET /administration/secrets`) reports per source whether it is permitted here, configured and
reachable, and how many secrets it holds — never their names.

`.secrets/` is in `.gitignore` **and** `.dockerignore`; the API container reads it at
`/repo/.secrets` through the repository mount.

Verified 2026-09-27 by `apps/api/test/provider-readiness.test.ts`: after a full configure-and-test
against a fake OpenAI, no `audit_event`, `configuration_change` or `generation_provider_validation`
row and no response body contains any fragment of the key, and no audit or change row contains a
`localstore://` reference. Mutating either the key handling or the redaction fails that suite.

---

## 4. Test connection, and the line it does not cross

> **Superseded in part on 2026-09-27 (P-5, OPENAI-CODEX-00).** The chain below was the one this
> screen shipped with. It is now nine checks and, for OpenAI, the live ones are real — see §4.1.
> The rule is unchanged: nothing is claimed that was not observed.

As first built, the button was real, the result was real, and **it did not call a provider**.

No client for any external provider exists in this build ([architecture.md §9.0](../architecture.md)),
so a validation reports the **configuration chain** — five checks in the order the platform
enforces them, each `PASSED`, `FAILED` or `NOT_ATTEMPTED`, each with a sentence:

| Check | What it establishes | What it cannot |
| --- | --- | --- |
| `CAPABILITY` | the provider performs no retrieval of its own, so a question it drafts can be grounded | — |
| `APPROVAL` | a data-processing approval is recorded | whether the approval is still current |
| `IMPLEMENTATION` | a client exists in this build | — |
| `CREDENTIAL` | a reference is recorded, and whether the platform can resolve it | whether the secret behind it is valid |
| `LIVE_CALL` | **nothing, in this build** | authentication, endpoint reachability, model availability |

The outcome has **three** values and the middle one is the normal one:

- `PASSED` — every check ran and passed. Only the deterministic provider reaches this today.
- `FAILED` — at least one check failed. The chain is conjunctive.
- `INCOMPLETE` — everything attempted passed, and something was not attempted.

There is no outcome meaning "probably fine". A result that stopped at `CREDENTIAL` and reported a
pass would be read as "authentication successful" — which nothing here has established, and which
is exactly the false assurance somebody would cite during an incident. `LIVE_CALL`'s detail says
so in words: *"authentication, endpoint reachability and model availability are UNVERIFIED — this
result does not claim them."*

`CREDENTIAL` reports `NOT_ATTEMPTED` rather than `FAILED` when a reference is recorded: this build
has no secret resolver, so whether it resolves is **unknown**, not known-bad. The difference is
what an administrator is told to go and check.

### 4.1 The chain since P-5 and OPENAI-CODEX-00

| Check | Establishes | Runs when |
| --- | --- | --- |
| `CAPABILITY` | the provider performs no retrieval of its own | always |
| `APPROVAL` | a data-processing approval is recorded | always — and it does **not** gate the checks below |
| `IMPLEMENTATION` | a client exists (for OpenAI, a readiness client) | always |
| `CONFIGURATION` | base URL, model and reference are recorded; records a settings fingerprint | always |
| `SECRET_RESOLUTION` | the reference resolved, from which source | capability, implementation and configuration passed |
| `ENDPOINT` | the allow-listed host answered, over https, in n ms | the secret resolved |
| `AUTHENTICATION` | the provider accepted the key (`GET /models` 200, or 429 = accepted and throttled) | the endpoint answered |
| `MODEL` | the configured model is available to that key (`GET /models/{model}` 200) | the key was accepted |
| `GENERATION` | always `NOT_ATTEMPTED`: a test never generates, and OpenAI cannot generate in this build | always |

**Why the approval does not gate the live checks.** They send a key and a model name and nothing
else — no prompt, document, question or person. Knowing a key works before Privacy signs off is
useful and harmless; *generating* is what the approval governs, and the registry keeps refusing
that with `BLOCKED_BY_APPROVAL`.

**What is never kept from a response:** the provider's error *message*. OpenAI's 401 body quotes a
masked form of the key; only `error.code` and `error.type` survive, and only as short identifiers.

**The outcome** is `FAILED` while no approval is recorded, and at best `INCOMPLETE` afterwards,
because `GENERATION` is never attempted. `PASSED` is reached only by the deterministic provider.

### 4.2 One row per attempt

`generation_provider_validation` records every validation, not a mutable "last validation" column
— the same reasoning that made `generation_provider_call` an attempt log in 0009. The question is
"what did it say, and has anybody checked since", and a single column answers only the first half.

Nothing in that table is a secret: `steps` records which check passed and why, never a credential,
an endpoint response or a model output. The history **survives** a settings reset, which is the
point of a log.

---

## 5. Provider state — six values, and where each is decided

| State | Decided by | Cleared by |
| --- | --- | --- |
| `BLOCKED_BY_CAPABILITY` | the registry — the provider retrieves its own context | nothing. It is permanent |
| `BLOCKED_BY_APPROVAL` | the registry — no approval recorded | recording an approval, with a reference |
| `UNAVAILABLE` | the registry — no client in this build | a release |
| `BLOCKED_BY_CONFIGURATION` | the registry — not enabled, or the credential does not resolve | an administrator, here |
| `AVAILABLE` | the registry — all of the above satisfied | — |
| `OVER_BUDGET` | **the usage read model**, not the registry | the window rolling over, or a higher ceiling |

**The order of the first five is the policy**, most permanent first, so the reason an operator
reads is the one they can least easily change. Reversing capability and approval would tell
somebody to get Copilot approved for a use it can never satisfy.

Within the configuration step, the administrator's own decision is checked **before** the
credential: "the owner turned this off" is a more useful sentence than "its credential is missing",
and it is the one that is true.

`OVER_BUDGET` is the sixth state and the only one the registry does not assign. The registry has no
database, by design (boundary rule B4), and budget consumption is a query — so it is applied by
`readAiUsage` after the registry has spoken, and only to a provider already called `AVAILABLE`. It
is **never persisted**: a stored `OVER_BUDGET` would be false the moment a window rolled over, and
a stale state in a durable table is worse than none. The `generation_provider_state` enum in
migration 0011 therefore has five members, not six.

### 5.1 Readiness — the ladder beside the gate (2026-09-27)

`ProviderState` is the **gate**: would a generation request be refused, and why. **Readiness** is
the ladder an administrator climbs, derived by `deriveReadiness` from the settings and the latest
validation — and only when that validation's settings fingerprint matches the settings in force:

| Readiness | Meaning |
| --- | --- |
| `BLOCKED_BY_CONFIGURATION` | base URL, model or reference missing; the reference did not resolve; the host is not allowed; or verified and approved but not enabled |
| `CONFIGURED` | complete; never tested, or changed since the last test |
| `RESOLVED` | the secret was read; the key was not accepted |
| `AUTHENTICATED` | the key was accepted; the model is not available |
| `BLOCKED_BY_APPROVAL` | endpoint, key and model verified; no data-processing approval |
| `UNAVAILABLE` | cannot ground, no client, endpoint unreachable, or verified, approved and enabled but this build cannot generate with it |
| `AVAILABLE` | all of the above, and it can generate — today only the deterministic provider |

Never persisted. Shown on this screen and on AI Usage & Budgets, both derived by the same function.

---

## 6. Authorization

| Action | Policy | Permission | Held by |
| --- | --- | --- | --- |
| Read the screen | `governance.ai.read` | `report.read` | Reporting User, Report Publisher, Manager, Auditor, KNOWZY Administrator |
| Every write | `governance.ai.manage` | `platform.configure` | KNOWZY Administrator |

No new policy names were minted. These are the same two authorities the AI Usage page already
separates: reading what a provider costs, and changing what it may do. A reader without
`platform.configure` sees the table with no controls and a line saying which permission is
required; an identity without `report.read` is refused the page.

---

## 7. What this screen does not do

- **Test connection does not generate.** It makes two metadata requests for OpenAI and nothing
  for any other external provider (§4.1). No test request carries a prompt. *Generation* with
  OpenAI exists since OPENAI-CODEX-01, is refused until an approval is recorded, and runs from a
  generation job, never from this screen.
- **It does not accept a key.** A key enters the local secure store through `npm run secrets` on the
  machine running the stack; there is no upload, route or form field that writes one.
- **It does not hide the providers it will not use.** Five of the six are unusable today and all
  six are listed, each with its reason. A table showing only the working one would suggest the
  others do not exist rather than that they are not built yet.
- **It does not register a stand-in.** Since OPENAI-CODEX-01, `OPENAI` is registered with a real
  **generation** client (`supportsGeneration: true`). Once approved, enabled, tested and
  credentialled it becomes AVAILABLE and can be made active. Every other external provider is
  declared, not registered.
- **It does not report a credential rotation date.** The timestamp it shows is the
  `llm.providerSettings` row's, labelled "Provider settings last changed" — nothing records when an
  individual reference changed, and a rotation date inferred from a shared row would be wrong the
  first week two providers were configured.
- **It does not set prices.** `llm.tokenPrices` remains configuration-only; a missing price makes
  a cost unobservable rather than zero, and pricing is a commercial fact rather than an operational
  one.

---

## 8. Change log

| Date | Change |
| --- | --- |
| 2026-09-26 | Built. Migration 0011, `llm.providerSettings`, four writes, five-check validation, `OVER_BUDGET` as a sixth provider state, three credential-reference environment variables declared. |
| 2026-09-27 | **P-5 and OPENAI-CODEX-00.** §3.2 the Secret Resolution Layer (local secure store, Key Vault declared, resolver, audited resolutions, `npm run secrets`); §4.1 the nine-check chain with real endpoint, authentication and model checks for OpenAI; §5.1 readiness. References are shown; values never. Five audit actions added: `SECRET_REFERENCE_CREATED`, `SECRET_REFERENCE_UPDATED`, `SECRET_VALIDATED`, `PROVIDER_ENABLED`, `PROVIDER_DISABLED`. Re-saving settings without the reference now keeps it. |
| 2026-09-27 | **OPENAI-CODEX-01.** OpenAI's readiness-only client is replaced by a generation client (see [OPENAI_CODEX_GENERATION_READINESS.md](../integrations/OPENAI_CODEX_GENERATION_READINESS.md)). Two settings: **API style** (Responses or Chat Completions) and **Auth header name** (a gateway may need its own). Readiness can now reach AVAILABLE for OpenAI. |
