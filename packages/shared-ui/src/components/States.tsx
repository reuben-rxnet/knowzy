// The page states every screen must be able to show.
//
// Both specifications list them (§31 authoring, §21 learner): loading, empty,
// no results, permission refusal, validation error, service unavailable, stale
// data, stale session. They are components rather than a paragraph in each
// page so that a refusal always looks like a refusal and always says why.
//
// The rule they all obey: the message explains the actual issue and never
// exposes a stack trace, a credential, an answer key, or inaccessible content.

import type { ReactNode } from 'react';
import {
  AlertTriangle,
  CloudOff,
  FileQuestion,
  Inbox,
  RefreshCw,
  ShieldAlert,
  XOctagon,
} from 'lucide-react';
import { Card } from './Card.js';

const Frame = ({
  icon,
  tone,
  title,
  children,
  actions,
  role,
}: {
  readonly icon: ReactNode;
  readonly tone: string;
  readonly title: ReactNode;
  readonly children?: ReactNode;
  readonly actions?: ReactNode;
  readonly role?: 'status' | 'alert';
}) => (
  <Card
    {...(role === undefined ? {} : { role })}
    className="flex flex-col items-center gap-3 px-6 py-10 text-center"
  >
    <span aria-hidden="true" className={`grid size-12 place-items-center rounded-pill ${tone}`}>
      {icon}
    </span>
    <h3 className="text-lg font-semibold text-brand-navy-text">{title}</h3>
    {children === undefined ? null : (
      <div className="max-w-prose text-sm text-ink-muted">{children}</div>
    )}
    {actions === undefined ? null : <div className="mt-1 flex gap-2">{actions}</div>}
  </Card>
);

/** Nothing exists yet — not a failure. */
export const EmptyState = ({
  title,
  description,
  actions,
}: {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
}) => (
  <Frame
    icon={<Inbox className="size-6" />}
    tone="bg-neutral-soft text-ink-muted"
    title={title}
    {...(actions === undefined ? {} : { actions })}
  >
    {description}
  </Frame>
);

/** A filter or search returned nothing — distinct from "nothing exists". */
export const NoResultsState = ({
  title = 'No matches',
  description,
  actions,
}: {
  readonly title?: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
}) => (
  <Frame
    icon={<FileQuestion className="size-6" />}
    tone="bg-neutral-soft text-ink-muted"
    title={title}
    {...(actions === undefined ? {} : { actions })}
  >
    {description}
  </Frame>
);

/**
 * Authorization refused the request.
 *
 * Kept visually distinct from an error: a refusal is the platform working. The
 * `code` is shown because it is what a user quotes when asking for access.
 */
export const RefusalState = ({
  title,
  reason,
  code,
  actions,
}: {
  readonly title: ReactNode;
  readonly reason: ReactNode;
  readonly code?: string;
  readonly actions?: ReactNode;
}) => (
  <Frame
    icon={<ShieldAlert className="size-6" />}
    tone="bg-warning-soft text-warning"
    title={title}
    role="alert"
    {...(actions === undefined ? {} : { actions })}
  >
    <p>{reason}</p>
    {code === undefined ? null : (
      <p className="mt-2 text-xs text-ink-subtle">
        Code <code className="font-mono">{code}</code>
      </p>
    )}
  </Frame>
);

/** Something went wrong, stated without leaking internals. */
export const ErrorState = ({
  title = 'That did not work',
  reason,
  code,
  actions,
}: {
  readonly title?: ReactNode;
  readonly reason: ReactNode;
  readonly code?: string;
  readonly actions?: ReactNode;
}) => (
  <Frame
    icon={<XOctagon className="size-6" />}
    tone="bg-danger-soft text-danger"
    title={title}
    role="alert"
    {...(actions === undefined ? {} : { actions })}
  >
    <p>{reason}</p>
    {code === undefined ? null : (
      <p className="mt-2 text-xs text-ink-subtle">
        Code <code className="font-mono">{code}</code>
      </p>
    )}
  </Frame>
);

/** A dependency is unreachable — the platform is fine, the link is not. */
export const ServiceUnavailableState = ({
  title = 'Service unavailable',
  reason,
  actions,
}: {
  readonly title?: ReactNode;
  readonly reason: ReactNode;
  readonly actions?: ReactNode;
}) => (
  <Frame
    icon={<CloudOff className="size-6" />}
    tone="bg-danger-soft text-danger"
    title={title}
    role="alert"
    {...(actions === undefined ? {} : { actions })}
  >
    {reason}
  </Frame>
);

/**
 * Data on screen may be behind the server.
 *
 * §31 requires a stale-data state; showing one is how a screen avoids
 * presenting a cached number as current.
 */
export const StaleDataNotice = ({ children }: { readonly children: ReactNode }) => (
  <div
    role="status"
    className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning"
  >
    <RefreshCw aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
    <span>{children}</span>
  </div>
);

/**
 * An in-flight skeleton.
 *
 * `label` is announced to assistive technology; a silent spinner tells a
 * screen-reader user nothing (§7).
 */
export const LoadingState = ({
  label = 'Loading',
  rows = 3,
}: {
  readonly label?: string;
  readonly rows?: number;
}) => (
  <Card className="px-5 py-5" role="status" ariaLive="polite">
    <span className="knowzy-sr-only">{label}</span>
    <div className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          aria-hidden="true"
          className="h-4 animate-pulse rounded-xs bg-surface-sunken"
          style={{ width: `${100 - index * 12}%` }}
        />
      ))}
    </div>
  </Card>
);

/** An inline skeleton for a single value inside an already-rendered card. */
export const SkeletonText = ({ width = '6rem' }: { readonly width?: string }) => (
  <span
    aria-hidden="true"
    className="inline-block h-4 animate-pulse rounded-xs bg-surface-sunken align-middle"
    style={{ width }}
  />
);

/**
 * A capability the release does not include.
 *
 * The honest alternative to a fabricated panel. UI specification §2: label it,
 * and state what it will need — a reader then knows it is absent by decision
 * rather than broken.
 */
export const PlannedState = ({
  title,
  description,
  requirement,
}: {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  /** What has to exist first, in one plain sentence. */
  readonly requirement?: ReactNode;
}) => (
  <Frame
    icon={<AlertTriangle className="size-6" />}
    tone="bg-surface-sunken text-ink-subtle"
    title={title}
  >
    {description === undefined ? null : <p>{description}</p>}
    {requirement === undefined ? null : (
      <p className="mt-2 text-xs text-ink-subtle">Needs: {requirement}</p>
    )}
  </Frame>
);
