# KNOWZY Shared Component Inventory

**Status:** UI-M1 delivered. `packages/shared-ui`.
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

## 7. Not in UI-M1

Listed so a later milestone does not re-invent them, and so nobody looks for them now:

- `DataTable` and pagination — UI-M3, with the table the Knowledge Sources screen needs
- `Tabs` — UI-M3
- `Toast` — UI-M5, when transitions report outcomes inline
- `ApprovalGateChecklist`, `EvidenceExcerpt`, `SourceCitation`, `ConfidenceBreakdown`,
  `DuplicateRisk` — UI-M5/M6, built against the real payloads
- `ProvenanceTimeline`, `CoverageIndicator` — UI-M7
- `AssessmentCard`, `QuizProgress`, `AnswerOptionCard`, `ResultSummary`, `ProgressRing`,
  `StaleSessionNotice`, `EligibilityRefusal` — UI-M9
- `ChartCard` and any chart — UI-M2 at the earliest, and only once a real series exists

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
