# KNOWZY Design Tokens

**Status:** Implemented in UI-M1; contrast corrected and made testable in UI-M3.
**Source of truth:** `packages/shared-ui/src/tokens.css` — this document describes that file and
does not duplicate its values as a second authority.
**Specification:** [`KNOWZY_UI_SOURCE_OF_TRUTH.md`](KNOWZY_UI_SOURCE_OF_TRUTH.md) §5 (brand), §6
(visual style), §7 (accessibility).

---

## 1. How the tokens work

Tailwind v4 is CSS-first: a `@theme` block declares CSS custom properties **and** generates the
matching utilities. So one declaration serves both:

```css
@theme {
  --color-brand-green: #00b388;
}
```

gives you `bg-brand-green`, `text-brand-green`, `border-brand-green`, `ring-brand-green`, and
`var(--color-brand-green)` for the cases a utility cannot express.

That is why the tokens are written as theme variables rather than as a plain `:root` block. The
alternative — a variable set plus a separate Tailwind config naming the same colours — is two lists
that drift.

**Rules, both enforced by `packages/shared-ui/src/tokens.test.ts`:**

1. No component file contains a literal colour. The only exception is `Brand.tsx`, whose fills are
   part of the approved SVG artwork rather than of the theme.
2. The seven §5.2 brand values are asserted exactly. A tidy-up that nudged one would be invisible in
   review and wrong on every screen.

---

## 2. Colour

### 2.1 Brand — §5.2, verbatim

| Token | Value | §5.2 role |
| --- | --- | --- |
| `--color-brand-navy` | `#001E62` | Top header, product identity, primary headings |
| `--color-brand-green` | `#00B388` | Primary actions, approval, healthy states, progress, selected navigation |
| `--color-brand-navy-text` | `#08245C` | Headings, body emphasis, primary readable text |
| `--color-brand-blue` | `#146EF5` | Links, information, knowledge, secondary actions |
| `--color-brand-ai` | `#6B4EFF` | AI-generated content, recommendations, KNOWZY Copilot |
| `--color-brand-canvas` | `#F5F8FC` | Application canvas, secondary surfaces |
| `--color-brand-surface` | `#FFFFFF` | Cards, tables, panels, dialogs |

### 2.2 Neutrals

Derived from the navy so greys read as part of the brand rather than as a separate family.

| Token | Use | Contrast (white · sunken) |
| --- | --- | --- |
| `--color-ink` | Body text | 17.0:1 on white · 15.3:1 on sunken |
| `--color-ink-muted` | Secondary text | 7.4:1 · 6.7:1 |
| `--color-ink-subtle` | Hints, chips, captions | 5.2:1 · 4.7:1 |
| `--color-line` | Default border | — |
| `--color-line-strong` | Emphasised border | — |
| `--color-surface-sunken` | A panel inside a panel, table headers | — |
| `--color-surface-hover` | Row and item hover | — |

Anything below 4.5:1 is a border or a background in this system, never text.

### 2.3 Semantic — §5.3

Each has a **text-safe** shade for words on white and a **soft** shade for fills.

| Meaning | Text token | Fill token |
| --- | --- | --- |
| Success, approval | `--color-success` | `--color-success-soft` |
| Information, knowledge | `--color-info` | `--color-info-soft` |
| AI | `--color-ai` | `--color-ai-soft` |
| Warning, partial attention | `--color-warning` | `--color-warning-soft` |
| Error, rejection, failed gate, critical risk | `--color-danger` | `--color-danger-soft` |
| Neutral | `--color-neutral` | `--color-neutral-soft` |

> §5.3: **do not rely on colour alone.** Every badge in the system renders a label, and the semantic
> ones render an icon. A failed approval gate reads as failed in greyscale, in a screen reader, and
> to a colour-blind approver.

### 2.4 Where each colour may be used, and why

Every ratio in this document is **computed** by `packages/shared-ui/src/contrast.test.ts` against
`tokens.css`. UI-M1 wrote these figures in by hand and got one wrong; the test exists because of
that, and it fails the build rather than the review.

Two rules fall out of the arithmetic:

**Brand green `#00B388` never touches a light surface.** It is 2.69:1 on white — below AA for text
at any size, below the 3:1 a state indicator needs (1.4.11), and it cannot carry white text either
(also 2.69:1). On the navy header it is 5.7:1, which is why the green rule, the wordmark's `ZY`, and
nothing else use it. Everywhere else green appears — the active navigation border, the active tab
underline, a completed workflow stage, the sidebar lock-up, a hero's accent word — uses
`--color-success` (5.3:1 on white). The approved brand colour is unchanged; only where it is applied
changed.

