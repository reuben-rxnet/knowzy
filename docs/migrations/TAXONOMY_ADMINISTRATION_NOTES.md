# Taxonomy administration — domain and topic migration notes

**Applies to:** the taxonomy administration capability, 2026-09-22.
**Audience:** whoever deploys this, and whoever has to answer "why can I not change that code".
**Schema migration required:** **none.** Explained in §1, because that is the surprising part.

---

## 1. There is no migration, and that is a finding rather than an omission

`Domain` and `Topic` have carried every field this capability needs since migration `0001`:

| Model | Columns already present |
| --- | --- |
| `Domain` | `code` (**unique**), `name`, `description`, `isActive`, `requireSmeSignoff`, `version`, `createdByUserId`, `modifiedByUserId` |
| `Topic` | `domainId`, `name`, `slug`, `description`, `isActive`, `mergedIntoTopicId`, `version`, and the unique index `[domainId, slug]` |

So the data model was designed for managed taxonomy from the start, and what was missing was the
**write path** — no API, no policy, no screen. Nothing needed altering, nothing was backfilled, and
there is no down-migration to think about, because no column changed.

Two existing constraints do the work this capability would otherwise have had to add:

- `Domain.code` is `@unique`, so a duplicate code cannot exist even if two administrators create one
  in the same second. The service also checks first, so the refusal names the collision instead of
  surfacing a constraint violation.
- `Topic` is unique on `[domainId, slug]`, so "SAP Integration", "sap integration" and
  "SAP  Integration" are one topic. The slug is derived from the name (§3), which is what makes that
  index meaningful rather than incidental.

### 1.1 What the deployment does need

| Step | Why |
| --- | --- |
| `npm run codegen` | Three new error codes and one new audit action enter closed unions; the contract snapshot is generated. Skipping it fails `codegen:check` (G6) |
| Restart `api` | New routes |
| Restart `authoring-web` | New screen. The container does not see host edits (no inotify across the Windows bind mount) |
| No `db:migrate` | There is nothing to apply |

---

## 2. Domain notes

### 2.1 The code is the permanent part, and here is exactly how permanent

A published question id is `KNZ-{DOMAIN_CODE}-{YYYY}-{SEQ}` — `KNZ-SUPPORT_OPS-2026-000001`. Those
identifiers are written into the SharePoint Question Bank, which is **outside this platform**.
Renaming a code would orphan every identifier already issued under it, and nothing in Knowzy could
repair the ones that have left.

So the rule implemented is narrower than "immutable" and narrower than "editable":

| State of the domain | Code |
| --- | --- |
| Nothing references it — no question, no assessment, no question set | **Editable.** A typo caught before the domain is used is fixable |
| Anything references it | **Refused**, with `TAXONOMY_CODE_IMMUTABLE`, naming the counts that locked it |

**This is a deliberate reading of two rules that pull against each other** — "the domain code is
immutable" and "the domain code cannot be changed after publication". Taken literally, the first
makes a typed-wrong code permanent from the instant it is saved, and a code lives in every published
id forever, so a typo would be a permanent defect in a customer-visible identifier. The window is
therefore closed by *reference*, not by publication: a draft question is enough to lock it, because
the draft's lineage already cites the domain and its published id will carry the code.

The screen reflects this: while the code is editable it is an input with the reason; once locked it
renders as text with the count that locked it, not as a disabled input. A disabled field still looks
like something that could be enabled.

### 2.2 Display name, description and SME sign-off stay editable forever

A display name is presentation. Nothing outside the platform depends on it, and a domain that was
called "Support Ops" and should be called "Support Operations" should be correctable at any time.
Every change is audited with `changedFields`, and the before/after go in the audit row's declared
value-diff columns (H2).

### 2.3 Deactivation, never deletion

There is no delete. A domain with questions cannot be removed without destroying lineage, and
lineage is the product. `isActive: false`:

- removes it from `GET /authoring/taxonomy`, which is what every selection surface reads;
- makes `createGenerationJob` refuse it (`TAXONOMY_MISSING`), so a job cannot be created against
  taxonomy nobody may select;
- makes it unavailable as an import target;
- **changes nothing about existing questions.** A published question under a deactivated domain stays
  published, keeps its id, and stays answerable in the Live Portal.

The administration read deliberately shows deactivated rows. An administrator who cannot see a
deactivated domain cannot reactivate it, and will create a second one with a colliding code.

### 2.4 The seed is unchanged

`SUPPORT_OPS / Support Operations` and its one topic are still what a fresh database contains. The
seed is idempotent and this capability does not add rows to it: taxonomy beyond the seed is a tenant
decision, and seeding "VisionStar" for everyone would be inventing a customer's domain model.

---

## 3. Topic notes

### 3.1 The slug is derived, and it is the identity

`topicSlug(name)` lower-cases, replaces every run of non-alphanumerics with a hyphen, and trims. It
is stored in `Topic.slug`, which with `domainId` is the unique index. Consequences worth knowing
before typing:

| Typed | Slug | Therefore |
| --- | --- | --- |
| `SAP Integration` | `sap-integration` | These three are ONE topic, and the second and third are refused |
| `sap integration` | `sap-integration` | |
| `SAP  Integration` | `sap-integration` | |
| `LMS / Patient Request` | `lms-patient-request` | Punctuation is dropped, not encoded |
| `***` | — | Refused: a name must contain something sluggable |

A rename that changes the slug is checked against the domain's other topics first, and refused by
name if it would collide.

### 3.2 A topic belongs to exactly one domain, and never moves

`domainId` is set at creation and there is no path to change it. Reparenting a topic would carry
every question's lineage with it and silently rewrite what a published question claims to be about.
A topic in the wrong domain is corrected by creating it in the right one and deactivating the
original; the questions under it keep pointing where they always did.

### 3.3 A topic cannot be created in a deactivated domain

Refused with the reason. It would be a topic that no screen could ever offer.

---

## 4. Audit

| Action | When | Detail keys |
| --- | --- | --- |
| `ADMIN.TAXONOMY.DOMAIN_CREATED` | Create | `code`, `name`, `isActive` |
| `ADMIN.TAXONOMY.DOMAIN_UPDATED` | Any domain edit, including activate and deactivate | `code`, `name`, `isActive`, `changedFields` + value diff |
| `ADMIN.TAXONOMY.TOPIC_CREATED` | Create | `domainCode`, `slug`, `name`, `isActive` |
| `ADMIN.TAXONOMY.TOPIC_RENAMED` | The name changed | `domainCode`, `slug`, `name`, `previousName` + value diff |
| `ADMIN.TAXONOMY.TOPIC_UPDATED` | Description or activation changed | `domainCode`, `slug`, `name`, `isActive`, `changedFields` + value diff |

`TOPIC_UPDATED` is **new** in the closed action union (`audit-model.md` §2 now lists it). It exists
because `TOPIC_RENAMED` would be a false statement about a deactivation, and one action per field
would spread "what changed about this topic" across four vocabularies.

Every key above is declared in the allow-list in `packages/observability/src/audit.ts`. An
undeclared key is dropped and recorded as `_droppedKeys`, so the integration suite asserts the keys
are present rather than assuming.

Activation is **not** its own action. It is an update carrying `isActive` and
`changedFields: ['isActive']`, because the question a reader asks years later is "what changed about
this domain", and the answer should be in one place.

---

## 5. Codes owned by this document

Per `error-handling.md` E5, a code lives with the behaviour it describes.

| Code | Category | Status | Meaning |
| --- | --- | --- | --- |
| `TAXONOMY_DUPLICATE` | `CONFLICT` | 409 | A domain code, or a topic slug within a domain, already exists. The message names the value |
| `TAXONOMY_CODE_IMMUTABLE` | `CONFLICT` | 409 | A code change was attempted on a domain something already references. The message names the counts |
| `TAXONOMY_MAPPING_REQUIRED` | `VALIDATION` | 422 | An import names a domain or topic that does not exist. Nothing was written |

---

## 6. Import behaviour, stated as a migration concern

**An import never creates taxonomy**, and this is the rule most likely to be mistaken for a bug.

A question-bank file carries its own Domain and Topic columns, typed by hand. Before this change the
importer read those columns and then filed every question under the domain and topic chosen on the
screen, which is how a VisionStar question came to sit in Support Operations / Escalation and
Billing. Now:

| What the file says | What happens |
| --- | --- |
| A name matching an active domain code or display name, and a topic in it | Filed there. Case, spacing and `-`/`_` differences are folded |
| Nothing at all | Filed under the domain and topic selected on the screen |
| A name the platform does not hold | **The whole import is refused** with `TAXONOMY_MAPPING_REQUIRED`, naming the unmapped values and how many questions sit behind each |
| A name the importer explicitly maps in the request | Filed where they mapped it |

The refusal is whole-file rather than per-question on purpose: a bank half-filed under the right
domains and half under a dropdown's default is harder to correct than one that never landed.

**Why refusing rather than creating:** a spreadsheet typo would mint a domain code, and §2.1 is why
that cannot be taken back. `VissionStar` is one keystroke from a real domain.

### 6.1 What an operator does with an unmapped file

1. Read the **Domains and topics in this file** panel on `/import` after **Preview**. It lists every
   distinct pair the file names, with `MATCHED`, `MAPPED`, `FALLBACK` or `UNMATCHED` and the reason.
2. Create the missing domain or topic under **Administration → Knowledge Domains**, using the name
   the file uses so the next preview matches it.
3. Preview again, then **Create drafts**.

---

## 7. Authorization

| Policy | Permission | Guards |
| --- | --- | --- |
| `taxonomy.read` | `taxonomy.read` | `GET /authoring/taxonomy` (selection) and `GET /authoring/taxonomy/catalogue` (administration) |
| `taxonomy.manage` | `taxonomy.manage` | Every create and edit |

`taxonomy.manage` already existed as a permission key in the closed union and in
`access-control.md` §2 — held by `PLATFORM_ADMINISTRATOR` and by `KNOWZY_ADMINISTRATOR` — and had
nothing behind it. This change adds the policy, not the permission, so **no role gained anything**.
Reading the catalogue is `taxonomy.read` because seeing the taxonomy is not the sensitive part;
adding to it is.
