// The card system.
//
// §6.1: rounded cards, soft shadows, generous spacing, clear hierarchy, and
// high information density without crowding. Every panel in both portals is
// one of these, so a page never invents its own container.

import type { ElementType, ReactNode } from 'react';

export interface CardProps {
  readonly children: ReactNode;
  /** `sunken` for a panel inside a panel; `raised` for something floating. */
  readonly elevation?: 'flat' | 'card' | 'raised';
  /** Renders as `section` by default so cards contribute to the outline. */
  readonly as?: ElementType;
  /** Required when the card is a labelled region. */
  readonly ariaLabelledBy?: string;
  /** For the state components: a card can be a live region or an alert. */
  readonly role?: 'status' | 'alert' | 'region' | 'group';
  readonly ariaLive?: 'polite' | 'assertive';
  readonly className?: string;
}

const ELEVATION = {
  flat: 'shadow-none',
  card: 'shadow-card',
  raised: 'shadow-raised',
} as const;

export const Card = ({
  children,
  elevation = 'card',
  as: Tag = 'section',
  ariaLabelledBy,
  role,
  ariaLive,
  className = '',
}: CardProps) => (
  <Tag
    {...(ariaLabelledBy === undefined ? {} : { 'aria-labelledby': ariaLabelledBy })}
    {...(role === undefined ? {} : { role })}
    {...(ariaLive === undefined ? {} : { 'aria-live': ariaLive })}
    // `relative` for the same reason as DataTable: a chart's screen-reader
    // table inside a card must not escape it and widen the page.
    className={`relative rounded-lg border border-line bg-brand-surface ${ELEVATION[elevation]} ${className}`}
  >
    {children}
  </Tag>
);

export const CardHeader = ({
  title,
  description,
  actions,
  id,
  icon,
}: {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  /** Pair with `Card`'s `ariaLabelledBy` so the region is named. */
  readonly id?: string;
  readonly icon?: ReactNode;
}) => (
  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
    <div className="min-w-0">
      <h2
        {...(id === undefined ? {} : { id })}
        className="flex items-center gap-2 text-lg font-semibold text-brand-navy-text"
      >
        {icon === undefined ? null : (
          <span aria-hidden="true" className="text-brand-blue">
            {icon}
          </span>
        )}
        {title}
      </h2>
      {/* div: a ReactNode slot must not be a <p>. See PageHero. */}
      {description === undefined ? null : (
        <div className="mt-1 text-sm text-ink-muted">{description}</div>
      )}
    </div>
    {actions === undefined ? null : <div className="flex shrink-0 gap-2">{actions}</div>}
  </div>
);

export const CardBody = ({
  children,
  className = '',
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) => <div className={`px-5 py-4 ${className}`}>{children}</div>;

export const CardFooter = ({ children }: { readonly children: ReactNode }) => (
  <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface-sunken px-5 py-3">
    {children}
  </div>
);

/**
 * A metric card.
 *
 * `value` is a `ReactNode` and there is still no `delta` NUMBER prop, by
 * design: a component that accepted a bare number would invite one being made
 * up. Since decision R-1 (2026-09-27) a comparison CAN be real — coverage
 * snapshots are recorded daily and flows are counted from dated rows — so the
 * card has a `comparison` SLOT, which takes a rendered element. The only thing
 * that renders one is the authoring portal's `KpiComparison`, which is built
 * from the API's measured comparison object and prints "Not Yet Available"
 * when there is no base. `caption` is where any other sourced qualifier goes.
 */
export const KpiCard = ({
  label,
  value,
  caption,
  icon,
  tone = 'info',
  planned = false,
  comparison,
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly caption?: ReactNode;
  readonly icon?: ReactNode;
  readonly tone?: 'info' | 'success' | 'ai' | 'warning' | 'neutral';
  /** True when the metric has no data source yet: renders a Planned state. */
  readonly planned?: boolean;
  /** A rendered, measured comparison. See the note above: never a bare number. */
  readonly comparison?: ReactNode;
}) => {
  const ICON_TONE = {
    info: 'bg-info-soft text-info',
    success: 'bg-success-soft text-success',
    ai: 'bg-ai-soft text-ai',
    warning: 'bg-warning-soft text-warning',
    neutral: 'bg-neutral-soft text-ink-muted',
  } as const;

  return (
    <Card className="p-5">
      <div className="flex items-start gap-4">
        {icon === undefined ? null : (
          <span
            aria-hidden="true"
            className={`grid size-11 shrink-0 place-items-center rounded-md ${ICON_TONE[tone]}`}
          >
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink-muted">{label}</p>
          {planned ? (
            <p className="mt-1 text-md font-semibold text-ink-subtle">Not available yet</p>
          ) : (
            <p className="mt-1 text-2xl font-bold tracking-tight text-brand-navy-text">{value}</p>
          )}
          {comparison === undefined ? null : <div className="mt-1">{comparison}</div>}
          {caption === undefined ? null : <p className="mt-1 text-xs text-ink-subtle">{caption}</p>}
        </div>
      </div>
    </Card>
  );
};
