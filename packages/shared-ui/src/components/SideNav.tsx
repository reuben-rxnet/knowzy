// Navigation for both portals.
//
// One component, two configurations: §9 lists ten authoring destinations, and
// learner §5.2 lists eight. Only some have routes today, so every item carries
// the status the capability matrix gives it, and the status decides the
// treatment:
//
//   IMPLEMENTED                  a link
//   PARTIALLY_IMPLEMENTED        a link, plus a note saying where it lives now
//   PLANNED                      not a link, "Planned"
//   REQUIRES_BACKEND_EXTENSION   not a link, "Needs backend"
//   DISABLED_IN_CURRENT_RELEASE  not a link, "Unavailable"
//
// Nothing unreleased is an anchor, so there are no dead links (learner §5.2),
// and nothing is silently hidden either: the sidebar is an honest statement of
// what the product is and is not.
//
// The one exception is a PREVIEW (learner §5.2: "mark planned destinations as
// preview only when product owners explicitly want them visible", which they
// asked for on 2026-09-27). A preview item keeps its unreleased status and
// gains a link to a page that says, before anything else, that nothing on it
// is live. Its chip reads "Preview", never nothing, so it cannot pass for a
// released destination.
//
// §9: visual hiding is never the authorization control. Nothing here
// authorizes anything — the server refuses regardless of what this renders.

import type { ReactNode } from 'react';

/** The capability-matrix vocabulary, used verbatim so the two cannot drift. */
export type CapabilityStatus =
  | 'IMPLEMENTED'
  | 'PARTIALLY_IMPLEMENTED'
  | 'PLANNED'
  | 'REQUIRES_BACKEND_EXTENSION'
  | 'DISABLED_IN_CURRENT_RELEASE';

export interface NavItem {
  readonly label: string;
  /** Present only when the destination is reachable. */
  readonly href?: string;
  readonly icon: ReactNode;
  readonly status: CapabilityStatus;
  /** For PARTIALLY_IMPLEMENTED: where the capability lives today. */
  readonly note?: string;
  /** A real count, or omitted. Never a placeholder number. */
  readonly count?: number;
  /**
   * An unreleased destination with a labelled preview page at `href`. Only
   * meaningful with a status that is not IMPLEMENTED or PARTIALLY_IMPLEMENTED;
   * the tokens test refuses the combination.
   */
  readonly preview?: true;
}

const CHIP: Record<CapabilityStatus, string | null> = {
  IMPLEMENTED: null,
  PARTIALLY_IMPLEMENTED: null, // the note carries it instead
  PLANNED: 'Planned',
  REQUIRES_BACKEND_EXTENSION: 'Needs backend',
  DISABLED_IN_CURRENT_RELEASE: 'Unavailable',
};

/** What assistive technology hears for an unavailable destination. */
const UNAVAILABLE_DESCRIPTION: Record<CapabilityStatus, string> = {
  IMPLEMENTED: '',
  PARTIALLY_IMPLEMENTED: '',
  PLANNED: 'Planned for a later release.',
  REQUIRES_BACKEND_EXTENSION: 'Not available yet: it needs backend capability that does not exist.',
  DISABLED_IN_CURRENT_RELEASE: 'Not available in the current release.',
};

const PREVIEW_CHIP = 'Preview';
const PREVIEW_DESCRIPTION = 'A preview of a planned capability. Nothing on that page is live yet.';

const isReachable = (item: NavItem): boolean =>
  item.href !== undefined &&
  (item.status === 'IMPLEMENTED' ||
    item.status === 'PARTIALLY_IMPLEMENTED' ||
    item.preview === true);

export interface SideNavProps {
  readonly items: readonly NavItem[];
  /** The current pathname, matched to mark the active item. */
  readonly currentPath: string;
  readonly ariaLabel: string;
  /** The learner shell uses looser spacing and larger text (learner §4). */
  readonly density?: 'compact' | 'comfortable';
  /** Rendered at the bottom — the brand lock-up in the mockups. */
  readonly footer?: ReactNode;
  /**
   * `rail` is the collapsed form for tablet widths: icons only, each still a
   * real link or a disabled entry, with its label (and status) as the
   * accessible name and the native tooltip. The full list is one tap away in
   * the navigation drawer.
   */
  readonly variant?: 'full' | 'rail';
}

/**
 * Could this item be the active one?
 *
 * Exact match for the root so `/` does not light up on every page, prefix
 * match elsewhere so `/review/<id>` keeps Review Queue selected. An item whose
 * href carries a query matches only when the location carries the same query,
 * so Approvals (`/review?queue=approval`) does not light up on plain
 * `/review` — and does light up when that queue is actually open.
 */
