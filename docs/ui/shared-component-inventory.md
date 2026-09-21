# KNOWZY Shared Component Inventory

**Status:** UI-M1, UI-M2 and UI-M2b delivered. `packages/shared-ui`.
**Boundary:** rule **B6** — this package may import `@knowzy/shared-types` and nothing else from
the workspace. No component can reach the database, an adapter, or a domain service.
**Tokens:** [`design-tokens.md`](design-tokens.md).

---

## 1. The rules every component here obeys

1. **It renders; it does not decide.** Scoring, eligibility, gate evaluation, approval, publishing,
   and authorization stay server-side (§4.2). A component receives a decided value and displays it.
2. **It does not fetch.** No component calls an API, reads a cookie, or touches the database.
3. **Colour is never the only signal** (§5.3, §7). Status carries a label; semantic status also
   carries an icon.
4. **Only four components are client components** — `Drawer`, `Modal`, and anything that must hold
   state. Everything else is server-renderable, so adopting the design system does not turn a page
   into a client tree.
5. **No literal colour.** Asserted by `tokens.test.ts`.
6. **No fabricated data affordance.** `KpiCard` deliberately has no `delta` prop: no KPI history
   exists in the platform, so a "+6% vs last month" cannot be computed (capability matrix §5.1), and
   a component that accepted one would invite fabrication.

---

## 2. Branding

| Component | Purpose | Notes |
| --- | --- | --- |
| `EssilorLuxotticaLogo` | The corporate wordmark | Inline SVG mirroring `assets/branding/essilorluxottica-logo.svg.svg`; drawn with `currentColor` so it inherits the header's colour |
| `KnowzyWordmark` | The product wordmark, green `ZY` per §5.1 | `withTagline` adds the approved second line; the shell drops the tagline below large viewports rather than shrinking it |
| `KNOWZY_TAGLINE` | `Knowledge Today. Brighter Tomorrow.` | The approved string, for footers and heroes |

`assets/branding/` remains the master copy. The favicon is copied to each app's `public/icon.svg`
and registered through Next's `metadata.icons`. If official artwork replaces those files, it
replaces these two components and nothing else.

---

## 3. Shell

| Component | Purpose | Key behaviour |
| --- | --- | --- |
| `AppHeader` | The §8.1 global header, both portals | All five regions: brand, search, KNOWZY Copilot, notifications, identity. Search, Copilot, and notifications are **disabled and labelled** — none has a backend. Identity shows "Local Development Identity" in the local environment (§34) |
| `SideNav` | Navigation, both portals | Capability-status driven; see §4. The status chip sits **under** the label, because side by side "Administration" and "Needs backend" do not both fit and it was the label that truncated |
| `activeNavLabel` | Which single destination is active | See §4 — one highlight, never two |
| `BrandLockup` | The sidebar's People / Knowledge / Better Vision lock-up | Typeset, because the approved asset set has no such mark |
| `WorkflowRibbon` | The §11 workflow ribbon | A stage is complete **only** when the caller knows it is; future stages stay neutral. Horizontal scroll, never wrap |
| `KNOWZY_WORKFLOW_STAGES` | The seven §11 stages in order | Completion is never pre-set |
| `PageHero` | The §12 page heading band | Compact by default — §6.2 warns against heroes that eat the workspace. `titleAccent` gives the two-tone title the mockups use |
| `AuthoringShell` | Header + sidebar + ribbon + main + footer | Owns the landmark structure and the skip link |
| `LearnerShell` | Header + sidebar + main + footer | Lower density, narrower measure, no ribbon |
| `AUTHORING_NAV` | §9's destinations | See §4 |
| `LEARNER_NAV` | Learner §5.2's eight destinations | See §4 |

Both shells provide the §7 landmark set exactly once: a skip link as the first focusable element,
one `banner`, one `navigation`, one `main#main`, one `contentinfo`. A page never has to think about
any of it.

---

## 4. How navigation reflects the capability matrix

`NavItem.status` uses the capability matrix's own vocabulary, so the two cannot drift:

| Status | Rendered as | Chip |
| --- | --- | --- |
| `IMPLEMENTED` | Link | — |
| `PARTIALLY_IMPLEMENTED` | Link + a note saying where the capability lives today | note text |
| `PLANNED` | `span`, `aria-disabled` | "Planned" |
| `REQUIRES_BACKEND_EXTENSION` | `span`, `aria-disabled` | "Needs backend" |
| `DISABLED_IN_CURRENT_RELEASE` | `span`, `aria-disabled` | "Unavailable" |

