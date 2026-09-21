// The global header, shared by both portals.
//
// §8.1: deep navy, ~72px, branding left, context search centre, Copilot and
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
// UI-M3 refined the lock-up and the rhythm rather than the colours:
//
//   * The KNOWZY tile mark (the approved favicon artwork) sits beside the
//     wordmark, so the product is recognisable at a glance and the header
//     matches the browser tab. It was the only drawn mark in the approved set
//     and it was going unused.
//   * The corporate mark is given its own zone, separated by a hairline, at a
//     size that reads as an endorsement rather than competing with the product
//     name — §5.1's order, EssilorLuxottica first, KNOWZY second.
//   * One spacing scale across the whole bar (px-6, gap-6 between zones, gap-2
//     within a zone), the search field centred on the page rather than on
//     whatever space is left, and the action cluster given a fixed rhythm so
//     the identity block lands in the same place on every screen.
//
// Every target is at least 44px (§7), and the whole header is one landmark.

import type { ReactNode } from 'react';
import { Bell, Search, Sparkles } from 'lucide-react';
import { EssilorLuxotticaLogo, KnowzyMark, KnowzyWordmark } from './Brand.js';

export interface AppHeaderProps {
  /** Which portal this is, shown next to the wordmark. */
  readonly portalName: string;
  readonly tagline?: string;
  /** Placeholder text must describe only what search would actually cover. */
  readonly searchPlaceholder: string;
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
}: AppHeaderProps) => (
  <header
    role="banner"
    // A one-pixel green rule under the navy: the brand's accent, used as
    // structure rather than decoration, and the line that separates the
    // header from the workspace without a shadow.
    className="sticky top-0 flex h-header items-stretch gap-6 border-b-2 border-brand-green bg-brand-navy px-4 text-white sm:px-6"
    style={{ zIndex: 'var(--z-header)' }}
  >
    {/* ------------------------------------------------------------- brand
     * §5.1: the approved corporate mark, a separator, then the KNOWZY tile
     * and wordmark. shrink-0: the marks are approved artwork and are never
     * squeezed — without it the flexible search field opposite compresses
     * this box to nothing and the wordmark overflows across the search.
     */}
    <div className="flex shrink-0 items-center gap-4">
      <EssilorLuxotticaLogo className="hidden h-4 w-auto shrink-0 text-white/85 md:block" />
      <span aria-hidden="true" className="hidden h-8 w-px bg-white/20 md:inline-block" />
      <span className="flex items-center gap-2.5">
        <KnowzyMark className="size-8 shrink-0 rounded-md ring-1 ring-inset ring-white/15" />
        <KnowzyWordmark withTagline className="hidden h-9 w-auto shrink-0 xl:block" />
        <KnowzyWordmark className="h-5 w-auto shrink-0 xl:hidden" />
      </span>
      <span className="knowzy-sr-only">
        {portalName}
        {tagline === undefined ? '' : ` — ${tagline}`}
      </span>
    </div>

    {/* ------------------------------------------------------------ search
     * Disabled, and says so. §8.1 asks for Ctrl+K; the shortcut is not
     * advertised until the search behind it exists.
     */}
    <div className="mx-auto hidden w-full min-w-56 max-w-xl items-center xl:flex">
      <div className="flex w-full items-center gap-2.5 rounded-lg bg-white/[0.07] px-3.5 py-2 text-white/50 ring-1 ring-inset ring-white/15">
        <Search aria-hidden="true" className="size-4 shrink-0" />
        <input
          type="search"
          disabled
          aria-disabled="true"
          placeholder={searchPlaceholder}
          className="w-full bg-transparent text-base text-white placeholder:text-white/50 focus:outline-none"
        />
        <span className="shrink-0 rounded-xs bg-white/10 px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide text-white/60">
          Planned
        </span>
      </div>
    </div>

    {/* ------------------------------------------------------------- right */}
    <div className="ml-auto flex shrink-0 items-center gap-2">
      {/* KNOWZY Copilot, never "Copilot" alone: §8.1 forbids presenting it as
          Microsoft Copilot. Disabled until a governed service exists. */}
      <button
        type="button"
        disabled
        aria-disabled="true"
        title="KNOWZY Copilot is not available in this release"
        className="hidden h-target items-center gap-2 rounded-lg px-3 text-left text-white/55 ring-1 ring-inset ring-white/15 2xl:flex"
      >
        <Sparkles aria-hidden="true" className="size-4 shrink-0" />
        <span className="flex flex-col leading-tight">
          <span className="text-sm font-semibold">KNOWZY Copilot</span>
          <span className="text-2xs uppercase tracking-wide">Planned</span>
        </span>
      </button>

      <button
        type="button"
        disabled
        aria-disabled="true"
        title="Notifications are not available in this release"
        className="grid size-target place-items-center rounded-lg text-white/55 ring-1 ring-inset ring-white/10"
      >
        <Bell aria-hidden="true" className="size-5" />
        <span className="knowzy-sr-only">Notifications — not available in this release</span>
      </button>

      <span aria-hidden="true" className="mx-1 hidden h-8 w-px bg-white/20 sm:inline-block" />

      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="grid size-9 shrink-0 place-items-center rounded-pill bg-white/15 text-sm font-semibold text-white ring-1 ring-inset ring-white/20"
        >
          {initials(identity.displayName)}
        </span>
        <span className="hidden min-w-0 flex-col leading-tight sm:flex">
          <span className="truncate text-sm font-semibold text-white">{identity.displayName}</span>
          <span className="truncate text-2xs text-white/70">
            {identity.roleLabel}
            {identity.isLocalDevelopmentIdentity ? ' · Local Development Identity' : ''}
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
