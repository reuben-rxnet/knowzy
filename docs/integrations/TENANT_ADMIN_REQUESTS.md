# Knowzy — Tenant Configuration Request

**To:** Microsoft Entra ID administrator / Microsoft 365 administrator
**From:** the Knowzy delivery team
**Date raised:** 2026-09-21
**Purpose:** everything Knowzy needs from the tenant, why, and what we are deliberately **not**
asking for.

> **This document is written to be sent as-is.** Sections 1–8 are the request. Section 9 is a form to
> return. Section 10 records what we are not asking for and why, which is offered so the scope can be
> checked rather than taken on trust.

---

## 1. What Knowzy is, in three sentences

Knowzy generates multiple-choice assessment questions from approved internal documents, requires a
human to review and approve every question before it is used, and publishes approved questions to a
SharePoint list that becomes the reusable question bank.

It **reads** knowledge documents and **writes** only to one governance list on one site.

Nothing is published automatically; every question passes a 13-check approval gate and must be
approved by someone other than its author.

## 2. What we are asking for, at a glance

| # | Request | Type | Blocking |
| --- | --- | --- | --- |
| R1 | Three app registrations (two portals, one API) | Entra | Everything |
| R2 | Admin consent for the API's own exposed scopes | Entra | Sign-in |
| R3 | One app registration for server-to-server SharePoint access, with a certificate | Entra | SharePoint |
| R4 | `Sites.Selected` application permission, admin-consented | Graph | SharePoint |
| R5 | `Sites.Selected` **Read** on named document sites | SharePoint, per site | Reading documents |
| R6 | `Sites.Selected` **Write** on one governance site only | SharePoint, one site | Publishing |
| R7 | Delegated `Sites.Read.All` **or** delegated `Sites.Selected` for interactive browsing | Graph | Per-user permission trimming |
| R8 | Tenant ID, and the IDs of everything created above | Values | Configuration |

**We can be given R1–R2 alone and make useful progress.** R3–R6 unblock SharePoint. They can be
granted in stages and we have sequenced our work to suit that.

## 3. Current state, for context

We have a standard user account and no administrative access. What we have confirmed:

| Test | Result | What it tells us |
| --- | --- | --- |
| Graph `GET /me` | **200** | Sign-in and token issuance work; the account is active |
| Graph SharePoint queries | **403** | Authenticated but not authorized — a missing consented scope, not a credential or network problem |
| SharePoint sites in a browser | **Accessible** | The user's own SharePoint permissions are fine |

We understand the 403 to mean that every Graph permission which reads SharePoint site content
requires administrator consent, and that there is no user-consentable alternative. **If that is
wrong, please tell us — it would change our plan considerably.**

---

## 4. R1 — Application registrations

Three registrations. We are asking for three rather than one for a specific reason given under each.

### 4.1 `knowzy-authoring-web`

| Field | Value |
| --- | --- |
| Type | Public client / SPA — authorization code with PKCE |
| Purpose | The portal where staff configure sources, review and approve questions |
| Graph permissions | `User.Read` (delegated) only |
| API permissions | The `knowzy.authoring` scope exposed by `knowzy-api` (§4.3) |
| Redirect URIs | §6 |

### 4.2 `knowzy-live-web`

| Field | Value |
| --- | --- |
| Type | Public client / SPA — authorization code with PKCE |
| Purpose | The portal where staff take assessments |
| Graph permissions | `User.Read` (delegated) only |
| API permissions | The `knowzy.learning` scope exposed by `knowzy-api` (§4.3) |
| Redirect URIs | §6 |

> **Why two registrations and not one.** The learner portal must be unable to obtain an authoring
> scope. With two registrations that is a token boundary enforced by Entra. With one registration it
> becomes a check in our own code, which is a weaker guarantee and one we would rather not be trusted
> with.

### 4.3 `knowzy-api`