An unavailable destination is never an anchor, so it cannot be a dead link (learner §5.2), and each
carries screen-reader text explaining *why* it is unavailable. Nothing is hidden: the information
architecture is itself informative.

`tokens.test.ts` asserts the invariant in both directions — an item with a destination must be
`IMPLEMENTED` or `PARTIALLY_IMPLEMENTED`, and an item without one must not be.

**Visual hiding is never the authorization control** (§9). The server refuses regardless.

### Exactly one item is ever highlighted

Two destinations can honestly point at the same route while a capability still lives there: the
learner's Home and Assessments are both `/`, and Approvals is the approval queue of `/review`.
Matching each item independently highlighted both, which put two `aria-current="page"` entries in
one list and told the user they were in two places at once.

`activeNavLabel(items, location)` therefore picks one: a matching query beats no query, a longer
path beats a shorter one, and ties go to nav order. `SideNav` highlights only that label. So
`/review` selects Review Queue, `/review?queue=approval` selects Approvals, `/review/<id>` keeps
Review Queue, and the learner root selects Home rather than the alias sitting on it.

For the query half to work the shell needs the query string, so `src/middleware.ts` puts
`pathname + search` in `x-knowzy-path`. `tokens.test.ts` sweeps every destination in both navs,
plus representative detail routes, and asserts one active label — never two.

A route no destination owns highlights nothing, which is correct rather than a gap: a learner on
`/sessions/<id>` is not on a sidebar destination.

---

## 4b. Added in UI-M2

The authoring workflow needed five things UI-M1 deliberately left out. Each is here because a
converted page needed it, not in anticipation of one.

| Component | Purpose | The rule it carries |
| --- | --- | --- |
| `Button`, `ButtonLink`, `TextLink`, `buttonClass` | §28's primary, secondary and danger buttons, plus a ghost for card headers | Minimum 44px target; never wraps; `disabled` requires `disabledReason`, so a grey control always says why |
| `DataTable`, `THead`, `TBody`, `Tr`, `Th`, `Td`, `CellNote` | The data table, as composable parts | A caption is required — it is the table's accessible name; the scroll container is focusable and labelled (§30) |
| `TabNav` | §28's tabs, for the five review queues and the six question-detail panels | **Links, not ARIA tabs.** Each view is a URL, so it must middle-click, bookmark, and work before hydration. Announcing links as tabs is the worse outcome |
| `KeyValue` | The label-and-value lists these screens are full of | A real `<dl>`, so the pairing is in the markup |
| `Field`, `FieldLabel`, `Fieldset`, `Select`, `TextInput`, `Textarea`, `CheckboxRow`, `RadioRow` | Form controls | Native elements, styled. Every control takes an `id` and every label points at it. A checkbox row is a 44px target, not a 13px box |

They are parts rather than one configured `<DataTable columns rows>` on purpose: the tables in this
product differ too much for a `columns` prop — a queue row has a two-line source cell, a gate row an
icon and a reason, a section row a monospace offset pair — and a page keeps the same semantics it
already had, including `<th scope="row">`.

Two fixes in UI-M1 components came out of using them:

- `PageHero`'s `purpose` and `secondaryText`, and `CardHeader`'s `description`, render in a `div`
  rather than a `<p>`. They accept a `ReactNode`, and a caller passing a list into a `<p>` is
  invalid HTML — which React reports as a **hydration failure** and then re-renders the whole tree
  on the client. Found by clicking through the generation flow in a real browser, not by reading.
- The state `Frame` heading is an `h2`. As an `h3` directly under the page `h1` it skipped a level
  on any page whose only content was an empty state.

---

## 4c. Added in UI-M2b

| Component | Purpose | The rule it carries |
| --- | --- | --- |
| `Meter` | A proportion as a horizontal bar (§29) | The numbers are **always** rendered as text beside the bar: no hidden denominator, and the bar adds nothing the text does not say. One `aria-label` carries the whole claim, so a screen reader hears a value rather than "graphic" |
| `BandScale` | The proficiency bands a score was judged against | Driven by the result's own `appliedThresholds`, which were copied into it at scoring time — not by current configuration, which may since have changed |
| `ApprovalGateChecklist` | §28's approval gate checklist | The rail is `aria-hidden`, because each segment's meaning is in the list below it; thirteen unlabelled cells read out individually would be worse than useless. Renders the server's advisory sentence verbatim |
| `ProvenanceTimeline` | §28's provenance timeline | A step exists **only** because a record exists. Nothing is drawn as pending or expected: the absence of an approval row is not evidence that one is coming. A step with no recorded time says nothing about when |

Neither file computes anything. The gates are re-evaluated server-side at every transition, the
bands come from the result, and a provenance step is a row that exists.

