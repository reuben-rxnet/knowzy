// The approval gate checklist, and the provenance trail.
//
// Both render records the server produced. Neither evaluates anything: the
// thirteen gates are re-evaluated server-side at the moment of every
// transition (§5.7), and a provenance step exists only because a row exists.
//
// §28 names both ("Approval Gate Checklist", "Provenance Timeline").

import type { ReactNode } from 'react';
import { Check, CircleDashed, X } from 'lucide-react';

export interface GateResultLike {
  readonly gate: number;
  readonly code: string;
  readonly passed: boolean;
  readonly detail: string;
  readonly field?: string | null;
}

/**
 * Thirteen gates, as a rail and a list.
 *
 * The rail exists so "which gate" is answerable at a glance; it is numbered
 * and carries a glyph per segment, so it does not depend on colour (§7). The
 * list underneath is the real content — a gate an approver cannot read the
 * reason for is not useful.
 *
 * `advisory` is the server's own sentence and is rendered verbatim. A green
 * rail is a preview, not permission, and the component says so rather than
 * leaving the reader to infer it.
 */
export const ApprovalGateChecklist = ({
  gates,
  passed,
  advisory,
  failedFirst = false,
  labels,
}: {
  readonly gates: readonly GateResultLike[];
  readonly passed: boolean;
  readonly advisory: ReactNode;
  /** Lists the failures above the rest, for an approver triaging. */
  readonly failedFirst?: boolean;
  readonly labels: {
    readonly pass: string;
    readonly fail: string;
    readonly summary: (args: { passed: number; total: number }) => string;
    readonly gate: string;
  };
}) => {
  const passedCount = gates.filter((gate) => gate.passed).length;
  const ordered = failedFirst
    ? [...gates].sort((a, b) => Number(a.passed) - Number(b.passed) || a.gate - b.gate)
    : gates;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-base font-semibold text-brand-navy-text">
          {labels.summary({ passed: passedCount, total: gates.length })}
        </p>
        <span
          className={`inline-flex items-center gap-1.5 rounded-pill px-3 py-1 text-sm font-bold ring-1 ring-inset ${
            passed
              ? 'bg-success-soft text-success ring-success/25'
              : 'bg-danger-soft text-danger ring-danger/25'
          }`}
        >
          {passed ? (
            <Check aria-hidden="true" className="size-4" />
          ) : (
            <X aria-hidden="true" className="size-4" />
          )}
          {passed ? labels.pass : labels.fail}
        </span>
      </div>

      {/* The rail. Decorative: every segment's meaning is in the list below,
          so it is hidden from assistive technology rather than read out as
          thirteen unlabelled cells. */}
      <ol aria-hidden="true" className="flex flex-wrap gap-1">
        {gates.map((gate) => (
          <li
            key={gate.code}
            title={`${labels.gate} ${gate.gate} · ${gate.code}`}
            className={`flex h-7 min-w-9 items-center justify-center gap-1 rounded-sm px-1.5 text-2xs font-bold ${
              gate.passed
                ? 'bg-success-soft text-success ring-1 ring-inset ring-success/25'
                : 'bg-danger-soft text-danger ring-1 ring-inset ring-danger/30'
            }`}
          >
            {gate.gate}
            {gate.passed ? <Check className="size-3" /> : <X className="size-3" />}
          </li>
        ))}
      </ol>

      <p className="text-sm text-ink-muted">{advisory}</p>

      <ol className="flex flex-col divide-y divide-line rounded-md border border-line">
        {ordered.map((gate) => (
          <li key={gate.code} className="flex items-start gap-3 px-3 py-2.5">
            <span
              aria-hidden="true"
              className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-pill ${
                gate.passed ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'
              }`}
            >
              {gate.passed ? <Check className="size-3.5" /> : <X className="size-3.5" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono text-2xs font-bold text-ink-subtle">
                  {labels.gate} {gate.gate}
                </span>
                <span className="text-base font-semibold text-brand-navy-text">{gate.code}</span>
                <span className="knowzy-sr-only">{gate.passed ? labels.pass : labels.fail}</span>
              </span>
              <span className="mt-0.5 block text-sm text-ink-muted">{gate.detail}</span>
              {gate.field === undefined || gate.field === null ? null : (
                <span className="mt-0.5 block font-mono text-2xs text-ink-subtle">
                  {gate.field}
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
};

export interface ProvenanceStep {
  readonly title: ReactNode;
  /** Omitted when the platform does not record a time for this step. */
  readonly when?: ReactNode;
  readonly detail?: ReactNode;
  readonly facts?: readonly { readonly label: ReactNode; readonly value: ReactNode }[];
  readonly tone?: 'ai' | 'info' | 'success' | 'warning' | 'neutral';
  /** Decorative glyph for the step's dot. Falls back to a neutral marker. */
  readonly icon?: ReactNode;
}

const DOT: Record<NonNullable<ProvenanceStep['tone']>, string> = {
  ai: 'bg-ai-soft text-ai ring-ai/25',
  info: 'bg-info-soft text-info ring-info/25',
  success: 'bg-success-soft text-success ring-success/25',
  warning: 'bg-warning-soft text-warning ring-warning/25',
  neutral: 'bg-neutral-soft text-ink-muted ring-line',
};

/**
 * Where a published question came from, step by step.
 *
 * A step appears ONLY when a record exists for it — no step is drawn as
 * "pending" or "expected", because the absence of a record is not evidence of
 * a future event. A question that was never retired simply has no retirement
 * step.
 *
 * A step with no recorded time says nothing about when rather than guessing.
 */
export const ProvenanceTimeline = ({ steps }: { readonly steps: readonly ProvenanceStep[] }) => (
  <ol className="flex flex-col">
    {steps.map((step, index) => {
      const last = index === steps.length - 1;
      return (
        <li key={index} className="flex gap-3">
          <span className="flex flex-col items-center">
            <span
              aria-hidden="true"
              className={`grid size-7 shrink-0 place-items-center rounded-pill ring-1 ring-inset ${
                DOT[step.tone ?? 'neutral']
              }`}
            >
              {step.icon ?? <CircleDashed className="size-3.5" />}
            </span>
            {last ? null : <span aria-hidden="true" className="w-px flex-1 bg-line" />}
          </span>
          <div className={`min-w-0 flex-1 ${last ? '' : 'pb-5'}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className="text-base font-semibold text-brand-navy-text">{step.title}</p>
              {step.when === undefined ? null : (
                <p className="text-sm text-ink-subtle">{step.when}</p>
              )}
            </div>
            {step.detail === undefined ? null : (
              <p className="mt-0.5 text-sm text-ink-muted">{step.detail}</p>
            )}
            {step.facts === undefined || step.facts.length === 0 ? null : (
              <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[minmax(7rem,auto)_1fr]">
                {step.facts.map((fact, factIndex) => (
                  <div key={factIndex} className="contents">
                    <dt className="text-sm text-ink-subtle">{fact.label}</dt>
                    <dd className="break-all font-mono text-sm text-ink">{fact.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </li>
      );
    })}
  </ol>
);