| Field | Value |
| --- | --- |
| Type | Confidential client / resource server (web API) |
| Purpose | Validates tokens from both portals; holds no Graph permissions of its own |
| Application ID URI | `api://{client-id}` is fine, or your tenant's convention |
| **Exposed scopes** | `knowzy.authoring` and `knowzy.learning` — two delegated scopes, admin-consent |
| Graph permissions | **None** |

**R2:** admin consent for these two exposed scopes, granted to the two portal registrations. Neither
portal can call the API until this is done.

### 4.4 Certificates and secrets

`knowzy-api` needs a credential to validate tokens; a **certificate is preferred over a client
secret** wherever your tenant supports it. We store only a Key Vault reference in configuration —
never a secret value — and our configuration layer rejects a literal secret by schema validation.

---

## 5. R3–R7 — SharePoint access

### 5.1 R3 — the SharePoint service registration

| Field | Value |
| --- | --- |
| Suggested name | `knowzy-sharepoint-connector` |
| Type | Confidential client, **certificate credential preferred** |
| Used by | One internal service only (our MCP service). Not reachable from any browser |
| Purpose | Background document synchronization, and writing approved questions to the question bank |

> **Why this is separate from `knowzy-api`.** The credential that reaches SharePoint is readable only
> by the background service, not by the process that handles browser requests. Our configuration
> enforces this: the SharePoint credential is declared as available to that one service and no other.
> Combining the two registrations would remove that separation silently.

### 5.2 R4 — the Graph application permission

| Permission | Type | Consent |
| --- | --- | --- |
| `Sites.Selected` | Application | Admin consent required |

`Sites.Selected` grants **no access to anything** until a specific site is granted individually. That
is why we are asking for it rather than for a tenant-wide alternative — see §10.

### 5.3 R5 — Read on document sites

For each site listed in §9.3, a `Sites.Selected` **Read** grant to `knowzy-sharepoint-connector`.

Typically applied per site with `Grant-PnPAzureADAppSitePermission` or the equivalent Graph call on
`/sites/{site-id}/permissions`. We are happy to supply the exact site IDs once we can resolve them,
or to work from the URLs in §9.3.

### 5.4 R6 — Write on the governance site only

One site, one `Sites.Selected` **Write** grant.

> **This must be a different site from every document site.** Knowledge documents are read-only to
> Knowzy, and we would like that to be true because of how the grants are scoped rather than because
> of how our code behaves. Please do not grant Write on a document site even if it would be
> convenient.

The question bank is a single SharePoint list on that site. §9.4 asks whether we may create it or
must adopt an existing one.

### 5.5 R7 — Delegated access for interactive browsing

When a member of staff browses documents in the portal, we would like them to see **exactly what
SharePoint would show them** and nothing more. That requires a delegated (on-behalf-of) permission:
either `Sites.Read.All` (delegated) or delegated `Sites.Selected`, whichever your tenant prefers.

**This is the one request where we would welcome your guidance.** If delegated access is not
something you grant, we can operate without it — document visibility is then filtered by our own
role, domain, team and business-function rules, and the interface states plainly that trimming is
enforced by Knowzy rather than by SharePoint. That is a workable but genuinely weaker position, and
we would rather ask than assume.

---

## 6. Redirect URIs

Both portals are server-rendered web applications. Tokens are held **server-side**; no token is ever
placed in browser storage.

| Environment | `knowzy-authoring-web` | `knowzy-live-web` |
| --- | --- | --- |
| Local development | `http://localhost:3000/auth/callback` | `http://localhost:3001/auth/callback` |
| Dev | `https://{authoring-host}/auth/callback` | `https://{live-host}/auth/callback` |
| Test | `https://{authoring-host}/auth/callback` | `https://{live-host}/auth/callback` |
| Production | `https://{authoring-host}/auth/callback` | `https://{live-host}/auth/callback` |

Notes, offered so you can hold us to them:

- Only the two `localhost` URIs use `http`. Every deployed URI is `https`.
- Front-channel logout: `/auth/logout` on the same hosts, if your tenant requires it registered.
- **The callback path is our proposal and is not yet implemented**, so if your tenant has a
  convention we will adopt it. Please tell us and we will build to it rather than asking you to
  accommodate us.