---

## 5. Primitives

| Component | Purpose |
| --- | --- |
| `Card`, `CardHeader`, `CardBody`, `CardFooter` | Every panel in both portals. `role`/`ariaLive` are forwarded so a card can be a live region |
| `KpiCard` | A metric, with `planned` for a metric with no data source. No `delta` prop, by design |
| `Badge` | The base chip: seven tones, icon by default |
| `StatusBadge` + `statusTone()` | Renders the platform's own status strings (`SUBMITTED_FOR_APPROVAL`, `PUBLISHED`, …) **verbatim**, mapped to a tone. Not prettified: a reviewer reading the UI and an audit row should read the same token |
| `StatusIndicator` | Dot plus mandatory label, for dense table rows |
| `PlannedBadge`, `AiBadge`, `RoleBadge`, `VersionBadge`, `LockedBadge`, `BlockedBadge`, `BusyBadge` | The specific badge vocabularies §28 lists |
| `Drawer` | Right-side detail panel. **Client.** Focus trap, Escape, focus restoration, `aria-modal`, scroll lock |
| `Modal` | Dialog, with a `danger` tone for destructive confirmations. **Client.** Same focus contract |

Focus handling in `Drawer` and `Modal` is written out rather than delegated to a library: the
repository has no dialog dependency, and the behaviour §7 requires — trap, Escape, restore — is
small enough to own and to read.

---

## 6. Page states

Both specifications enumerate these (§31 authoring, §21 learner). They are components so that a
refusal always looks like a refusal and always says why.

| Component | For |
| --- | --- |
| `LoadingState` | In-flight skeleton, announced via `role="status"` — a silent spinner tells a screen-reader user nothing |
| `SkeletonText` | A single pending value inside a rendered card |
| `EmptyState` | Nothing exists yet — not a failure |
| `NoResultsState` | A filter or search matched nothing — distinct from the above |
| `RefusalState` | Authorization refused. Visually distinct from an error, because a refusal is the platform working. Shows the code, which is what a user quotes when asking for access |
| `ErrorState` | Something failed, stated without a stack trace |
| `ServiceUnavailableState` | A dependency is unreachable |
| `StaleDataNotice` | On-screen data may be behind the server |
| `PlannedState` | A capability this release does not include, with what it needs first |

`PlannedState` and `PlannedBadge` exist for the milestones that need them. **UI-M1 populates no page
with them** — placeholders are permitted only where the capability matrix records the absence, and
UI-M1 ships exactly three: the disabled search box, the disabled Copilot button, and the disabled
notification button.

---

## 7. Still not built

Listed so a later milestone does not re-invent them, and so nobody looks for them now.
`DataTable`, `Tabs` (as `TabNav`), buttons, `KeyValue`, and the form controls arrived in UI-M2 —
see §4b.

- **Pagination** — not yet needed: every list in this build fits one page. It belongs with the
  first list that does not
- `ChartCard` and any donut, line or area chart — nothing in this build has a time series or a
  category breakdown to put in one. `Meter` covers the proportions that do exist
- `Toast` — a later milestone. Every transition currently reports its outcome inline, next to the
  control that caused it, which is more reliable than a message that disappears
- `ApprovalGateChecklist`, `EvidenceExcerpt`, `SourceCitation`, `ConfidenceBreakdown`,
  `DuplicateRisk` — UI-M5/M6, built against the real payloads
- `ProvenanceTimeline`, `CoverageIndicator` — UI-M7
- `AssessmentCard`, `QuizProgress`, `AnswerOptionCard`, `ResultSummary`, `ProgressRing`,
  `StaleSessionNotice`, `EligibilityRefusal` — UI-M9

The earlier UI-M1 scope listed the domain and learner components. They moved out for one reason: a
component built against an imagined payload gets rebuilt when it meets the real one. Each now lands
in the milestone that renders it, where its props can be taken from the endpoint that feeds it.

---

## 8. Using the system in an app

```tsx
// Page content only — the shell comes from the root layout.
import { Card, CardBody, CardHeader, StatusBadge } from '@knowzy/shared-ui';
```

Both apps declare `transpilePackages: ['@knowzy/shared-ui']`, and each app's `globals.css` carries

```css
@source '../../../../packages/shared-ui/src/**/*.tsx';
```

so Tailwind scans the package's **source**. Tailwind skips `node_modules`, and the package resolves
through a workspace symlink; scanning source rather than build output also means a stale `dist` can
never silently drop a class from the CSS.

After changing a component, rebuild the package (`npm run build -w @knowzy/shared-ui`) — the apps
import its compiled entry point.
