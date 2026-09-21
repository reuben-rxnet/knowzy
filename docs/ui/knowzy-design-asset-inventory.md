# KNOWZY Design Asset Inventory

**Status:** Delivered. Every file in the approved pack is classified below — 82 of 82, asserted by
the generator that produced this table, so there is no "and the rest".
**Approved source:** `design/approved/knowzy_design_elements_asset_pack/` — immutable reference
material (`CLAUDE.md`). Nothing reads from it at runtime.
**Specification:** [`KNOWZY_DESIGN_ASSET_INTEGRATION_AND_UI_POLISH.md`](KNOWZY_DESIGN_ASSET_INTEGRATION_AND_UI_POLISH.md)
**Capability status:** [`full-solution-capability-matrix.md`](full-solution-capability-matrix.md)

---

## 1. Verdicts

| Verdict | Count | Share |
| --- | --- | --- |
| **DEFER** | 28 | 34% |
| **REJECT** | 22 | 27% |
| **USE** | 15 | 18% |
| **USE_AS_DECORATIVE** | 8 | 10% |
| **REQUIRES_BRAND_APPROVAL** | 7 | 9% |
| **DUPLICATE** | 2 | 2% |

The pack is a **visual library, not a feature specification** (`CLAUDE.md`). An asset existing for
Discover does not make Discover exist, so an icon for an unbuilt destination is used while the
destination stays non-navigable, and an asset whose only purpose is to display data the platform
does not hold is not used at all. That single rule accounts for most of the 28 deferrals and 22
rejections.

What each verdict means here:

| Verdict | Meaning |
| --- | --- |
| **USE** | In the applications now, as approved artwork |
| **USE_AS_DECORATIVE** | In the applications now, with an empty accessible name — it carries no information the adjacent text does not |
| **DEFER** | Approved and kept, but nothing to attach it to yet. Named against the milestone that would use it where one exists |
| **DUPLICATE** | The application already does this, and better — usually because the asset bakes in one specific value that a component computes for any value |
| **REJECT** | Would misrepresent the build: an image of an interactive control, or a picture of data the platform does not record |
| **REQUIRES_BRAND_APPROVAL** | Carries a third-party mark. Not a decision this repository can make |

---

## 2. Three construction details that decided most of the classifications

**Two thirds of the pack's "icons" are a character, not a drawing.** `stats/*` and `categories/*` are
a tinted circle plus a single Unicode glyph rendered as `<text>` in Arial — `◎`, `▣`, `!`. That
renders only where the host font carries the glyph, and in a Linux container it can come out as a
missing-character box. The application's existing icons are real paths. So those sixteen are
deferred, and the reason is recorded here rather than discovered later by someone wondering why a
dashboard shows squares.

**`navigation/*` is the opposite** — genuine line art, drawn with `fill="currentColor"`, which is why
all eleven usable ones are in. One file serves the inactive, active, hover and disabled states
because the colour comes from the surrounding text.

**Text baked into an image cannot be read, translated, or selected.** That rules out the level
badges (`beginner` … `expert`), the quote card, and `pill_planned`, whose *style* was worth adopting
even though the file was not.

---

## 3. Runtime asset strategy

The approved pack cannot be served: Next serves only from an application's own `public`, and the two
applications are separate deployables that cannot read each other's (ADR-001). The integration
specification §6 offers three strategies; this is **strategy 1 — a synchronization script with a
generated consistency check**.

```
design/approved/knowzy_design_elements_asset_pack/   immutable, never read at runtime
        │
        │  npm run assets:sync          (scripts/sync-design-assets.ts)
        ▼
apps/authoring-web/public/assets/knowzy/**           20 files
apps/live-web/public/assets/knowzy/**                 20 files
        ▲
        │  referenced only through the typed registry
        │
packages/shared-ui/src/assets/manifest.ts
```

### 3.1 How references are typed

`manifest.ts` maps a **meaning** to a **file**: `NAV_ICONS.home`, `ILLUSTRATIONS.goal`,
`BACKDROPS.wave`. The components take one of those names, never a path:

```tsx
<KnowzyNavIcon name="home" />          // compiles
<KnowzyNavIcon name="hoem" />          // does not
<KnowzyNavIcon path="../../etc/passwd" />  // no such prop
```

A path prop would accept any string, which is a traversal and an injection surface at once
(spec §8). It also means renaming an approved file is one edit, and TypeScript finds every use.

### 3.2 How a missing asset is detected

`packages/testing/contracts/design-assets.test.ts` runs in `npm run verify` and fails on all three
ways this can break:

| Fault | Caught by |
| --- | --- |
| A referenced asset was never copied | every manifest entry must exist in both applications |
| A copy was edited in place | every copy must be **byte-identical** to the approved source |
| A file lingers that nothing references | every served file must appear in the manifest |

All three were planted and confirmed to fail before this was trusted. `npm run assets:sync` repairs
any of them, including deleting the orphan.

That test is the reason copying is acceptable at all. "Do not modify the approved assets" is worth
nothing as a sentence in a document; as a byte comparison in the build it is worth something.

### 3.3 Why the four branding marks are inlined instead

They are the documented exception, and each needs a colour context an `<img>` cannot give:

- `essilorluxottica_logo.svg` is entirely `currentColor` — as an `<img>` it renders black, invisible
  on the navy header. Hard-coding white would be recolouring an approved asset.
- `knowzy_wordmark.svg` mixes `currentColor` with a literal green `ZY`. A CSS mask — the technique
  used for navigation icons — flattens everything to one colour and would lose the green that §5.1
  requires.
- `knowzy_icon.svg` carries its own three colours and is small enough that a request for it, in a
  shell every page renders, is not worth paying for.

`packages/shared-ui/src/brand-fidelity.test.ts` asserts each inlined mark still matches its approved
file — viewBox, path data, stroke widths, fills, tagline text — and that the favicon and the tile
are the same artwork. Transcribing artwork is only safe if something checks the transcription.

`favicon.svg` is served, not inlined, because that is what a favicon is; it is installed through
Next's `metadata.icons` convention.

### 3.4 Why navigation icons are CSS masks

`background-color: currentColor` behind `mask-image: url(...)`. The file stays external and
approved, the colour stays a design token, and one file covers every state. An `<img>` would render
them black; a duplicate file per state would be four files to keep in step.

The trade-off is that a mask is single-colour, so `icon_copilot.svg`'s green accent is flattened.
That is acceptable on a disabled control and is recorded here rather than left as a surprise.

---

## 4. The inventory

Route columns name where the asset is used **now**. "Available; not currently placed" means it is
synchronized and in the registry, with no implemented screen that needs it yet.

### `actions/`

| Asset | Verdict | Component | Authoring route | Learner route | Reason |
| --- | --- | --- | --- | --- | --- |
| `arrow_button.svg` | **REJECT** | — | — | — | As above. |
| `danger_button.svg` | **REJECT** | — | — | — | As above. |
| `primary_button.svg` | **REJECT** | — | — | — | A picture of a button. Integration spec §18: real interaction uses semantic controls. `Button` already carries this style. |
| `secondary_button.svg` | **REJECT** | — | — | — | As above. |
| `success_button.svg` | **REJECT** | — | — | — | As above. Its **style** was adopted: `Button` gained a `success` tone in UI-M3. |

### `avatars/`

| Asset | Verdict | Component | Authoring route | Learner route | Reason |
| --- | --- | --- | --- | --- | --- |
| `avatar_local_learner.svg` | **DUPLICATE** | — | — | — | The letters `LL` baked into a circle. `AppHeader` already computes initials for **any** identity; this asset would hard-code one persona. |
| `avatar_placeholder.svg` | **DEFER** | — | — | — | A silhouette for an unknown user. Both portals always have a selected identity, so there is no unknown-user state to fill. |

### `backgrounds/`

| Asset | Verdict | Component | Authoring route | Learner route | Reason |
| --- | --- | --- | --- | --- | --- |
| `bg_dots.svg` | **USE_AS_DECORATIVE** | `KnowzyBackdrop name="dots"` | available; not currently placed | available; not currently placed | In the registry and served; one backdrop per landing screen is enough. |
| `bg_gradient.svg` | **USE_AS_DECORATIVE** | `KnowzyBackdrop name="gradient"` | available; not currently placed | available; not currently placed | As above. |
| `bg_wave.svg` | **USE_AS_DECORATIVE** | `KnowzyBackdrop name="wave"` | `/` page hero | `/` page hero | Decorative, 25% opacity, right third, wide viewports only. No text sits on it, so it cannot affect contrast. |

### `badges/`

