// Tabs that are links, and a definition list.
//
// §28 asks for Tabs, and the screens that need them — the five review queues,
// the six question-detail panels — select a view that must be linkable,
// bookmarkable, and survive a reload. So these are anchors inside a labelled
// `nav`, marked with `aria-current="page"`, not ARIA tabs.
//
// That is deliberate, not a shortcut. The ARIA tab pattern promises arrow-key
// movement between tabs in one document; these navigate, which means they must
// middle-click, open in a new tab, and work before hydration. Announcing them
// as tabs while they behave as links is the worse accessibility outcome.

import type { ReactNode } from 'react';

export interface TabItem {
  readonly label: string;
  readonly href: string;
  /** A real count, or omitted. Never a placeholder. */
  readonly count?: number;
}

export const TabNav = ({
  items,
  activeHref,
  ariaLabel,
}: {
  readonly items: readonly TabItem[];
  /** The href of the view being shown — compared exactly. */
  readonly activeHref: string;
  readonly ariaLabel: string;
}) => (
  <nav aria-label={ariaLabel} className="overflow-x-auto border-b border-line">
    <ul className="flex min-w-max items-stretch gap-1">
      {items.map((item) => {
        const active = item.href === activeHref;
        return (
          <li key={item.href} className="flex">
            <a
              href={item.href}
              {...(active ? { 'aria-current': 'page' as const } : {})}
              className={`flex min-h-target items-center gap-2 whitespace-nowrap border-b-2 px-4 text-base font-medium transition-colors duration-(--duration-fast) ${
                active
                  ? // A border as well as a colour: §7 forbids colour alone.
                    'border-brand-green text-brand-navy-text'
                  : 'border-transparent text-ink-muted hover:border-line-strong hover:text-brand-navy-text'
              }`}
            >
              {item.label}
              {item.count === undefined ? null : (
                <span
                  className={`rounded-pill px-2 py-0.5 text-2xs font-bold ${
                    active ? 'bg-success-soft text-success' : 'bg-surface-sunken text-ink-muted'
                  }`}
                >
                  {item.count}
                </span>
              )}
            </a>
          </li>
        );
      })}
    </ul>
  </nav>
);

export interface KeyValueItem {
  readonly label: ReactNode;
  readonly value: ReactNode;
  /** Renders the value monospaced — for ids, hashes, and offsets. */
  readonly mono?: boolean;
}

/**
 * The label-and-value list these screens are full of.
 *
 * A real `<dl>`, so the pairing is in the markup rather than implied by
 * columns. Two columns at width, stacked below it.
 */
export const KeyValue = ({
  items,
  className = '',
}: {
  readonly items: readonly KeyValueItem[];
  readonly className?: string;
}) => (
  <dl className={`grid gap-x-6 gap-y-2 sm:grid-cols-[minmax(9rem,auto)_1fr] ${className}`}>
    {items.map((item, index) => (
      <div key={index} className="contents">
        <dt className="text-base text-ink-muted">{item.label}</dt>
        <dd
          className={`text-base text-ink ${item.mono ? 'break-all font-mono text-sm' : ''} sm:mb-0 mb-2`}
        >
          {item.value}
        </dd>
      </div>
    ))}
  </dl>
);
