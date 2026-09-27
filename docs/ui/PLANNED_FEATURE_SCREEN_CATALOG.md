# KNOWZY — Planned Feature Screen Catalog

**Status:** live catalogue. Update it in the same commit as any preview page, or any promotion of a
preview to a real screen.
**Created:** 2026-09-27 (LIVE-PREVIEW-M2). The brief for that milestone named this file as existing;
it did not, so this is its first version.
**Applies to:** the learner portal (:3001), the authoring portal (:3000) and the SharePoint Sync
Manager (:3002).

This is the list of every navigation destination, what it opens, and — for anything not built —
the preview that stands in for it. It is **not** a capability status: that stays in
[full-solution-capability-matrix.md](full-solution-capability-matrix.md), and a preview changes
none of it.

---

## 1. What a preview is

A **preview** is a real page for an unbuilt destination, added at the product owner's request so a
stakeholder can click every area and see the intended finished product. It is held to five rules,
and each rule is enforced by something other than good intentions:

| Rule | Enforced by |
| --- | --- |
| The sidebar entry keeps its unreleased status and reads **Preview** | `NavItem.preview`; `tokens.test.ts` refuses a preview marked `IMPLEMENTED` or `PARTIALLY_IMPLEMENTED` |
| The page says it is a preview before anything else | `PreviewNotice` (a labelled `note`) directly under the hero |
| Every illustrative block is fenced and tagged on screen | `ExampleRegion`: dashed frame, visible *Illustrative example — …* tag, a **Coming in Phase 9** or **Future capability** chip |
| Nothing inside a frame is actionable | Buttons disabled with a reason (`PreviewAction`); filters in a disabled `fieldset`; no links. `previews.spec.ts` asserts all three on every page, and was checked by mutation |
| No example states a value for something the platform does not record | Every string, examples included (`ex.*`), is in `apps/live-web/src/copy.ts`, which `no-fabricated-metrics.test.ts` scans |

A real section on a preview page is drawn **outside** any frame, carries the green **Live — from
this release** tag, and reads only an existing API.

**Chip vocabulary.** *Coming in Phase 9* only where the implementation roadmap puts the capability in
Phase 9 (badges, certificates, recommendations, permission-aware knowledge search). Everything else
unbuilt — the learning catalog, paths, usage analytics, support integrations — is *Future
capability*, with its LIVE-FULL milestone named in the notice.

---

## 2. Learner portal — every destination

| # | Destination | Route | Opens | Real content | Illustrative content | Milestone that makes it real |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Home | `/` | **Working screen** | Eligible assessments, resume, start | — | Built |
| 2 | My Learnings | `/my-learnings` | **Preview** | Progress counts; assessment history (attempts used, Resume) | Active and completed learning paths, badges, a certificate | LIVE-FULL-M1, M2; Phase 9 |
| 3 | Assessments | `/` | **Working screen** (on Home in this release) | As Home | — | UI-M9 gives it its own route |
| 4 | Discover | `/discover` | **Preview** | Subjects: domains of assessments published to the learner | Search and filters, suggested topics (with reasons), trending topics, popular assessments, suggested paths | Phase 9; LIVE-FULL-M1, M3 |
| 5 | Badges | `/badges` | **Preview** | None — nothing is awarded | Categories, gallery (8 approved designs, greyed), criteria, how an award is listed (no date), progress toward a badge | Phase 9 |
| 6 | Knowledge Library | `/knowledge-library` | **Preview** | Domains published to the learner | Sources (each *Not connected*), search and filters, resources, categories and topics, a document detail | LIVE-FULL-M1, M4; Phase 9 |
| 7 | My Progress | `/my-progress` | **Preview** | Assessment completion (attempted of available) | Filters, progress by topic and by domain, competency overview (the platform's five bands), learning journey | LIVE-UI-M2; LIVE-FULL-M1, M2 |
| 8 | Help & Support | `/help` | **Preview** | User guides and FAQ describing this release | Help search, tutorials, support channels (each *Not configured*), support hours, system status | LIVE-FULL-M6 |

**The audit (2026-09-27):** all eight open with status 200 and a page heading; none reads "Needs
backend", "Placeholder" or "Coming soon"; none is a 404 or an empty page. Asserted by
`previews.spec.ts` ("every learner destination opens something").

**Never drawn, even inside a frame** — each is a figure or a commitment with nothing behind it:

- learning calendar sessions and join links (learner spec §7.5);
- a badge count, points, streak or achievement level;
- learning hours, courses completed or an average score;
- any "vs last month" or "this quarter" change;
- a learner count or a popularity rank;
- a support address, telephone number or hours;
- "All Systems Operational";
- a date on an example award.

## 3. Authoring portal — every destination

All twelve sidebar entries, and every tab under Reports, Governance and Administration, lead to
**working screens**. There is no preview in the authoring portal, and the 2026-09-27 review found no
screen reading "Needs backend", "Placeholder" or "Coming soon". Parts of three sections are not built
and have **no entry at all**, rather than an entry leading to a placeholder:

- **Governance:** the revalidation queue and reconciliation.
- **Administration:** generation profiles, thresholds, field mappings and badge definitions.
- **Reports:** most of the catalogue in `reporting.md`.

Three entries point at a screen that holds the capability today, and say so in their note: Approvals
("In the review queue"), Question Bank and Assessments ("On Publish").

## 4. SharePoint Sync Manager

One operational dashboard, by specification, with no navigation rail. Its disabled header controls
(Settings, Help, Notifications) are shown as *not available in this release*. On a phone they fold
behind **Environment and settings**.

## 5. Navigation at every width (UX-M1)

| Width | Authoring and learner portals |
| --- | --- |
| 1024 px and wider | The full sidebar |
| 768–1023 px | A collapsed icon rail, plus the menu button for the full list |
| Below 768 px | The menu button: a slide-out drawer with the same sidebar |

Specified in user guide §2.4. Tested at 390, 820 and 1440 px by `responsive-nav.spec.ts` in both
portals and `responsive.spec.ts` in the Sync Manager.

## 6. Promoting a preview

When a capability is built, its preview is **not relabelled**. Its frames are removed and the page
reads real data. Then, in the same commit:

- the sidebar item loses `preview: true` and gets its real status;
- this catalogue's row changes to *Working screen*;
- the capability matrix rows change;
- the user guide's §5.5 and §10 change.

A frame that survives on a real screen, or a real screen still wearing a Preview chip, is a defect.
