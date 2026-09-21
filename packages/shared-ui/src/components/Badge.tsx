// Badges, and every status the product needs to state.
//
// §5.3 and §7 are explicit: colour never carries meaning alone. So every badge
// renders a label, and the semantic ones render an icon too — which means a
// failed gate reads as failed in greyscale, to a screen reader, and to a
// colour-blind approver.
//
// Presentational only: it receives a decided status and displays it. Nothing
// here evaluates a gate, a risk, or an eligibility.

import type { ReactNode } from 'react';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleDashed,
  Clock,
  Info,
  Loader2,
  Lock,
  Shield,
  Sparkles,
  XCircle,
} from 'lucide-react';

export type BadgeTone = 'neutral' | 'success' | 'info' | 'warning' | 'danger' | 'ai' | 'planned';

const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-neutral-soft text-ink-muted ring-line',
  success: 'bg-success-soft text-success ring-success/20',
  info: 'bg-info-soft text-info ring-info/20',
  warning: 'bg-warning-soft text-warning ring-warning/25',
  danger: 'bg-danger-soft text-danger ring-danger/20',
  ai: 'bg-ai-soft text-ai ring-ai/20',
  planned: 'bg-surface-sunken text-ink-subtle ring-line',
};

const TONE_ICON: Record<BadgeTone, typeof CheckCircle2> = {
  neutral: CircleDashed,
  success: CheckCircle2,
  info: Info,
  warning: AlertTriangle,
  danger: XCircle,
  ai: Sparkles,
  planned: Clock,
};

export interface BadgeProps {
  readonly children: ReactNode;
  readonly tone?: BadgeTone;
  /** Shows the tone's icon. On by default: §7 forbids colour-only meaning. */
  readonly withIcon?: boolean;
  /** Extra context for assistive technology when the label alone is terse. */
  readonly srDescription?: string;
  readonly className?: string;
}

export const Badge = ({
  children,
  tone = 'neutral',
  withIcon = true,
  srDescription,
  className = '',
}: BadgeProps) => {
  const Icon = TONE_ICON[tone];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${TONE[tone]} ${className}`}
    >
      {withIcon ? <Icon aria-hidden="true" className="size-3.5 shrink-0" /> : null}
      <span>{children}</span>
      {srDescription === undefined ? null : <span className="knowzy-sr-only">{srDescription}</span>}
    </span>
  );
};

/**
 * A status the platform computed, rendered with its own vocabulary.
 *
 * The `status` string is passed through verbatim rather than prettified: a
 * reviewer reading `SUBMITTED_FOR_APPROVAL` in the UI and in an audit row is
 * reading the same token, and translating it in the browser would break that.
 */
export const StatusBadge = ({ status, tone }: { status: string; tone?: BadgeTone }) => (
  <Badge tone={tone ?? statusTone(status)}>{status}</Badge>
);

/** Maps the platform's own status vocabulary onto tones. */
export const statusTone = (status: string): BadgeTone => {
  switch (status) {
    case 'PUBLISHED':
    case 'APPROVED':
    case 'HEALTHY':
    case 'EXTRACTED':
    case 'SUCCEEDED':
    case 'PASS':
    case 'COVERED':
    case 'IN_SYNC':
      return 'success';
    case 'SUBMITTED_FOR_APPROVAL':
    case 'AUTHOR_REVIEW':
    case 'IN_PROGRESS':
    case 'UNDER_REVIEW':
      return 'info';
    case 'CHANGES_REQUESTED':
    case 'PARTIAL':
    case 'NOT_COVERED':
    case 'UNTESTED':
    case 'PENDING':
    case 'DRY_RUN':
      return 'warning';
    case 'REJECTED':
    case 'FAILED':
    case 'FAIL':
    case 'GATE_FAILED':
    case 'UNHEALTHY':
      return 'danger';
    case 'RETIRED':
    case 'ARCHIVED':
    case 'NON_ASSESSABLE':
    case 'SKIP':
      return 'neutral';
    default:
      return 'neutral';
  }
};

/**
 * A dot-and-label indicator for inline use in dense tables, where a full badge
 * would crowd the row. Still never colour alone: the label is mandatory.
 */
export const StatusIndicator = ({
  tone = 'neutral',
  children,
}: {
  readonly tone?: BadgeTone;
  readonly children: ReactNode;
}) => {
  const DOT: Record<BadgeTone, string> = {
    neutral: 'bg-neutral',
    success: 'bg-success',
    info: 'bg-info',
    warning: 'bg-warning',
    danger: 'bg-danger',
    ai: 'bg-ai',
    planned: 'bg-line-strong',
  };
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-ink">
      <span aria-hidden="true" className={`size-2 shrink-0 rounded-pill ${DOT[tone]}`} />
      {children}
    </span>
  );
};

/**
 * Marks a surface the platform cannot back yet.
 *
 * UI specification §2: an unimplemented feature is labelled planned, preview,
 * unavailable, or disabled — never quietly populated with invented data. This
 * badge is how a screen says so, and the capability matrix says which screens
 * need it.
 */
export const PlannedBadge = ({ children = 'Planned' }: { readonly children?: ReactNode }) => (
  <Badge tone="planned" srDescription="This feature is not available in the current release.">
    {children}
  </Badge>
);

/** Marks content a model produced, per §5.2's AI purple. */
export const AiBadge = ({ children = 'AI generated' }: { readonly children?: ReactNode }) => (
  <Badge tone="ai">{children}</Badge>
);

/** A role or permission chip, for identity and administration surfaces. */
export const RoleBadge = ({ children }: { readonly children: ReactNode }) => (
  <Badge tone="info" withIcon={false} className="font-medium">
    <Shield aria-hidden="true" className="size-3.5 shrink-0" />
    {children}
  </Badge>
);

/** A question or document version. Monospace, because it is an identifier. */
export const VersionBadge = ({ version }: { readonly version: number | string }) => (
  <Badge tone="neutral" withIcon={false} className="font-mono">
    v{version}
  </Badge>
);

export const LockedBadge = ({ children = 'Locked' }: { readonly children?: ReactNode }) => (
  <Badge tone="neutral" withIcon={false}>
    <Lock aria-hidden="true" className="size-3.5 shrink-0" />
    {children}
  </Badge>
);

export const BlockedBadge = ({ children }: { readonly children: ReactNode }) => (
  <Badge tone="danger" withIcon={false}>
    <Ban aria-hidden="true" className="size-3.5 shrink-0" />
    {children}
  </Badge>
);

export const BusyBadge = ({ children = 'Working' }: { readonly children?: ReactNode }) => (
  <Badge tone="info" withIcon={false}>
    <Loader2 aria-hidden="true" className="size-3.5 shrink-0 animate-spin" />
    {children}
  </Badge>
);
