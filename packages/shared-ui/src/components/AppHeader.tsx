// The global header, shared by both portals.
//
// §8.1: deep navy, branding left, context search centre, Copilot and
// notifications and identity right. Two things here are deliberate refusals:
//
//   * Search and Copilot render DISABLED. No cross-entity search endpoint and
//     no Copilot service exist (capability matrix A1, B1), and §23 forbids
//     faking a conversation. A disabled control with a "Planned" label tells
//     the truth; a working-looking box that does nothing does not.
//   * The identity block is labelled "Local Development Identity" whenever the
//     environment is local, per §34 and learner §5.1 — synthetic personas are
//     never presented as real employees.
//
// The brand marks come from the approved files in `assets/branding/`, rendered
// by the components in Brand.tsx. Nothing here recolours or reshapes them.
//
// UI-M3 built the lock-up to the APPROVED HEADER MOCKUP, which is the visual
// source of truth and settles three things the earlier version had guessed at:
//
//   * Size. EssilorLuxottica reads as a full corporate mark rather than a
//     watermark, and the KNOWZY wordmark carries its tagline at a size where
//     the tagline is actually legible. That needs an 80px bar, so
//     `--spacing-header` is 5rem.
//   * No tile. The mockup is `EssilorLuxottica | KNOWZY` and nothing else on
//     the left. `KnowzyMark` — the approved favicon artwork — stays exported
//     and stays the browser tab, but it is not in the header: the mockup wins
//     over a decision made without it.
//   * Rhythm. One scale across the bar, the search centred on the page, and
//     the action cluster in a fixed order so identity lands in the same place
//     at every width.
//
// Where this deviates from the mockup, it is because the mockup shows a
// service that does not exist:
//
//   * The search chip says "Planned", not "Ctrl + K". Advertising a shortcut
//     for a disabled field would be a promise the build cannot keep.
//   * "KNOWZY Copilot", never "Copilot" alone (§8.1 forbids presenting it as
//     Microsoft Copilot), and the second line is "Planned" rather than the
//     mockup's tagline for a product that has no backend.
//   * The bell carries no count. The mockup shows a red "3"; there is no
//     notification producer, so any number would be invented.
//   * The avatar is initials, not a photograph. No photo exists for a
//     synthetic identity.
//
// The search, Copilot and notification glyphs are the APPROVED pack's icons
// (`navigation/icon_search|copilot|notification.svg`), rendered as CSS masks so
// they take the header's colour. The brand marks are the pack's too. Lucide is
// still the authoring portal's icon set, where the pack has no equivalents.
//
// Every target is at least 44px (§7), every foreground on the navy is contrast
// checked by `contrast.test.ts`, and the whole header is one landmark.

import type { ReactNode } from 'react';
import { KnowzyNavIcon } from './Asset.js';
import { EssilorLuxotticaLogo, KnowzyWordmark } from './Brand.js';

export interface AppHeaderProps {
  /** Which portal this is, shown next to the wordmark. */
  readonly portalName: string;
  readonly tagline?: string;
  /** Placeholder text must describe only what search would actually cover. */
  readonly searchPlaceholder: string;
  /**
   * The navigation toggle, rendered first. The shell passes a `NavDrawer`,
   * which hides its own button at desktop widths where the sidebar is shown.
   */
  readonly navToggle?: ReactNode;
  readonly identity: {
    readonly displayName: string;
    readonly roleLabel: string;
    /** True in the local environment: adds the development-identity label. */
    readonly isLocalDevelopmentIdentity: boolean;
  };
  /** Rendered after the identity block — the portal's own identity switcher. */
  readonly identityAction?: ReactNode;
}

