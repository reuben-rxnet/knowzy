# Microsoft Entra ID Integration Plan

**Roadmap phase:** 2 — Identity and access. Recorded DONE *with the local stub issuer*; Entra itself
is the deferred half.
**Status:** NOT STARTED. `createEntraResolver()` exists and throws.
**Priority:** **first** in the Pilot Workstream. Not a preference — see §2.

---

## 1. Existing identity architecture

The architecture is complete and the seam is exactly one function.

`packages/authentication/src/subject-resolver.ts` defines a `SubjectResolver` port with two
implementations selected by environment:

```
createSubjectResolver({ environment, lookup })
        │
        ├── environment === 'local'  ──►  createStubIssuerResolver()   implemented
        └── otherwise                ──►  createEntraResolver()        THROWS
```

Four properties of the existing design that the Entra implementation must preserve, each already
enforced rather than documented:

| Property | How it is enforced today |
| --- | --- |
| **The stub issuer cannot exist outside `local`.** | `createStubIssuerResolver` **throws at construction** if `environment !== 'local'`, with `StubIssuerNotPermittedError`. Not a config check downstream — a constructor that refuses. A stub issuer reachable in a deployed environment is a total authentication bypass, so it fails closed |
| **Roles are resolved from the database, never from claims.** | ADR-011. `SubjectLookup.byIdentifier()` returns a `Subject` with roles and scopes read from Postgres. A token cannot grant a role |
| **Account status is re-checked per request.** | Requirement S5. Revoking access does not wait for a token to expire |
| **This package performs no database access.** | `SubjectLookup` is injected, so identity is testable without a database |

`createEntraResolver()` throws rather than returning `null`, and its comment says why: returning
`null` would let a deployed environment read "no authentication implemented" as "no subject", which
presents as an anonymous request rather than a misconfiguration. That is the correct choice and it
must not be softened during implementation.

---

## 2. Why this goes first

**Every non-local deployment currently fails every request.** `createSubjectResolver` picks the Entra
resolver for `dev`, `test` and `prod`, and that resolver throws. Until it is implemented:

- nothing can be demonstrated anywhere except a laptop;
- no integration built in Phases 7 or 8 can be exercised in a deployed environment;
- the pilot has no environment to be a pilot in.

This is not a sequencing preference. It is the only item in the workstream with no viable parallel
path, and it is the reason the brief's ordering (SharePoint first) has to move.

---

## 3. What to build

### 3.1 Token validation

The resolver's contract is narrow: headers in, `Subject | null` out. Validation steps, in order, all
already named in the existing comment (JWKS caching, signature, `iss`/`aud`/`exp`/`nbf`/`tid`, then
database resolution):

| # | Step | Failure behaviour |
| --- | --- | --- |
| 1 | Extract the bearer token | Absent → `null` (unauthenticated, not an error) |
| 2 | Fetch and **cache** the tenant JWKS; refresh on unknown `kid` | Refresh once per unknown `kid`, rate-limited. An unbounded refresh on every bad token is a self-inflicted denial of service |
| 3 | Verify signature | Reject |
| 4 | Verify `iss` against the tenant issuer | Reject |
| 5 | Verify `aud` against `ENTRA_API_AUDIENCE` | Reject. A token minted for another resource must not be accepted |
| 6 | Verify `tid` against `ENTRA_TENANT_ID` | Reject. Single-tenant by A-01 |
| 7 | Verify `exp` / `nbf` with a small permitted clock skew | Reject |
| 8 | Verify the scope claim is one of the two exposed scopes, appropriate to the deployable | Reject. This is what keeps the learner portal from reaching authoring |
| 9 | Resolve the `Subject` via `SubjectLookup` using the object ID | **No row → `null`, never a synthesized subject.** An authenticated principal unknown to Knowzy has no roles, and inventing one would make provisioning an authorization path |
| 10 | Re-check account status (S5) | Disabled → `null` |

Configuration already exists for every value this needs: `ENTRA_TENANT_ID`, `ENTRA_API_CLIENT_ID`,
`ENTRA_API_AUDIENCE`, all required in deployed environments and validated at startup.

### 3.2 Portal sign-in

Both portals are Next.js App Router apps where **the browser never calls the API and never holds a
subject header** — server components and server actions act as the BFF. So the token must be acquired
and held **server-side**, and the existing property that no browser code path holds a credential is a
property to preserve, not an obstacle to route around.

`ENTRA_AUTHORING_CLIENT_ID` and `ENTRA_LIVE_CLIENT_ID` are already declared browser-safe in
`isBrowserSafeVarName()` — public client IDs are not secrets. Nothing else from the identity
configuration may reach a bundle, and the startup check that forbids secret-shaped values under a
`PUBLIC_` name already enforces the general rule.

**Decision required (§6.1):** session mechanism between browser and BFF.

---

## 4. Required app registrations

Already enumerated as T-01..T-05 and consolidated in
[ENTERPRISE_PILOT_READINESS.md](ENTERPRISE_PILOT_READINESS.md) §8. Four registrations: two public
clients (one per portal), one API resource server exposing `knowzy.authoring` and `knowzy.learning`,
and the Graph credential owned by `mcp-server`.

