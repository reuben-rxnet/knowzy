# Access Discovery Report

**Status:** Findings and analysis. Planning artifact only — no code changed.
**Discovered:** 2026-09-21, against the live tenant, by the project team with a standard user account.
**Assessed at:** commit `31cb663`
**Companion documents:** [SHAREPOINT_DISCOVERY_PLAN.md](SHAREPOINT_DISCOVERY_PLAN.md) ·
[TENANT_ADMIN_REQUESTS.md](TENANT_ADMIN_REQUESTS.md) ·
[TRANSITIONAL_KNOWLEDGE_SOURCE_PLAN.md](TRANSITIONAL_KNOWLEDGE_SOURCE_PLAN.md) ·
[ENTERPRISE_PILOT_READINESS.md](../project/ENTERPRISE_PILOT_READINESS.md)

---

## 1. Summary

| Surface | Access | Blocking? |
| --- | --- | --- |
| **Microsoft Entra** — administration | None | **Yes** — roadmap Phase 2 cannot start |
| **Microsoft Entra** — app registration | None | **Yes** — Knowzy cannot obtain an identity of its own |
| **Microsoft Graph** — authentication | Works. `/me` succeeds | No, but see §3.2: this says nothing about Knowzy |
| **Microsoft Graph** — SharePoint queries | **403** | **Yes** — roadmap Phases 7 and 8 cannot start |
| **SharePoint** — direct site access | Works, in a browser, as the signed-in user | No. This is the one productive finding |

**The headline:** every API-based integration is blocked, and it is blocked on a **consent decision**
rather than on anything the team can engineer around. But the single most valuable piece of
preparatory work turns out not to need an API at all, because it needs *documents*, and documents are
reachable in a browser today. See §5 and Step 4 in §7.

---

## 2. Entra access level: none

No administrative access and no application-registration access.

### 2.1 Direct consequence

Knowzy **has no identity in this tenant and cannot create one.** The four registrations the platform
requires (T-02 `knowzy-authoring-web`, T-03 `knowzy-live-web`, T-04 `knowzy-api`, T-15 the Graph
credential) all require either Application Developer rights or an administrator.

Roadmap Phase 2 is therefore blocked in full. That is worth stating precisely, because
`createEntraResolver()` throws: **no deployed environment can serve a single request until this is
resolved.** Local development is unaffected — the stub issuer runs with zero tenant values by
design — so the platform continues to be demonstrable on a laptop.

### 2.2 One thing worth re-checking, and why it will not help

Many tenants leave *"Users can register applications"* enabled, which would let a standard user
self-register an app without an administrator. The discovery says app registration access is absent,
so it appears disabled here.

**It is worth a single confirmation attempt, and no more than that** — because even if it were
enabled it would not unblock anything material:

- A self-registered app can be granted **user-consentable** delegated scopes only.
- **Every Graph scope that reads SharePoint content requires admin consent** (§4.2).
- So a self-registered app would reach `/me` and stop, which is exactly where the team already is.

Do not spend effort pursuing self-registration as a route to SharePoint. It is a dead end, and
knowing that is worth more than trying it.

---

## 3. Graph access level: authenticated, unauthorized for anything useful

### 3.1 What `/me` succeeding proves

- The tenant issues tokens to the client the call was made from.
- The account is active and licensed.
- Network egress to Graph works.

### 3.2 What it does not prove — and this is the important part

The token that satisfied `/me` belongs to **whatever client made the call** — almost certainly a
pre-consented Microsoft first-party application such as Graph Explorer, Azure CLI or Azure
PowerShell. `User.Read` is user-consentable, which is precisely why that call works.

**Knowzy cannot use that token.** A token is issued to an audience, and Knowzy has no app
registration, so it has no audience to be issued a token for. The finding is evidence about the
*tenant's* posture, not about the platform's readiness.

This distinction matters because "Graph authentication works" reads like progress toward integration
and is not. Nothing in the repository can authenticate to Graph today, and no amount of code changes
that.

