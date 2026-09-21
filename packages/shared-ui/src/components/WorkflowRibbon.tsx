// The KNOWZY workflow ribbon.
//
// §11: Knowledge Sources → AI Generation → Review → Approval → Question Bank
// → Assessments → Insights, compact, on authoring workflow pages.
//
// The rule that shapes this component: *"Mark a stage completed only when
// completion is known. Keep future stages neutral."* So `complete` is not a
// default and not inferred from position — a caller must know a stage is done
// to say so. A ribbon that greened everything to the left of the current stage
// would be asserting progress the platform has not measured.
//
// §11 also allows navigation "only when valid and authorized", so a stage is a
// link only when the caller supplies an href.

import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { KnowzyBackdrop } from './Asset.js';
import type { BackdropName } from '../assets/manifest.js';

export interface WorkflowStage {
  readonly label: string;
  readonly href?: string;
  /** Omit unless completion is actually known. Undefined renders neutral. */
  readonly complete?: boolean;
}

export interface WorkflowRibbonProps {
  readonly stages: readonly WorkflowStage[];
  /** The label of the stage the user is on. */
  readonly activeLabel: string;
  readonly ariaLabel?: string;
}

export const WorkflowRibbon = ({
  stages,
  activeLabel,
  ariaLabel = 'KNOWZY workflow',
}: WorkflowRibbonProps) => (
  <nav
    aria-label={ariaLabel}
    // §30: horizontal scroll on a narrow viewport rather than wrapping, so the
    // sequence stays a sequence.
    className="overflow-x-auto border-b border-line bg-brand-surface"
  >
    <ol className="flex min-w-max items-center gap-1 px-4 py-2">
      {stages.map((stage, index) => {
        const active = stage.label === activeLabel;
        const done = stage.complete === true && !active;

        const body = (
          <>
            <span
              aria-hidden="true"
              className={`grid size-4 shrink-0 place-items-center rounded-pill text-2xs font-bold ${
                done
                  ? 'bg-success text-white'
                  : active
                    ? 'bg-brand-navy text-white'
                    : 'bg-surface-sunken text-ink-subtle'
              }`}
            >
              {done ? <Check className="size-3" /> : index + 1}
            </span>
            <span className="whitespace-nowrap">{stage.label}</span>
            {done ? <span className="knowzy-sr-only">(completed)</span> : null}
          </>
        );

        const shared = `flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium ${
          active ? 'bg-surface-sunken text-brand-navy-text' : done ? 'text-ink' : 'text-ink-subtle'
        }`;

        return (
          <li key={stage.label} className="flex items-center">
            {stage.href === undefined ? (
              <span {...(active ? { 'aria-current': 'step' as const } : {})} className={shared}>
                {body}
              </span>
            ) : (
              <a
                href={stage.href}
                {...(active ? { 'aria-current': 'step' as const } : {})}
                className={`${shared} hover:bg-surface-hover hover:text-brand-navy-text`}
              >
                {body}
              </a>
            )}
            {index < stages.length - 1 ? (
              <span aria-hidden="true" className="mx-0.5 text-ink-subtle">
                ›
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  </nav>
);

/** The seven §11 stages, in order. Completion is never assumed here. */
export const KNOWZY_WORKFLOW_STAGES: readonly WorkflowStage[] = [
  { label: 'Knowledge Sources', href: '/sources' },
  { label: 'AI Generation', href: '/generate' },
  { label: 'Review', href: '/review' },
  { label: 'Approval', href: '/review?queue=approval' },
  { label: 'Question Bank', href: '/publish' },
  { label: 'Assessments', href: '/publish' },
  { label: 'Insights' },
] as const;

/**
 * The page heading band.
 *
 * §12: title, a concise purpose statement, optional approved visual. §6.2
 * warns against large hero banners that eat the workspace, so this is a
 * compact band by default; `art` is where an approved brand visual goes once
 * such assets exist in the repository.
 */
export const PageHero = ({
  title,
  /** The `<em>`-styled second word, as every mockup title does. */
  titleAccent,
  purpose,
  secondaryText,
  actions,
  art,
  eyebrow,
  backdrop,
}: {
  readonly title: string;
  readonly titleAccent?: string;
  readonly purpose?: ReactNode;
  readonly secondaryText?: ReactNode;
  readonly actions?: ReactNode;
  readonly art?: ReactNode;
  readonly eyebrow?: ReactNode;
  /** An approved decorative backdrop, from the design asset pack. */
  readonly backdrop?: BackdropName;
}) => (
  <div className="relative overflow-hidden rounded-lg border border-line bg-brand-surface shadow-card">
    <div className="relative flex flex-wrap items-center justify-between gap-4 px-6 py-5">
      <div className="min-w-0 max-w-3xl">
        {eyebrow === undefined ? null : (
          <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-brand-blue">
            {eyebrow}
          </p>
        )}
        <h1 className="text-2xl font-bold tracking-tight text-brand-navy-text">
          {title}
          {titleAccent === undefined ? null : (
            <>
              {' '}
              <span className="text-success">{titleAccent}</span>
            </>
          )}
        </h1>
        {/* div, not p: these slots take a ReactNode, and a caller passing a
            list or a definition list into a <p> is invalid HTML — which React
            reports as a hydration failure and then re-renders the whole tree
            on the client. */}
        {purpose === undefined ? null : (
          <div className="mt-1.5 text-md text-ink-muted">{purpose}</div>
        )}
        {secondaryText === undefined ? null : (
          <div className="mt-1 text-base text-ink-subtle">{secondaryText}</div>
        )}
      </div>
      {actions === undefined ? null : (
        <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
      )}
      {art === undefined ? null : (
        <div aria-hidden="true" className="hidden shrink-0 xl:block">
          {art}
        </div>
      )}
      {backdrop === undefined ? null : (
        // Decorative, and deliberately confined: low opacity, right-hand
        // third, and hidden below the wide breakpoint. No text sits on it, so
        // it cannot affect the contrast of anything (§19, §21).
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 hidden w-1/3 overflow-hidden opacity-25 xl:block"
        >
          <KnowzyBackdrop name={backdrop} className="h-full w-full object-cover" />
        </div>
      )}
    </div>
  </div>
);
