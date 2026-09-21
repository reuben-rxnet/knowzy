// Knowledge -> Evidence -> Review -> Approval -> Publication.
//
// The five stages every question passes through, as one strip. It answers a
// question no other surface on the screen answers in one glance: HOW FAR has
// this question got, and WHAT RECORD backs each stage it has passed.
//
// The difference from `ProvenanceTimeline`, which is next to it in this
// package and must not be collapsed into it:
//
//   * `ProvenanceTimeline` draws HISTORY. A step exists only because a row
//     exists, and nothing is ever drawn as pending, because the absence of a
//     record is not evidence of a future event.
//   * This draws a DEFINED SEQUENCE. All five stages always exist in the
//     domain, so a stage with no record yet is legitimately "not yet" — that
//     is a fact about the workflow, not a prediction.
//
// A stage never invents its own facts: `facts` is what the caller read out of
// a payload, and a stage with nothing to show says only that it has been
// reached.

import type { ReactNode } from 'react';
import { Check } from 'lucide-react';

export interface TraceStage {
  /** The stage's name. One of the five, supplied by the app (C1). */
  readonly label: string;
  /**
   * Whether the platform holds a record for this stage.
   *
   * The caller decides this from a field, never from a status string it
   * pattern-matched: `reached` must mean "there is a row".
   */
  readonly reached: boolean;
  /** The single fact that identifies the record — a document name, a decision. */
  readonly summary?: ReactNode;
  /** Identifiers and values behind it. Rendered monospace. */
  readonly facts?: readonly { readonly label: string; readonly value: ReactNode }[];
  readonly tone?: 'ai' | 'info' | 'success' | 'neutral';
}

const REACHED: Record<NonNullable<TraceStage['tone']>, string> = {
  ai: 'border-ai/35 bg-ai-soft',
  info: 'border-info/35 bg-info-soft',
  success: 'border-success/35 bg-success-soft',
  neutral: 'border-line bg-surface-sunken',
};

const MARK: Record<NonNullable<TraceStage['tone']>, string> = {
  ai: 'bg-ai text-white',
  info: 'bg-info text-white',
  success: 'bg-success text-white',
  neutral: 'bg-neutral-soft text-ink-muted',
};

/**
 * @param stages The five, in order. Fewer is allowed; reordering is not the
 *   component's business.
 * @param labels The two words for a stage's state. They are announced, not
 *   implied by colour — a pending stage differs from a reached one by its
 *   glyph, its border, its text and its accessible name, per §7.
 */
export const TraceabilityChain = ({
  stages,
  labels,
}: {
  readonly stages: readonly TraceStage[];
  readonly labels: { readonly reached: string; readonly pending: string; readonly stage: string };
}) => (
  <ol className="grid gap-2 md:grid-cols-5">
    {stages.map((stage, index) => {
      const tone = stage.tone ?? 'neutral';
      return (
        <li
          key={stage.label}
          className={`flex flex-col gap-1.5 rounded-lg border p-3 ${
            stage.reached ? REACHED[tone] : 'border-dashed border-line bg-surface'
          }`}
        >
          <span className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={`grid size-5 shrink-0 place-items-center rounded-pill text-2xs font-bold ${
                stage.reached
                  ? MARK[tone]
                  : 'bg-surface-sunken text-ink-subtle ring-1 ring-inset ring-line'
              }`}
            >
              {stage.reached ? <Check className="size-3" /> : index + 1}
            </span>
            <span
              className={`text-2xs font-bold uppercase tracking-wide ${
                stage.reached ? 'text-brand-navy-text' : 'text-ink-subtle'
              }`}
            >
              {stage.label}
            </span>
          </span>

          {/* Stated, not coloured. A reader who cannot see the border style,
              and a screen reader that reads neither, both get the word. */}
          <span className="text-sm text-ink-muted">
            <span className="knowzy-sr-only">
              {labels.stage} {index + 1}:{' '}
            </span>
            {stage.reached ? (stage.summary ?? labels.reached) : labels.pending}
          </span>

          {!stage.reached || stage.facts === undefined || stage.facts.length === 0 ? null : (
            <dl className="flex flex-col gap-0.5">
              {stage.facts.map((fact) => (
                <div key={fact.label} className="flex flex-col">
                  <dt className="text-2xs uppercase tracking-wide text-ink-subtle">{fact.label}</dt>
                  <dd className="break-words font-mono text-2xs text-ink">{fact.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </li>
      );
    })}
  </ol>
);

/**
 * The same five stages as one compact bar, for a row in a list.
 *
 * Carries no facts — it is a position indicator, and the full chain is one
 * click away on the question. It is `role="img"` with the whole chain in its
 * accessible name, so it is announced once as a summary rather than as five
 * unlabelled cells.
 */
export const TraceabilityBar = ({
  stages,
  label,
}: {
  readonly stages: readonly TraceStage[];
  /** Renders the complete accessible name. The caller owns the wording (C1). */
  readonly label: string;
}) => (
  <span role="img" aria-label={label} className="inline-flex items-center gap-0.5">
    {stages.map((stage) => (
      <span
        key={stage.label}
        title={stage.label}
        className={`h-1.5 w-5 rounded-pill ${
          stage.reached
            ? MARK[stage.tone ?? 'neutral']
            : 'bg-neutral-soft ring-1 ring-inset ring-line'
        }`}
      />
    ))}
  </span>
);