| Asset | Verdict | Component | Authoring route | Learner route | Reason |
| --- | --- | --- | --- | --- | --- |
| `badge_assessment_pro.svg` | **DEFER** | — | — | — | Achievement badges are excluded from this milestone and no badge is awarded by the platform. |
| `badge_continuous_learner.svg` | **DEFER** | — | — | — | As above. |
| `badge_domain_specialist.svg` | **DEFER** | — | — | — | As above. |
| `badge_growth_mindset.svg` | **DEFER** | — | — | — | As above. |
| `badge_knowledge_explorer.svg` | **DEFER** | — | — | — | As above. |
| `badge_knowledge_sharer.svg` | **DEFER** | — | — | — | As above. |
| `badge_learning_champion.svg` | **DEFER** | — | — | — | As above. |
| `badge_team_learner.svg` | **DEFER** | — | — | — | As above. |
| `level_advanced.svg` | **DEFER** | — | — | — | As above. |
| `level_beginner.svg` | **DEFER** | — | — | — | The word `beginner` is baked into the image. The platform's proficiency vocabulary is `CRITICAL_KNOWLEDGE_GAP … EXPERT`, so four of the five bands have no asset and text in an image cannot be translated or read by a screen reader. |
| `level_expert.svg` | **DEFER** | — | — | — | As above — `expert` is the one band name that coincides, which is not enough to build on. |
| `level_intermediate.svg` | **DEFER** | — | — | — | As above. |

### `branding/`

| Asset | Verdict | Component | Authoring route | Learner route | Reason |
| --- | --- | --- | --- | --- | --- |
| `essilorluxottica_logo.svg` | **USE** | `EssilorLuxotticaLogo` | every route (shell header) | every route (shell header) | Canonical corporate mark. Inlined, because it is drawn entirely with `currentColor` and an `<img>` has no colour to inherit — it would render black on the navy header. |
| `favicon.svg` | **USE** | Next `metadata.icons` | every route | every route | Served from `public/assets/knowzy/branding/`. Identical artwork to `knowzy_icon.svg`, asserted by test so the tab and the in-app mark cannot diverge. |
| `knowzy_icon.svg` | **USE** | `KnowzyMark` | available; not currently placed | available; not currently placed | The tile artwork. Inlined for the same reason as the wordmark. Left the header when the approved header mockup turned out not to include it. |
| `knowzy_wordmark.svg` | **USE** | `KnowzyWordmark` | every route (shell header) | every route (shell header) | Canonical product wordmark. Inlined: it mixes `currentColor` with a literal green `ZY`, and a CSS mask would flatten both into one colour. |

### `cards/`

| Asset | Verdict | Component | Authoring route | Learner route | Reason |
| --- | --- | --- | --- | --- | --- |
| `card_copilot_suggestion.svg` | **REJECT** | — | — | — | "Let KNOWZY Copilot suggest a personalised learning path" — a recommendation, which this milestone excludes and which no service backs. |
| `card_keep_discovering.svg` | **DEFER** | — | — | — | Marketing copy baked into an image, for a Discover capability that does not exist. |
| `card_quote.svg` | **DEFER** | — | — | — | A quotation as an image: not translatable, not selectable, not readable by a screen reader. |

### `categories/`

| Asset | Verdict | Component | Authoring route | Learner route | Reason |
| --- | --- | --- | --- | --- | --- |
| `icon_all_content.svg` | **DEFER** | — | — | — | Glyph-in-text construction, and content categories are not a concept the platform models. |
| `icon_infrastructure.svg` | **DEFER** | — | — | — | As above. The taxonomy has domains and topics, not these categories. |
| `icon_mes360.svg` | **DEFER** | — | — | — | A demonstration domain. No data associates it with anything. |
| `icon_rxnet.svg` | **DEFER** | — | — | — | As above. |
| `icon_sap.svg` | **REQUIRES_BRAND_APPROVAL** | — | — | — | A third-party mark. Using it needs approval from outside this repository. |
| `icon_service_management.svg` | **DEFER** | — | — | — | As above. |
| `icon_soft_skills.svg` | **DEFER** | — | — | — | As above. |
| `icon_visionstar.svg` | **DEFER** | — | — | — | As above. |

### `controls/`

| Asset | Verdict | Component | Authoring route | Learner route | Reason |
| --- | --- | --- | --- | --- | --- |
| `checkbox.svg` | **REJECT** | — | — | — | Spec §18 forbids using an image to simulate a checkbox. A real `<input type="checkbox">` is used. |
| `dropdown.svg` | **REJECT** | — | — | — | A real `<select>` is used. |
| `pill_planned.svg` | **DUPLICATE** | — | — | — | Its **style** was adopted in UI-M3 — the `planned` badge tone is now a soft blue pill. As an image it would put the word `Planned` beyond the reach of a screen reader. |
| `radio_checked.svg` | **REJECT** | — | — | — | As above, for radios. |
| `search_bar.svg` | **REJECT** | — | — | — | The header search is a real (disabled) `<input type="search">`. |
| `toggle.svg` | **REJECT** | — | — | — | A picture of a switch. No toggle exists in either portal, and it would be a real control if one did. |