---

## 4. SharePoint access level: two different authorization paths, one of them open

The two findings — a user can browse the sites, and Graph returns 403 — are not in tension. They are
two separate authorization systems, and only one of them is satisfied.

```
Browser → SharePoint web auth → the user's own SharePoint permissions          WORKS
Client  → Graph  → app scope + admin consent → SharePoint content             403
```

### 4.1 The 403 is a diagnosis, not a symptom

**403 means authenticated but not authorized.** Had the token been invalid, expired, or for the wrong
audience, the response would have been **401**. So the token is good and the *scope* is missing.

This is a precise and useful result: it rules out credential, tenant and network problems entirely,
and points at exactly one cause.

### 4.2 The cause, and why it is not self-serviceable

Every Microsoft Graph delegated permission that reads SharePoint site content requires **admin
consent**:

| Scope | Reads site content | Admin consent required |
| --- | --- | --- |
| `User.Read` | No | **No** — user-consentable. This is why `/me` works |
| `Sites.Read.All` | Yes | **Yes** |
| `Sites.ReadWrite.All` | Yes | **Yes** |
| `Sites.Manage.All` | Yes | **Yes** |
| `Sites.FullControl.All` | Yes | **Yes** |
| `Sites.Selected` | Yes, per granted site | **Yes** |
| `Files.Read.All` | Yes | **Yes** |

There is no user-consentable Graph scope that reads another site's content. **Therefore no Graph
SharePoint access is achievable without administrator involvement, by any route.** That is a firm
conclusion and the team should stop looking for one.

### 4.3 What remains open, and is genuinely useful

The user can open the sites in a browser, which means they can:

- **read** site, library and folder structure;
- **read** SharePoint column values on documents (the metadata Knowzy needs);
- **observe** permission state — who a document is shared with, and what is restricted;
- **download** documents.

That last capability is the one that unblocks real work, and §5 is about why.

---

## 5. What can be validated without tenant-admin support

Sorted by value, and this ordering is the substance of this report.

### 5.1 Extraction against real documents — the highest-value available work

**A gap this report found while checking the access story, and which needs correcting from the earlier
readiness assessment:** `ENTERPRISE_PILOT_READINESS.md` rated Knowledge Sources as "ready behind a
mock." That understated one thing materially. Only **three** extractors are registered — plain text,
Markdown and HTML:

```
packages/content-extraction/src/extract.ts
EXTRACTORS = { txt, text, md, markdown, html, htm, aspx }
```

`DocumentType` declares seven types. **PDF, DOCX, PPTX, XLSX and SharePoint Pages have no extractor
at all.** The code says so in a comment and is honest about it at runtime — an unregistered type
returns `UNSUPPORTED` with a reason rather than empty text, per rule X5.

Two consequences:

1. **Real corporate SharePoint content is overwhelmingly PDF, DOCX and PPTX.** Connecting Graph
   tomorrow would surface a library of documents the platform cannot read. The Phase 7 exit criterion
   *"Real PDF, DOCX, PPTX, XLSX, Pages, HTML, and TXT documents extract with offsets satisfying X2"*
   is therefore five extractors of work, not a configuration step.
2. `ExtractInput.content` is typed **`string`** — "Binary formats are not supported yet." So this is
   a **signature change** to the extraction entry point, not the "additive map entry" the comment
   suggests. That comment is accurate for text formats and optimistic for binary ones.

**None of this needs tenant admin.** It needs documents, and documents can be downloaded today.

### 5.2 A real-content fixture corpus

The mock adapter reads a fixture tree with a `{file}.meta.json` sidecar whose shape is *already* the
shape of a SharePoint discovery record:

```json
{
  "sourceVersion": "4.1",
  "sourceCreatedAt": "...", "sourceModifiedAt": "...",
  "mimeType": "text/html",
  "metadata": { "Owner": "...", "ReviewCycle": "...", "Classification": "..." },
  "access": { "default": "ALLOWED", "principals": { "user@example.com": "DENIED" } }
}
```