The two separations that must survive the tenant conversation — two portals must not share one
registration, and the Graph credential must not belong to the API — are argued in §8 of that
document. Both are properties the current code already has; both would be lost quietly by
consolidating registrations for convenience.

---

## 5. Required claims

Deliberately minimal, because ADR-011 means claims are used for **identification only**:

| Claim | Used for | Required |
| --- | --- | --- |
| `oid` | The stable principal identifier joined to `User.entraObjectId` | **Yes.** The join key |
| `tid` | Tenant verification | Yes |
| `aud`, `iss`, `exp`, `nbf` | Standard validation | Yes |
| `scp` / `roles` | Scope check (step 8) — *the API scope*, not a Knowzy role | Yes |
| `preferred_username` / `upn` | Display and audit readability only | Optional |
| `groups` | Provisioning only, never authorization (T-06) | **No — see §5.1** |

### 5.1 Do not request the `groups` claim for the pilot

Three reasons:

1. **It authorizes nothing.** ADR-011 resolves roles from the database. A `groups` claim would be
   read, mapped, and then have no bearing on any decision.
2. **It is an overage hazard.** Above the claim-size limit Entra replaces group membership with an
   overage indicator requiring a Graph directory call — so the "simple" claim becomes a directory
   read plus a failure mode, for a value that authorizes nothing.
3. **It invites the wrong shortcut.** A `groups` claim in the token is a standing temptation to
   authorize from it, which would convert a database-resolved permission model into a token-resolved
   one and defeat the audit story.

**Recommendation:** omit `groups`, omit `GroupMember.Read.All`, and seed roles via T-07 bootstrap
administrator object IDs. Group-based provisioning (§6.3) can be added later without redesign
because the `Subject` already comes from the database.

---

## 6. Group mappings, role mappings, and three open decisions

### 6.1 Session mechanism between browser and BFF — required before coding

The portals hold the token server-side. Something must tie a browser to that server-side identity.

**Decision required.** Options: an encrypted HTTP-only cookie holding a session reference (server-side
session store); an encrypted cookie holding the token itself; or a signed session cookie plus
per-request silent renewal.

**Recommendation:** HTTP-only, `Secure`, `SameSite=Lax` cookie holding an **opaque session reference**,
with tokens held server-side. It keeps tokens out of the browser entirely, which is the property the
current architecture already has with the demo identity picker, and it makes sign-out revocable
server-side rather than dependent on cookie expiry.

### 6.2 Role mapping for the pilot: seed, do not map

The role catalogue is **seeded configuration and read-only in release 1** — a role change is a
deployment with a visible diff. So "role mapping" for the pilot means assigning existing Knowzy roles
to real people, not deriving roles from the directory.

**Recommendation:** for each of the seeded roles, name the pilot participants and seed
`User` + `UserRole` rows keyed on `entraObjectId` (T-07, T-08). This keeps gate 13 — separation of
duties — meaningful from day one: the pilot needs **at least two distinct real people**, one who can
author and one who can approve, or the platform's central governance control cannot be demonstrated
with real identities.

That last point deserves emphasis because it is an easy thing to discover too late: a pilot
provisioned with a single administrator account cannot exercise separation of duties at all.

### 6.3 Provisioning of user attributes — a privacy decision, not a technical one

T-08 asks which attributes may be provisioned (job title, department, business function), and
`businessFunction` participates in source restrictions. So this is a decision with an authorization
consequence even though claims do not authorize: a provisioned `businessFunction` narrows which
sources a user may read.

**Decision required from the privacy owner.** **Recommendation for the pilot:** provision nothing
automatically. Set `businessFunction` explicitly for the named pilot participants, so source
restriction is exercised without a directory read and without importing attributes whose use has not
been approved.

---

## 7. Verification

| Property | Test |
| --- | --- |
| Stub issuer refuses deployment | Constructing it with `environment: 'dev'` throws `StubIssuerNotPermittedError`. **Already tested** |
| Token for the wrong audience | Rejected |
| Token from another tenant | Rejected |
| Expired / not-yet-valid token | Rejected, with a small skew allowance |
| Learner-scope token on an authoring route | Rejected at the scope check, before any policy evaluation |
| Authenticated principal with no `User` row | `null` — no synthesized subject, and the request is unauthenticated rather than unauthorized-with-no-roles |
| Disabled account with a still-valid token | Rejected (S5) |
| Unknown `kid` | One rate-limited JWKS refresh, not a refresh per request |
| Roles come from the database | A token with a fabricated `roles` claim changes nothing about what the subject may do. **This is the ADR-011 test and it should be written as a deliberate attempt to escalate** |
| Both portals, both scopes | A real sign-in in `dev` reaching a policy-protected route in each |

The ADR-011 test is the one to write first and to mutate: it asserts a *negative* — that a claim has
no effect — and a negative assertion that is accidentally vacuous looks identical to one that holds.

---

## 8. Definition of done

Entra is done when a real person signs in to both portals in a deployed environment, every route
resolves roles from the database, the §7 tests pass including the mutated ADR-011 test, the three §6
decisions are recorded, and **two distinct real identities** can demonstrate gate 13 end to end.

It is **not** done when sign-in works. Sign-in working with roles quietly coming from claims would
pass a demo and silently delete the audit story.