- Deployed hostnames are not yet allocated. We can either return them before you create the
  registrations, or you can create them with the `localhost` URIs and add the rest later —
  whichever suits your process.

---

## 7. Permissions summary, in one table

| Registration | Permission | Type | Scope | Admin consent |
| --- | --- | --- | --- | --- |
| `knowzy-authoring-web` | `User.Read` | Delegated | — | No |
| `knowzy-authoring-web` | `knowzy.authoring` | Delegated (our API) | — | **Yes** |
| `knowzy-live-web` | `User.Read` | Delegated | — | No |
| `knowzy-live-web` | `knowzy.learning` | Delegated (our API) | — | **Yes** |
| `knowzy-api` | none | — | — | — |
| `knowzy-sharepoint-connector` | `Sites.Selected` | **Application** | Per site, §9.3 | **Yes** |
| `knowzy-sharepoint-connector` | Read grant | Site permission | Each document site | Per site |
| `knowzy-sharepoint-connector` | Write grant | Site permission | **One** governance site | One site |
| `knowzy-sharepoint-connector` | `Sites.Read.All` *or* delegated `Sites.Selected` | Delegated | §5.5 | **Yes**, if granted |

## 8. Staging

You can grant this in three independent stages. We have sequenced our work so each stage is useful on
its own.

| Stage | Grants | What it unblocks |
| --- | --- | --- |
| **1** | R1, R2, R8 | Sign-in for both portals; a working deployed environment. **Nothing works outside a laptop until this is done** |
| **2** | R3, R4, R5, R7 | Reading real documents; synchronization; permission trimming |
| **3** | R6 | Publishing approved questions to the question bank |

**Stage 1 is the one we would ask you to prioritise**, and it involves no SharePoint access at all.

---

## 9. Values to return

### 9.1 Tenant

| # | Value | Please provide |
| --- | --- | --- |
| T-01 | Entra tenant ID (GUID) | |
| T-09 | SharePoint tenant hostname, e.g. `contoso.sharepoint.com` | |

### 9.2 Registrations

| Registration | Client ID (GUID) | Object ID | Notes |
| --- | --- | --- | --- |
| `knowzy-authoring-web` | | | |
| `knowzy-live-web` | | | |
| `knowzy-api` | | | Also: Application ID URI |
| `knowzy-sharepoint-connector` | | | Also: certificate thumbprint or Key Vault location |

| Value | Please provide |
| --- | --- |
| `knowzy-api` Application ID URI | |
| Exposed scope names as registered | |
| Admin consent granted for the exposed scopes? | Yes / No |

### 9.3 Document sites — Read grants

| # | Site URL | Read granted? | Granted on |
| --- | --- | --- | --- |
| 1 | | | |
| 2 | | | |
| 3 | | | |

> We will supply the final site list from our discovery work. It will be **two to four folders across
> one or two sites** for the pilot — deliberately small.

### 9.4 Governance site — Write grant

| Value | Please provide |
| --- | --- |
| T-21 Governance site URL (must differ from every site above) | |
| T-22 Write granted? | Yes / No |
| T-23 May Knowzy create the list, or must an existing list be adopted? | Create / Adopt |
| T-24 If adopting: list title, and its **actual internal column names** | |
| T-25 Will people hold write access to this list directly? | Yes / No |
| T-26 Can list versioning and a unique `QuestionID` constraint be enabled? | Yes / No |

Notes on the last three: if we are adopting an existing list we support legacy `field_n` internal
column names and will generate a mapping profile for them — we just need the real names. If people
will edit the list by hand, that is fine and we will detect the drift rather than prevent it; we
would simply like to know. Versioning and the unique constraint are recommendations, not
requirements, and their absence produces a warning rather than a failure.

### 9.5 Anything you would like from us

| Question | Our answer |
| --- | --- |
| Conditional Access policies we must satisfy? | Please tell us and we will comply |
| A naming convention for registrations? | Ours are suggestions; we will adopt yours |
| A required redirect URI convention? | See §6 — we will build to yours |
| A review or security assessment we should enter? | Please point us at it |