`metadata` is SharePoint column values. `access` carries per-principal decisions. So a real document,
plus its real column values, plus its real permission state, **maps onto a fixture without
invention** — and the mock adapter then runs the real extractors over it.

This is the mechanism that turns browser-only SharePoint access into engineering progress.

### 5.3 Claude generation and the quality spike

Blocked on **T-29** (privacy and legal approval to send drafts and delimited source excerpts to
Anthropic) and an API key — **neither of which is an IT or Entra dependency.** With §5.1 and §5.2
done, the quality comparison runs against *real corporate documents* rather than five synthetic
fixtures, which is a materially better answer to the product's central unknown.

### 5.4 The end-to-end acceptance automation

Needs no approval from anyone. Still the correct thing to build before any adapter is swapped.

### 5.5 Everything already validated

The full pipeline on mock adapters: source configuration and synchronization, document browsing,
governed generation with refusals, review, approval under separation of duties, publication with
idempotency, assessment publication with a pinned pool, scored learner attempts with resume.

### 5.6 Partially available: the Graph client

Increments 1–5 of [integration-plan-microsoft-graph.md](../project/integration-plan-microsoft-graph.md)
(token handling, paging, throttling, retry, circuit breaking, redaction) were planned as
tenant-independent. They still are — **but the evidence is weaker than planned**, because T-40
(capturing recorded Graph fixtures from a real dev site) is now blocked too. Fixtures would have to
be hand-authored from Graph's published schemas, which tests the client against *our belief* about
Graph's responses rather than against Graph's actual ones.

That is worth doing but is not the highest-value work, and the reduced confidence should be recorded
rather than glossed: a hand-authored fixture that is subtly wrong produces a client that passes its
tests and fails on first contact.

---

## 6. What cannot be validated, at all, until IT acts

| Capability | Blocked by |
| --- | --- |
| Any Knowzy-issued token; any sign-in to either portal | No app registration (T-02..T-04) |
| Any deployed environment serving any request | `createEntraResolver()` throws |
| Every Graph SharePoint call: site resolution, library discovery, item listing, content download | Admin consent (§4.2) |
| Test Connection against a real site; the nine checks | As above |
| Delta synchronization, checkpointing, invalid-token fallback | As above |
| `DELEGATED_OBO` permission trimming matching SharePoint's own | As above, plus T-39 |
| Question Bank writes; idempotency and `If-Match` against a real list | `Sites.Selected` **Write** (T-22) |
| Recorded Graph fixtures for CI | T-40 |

---

## 7. Recommendation

**Send [TENANT_ADMIN_REQUESTS.md](TENANT_ADMIN_REQUESTS.md) now.** Everything in §6 is gated on it and
nothing the team does shortens that queue.

**In parallel, build the extraction milestone (§5.1–§5.2)** — now specified as **PILOT-T1** in
[TRANSITIONAL_KNOWLEDGE_SOURCE_PLAN.md](TRANSITIONAL_KNOWLEDGE_SOURCE_PLAN.md) §7, which also settles
how the documents get in: a synced SharePoint library read through a `FILE_REPOSITORY` adapter. It is the highest-value work available
without tenant admin, it is on the Phase 7 critical path regardless of how the access conversation
goes, and it retires risk R-06 with a measurement instead of an assumption. Full recommendation and
sequencing: §7 of [SHAREPOINT_DISCOVERY_PLAN.md](SHAREPOINT_DISCOVERY_PLAN.md) and the milestone
definition in [ENTERPRISE_PILOT_READINESS.md](../project/ENTERPRISE_PILOT_READINESS.md) §10.

**One correction to carry forward:** the earlier readiness report's "ready behind a mock" rating for
Knowledge Sources was too generous. Extraction covers three text formats and none of the four binary
formats a real SharePoint library is made of. That is now the largest single piece of Phase 7 work,
and discovering it before Graph access rather than after is the most useful thing this access
investigation produced.
