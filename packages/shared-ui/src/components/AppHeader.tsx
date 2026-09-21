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
// by the two components in Brand.tsx.

import type { ReactNode } from 'react';
import { Bell, Search, Sparkles } from 'lucide-react';
import { EssilorLuxotticaLogo, KnowzyWordmark } from './Brand.js';

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
    className="sticky top-0 flex h-header items-center gap-4 bg-brand-navy px-4 text-white sm:px-6"
    style={{ zIndex: 'var(--z-header)' }}
  >
    {/* ------------------------------------------------------------- brand
     * §5.1: the approved corporate mark, a separator, then the KNOWZY
     * wordmark with its green ZY. The tagline rides with the wordmark at wide
     * viewports and is dropped rather than shrunk below them.
     */}
    {/* shrink-0: the marks are approved artwork and are never squeezed. Without
     * it the flexible search field opposite compresses this box to nothing and
     * the wordmark overflows across the search. */}
    <div className="flex shrink-0 items-center gap-3">
      <EssilorLuxotticaLogo className="hidden h-4 w-auto shrink-0 text-white sm:block" />
      <span aria-hidden="true" className="hidden h-7 w-px bg-white/25 sm:inline-block" />
      <KnowzyWordmark withTagline className="hidden h-9 w-auto shrink-0 lg:block" />
      <KnowzyWordmark className="h-5 w-auto shrink-0 lg:hidden" />
      <span className="knowzy-sr-only">
        {portalName}
        {tagline === undefined ? '' : ` — ${tagline}`}
      </span>
    </div>

    {/* ------------------------------------------------------------ search
     * Disabled, and says so. §8.1 asks for Ctrl+K; the shortcut is not
     * advertised until the search behind it exists.
     */}
    <div className="mx-auto hidden min-w-0 w-full max-w-2xl md:block">
      <div className="flex items-center gap-2 rounded-md bg-white/10 px-3 py-2 text-white/50 ring-1 ring-inset ring-white/15">
        <Search aria-hidden="true" className="size-4 shrink-0" />
        <input
          type="search"
          disabled
          aria-disabled="true"
          placeholder={searchPlaceholder}
          className="w-full bg-transparent text-base text-white placeholder:text-white/50 focus:outline-none"
        />
        <span className="shrink-0 rounded-xs bg-white/10 px-1.5 py-0.5 text-2xs font-semibold tracking-wide text-white/60">
          Planned
        </span>
      </div>
    </div>

    {/* ------------------------------------------------------------- right */}
    <div className="ml-auto flex items-center gap-1 sm:gap-2">
      {/* KNOWZY Copilot, never "Copilot" alone: §8.1 forbids presenting it as
          Microsoft Copilot. Disabled until a governed service exists. */}
      <button
        type="button"
        disabled
        aria-disabled="true"
        title="KNOWZY Copilot is not available in this release"
        className="hidden h-target items-center gap-2 rounded-md px-3 text-left text-white/55 ring-1 ring-inset ring-white/15 lg:flex"
      >
        <Sparkles aria-hidden="true" className="size-4 shrink-0" />
        <span className="flex flex-col leading-tight">
          <span className="text-sm font-semibold">KNOWZY Copilot</span>
          <span className="text-2xs">Planned</span>
        </span>
      </button>

      <button
        type="button"
        disabled
        aria-disabled="true"
        title="Notifications are not available in this release"
        className="grid size-target place-items-center rounded-md text-white/55"
      >
        <Bell aria-hidden="true" className="size-5" />
        <span className="knowzy-sr-only">Notifications — not available in this release</span>
      </button>

      <span aria-hidden="true" className="mx-1 hidden h-7 w-px bg-white/25 sm:inline-block" />

      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="grid size-9 shrink-0 place-items-center rounded-pill bg-white/15 text-sm font-semibold text-white"
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
