// The filter row every analytics screen needs.
//
// A plain GET form, deliberately: the result is a URL somebody can send to a
// colleague or paste into a report, it needs no JavaScript, and the back button
// works. The same choice the taxonomy screen already makes.
//
// It renders the controls it is given and decides nothing. Which filters exist,
// and what they do to the query, belongs to the screen.

import type { ReactNode } from 'react';

export interface FilterDefinition {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly value: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
}

export const FilterBar = ({
  filters,
  applyLabel,
  resetLabel,
  resetHref,
  hidden = [],
  children,
}: {
  readonly filters: readonly FilterDefinition[];
  readonly applyLabel: string;
  readonly resetLabel: string;
  /** Where "reset" goes — the screen's own route with no query. */
  readonly resetHref: string;
  /** Query values to carry through the submit, e.g. the active tab. */
  readonly hidden?: readonly { readonly name: string; readonly value: string }[];
  /** Extra controls, e.g. a free-text search field. */
  readonly children?: ReactNode;
}) => (
  <form method="GET" className="flex flex-wrap items-end gap-4">
    {hidden.map((field) => (
      <input key={field.name} type="hidden" name={field.name} value={field.value} />
    ))}

    {filters.map((filter) => (
      <div key={filter.id} className="min-w-44 flex-1">
        <label
          htmlFor={filter.id}
          className="mb-1 block text-2xs font-semibold uppercase tracking-wide text-ink-muted"
        >
          {filter.label}
        </label>
        <select
          id={filter.id}
          name={filter.name}
          defaultValue={filter.value}
          className="min-h-target w-full rounded-md border border-line bg-brand-surface px-3 py-2 text-base text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
        >
          {filter.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    ))}

    {children}

    <div className="flex items-center gap-2">
      <button
        type="submit"
        className="min-h-target rounded-md bg-brand-blue px-4 py-2 text-base font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
      >
        {applyLabel}
      </button>
      {/* A link, not a button: "reset" IS a navigation to the unfiltered URL,
          and making it a link means middle-click and copy-link work. */}
      <a
        href={resetHref}
        className="min-h-target rounded-md border border-line px-4 py-2 text-base text-ink-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
      >
        {resetLabel}
      </a>
    </div>
  </form>
);