---

## 10. What we are **not** asking for

Offered so the scope can be checked rather than trusted.

| Not requested | Why we do not need it |
| --- | --- |
| `Sites.Read.All` **application** permission | Would grant read access to **every site in the tenant**. `Sites.Selected` grants nothing until you name a site, so the blast radius is a record you control |
| `Sites.FullControl.All`, `Sites.Manage.All` | Knowzy never creates, moves or deletes a site or library |
| `Files.ReadWrite.All` | Knowzy never writes to a document library. Ever |
| Any write permission on a knowledge document site | Source documents are read-only to the platform, and we would like the grants to be the reason |
| `Directory.Read.All`, `GroupMember.Read.All` | Knowzy resolves user roles from its **own database**, not from directory group membership or token claims. Role assignment is an explicit, audited action inside Knowzy. We do not need to read your directory |
| `User.ReadWrite.All`, or any user-write permission | Knowzy never modifies a user object |
| A delete capability on the question bank | Our SharePoint write interface **has no delete method** — retirement marks an item inactive and leaves it in place. This is enforced in our code by the absence of the operation, not by policy |
| Global Administrator, Application Administrator, or any standing privileged role for our team | We need grants, not roles. We are not asking to be administrators |

**If `Sites.Read.All` is offered as being simpler to grant than per-site `Sites.Selected`:** it is
simpler, and we would rather not have it. Per-site grants mean that if our service is ever
compromised, the exposure is the sites you named rather than everything.

---

## 11. Questions we expect, answered in advance

**Does content leave the tenant?** Only if you approve it separately. Question drafting may use
Anthropic's Claude API, which would send document excerpts and draft questions outside the tenant.
That approval is a **separate decision by your privacy and legal owners** and is not part of this
request. Knowzy runs fully without it, using a local deterministic generator, and every other
capability is unaffected.

**Where do documents get stored?** Document text is extracted and stored in Knowzy's own database for
indexing and evidence verification. Raw file bytes are streamed to the extractor and **never
persisted**. Approved question content is stored in the SharePoint list you own.

**Can Knowzy see documents a user cannot?** Background synchronization uses the application identity
and therefore discovers more than any individual can see. Visibility is re-evaluated against the
signed-in user at read time; discovery does not confer access. With R7 granted, that re-evaluation is
SharePoint's own decision.

**What happens if we grant nothing?** Knowzy continues to run against mock adapters on a developer
machine. It cannot be deployed, because our identity layer deliberately fails closed rather than
running without authentication.

**Who do we contact?** The Knowzy delivery team, via the channel this document arrived on.

---

## Appendix — internal traceability

Not part of the request. Maps this document to the project's own registers.

| This document | Internal reference |
| --- | --- |
| R1, §4 | T-02, T-03, T-04 |
| R2, §4.3 | T-05 |
| R3, §5.1 | T-15 |
| R4–R5, §5.2–5.3 | T-16, A-03 |
| R6, §5.4 | T-21, T-22, A-03 |
| R7, §5.5 | T-14, R-03 |
| §6 | Pending the session decision in [integration-plan-entra-id.md](../project/integration-plan-entra-id.md) §6.1 |
| §9.1 | T-01, T-09 |
| §9.3 | T-10, T-16 |
| §9.4 | T-21..T-27 |
| §10 directory row | ADR-011, and the recommendation in integration-plan-entra-id.md §5.1 |
| §11 Claude row | A-05, T-29 |
| Staging §8 | [ENTERPRISE_PILOT_READINESS.md](../project/ENTERPRISE_PILOT_READINESS.md) §10 |

Not in this request, because they are not the Entra administrator's to give: **T-07** bootstrap
administrator object IDs and **T-08** provisionable attributes (business owners); **T-28/T-29**
Anthropic key and approval (platform team, privacy, legal); **T-39** a document restricted from a
named test principal, and **T-40** permission to capture and scrub recorded Graph fixtures — both to
be raised with the SharePoint site owner once §9.3 is settled.
