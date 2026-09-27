// Preview pages: how a planned destination is expected to look, without
// pretending any of it works.
//
// Requested by the product owner on 2026-09-27 so a stakeholder can click every
// learner destination (learner §5.2 allows previews "only when product owners
// explicitly want them visible"). Three rules make a preview honest, and each
// component here enforces one of them:
//
//   1. The page SAYS it is a preview before anything else: `PreviewNotice`
//      sits directly under the hero and is a labelled note, not small print.
//   2. Illustrative content is FENCED. `ExampleRegion` draws a dashed frame
//      with a visible "Illustrative example" tag on every block of example
//      content, so a screenshot of one card still carries the label.
//   3. Nothing in a frame is ACTIVE. Every control inside is a disabled
//      `Button` with its reason; there are no links out of an example.
//
// Real data may sit on the same page — the learner's own assessments, the
// domains they can see — and it is drawn OUTSIDE any frame, in the ordinary
// card style, so the two can be told apart at a glance.
//
// Every string arrives as a prop (C1): the copy lives in the app's copy.ts,
// where the no-fabricated-metrics contract can read it.

import type { ReactNode } from 'react';
import { Eye } from 'lucide-react';
import { BADGE_ARTWORK, assetUrl, type BadgeArtworkName } from '../assets/manifest.js';
import { Badge } from './Badge.js';

/** The banner at the top of a preview page. */
export const PreviewNotice = ({
  label,
  title,
  children,
  requirement,
}: {
  /** The chip, e.g. "Preview". Also names the region. */
  readonly label: string;
  readonly title: ReactNode;
  readonly children?: ReactNode;
  /** What has to exist first, in one sentence including its own lead-in. */
  readonly requirement?: ReactNode;
}) => (
  <section
    role="note"
    aria-label={label}
    className="flex gap-3 rounded-lg border border-info/30 bg-info-soft p-4 sm:p-5"
  >
    <span
      aria-hidden="true"
      className="grid size-10 shrink-0 place-items-center rounded-pill bg-brand-surface text-info"
    >
      <Eye className="size-5" />
    </span>
    <div className="flex min-w-0 flex-col gap-1.5">
      <p className="flex flex-wrap items-center gap-2">
        <Badge tone="planned" withIcon={false}>
          {label}
        </Badge>
        <strong className="text-base font-semibold text-brand-navy-text">{title}</strong>
      </p>
      {children === undefined ? null : <div className="text-sm text-ink">{children}</div>}
      {requirement === undefined ? null : <p className="text-sm text-ink-muted">{requirement}</p>}
    </div>
  </section>
);

/** A fenced block of illustrative content. */
export const ExampleRegion = ({
  id,
  heading,
  tag,
  description,
  children,
  aside,
}: {
  /** Names the region; must be unique on the page. */
  readonly id: string;
  readonly heading: ReactNode;
  /** The visible label on the frame, e.g. "Illustrative example — not your data". */
  readonly tag: string;
  readonly description?: ReactNode;
  readonly children: ReactNode;
  /** Right-aligned beside the heading — a disabled control, typically. */
  readonly aside?: ReactNode;
}) => (
  <section
    aria-labelledby={id}
    className="rounded-lg border-2 border-dashed border-line-strong bg-brand-surface p-4 sm:p-5"
  >
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="w-fit rounded-xs bg-surface-sunken px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide text-ink-muted">
          {tag}
        </span>
        <h2 id={id} className="text-lg font-semibold text-brand-navy-text">
          {heading}
        </h2>
        {description === undefined ? null : (
          <p className="max-w-prose text-sm text-ink-muted">{description}</p>
        )}
      </div>
      {aside === undefined ? null : <div className="shrink-0">{aside}</div>}
    </div>
    <div className="mt-4">{children}</div>
  </section>
);

/**
 * An approved badge design, shown as NOT EARNED.
 *
 * Integration spec §17: badge assets may appear in an approved preview but must
 * not imply a learner has earned anything. So there is no "earned" variant at
 * all — the artwork is always desaturated and captioned by the caller, and the
 * accessible name says it is a design.
 */
export const KnowzyBadgeArt = ({
  name,
  label,
  className = 'size-16',
}: {
  readonly name: BadgeArtworkName;
  /** e.g. "Badge design: Assessment Pro (not earned)". */
  readonly label: string;
  readonly className?: string;
}) => (
  <img
    src={assetUrl(BADGE_ARTWORK[name])}
    alt={label}
    className={`${className} opacity-60 grayscale`}
    width={128}
    height={128}
    loading="lazy"
    decoding="async"
  />
);
