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
    className={`rounded-lg border border-line bg-brand-surface ${ELEVATION[elevation]} ${className}`}
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
      {description === undefined ? null : (
        <p className="mt-1 text-sm text-ink-muted">{description}</p>
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
 * `value` is a `ReactNode` and there is no `delta` prop by design. Every
 * mockup card shows "+6% vs last month"; the platform stores no KPI history,
 * so a delta cannot be computed from anything (capability matrix §5.1). A
 * component that accepted one would invite fabrication, so this one refuses to
 * have the field. `caption` is where a real, sourced qualifier goes.
 */
export const KpiCard = ({
  label,
  value,
  caption,
  icon,
  tone = 'info',
  planned = false,
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly caption?: ReactNode;
  readonly icon?: ReactNode;
  readonly tone?: 'info' | 'success' | 'ai' | 'warning' | 'neutral';
  /** True when the metric has no data source yet: renders a Planned state. */
  readonly planned?: boolean;
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
          {caption === undefined ? null : <p className="mt-1 text-xs text-ink-subtle">{caption}</p>}
        </div>
      </div>
    </Card>
  );
};