export const AppHeader = ({
  portalName,
  tagline,
  searchPlaceholder,
  identity,
  identityAction,
  navToggle,
}: AppHeaderProps) => (
  <header
    role="banner"
    // A 2px green rule under the navy: the brand's accent used as structure,
    // and the line that separates header from workspace without a shadow.
    className="sticky top-0 flex h-header items-center gap-3 border-b-2 border-brand-green bg-brand-navy px-4 text-white sm:gap-5 sm:px-7"
    style={{ zIndex: 'var(--z-header)' }}
  >
    {navToggle}
    {/* ------------------------------------------------------------- brand
     * §5.1's order: EssilorLuxottica, a hairline, then KNOWZY. shrink-0 — the
     * marks are approved artwork and are never squeezed; without it the
     * flexible search field opposite compresses this box and the wordmark
     * overflows across the search.
     */}
    <div className="flex shrink-0 items-center gap-5">
      <EssilorLuxotticaLogo className="hidden h-5 w-auto shrink-0 text-white md:block xl:h-6" />
      <span aria-hidden="true" className="hidden h-10 w-px bg-white/25 md:inline-block" />
      <KnowzyWordmark withTagline className="hidden h-11 w-auto shrink-0 lg:block xl:h-12" />
      <KnowzyWordmark className="h-6 w-auto shrink-0 lg:hidden" />
      <span className="knowzy-sr-only">
        {portalName}
        {tagline === undefined ? '' : ` — ${tagline}`}
      </span>
    </div>

    {/* ------------------------------------------------------------ search
     * Disabled, and says so. §8.1 asks for Ctrl+K; the shortcut is not
     * advertised until the search behind it exists.
     */}
    <div className="mx-auto hidden w-full min-w-64 max-w-2xl items-center xl:flex">
      <div className="flex h-11 w-full items-center gap-3 rounded-lg bg-white/[0.08] px-4 text-white/55 ring-1 ring-inset ring-white/15">
        <KnowzyNavIcon name="search" className="size-4" />
        <input
          type="search"
          disabled
          aria-disabled="true"
          placeholder={searchPlaceholder}
          className="w-full bg-transparent text-md text-white placeholder:text-white/55 focus:outline-none"
        />
        <span className="shrink-0 rounded-sm bg-white/10 px-2 py-1 text-2xs font-bold uppercase tracking-wider text-white/60">
          Planned
        </span>
      </div>
    </div>

    {/* ------------------------------------------------------------- right */}
    <div className="ml-auto flex min-w-0 shrink-0 items-center gap-2 sm:gap-3">
      <button
        type="button"
        disabled
        aria-disabled="true"
        title="KNOWZY Copilot is not available in this release"
        className="hidden h-11 items-center gap-2.5 rounded-lg px-3.5 text-left text-white/60 ring-1 ring-inset ring-white/15 2xl:flex"
      >
        <KnowzyNavIcon name="copilot" className="size-5 text-brand-green" />
        <span className="flex flex-col leading-tight">
          <span className="text-base font-semibold text-white/85">KNOWZY Copilot</span>
          <span className="text-2xs font-semibold uppercase tracking-wider">Planned</span>
        </span>
      </button>

      <button
        type="button"
        disabled
        aria-disabled="true"
        title="Notifications are not available in this release"
        // Hidden on a phone: it does nothing in this release, and the header
        // needs its width for the navigation button and the identity.
        className="hidden size-target place-items-center rounded-lg text-white/60 ring-1 ring-inset ring-white/10 sm:grid"
      >
        <KnowzyNavIcon name="notification" className="size-5" />
        <span className="knowzy-sr-only">Notifications — not available in this release</span>
      </button>

      <span aria-hidden="true" className="hidden h-10 w-px bg-white/25 sm:inline-block" />

      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="grid size-10 shrink-0 place-items-center rounded-pill bg-white/15 text-base font-semibold text-white ring-1 ring-inset ring-white/25"
        >
          {initials(identity.displayName)}
        </span>
        <span className="hidden min-w-0 max-w-44 flex-col leading-tight sm:flex xl:max-w-56 2xl:max-w-80">
          <span className="truncate text-base font-semibold text-white">
            {identity.displayName}
          </span>
          {/* The development-identity label comes FIRST so that truncation
              eats the role sentence rather than the §34 disclosure. A role
              description is a convenience; "this is not a real employee" is
              not, and the role strings here are long enough to push it off
              the end at every width. */}
          <span className="truncate text-2xs text-white/70">
            {identity.isLocalDevelopmentIdentity ? 'Local Development Identity · ' : ''}
            {identity.roleLabel}
          </span>
        </span>
        {identityAction}
      </div>
    </div>
  </header>
);

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
