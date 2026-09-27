// Building blocks for the learner preview pages (LIVE-PREVIEW-M1).
//
// Everything here renders INSIDE an ExampleRegion, except `LiveTag`, which
// marks a real section. The components have no links and no enabled controls:
// an action is always a disabled Button carrying its reason, which assistive
// technology hears and a mouse sees as the native tooltip. That is what
// "future functionality must never appear active" means in markup.

import { Badge, Button, Meter } from '@knowzy/shared-ui';
import { Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { t } from '../copy';

/** The tag on a section built from real data, so it reads apart from a frame. */
export const LiveTag = () => (
  <Badge tone="success" withIcon={false}>
    {t('preview.live')}
  </Badge>
);

/** The milestone chip beside a framed heading. */
export const FutureTag = ({ phase9 = false }: { readonly phase9?: boolean }) => (
  <Badge tone="planned" withIcon={false}>
    {phase9 ? t('preview.phase9') : t('preview.future')}
  </Badge>
);

/** A disabled action. Never an anchor, never enabled. */
export const PreviewAction = ({
  label,
  tone = 'secondary',
}: {
  readonly label: string;
  readonly tone?: 'primary' | 'secondary';
}) => (
  <Button tone={tone} size="sm" disabled disabledReason={t('preview.disabledReason')}>
    {label}
  </Button>
);

/** One illustrative item: a path, a resource, an assessment. */
export const ExampleCard = ({
  title,
  body,
  eyebrow,
  meta = [],
  tags = [],
  progress,
  action,
  art,
}: {
  readonly title: string;
  readonly body?: string;
  readonly eyebrow?: string;
  readonly meta?: readonly string[];
  readonly tags?: readonly string[];
  /** An example percentage, always labelled "Example progress". */
  readonly progress?: number;
  readonly action?: string;
  readonly art?: ReactNode;
}) => (
  <div className="flex h-full flex-col gap-3 rounded-md border border-line bg-brand-surface p-4">
    {art === undefined ? null : <div aria-hidden="true">{art}</div>}
    {eyebrow === undefined ? null : (
      <p className="text-xs font-semibold text-ink-muted">{eyebrow}</p>
    )}
    <h3 className="text-base font-semibold text-brand-navy-text">{title}</h3>
    {body === undefined ? null : <p className="text-sm text-ink-muted">{body}</p>}
    {tags.length === 0 ? null : (
      <ul className="flex flex-wrap gap-1.5">
        {tags.map((tag) => (
          <li key={tag}>
            <Badge tone="neutral" withIcon={false}>
              {tag}
            </Badge>
          </li>
        ))}
      </ul>
    )}
    {meta.length === 0 ? null : (
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-subtle">
        {meta.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    )}
    {progress === undefined ? null : (
      <Meter label={t('ex.progressLabel')} percent={progress} tone="neutral" />
    )}
    {action === undefined ? null : (
      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        <PreviewAction label={action} tone="primary" />
        <PreviewAction label={t('preview.bookmark')} />
      </div>
    )}
  </div>
);

/**
 * A search box and filters, disabled as one group.
 *
 * A disabled `<fieldset>` disables every control inside it natively, and its
 * legend says why — so there is no way to render one of these half-working.
 */
export const DisabledFilters = ({
  idPrefix,
  searchPlaceholder,
  filters,
}: {
  readonly idPrefix: string;
  readonly searchPlaceholder: string;
  readonly filters: readonly string[];
}) => (
  <fieldset disabled className="flex flex-col gap-3">
    <legend className="mb-2 text-xs font-semibold text-ink-muted">
      {t('preview.filtersLegend')}
    </legend>
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
      <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-medium text-ink">
        {t('preview.searchLabel')}
        <span className="flex items-center gap-2 rounded-md border border-line bg-surface-sunken px-3 py-2 text-ink-subtle">
          <Search aria-hidden="true" className="size-4 shrink-0" />
          <input
            id={`${idPrefix}-search`}
            type="search"
            placeholder={searchPlaceholder}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </span>
      </label>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:flex">
        {filters.map((filter) => (
          <label key={filter} className="flex flex-col gap-1 text-sm font-medium text-ink lg:w-40">
            {filter}
            <select
              className="rounded-md border border-line bg-surface-sunken px-3 py-2 text-sm text-ink-subtle"
              defaultValue="all"
            >
              <option value="all">{t('preview.filterAll')}</option>
            </select>
          </label>
        ))}
      </div>
    </div>
  </fieldset>
);

/** A grid that collapses to one column on a phone. */
export const ExampleGrid = ({
  children,
  columns = 3,
}: {
  readonly children: ReactNode;
  readonly columns?: 2 | 3 | 4;
}) => {
  const wide = {
    2: 'md:grid-cols-2',
    3: 'md:grid-cols-2 xl:grid-cols-3',
    4: 'sm:grid-cols-2 xl:grid-cols-4',
  };
  return <div className={`grid grid-cols-1 gap-4 ${wide[columns]}`}>{children}</div>;
};