### `course_thumbnails/`

| Asset | Verdict | Component | Authoring route | Learner route | Reason |
| --- | --- | --- | --- | --- | --- |
| `thumbnail_azure.svg` | **REQUIRES_BRAND_APPROVAL** | — | — | — | Courses are excluded from this milestone and no course model exists. Several also carry third-party marks, which would need approval from outside this repository. |
| `thumbnail_confluence.svg` | **REQUIRES_BRAND_APPROVAL** | — | — | — | Courses are excluded from this milestone and no course model exists. Several also carry third-party marks, which would need approval from outside this repository. |
| `thumbnail_leonardo.svg` | **REJECT** | — | — | — | Courses are excluded from this milestone and no course model exists. Several also carry third-party marks, which would need approval from outside this repository. |
| `thumbnail_mes360.svg` | **REJECT** | — | — | — | Courses are excluded from this milestone and no course model exists. Several also carry third-party marks, which would need approval from outside this repository. |
| `thumbnail_microsoft_learn.svg` | **REQUIRES_BRAND_APPROVAL** | — | — | — | Courses are excluded from this milestone and no course model exists. Several also carry third-party marks, which would need approval from outside this repository. |
| `thumbnail_rxnet.svg` | **REJECT** | — | — | — | Courses are excluded from this milestone and no course model exists. Several also carry third-party marks, which would need approval from outside this repository. |
| `thumbnail_sap.svg` | **REQUIRES_BRAND_APPROVAL** | — | — | — | Courses are excluded from this milestone and no course model exists. Several also carry third-party marks, which would need approval from outside this repository. |
| `thumbnail_sharepoint.svg` | **REQUIRES_BRAND_APPROVAL** | — | — | — | Courses are excluded from this milestone and no course model exists. Several also carry third-party marks, which would need approval from outside this repository. |
| `thumbnail_udemy.svg` | **REQUIRES_BRAND_APPROVAL** | — | — | — | Courses are excluded from this milestone and no course model exists. Several also carry third-party marks, which would need approval from outside this repository. |
| `thumbnail_visionstar.svg` | **REJECT** | — | — | — | Courses are excluded from this milestone and no course model exists. Several also carry third-party marks, which would need approval from outside this repository. |

### `illustrations/`

| Asset | Verdict | Component | Authoring route | Learner route | Reason |
| --- | --- | --- | --- | --- | --- |
| `illustration_goal.svg` | **USE_AS_DECORATIVE** | `KnowzyIllustration name="goal"` | — | `/results/[id]` when no knowledge gap was found | Decorative. Marks a genuinely good outcome without inventing a congratulation. |
| `illustration_growth.svg` | **USE_AS_DECORATIVE** | `KnowzyIllustration name="growth"` | available; not currently placed | available; not currently placed | In the registry and served. No implemented screen has an empty state it fits yet. |
| `illustration_idea.svg` | **USE_AS_DECORATIVE** | `KnowzyIllustration name="idea"` | `/generate` when no source is usable | — | Decorative. |
| `illustration_learning.svg` | **USE_AS_DECORATIVE** | `KnowzyIllustration name="learning"` | `/review` when a queue is empty | `/` when no assessment is published | Decorative, `alt=""`. The heading beside it carries the meaning. |
| `illustration_people.svg` | **USE_AS_DECORATIVE** | `KnowzyIllustration name="people"` | available; not currently placed | available; not currently placed | As above. |

### `navigation/`