export const isActivePath = (currentLocation: string, href: string): boolean => {
  const [currentPath = currentLocation, currentQuery = ''] = currentLocation.split('?');
  const [path = href, query = ''] = href.split('?');

  const pathMatches =
    path === '/' ? currentPath === '/' : currentPath === path || currentPath.startsWith(`${path}/`);
  if (!pathMatches) return false;
  if (query === '') return true;

  const present = new URLSearchParams(currentQuery);
  return [...new URLSearchParams(query)].every(([key, value]) => present.get(key) === value);
};

/**
 * Which single item is active.
 *
 * Several items can legitimately point at the same route while a capability
 * still lives there — the learner's Home and Assessments are both `/`, and
 * Approvals is a queue of `/review`. Highlighting all of them would put two
 * `aria-current="page"` items in one list and tell the user they are in two
 * places at once, so the most specific match wins:
 *
 *   1. a longer path beats a shorter one,
 *   2. then a matching query beats none — Approvals owns
 *      `/review?queue=approval`, Review Queue owns plain `/review`,
 *   3. then the destination that IS the page beats an alias pointing at it —
 *      `/publish` is Publish, even though Question Bank and Assessments also
 *      live there in this release.
 *
 * Remaining ties go to nav order.
 */
export const activeNavLabel = (
  items: readonly NavItem[],
  currentLocation: string,
): string | undefined => {
  let bestLabel: string | undefined;
  let bestScore = -1;

  for (const item of items) {
    if (!isReachable(item) || item.href === undefined) continue;
    if (!isActivePath(currentLocation, item.href)) continue;

    const [path = item.href, query = ''] = item.href.split('?');
    const score =
      path.length * 4 + (query === '' ? 0 : 2) + (item.status === 'IMPLEMENTED' ? 1 : 0);
    if (score > bestScore) {
      bestScore = score;
      bestLabel = item.label;
    }
  }

  return bestLabel;
};

export const SideNav = ({
  items,
  currentPath,
  ariaLabel,
  density = 'compact',
  footer,
  variant = 'full',
}: SideNavProps) => {
  if (variant === 'rail')
    return <Rail items={items} currentPath={currentPath} ariaLabel={ariaLabel} />;

  const itemPadding = density === 'compact' ? 'py-2' : 'py-2.5';
  const itemText = density === 'compact' ? 'text-base' : 'text-md';
  const activeLabel = activeNavLabel(items, currentPath);

  return (
    <nav
      aria-label={ariaLabel}
      className="flex h-full w-sidebar shrink-0 flex-col overflow-y-auto border-r border-line bg-brand-surface"
    >
      <ul className="flex flex-col gap-0.5 p-3">
        {items.map((item) => {
          const reachable = isReachable(item);
          const active = item.label === activeLabel;
          const chip = item.preview === true ? PREVIEW_CHIP : CHIP[item.status];

          const inner = (
            <>
              <span
                aria-hidden="true"
                className={`grid size-5 shrink-0 place-items-center ${
                  active ? 'text-success' : reachable ? 'text-ink-muted' : 'text-ink-subtle'
                }`}
              >
                {item.icon}
              </span>
              {/* The label owns the full width of the row and the status sits
               * under it. Side by side, "Administration" and "Needs backend"
               * do not both fit in the sidebar, and it was the label that got
               * truncated — a destination reading "Admini…" tells the user
               * nothing. */}
              <span className="min-w-0 flex-1">
                <span className="block truncate">{item.label}</span>
                {chip === null && item.note === undefined ? null : (
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                    {chip === null ? null : (
                      <span
                        className={`rounded-xs px-1.5 py-0.5 text-2xs font-semibold ${
                          item.preview === true
                            ? 'bg-info-soft text-info'
                            : 'bg-surface-sunken text-ink-subtle'
                        }`}
                      >
                        {chip}
                      </span>
                    )}
                    {item.note === undefined ? null : (
                      <span className="text-2xs font-normal leading-snug text-ink-subtle">
                        {item.note}
                      </span>
                    )}
                  </span>
                )}
              </span>
              {item.count === undefined ? null : (
                <span className="shrink-0 rounded-pill bg-surface-sunken px-2 py-0.5 text-2xs font-bold text-ink-muted">
                  {item.count}
                </span>
              )}
            </>
          );

          if (!reachable) {
            return (
              <li key={item.label}>
                <span
                  aria-disabled="true"
                  className={`flex items-center gap-3 rounded-md border-l-4 border-transparent pl-2 pr-3 ${itemPadding} ${itemText} font-medium text-ink-subtle`}
                >
                  {inner}
                  <span className="knowzy-sr-only">{UNAVAILABLE_DESCRIPTION[item.status]}</span>
                </span>
              </li>
            );
          }

          return (
            <li key={item.label}>
              <a
                href={item.href}
                {...(active ? { 'aria-current': 'page' as const } : {})}
                className={`flex items-center gap-3 rounded-md pl-2 pr-3 ${itemPadding} ${itemText} font-medium transition-colors duration-(--duration-fast) ${
                  active
                    ? // §9: light green background, green left indicator, dark
                      // navy text. The indicator is a border, so the selected
                      // item is distinguishable without colour perception.
                      //
                      // `border-success`, not `border-brand-green`: the bright
                      // brand green is 2.69:1 on white, and a state indicator
                      // needs 3:1 (WCAG 1.4.11). The success green is the same
                      // family at 5.3:1. Brand green keeps the header rule and
                      // the wordmark, where it sits on navy.
                      'border-l-4 border-success bg-success-soft text-brand-navy-text'
                    : 'border-l-4 border-transparent text-ink hover:bg-surface-hover hover:text-brand-navy-text'
                }`}
              >
                {inner}
                {item.preview === true ? (
                  <span className="knowzy-sr-only">{PREVIEW_DESCRIPTION}</span>
                ) : null}
              </a>
            </li>
          );
        })}
      </ul>

      {footer === undefined ? null : <div className="mt-auto p-5">{footer}</div>}
    </nav>
  );
};

