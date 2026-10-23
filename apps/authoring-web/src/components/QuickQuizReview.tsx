'use client';

// AI Document Studio, Simple mode -- approve, then publish
// (docs/competencies/AI_DOCUMENT_STUDIO_ARCHITECTURE.md §12.4).
//
// Approval stays a person's decision on each question: every approvable
// question has its own checkbox, UNTICKED, and there is deliberately no
// "select all". "Approve selected" walks only the ticked ones through the real
// transitions; a question the gates refuse shows the gates' reasons on its own
// card. "Publish quiz" appears once something is approved.

import { useActionState, useState } from 'react';
import { Button, Field, TextInput } from '@knowzy/shared-ui';
import { CheckCircle2, Library, Loader2, Rocket } from 'lucide-react';
import { t } from '../copy';
import {
  approveQuestionsAction,
  publishQuizAction,
  type ApprovalFailure,
} from '../app/document-studio/quick-actions';
import { Problem } from './Problem';
import { APPROVABLE } from './quiz-status';

export interface QuizQuestion {
  readonly questionId: string;
  readonly status: string;
  readonly questionText: string;
  readonly options: Readonly<Record<string, string>>;
  readonly proposedCorrectOption: string;
  readonly explanation: string;
}

const StatusPill = ({ status }: { readonly status: string }) => {
  const done = status === 'APPROVED' || status === 'PUBLISHED';
  const gone = status === 'REJECTED' || status === 'RETIRED' || status === 'ARCHIVED';
  const tone = done
    ? 'bg-success-soft text-success'
    : gone
      ? 'bg-danger-soft text-danger'
      : 'bg-warning-soft text-warning';
  const label =
    status === 'APPROVED'
      ? t('qq.statusApproved')
      : status === 'PUBLISHED'
        ? t('qq.statusPublished')
        : gone
          ? t('qq.statusRejected')
          : t('qq.draft');
  return (
    <span
      className={`shrink-0 rounded-pill px-2 py-0.5 text-2xs font-semibold ${tone}`}
      data-question-status={status}
    >
      {label}
    </span>
  );
};

const Working = ({ label }: { readonly label: string }) => (
  <div
    role="status"
    className="flex items-center gap-2 rounded-md bg-info-soft px-4 py-2 font-semibold text-brand-navy-text"
  >
    <Loader2 aria-hidden="true" className="size-4 animate-spin text-brand-blue" />
    {label}
  </div>
);

