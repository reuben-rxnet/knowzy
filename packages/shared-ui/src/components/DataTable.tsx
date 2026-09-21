// The data table, as compositional parts rather than one configured component.
//
// §28 asks for a Data Table; §30 adds "tables may scroll or reduce columns
// responsively". The tables in this product differ too much for a single
// `columns` prop to serve them — a queue row has a two-line source cell, a
// gate row has an icon and a reason, a section row has a monospace offset pair
// — so these are styled primitives with the same semantics as the HTML they
// replace. A page keeps its `<th scope="row">` and gains none of the
// indirection of a render-prop table.
//
// What the wrapper guarantees, so no page has to remember it:
//
//   * A caption. A table without one is an unlabelled region (§31); it is a
//     required prop, and `captionHidden` keeps it for assistive technology
//     when the page already has a visible heading.
//   * Horizontal scroll rather than a squeezed layout, and the scroll
//     container is focusable and labelled so a keyboard user can reach it.
//   * A sticky header, because these lists are read by scrolling.

import type { ReactNode } from 'react';

export interface DataTableProps {
  readonly children: ReactNode;
  /** Required: this is the table's accessible name. */
  readonly caption: ReactNode;
  /** Keep the caption for screen readers only — the page already names it. */
  readonly captionHidden?: boolean;
  readonly className?: string;
}

export const DataTable = ({
  children,
  caption,
  captionHidden = false,
  className = '',
}: DataTableProps) => (
  // tabIndex on the scroll container: a region that scrolls must be reachable
  // without a mouse (WCAG 2.2, and §31's keyboard requirement).
  <div
    className={`overflow-x-auto rounded-lg border border-line bg-brand-surface ${className}`}
    tabIndex={0}
    role="group"
  >
    <table className="w-full border-collapse text-left text-base">
      <caption
        className={
          captionHidden
            ? 'knowzy-sr-only'
            : 'border-b border-line px-4 py-3 text-left text-sm font-semibold text-ink-muted'
        }
      >
        {caption}
      </caption>
      {children}
    </table>
  </div>
);

export const THead = ({ children }: { readonly children: ReactNode }) => (
  <thead className="sticky top-0 bg-surface-sunken">{children}</thead>
);

export const TBody = ({ children }: { readonly children: ReactNode }) => (
  <tbody className="divide-y divide-line">{children}</tbody>
);

export const Tr = ({
  children,
  className = '',
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) => <tr className={`align-top hover:bg-surface-hover ${className}`}>{children}</tr>;

type Align = 'start' | 'end' | 'center';

const ALIGN: Record<Align, string> = {
  start: 'text-left',
  end: 'text-right',
  center: 'text-center',
};

/** A header cell. `scope` is required: an unscoped header helps nobody. */
export const Th = ({
  children,
  scope,
  align = 'start',
  className = '',
}: {
  readonly children: ReactNode;
  readonly scope: 'col' | 'row';
  readonly align?: Align;
  readonly className?: string;
}) => (
  <th
    scope={scope}
    className={`px-4 py-3 ${ALIGN[align]} ${
      scope === 'col'
        ? 'whitespace-nowrap border-b border-line text-sm font-semibold uppercase tracking-wide text-ink-muted'
        : 'font-semibold text-brand-navy-text'
    } ${className}`}
  >
    {children}
  </th>
);

export const Td = ({
  children,
  align = 'start',
  numeric = false,
  className = '',
}: {
  readonly children: ReactNode;
  readonly align?: Align;
  /** Tabular figures and right alignment, so digits line up column-wise. */
  readonly numeric?: boolean;
  readonly className?: string;
}) => (
  <td
    className={`px-4 py-3 text-ink ${numeric ? 'text-right font-mono tabular-nums' : ALIGN[align]} ${className}`}
  >
    {children}
  </td>
);

/** The secondary line inside a cell — a topic under a document name. */
export const CellNote = ({ children }: { readonly children: ReactNode }) => (
  <span className="mt-0.5 block text-sm text-ink-subtle">{children}</span>
);