/** What a rail entry is called: its label, then its status if it has one. */
const railName = (item: NavItem): string => {
  const chip = item.preview === true ? PREVIEW_CHIP : CHIP[item.status];
  return chip === null ? item.label : `${item.label} (${chip})`;
};

const Rail = ({
  items,
  currentPath,
  ariaLabel,
}: Pick<SideNavProps, 'items' | 'currentPath' | 'ariaLabel'>) => {
  const activeLabel = activeNavLabel(items, currentPath);
  return (
    <nav
      aria-label={ariaLabel}
      className="flex h-full w-sidebar-rail shrink-0 flex-col overflow-y-auto border-r border-line bg-brand-surface"
    >
      <ul className="flex flex-col items-center gap-1 py-3">
        {items.map((item) => {
          const name = railName(item);
          const active = item.label === activeLabel;
          if (!isReachable(item)) {
            return (
              <li key={item.label}>
                <span
                  aria-disabled="true"
                  title={name}
                  className="grid size-target place-items-center rounded-md text-ink-subtle opacity-60"
                >
                  <span aria-hidden="true" className="grid size-5 place-items-center">
                    {item.icon}
                  </span>
                  <span className="knowzy-sr-only">
                    {name}. {UNAVAILABLE_DESCRIPTION[item.status]}
                  </span>
                </span>
              </li>
            );
          }
          return (
            <li key={item.label}>
              <a
                href={item.href}
                title={name}
                {...(active ? { 'aria-current': 'page' as const } : {})}
                className={`relative grid size-target place-items-center rounded-md transition-colors duration-(--duration-fast) ${
                  active
                    ? 'bg-success-soft text-success ring-2 ring-inset ring-success'
                    : 'text-ink-muted hover:bg-surface-hover hover:text-brand-navy-text'
                }`}
              >
                <span aria-hidden="true" className="grid size-5 place-items-center">
                  {item.icon}
                </span>
                {item.preview === true ? (
                  <span
                    aria-hidden="true"
                    className="absolute right-1 top-1 size-2 rounded-pill bg-info"
                  />
                ) : null}
                <span className="knowzy-sr-only">
                  {name}
                  {item.preview === true ? `. ${PREVIEW_DESCRIPTION}` : ''}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

/**
 * The EssilorLuxottica lock-up at the foot of the sidebar in every mockup.
 *
 * Typeset from the approved tagline words rather than an image: the approved
 * asset set contains a corporate wordmark and a product wordmark, not this
 * lock-up, and §5 permits only approved assets.
 */
export const BrandLockup = () => (
  <div className="flex flex-col gap-1 border-t border-line pt-5">
    <span className="text-md leading-tight text-ink-muted">People</span>
    <span className="text-md leading-tight text-ink-muted">Knowledge</span>
    <span className="text-lg font-bold leading-tight text-success">Better Vision</span>
    {/* `tracking-widest` on an uppercased 31-character line is wider than the
        sidebar's content box, and the nav clips horizontally — the line read
        "THER FOR A BRIGHTER RROW" in a 1440px browser. Wrapped, and at normal
        tracking, because the words matter more than the letter-spacing. */}
    <span className="mt-2 text-balance text-2xs font-semibold uppercase tracking-wide text-ink-subtle">
      Together for a brighter tomorrow
    </span>
  </div>
);