export const QuizReview = ({
  questions,
  actingAs,
}: {
  readonly questions: readonly QuizQuestion[];
  readonly actingAs: string;
}) => {
  const [state, submit, pending] = useActionState(approveQuestionsAction, null);
  const failures =
    ((state?.data ?? null) as { failures?: readonly ApprovalFailure[] } | null)?.failures ?? [];
  const approvable = questions.filter((question) => APPROVABLE.has(question.status));

  return (
    <form action={submit} className="flex flex-col gap-4">
      <ol className="flex flex-col gap-4" data-quiz-questions>
        {questions.map((question, index) => {
          const canApprove = APPROVABLE.has(question.status);
          const failure = failures.find((row) => row.questionId === question.questionId);
          return (
            <li key={question.questionId}>
              <div
                className={`flex flex-col gap-3 rounded-xl border bg-brand-surface p-5 ${
                  failure === undefined ? 'border-line' : 'border-danger'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <label className="flex items-start gap-3">
                    {canApprove ? (
                      <input
                        type="checkbox"
                        name="questionIds"
                        value={question.questionId}
                        className="mt-1 size-5 shrink-0 accent-brand-blue"
                        aria-label={t('qq.tickToApprove', { n: index + 1 })}
                      />
                    ) : (
                      <CheckCircle2
                        aria-hidden="true"
                        className={`mt-0.5 size-5 shrink-0 ${
                          question.status === 'APPROVED' || question.status === 'PUBLISHED'
                            ? 'text-success'
                            : 'text-ink-subtle'
                        }`}
                      />
                    )}
                    <span className="text-base font-semibold text-ink">
                      <span className="mr-2 text-brand-blue">{index + 1}.</span>
                      {question.questionText}
                    </span>
                  </label>
                  <StatusPill status={question.status} />
                </div>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {Object.entries(question.options).map(([key, text]) => {
                    const correct = key === question.proposedCorrectOption;
                    return (
                      <li
                        key={key}
                        className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
                          correct
                            ? 'border-success bg-success-soft text-ink'
                            : 'border-line text-ink'
                        }`}
                      >
                        <span className="font-semibold">{key}.</span>
                        <span className="flex-1">{text}</span>
                        {correct ? (
                          <span className="text-2xs font-semibold text-success">
                            {t('qq.proposedAnswer')}
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
                <details className="text-sm">
                  <summary className="cursor-pointer text-brand-blue">
                    {t('qq.explanation')}
                  </summary>
                  <p className="mt-2 text-ink-muted">{question.explanation}</p>
                </details>
                {failure === undefined ? null : (
                  <Problem problem={failure.problem} actingAs={actingAs} />
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {approvable.length > 0 ? (
        <div className="sticky bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-brand-surface px-5 py-4 shadow-md">
          <span className="max-w-prose text-sm text-ink-muted">{t('qq.approveHint')}</span>
          {pending ? (
            <Working label={t('qq.approving')} />
          ) : (
            <Button>
              <CheckCircle2 aria-hidden="true" className="size-4" />
              {t('qq.approveSelected')}
            </Button>
          )}
        </div>
      ) : null}
      {state?.ok === false && state.problem !== undefined ? (
        <Problem problem={state.problem} actingAs={actingAs} />
      ) : null}
    </form>
  );
};

export const PublishQuizForm = ({
  jobId,
  defaultName,
  actingAs,
}: {
  readonly jobId: string;
  readonly defaultName: string;
  readonly actingAs: string;
}) => {
  const [state, submit, pending] = useActionState(publishQuizAction, null);
  const [intent, setIntent] = useState<'quiz' | 'bank'>('quiz');
  const choices = [
    { value: 'quiz', title: t('qq.choiceQuiz'), body: t('qq.choiceQuizBody'), Icon: Rocket },
    { value: 'bank', title: t('qq.choiceBank'), body: t('qq.choiceBankBody'), Icon: Library },
  ] as const;
  return (
    <form action={submit} className="flex flex-col gap-5">
      <input type="hidden" name="jobId" value={jobId} />
      <fieldset className="grid gap-3 md:grid-cols-2">
        <legend className="knowzy-sr-only">{t('qq.choiceLegend')}</legend>
        {choices.map((choice) => (
          <label
            key={choice.value}
            className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 ${
              intent === choice.value
                ? 'border-brand-blue bg-info-soft'
                : 'border-line bg-brand-surface hover:bg-surface-hover'
            }`}
          >
            <input
              type="radio"
              name="intent"
              value={choice.value}
              checked={intent === choice.value}
              onChange={() => setIntent(choice.value)}
              className="mt-1 size-4 accent-brand-blue"
            />
            <choice.Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-brand-blue" />
            <span className="flex flex-col gap-1">
              <span className="font-semibold text-brand-navy-text">{choice.title}</span>
              <span className="text-sm text-ink-muted">{choice.body}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {intent === 'quiz' ? (
        <div className="flex flex-col gap-4">
          <div className="grid gap-5 md:grid-cols-[2fr_1fr]">
            <Field id="qq-quiz-name" label={t('qq.quizName')}>
              <TextInput
                id="qq-quiz-name"
                name="name"
                defaultValue={defaultName}
                maxLength={200}
                required
              />
            </Field>
            <Field id="qq-pass" label={t('qq.passMark')} hint={t('qq.passMarkHint')}>
              <TextInput
                id="qq-pass"
                name="passPercentage"
                type="number"
                min={0}
                max={100}
                defaultValue={70}
                required
              />
            </Field>
          </div>
          <label className="flex items-start gap-3 text-sm text-ink">
            <input
              type="checkbox"
              name="showAnswers"
              defaultChecked
              className="mt-0.5 size-4 accent-brand-blue"
            />
            <span className="flex flex-col">
              <span className="font-medium">{t('qq.showAnswers')}</span>
              <span className="text-ink-muted">{t('qq.showAnswersHint')}</span>
            </span>
          </label>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {pending ? (
          <Working label={t('qq.publishing')} />
        ) : (
          <Button tone="success">
            {intent === 'quiz' ? (
              <Rocket aria-hidden="true" className="size-4" />
            ) : (
              <Library aria-hidden="true" className="size-4" />
            )}
            {intent === 'quiz' ? t('qq.publishQuiz') : t('qq.addToBank')}
          </Button>
        )}
        <span className="max-w-prose text-sm text-ink-muted">
          {intent === 'quiz' ? t('qq.publishHint') : t('qq.addToBankHint')}
        </span>
      </div>
      {state?.ok === false && state.problem !== undefined ? (
        <Problem problem={state.problem} actingAs={actingAs} />
      ) : null}
    </form>
  );
};