**Brand blue `#146EF5` is not used for small text.** It is 4.31:1 on the canvas, 4.11:1 on a sunken
row and 3.97:1 inside an information notice, and links appear on all three. `TextLink` uses
`--color-info` (5.3:1 at worst). Brand blue keeps the primary button — white on it is 4.59:1 — and
the focus ring.

Both are §5.2 approved values and neither was altered. What changed is the surface each is allowed
to sit on, which is a design-system decision rather than a brand one.

---

## 3. Typography

One family, one mono, and a restrained scale — §6.1 asks for modern typography, §6.2 forbids
oversized type.

| Token | Size | Used for |
| --- | --- | --- |
| `--text-2xs` | 11px | Table micro-labels, chips |
| `--text-xs` | 12px | Badges, captions |
| `--text-sm` | 13px | Dense table text |
| `--text-base` | 14px | Authoring body — the enterprise default |
| `--text-md` | 16px | Learner body, longer reading |
| `--text-lg` | 18px | Card titles |
| `--text-xl` | 22px | Section headings |
| `--text-2xl` | 28px | Page titles |
| `--text-3xl` | 36px | Hero titles, sparingly |

Each carries a paired line height, so `text-base` sets both.

`--font-mono` is not decoration: it marks the values that must be read exactly — character offsets,
content hashes, bank question IDs, error codes. If a value is something a person might quote back,
it is mono.

The authoring portal defaults to 14px and the learner portal to 16px. That is the density
difference learner §4 asks for, expressed in one place rather than per page.

---

## 4. Shape, elevation, motion

| Group | Tokens |
| --- | --- |
| Radius | `--radius-xs` `sm` `md` `lg` `xl` `pill` |
| Shadow | `--shadow-card` (resting), `--shadow-raised` (hover, popovers), `--shadow-overlay` (drawer, modal) |
| Motion | `--duration-fast` `base` `slow`, `--ease-standard` |

Shadows are soft and layered rather than dark, per §6.1's "soft shadows" and §6.2's warning against
heavy borders.

**Reduced motion** is handled once, in the base layer: `prefers-reduced-motion: reduce` sets all
three durations to zero and disables animation and smooth scrolling globally. No component repeats
that check.

---

## 5. Layout

| Token | Value | Meaning |
| --- | --- | --- |
| `--spacing-header` | 72px | §8.1's header height |
| `--spacing-sidebar` | 240px | Persistent sidebar |
| `--spacing-sidebar-rail` | 72px | Icon-only rail, 1024–1280 (arrives with UI-M2) |
| `--spacing-drawer` | 480px | Detail drawer |
| `--spacing-target` | 44px | §7's minimum interaction target |

`--spacing-target` being a token is deliberate: `h-target` and `size-target` are how a button meets
the 44px floor, so a component cannot quietly shrink below it.

Z-index is an ordered list in `:root` — `--z-sticky` `sidebar` `header` `drawer` `modal` `toast` —
so no component has to guess a number.

---

## 6. Accessibility built into the tokens

| Requirement | Where |
| --- | --- |
| Visible focus on every interactive element | `:focus-visible` in the base layer, 3px in information blue so it never reads as success |
| Reduced motion | Base layer media query |
| Minimum target size | `--spacing-target` |
| Screen-reader-only text | `.knowzy-sr-only` utility |
| Skip link as the first focusable element | `.knowzy-skip-link` utility, used by both shells |

---

## 7. Changing a token

1. Edit `packages/shared-ui/src/tokens.css`. Nowhere else.
2. If the value is one of the seven brand colours, the specification must change first — the test
   asserts them against §5.2.
3. Run `npm run test:unit`. The token test fails on a literal colour appearing in a component and
   on a missing brand value.
4. Rebuild the package: both apps consume it through `@knowzy/shared-ui`, and each app's
   `@source` directive scans the package's **source** so no build-output staleness can drop a class.

---

## 8. Adopting the tokens on an unconverted page

As of UI-M3 the authoring portal has **no** legacy stylesheet: every page is on the design system,
so `apps/authoring-web/src/app/legacy.css` was deleted rather than left in the build. One learner
page remains unconverted — the quiz — so `apps/live-web/src/app/legacy.css` still exists, with its
palette variables mapped onto these tokens.

That stylesheet is **nested under `#main`**, and it has to stay that way. Its rules are
element-level (`button`, `a`, `select`, `h1`), which was safe while the page was the whole
document. It is not safe now: unscoped, `button { background: var(--accent) }` also paints the
header's disabled Copilot control and notification bell, which then look enabled — the exact
misstatement the disabled treatment exists to prevent. The shell renders outside `#main`, so one
nesting level keeps the legacy pages looking as they did and keeps them off the shell. The
`:root` palette mapping stays outside the block, because custom properties must inherit
document-wide.

Each milestone from UI-M2 converts one page to Tailwind utilities and deletes the legacy rules it no
longer needs. When the `#main` block is empty, `legacy.css` goes.
