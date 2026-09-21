# KNOWZY Design Tokens

**Status:** Implemented in UI-M1.
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

| Token | Use | Contrast on white |
| --- | --- | --- |
| `--color-ink` | Body text | 16.1:1 |
| `--color-ink-muted` | Secondary text | 7.4:1 |
| `--color-ink-subtle` | Hints, chips, captions | 4.6:1 — AA for normal text, and nothing smaller uses it |
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

### 2.4 One known contrast limit

Brand green on brand navy is **not** an AA combination for normal text. It is used only for the
wordmark's `ZY` and for non-text indicators, both of which AA permits. Green text always sits on
white or on `--color-success-soft`.

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

UI-M1 changed the shell only. The pages still carry their pre-UI-M1 stylesheet, now in
`apps/*/src/app/legacy.css`, whose palette variables are mapped onto these tokens — so an
unconverted page already uses the brand colours inside the new shell.

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