| Asset | Verdict | Component | Authoring route | Learner route | Reason |
| --- | --- | --- | --- | --- | --- |
| `icon_assessments.svg` | **USE** | `KnowzyNavIcon name="assessments"` | — | Assessments | Learner sidebar. |
| `icon_badges.svg` | **USE** | `KnowzyNavIcon name="badges"` | — | Badges | Learner sidebar. Destination not activated — an icon is not a feature. |
| `icon_calendar.svg` | **DEFER** | — | — | — | No scheduling capability exists. Nothing to attach it to. |
| `icon_chat.svg` | **DEFER** | — | — | — | A support channel. Excluded from this milestone. |
| `icon_copilot.svg` | **USE** | `KnowzyNavIcon name="copilot"` | every route (header) | every route (header) | The KNOWZY Copilot entry point, which remains disabled and labelled Planned. |
| `icon_discover.svg` | **USE** | `KnowzyNavIcon name="discover"` | — | Discover | Learner sidebar. Destination not activated. |
| `icon_email.svg` | **DEFER** | — | — | — | A support channel. Excluded from this milestone. |
| `icon_help.svg` | **USE** | `KnowzyNavIcon name="help"` | — | Help & Support | Learner sidebar. Destination not activated. |
| `icon_home.svg` | **USE** | `KnowzyNavIcon name="home"` | — | Home | Learner sidebar. |
| `icon_library.svg` | **USE** | `KnowzyNavIcon name="library"` | — | Knowledge Library | Learner sidebar. Destination not activated. |
| `icon_my_learnings.svg` | **USE** | `KnowzyNavIcon name="myLearnings"` | — | My Learnings | Learner sidebar. The destination stays non-navigable (`REQUIRES_BACKEND_EXTENSION`); only its icon is approved artwork. |
| `icon_notification.svg` | **USE** | `KnowzyNavIcon name="notification"` | every route (header) | every route (header) | The header bell, which remains disabled and carries no count. |
| `icon_phone.svg` | **DEFER** | — | — | — | A support channel. Excluded from this milestone. |
| `icon_progress.svg` | **USE** | `KnowzyNavIcon name="progress"` | — | My Progress | Learner sidebar. Destination not activated. |
| `icon_search.svg` | **USE** | `KnowzyNavIcon name="search"` | every route (header) | every route (header) | The header search field, which remains disabled and labelled Planned. |

### `stats/`

| Asset | Verdict | Component | Authoring route | Learner route | Reason |
| --- | --- | --- | --- | --- | --- |
| `icon_average_score.svg` | **DEFER** | — | — | — | Glyph-in-text construction: the icon is the character `◎` in Arial, so it renders only if the host font has that glyph. Lucide equivalents are real paths. |
| `icon_certifications.svg` | **REJECT** | — | — | — | Certificates are excluded from this milestone, and no certification data exists. |
| `icon_courses_completed.svg` | **REJECT** | — | — | — | Courses are excluded, and there is no course model. |
| `icon_knowledge_gaps.svg` | **DEFER** | — | — | — | Same construction (`!`). The only one whose glyph is ASCII and therefore safe, but mixing one pack glyph icon into a Lucide set is worse than consistency. |
| `icon_learning_hours.svg` | **REJECT** | — | — | — | No time-on-task is recorded anywhere. |
| `icon_learning_streak.svg` | **REJECT** | — | — | — | Streaks are a gamification metric this release does not keep. |
| `icon_points_earned.svg` | **REJECT** | — | — | — | Points are not recorded. Learner §14.3 permits them only with formal approval. |
| `icon_total_badges.svg` | **REJECT** | — | — | — | Badges are excluded. |
| `progress_72.svg` | **REJECT** | — | — | — | A picture of a progress bar reading 72%. `Meter` draws real values; a static image would be a fabricated number. |

---

## 5. Where the deferred assets would land

Nothing below is built, and none of it is scheduled by this document — this is only so that the next
person does not have to re-derive it.

| Deferred set | Would be used by | Needs first |
| --- | --- | --- |
| `badges/badge_*` (8) | A recognition surface | The badge award model. Learner §14 |
| `badges/level_*` (4) | A proficiency pill | A vocabulary decision: the platform's five bands are not the pack's four levels |
| `stats/*` (9) | Reports and learner progress | The aggregate read models the matrix lists as `REQUIRES_BACKEND_EXTENSION`, and real paths instead of font glyphs |
| `categories/*` (8) | A content-category filter | A category concept. The taxonomy has domains and topics |
| `course_thumbnails/*` (10) | A catalog | A course model, plus third-party mark approval |
| `cards/card_keep_discovering`, `card_quote` | Discover | The Discover capability, and the text extracted from the image |
| `navigation/icon_chat|email|phone|calendar` | Help & Support | A support integration |
| `illustrations/growth`, `people`; `backgrounds/dots`, `gradient` | Any future empty state or hero | Nothing — they are synchronized and ready |

---

## 6. Accessibility notes

- **Navigation icons are `aria-hidden`.** Every one sits beside its own text label, so announcing it
  would repeat the label.
- **Illustrations and backdrops have an empty accessible name.** `KnowzyIllustration` takes an
  optional `label` for the case where one is genuinely informational; `KnowzyBackdrop` has no such
  option, because a backdrop that carried information would carry it only to sighted users.
- **No asset replaces a control.** Every `actions/` and `controls/` file is rejected for exactly
  that reason. The header search is a real disabled `<input type="search">`; the checkboxes are real
  checkboxes.
- **Contrast is unaffected.** Masked icons take a token colour that `contrast.test.ts` already
  checks. The one backdrop sits at 25% opacity in a region with no text on it.
- **Nothing was made worse.** The structural audit over all 14 routes still reports no findings.
