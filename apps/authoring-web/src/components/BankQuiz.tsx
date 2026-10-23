'use client';

// AI Document Studio, Simple mode -- build a quiz from the question bank
// (docs/competencies/AI_DOCUMENT_STUDIO_ARCHITECTURE.md §12.7).
//
// One form. A domain dropdown (one domain: a quiz belongs to one) drives a
// topics dropdown with a check mark per topic and "Select all", each with its
// count of published questions; only domains and topics with published questions
// are offered. Two ways to draw: MIXED (RANDOM_POOL over the ticked topics'
// combined pool) or EVEN (TOPIC_BALANCED: each topic gives an equal share).
// The share each topic must give is computed here exactly as the server's
// validation computes it (allocateEvenly over the SORTED topic ids), so a
// shortfall is shown before anything is sent. The server checks again.

import { useActionState, useState } from 'react';
import { Button, Field, TextInput } from '@knowzy/shared-ui';
import { Loader2, Shuffle } from 'lucide-react';
import { t } from '../copy';
import { buildBankQuizAction } from '../app/document-studio/quick-actions';
import { CheckDropdown } from './CheckDropdown';
import { Problem } from './Problem';
import { questionsLabel } from './quiz-status';
import type { WizardDomain } from './GenerateWizard';

export interface PoolCount {
  readonly domainId: string;
  readonly topicId: string;
  readonly count: number;
}

/** The server's allocateEvenly: base share each, the remainder to the first ids in sorted order. */
const evenShares = (topicIds: readonly string[], total: number): Map<string, number> => {
  const sorted = [...topicIds].sort();
  const base = Math.floor(total / Math.max(1, sorted.length));
  let remainder = total % Math.max(1, sorted.length);
  const out = new Map<string, number>();
  for (const id of sorted) {
    out.set(id, base + (remainder > 0 ? 1 : 0));
    if (remainder > 0) remainder -= 1;
  }
  return out;
};

export const BankQuizForm = ({
  domains,
  pools,
  actingAs,
}: {
  readonly domains: readonly WizardDomain[];
  readonly pools: readonly PoolCount[];
  readonly actingAs: string;
}) => {
  const [state, submit, pending] = useActionState(buildBankQuizAction, null);
  const countIn = (id: string): number =>
    pools.filter((pool) => pool.topicId === id).reduce((sum, pool) => sum + pool.count, 0);
  const withQuestions = domains.filter((domain) =>
    domain.topics.some((topic) => countIn(topic.topicId) > 0),
  );
  const topicsOf = (id: string) =>
    (withQuestions.find((row) => row.domainId === id)?.topics ?? []).filter(
      (topic) => countIn(topic.topicId) > 0,
    );

  const [domainId, setDomainId] = useState(withQuestions[0]?.domainId ?? '');
  const [chosen, setChosen] = useState<readonly string[]>(
    topicsOf(withQuestions[0]?.domainId ?? '').map((topic) => topic.topicId),
  );
  const [draw, setDraw] = useState<'mixed' | 'even'>('mixed');
  const [count, setCount] = useState(10);

  const domain = withQuestions.find((row) => row.domainId === domainId);
  const topics = topicsOf(domainId);
  const available = chosen.reduce((sum, id) => sum + countIn(id), 0);
  const shares = evenShares(chosen, count);
  const short = draw === 'even' ? chosen.filter((id) => (shares.get(id) ?? 0) > countIn(id)) : [];
  const nameOf = (id: string) => topics.find((topic) => topic.topicId === id)?.name ?? '';
  const problem =
    chosen.length === 0
      ? t('bq.noTopicChosen')
      : count > available
        ? t('bq.tooMany', { questions: questionsLabel(available) })
        : short.length > 0
          ? t('bq.evenShort', { topics: short.map(nameOf).join(', ') })
          : null;

  if (withQuestions.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line bg-brand-surface px-5 py-6 text-sm text-ink-muted">
        {t('bq.emptyBank')}
      </p>
    );
  }

  return (
    <form action={submit} className="flex flex-col gap-6" data-bank-quiz>
      <div className="grid items-start gap-5 md:grid-cols-3">
        <CheckDropdown
          id="bq-domain"
          label={t('bq.domain')}
          name="domainId"
          single
          options={withQuestions.map((row) => ({
            value: row.domainId,
            label: row.name,
            hint: questionsLabel(
              topicsOf(row.domainId).reduce((sum, topic) => sum + countIn(topic.topicId), 0),
            ),
          }))}
          selected={domainId.length === 0 ? [] : [domainId]}
          onChange={(next) => {
            const value = next[0] ?? '';
            setDomainId(value);
            setChosen(topicsOf(value).map((topic) => topic.topicId));
          }}
          summary={domain?.name ?? t('bq.chooseDomain')}
        />
        <CheckDropdown
          id="bq-topics"
          label={t('bq.topics')}
          name="topicIds"
          options={topics.map((topic) => ({
            value: topic.topicId,
            label: topic.name,
            hint: questionsLabel(countIn(topic.topicId)),
          }))}
          selected={chosen}
          onChange={setChosen}
          selectAllLabel={t('bq.allTopicsButton')}
          summary={
            chosen.length === 0
              ? t('bq.noTopicChosenShort')
              : chosen.length === 1
                ? nameOf(chosen[0] ?? '')
                : chosen.length === topics.length
                  ? t('bq.allTopicsSummary', { count: topics.length })
                  : t('bq.someTopicsSummary', { count: chosen.length })
          }
        />
        <Field
          id="bq-count"
          label={t('qq.countLabel')}
          hint={t('bq.available', { questions: questionsLabel(available) })}
        >
          <TextInput
            id="bq-count"
            name="questionCount"
            type="number"
            min={1}
            max={Math.max(1, available)}
            defaultValue={10}
            onChange={(event) => setCount(Number(event.target.value) || 0)}
            required
          />
        </Field>
      </div>

      {chosen.length > 1 ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-base font-semibold text-brand-navy-text">
            {t('bq.drawLabel')}
          </legend>
          <div className="grid gap-3 md:grid-cols-2">
            {(
              [
                { value: 'mixed', title: t('bq.drawMixed'), body: t('bq.drawMixedBody') },
                { value: 'even', title: t('bq.drawEven'), body: t('bq.drawEvenBody') },
              ] as const
            ).map((option) => (
              <label
                key={option.value}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 ${
                  draw === option.value
                    ? 'border-brand-blue bg-info-soft'
                    : 'border-line bg-brand-surface hover:bg-surface-hover'
                }`}
              >
                <input
                  type="radio"
                  name="draw"
                  value={option.value}
                  checked={draw === option.value}
                  onChange={() => setDraw(option.value)}
                  className="mt-1 size-4 accent-brand-blue"
                />
                <span className="flex flex-col gap-1">
                  <span className="font-semibold text-brand-navy-text">{option.title}</span>
                  <span className="text-sm text-ink-muted">{option.body}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <p className="max-w-prose text-sm text-ink-muted">{t('bq.drawNote')}</p>

      <div className="grid items-start gap-5 md:grid-cols-3">
        <Field id="bq-name" label={t('qq.quizName')} className="md:col-span-2">
          <TextInput
            id="bq-name"
            name="name"
            defaultValue={chosen.length === 1 ? nameOf(chosen[0] ?? '') : (domain?.name ?? '')}
            key={`${domainId}|${chosen.length === 1 ? chosen[0] : 'many'}`}
            maxLength={200}
            required
          />
        </Field>
        <Field id="bq-pass" label={t('qq.passMark')} hint={t('qq.passMarkHint')}>
          <TextInput
            id="bq-pass"
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

      {problem === null ? null : (
        <p role="status" className="text-sm font-medium text-warning" data-bank-problem>
          {problem}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {pending ? (
          <div
            role="status"
            className="flex items-center gap-2 rounded-md bg-info-soft px-4 py-2 font-semibold text-brand-navy-text"
          >
            <Loader2 aria-hidden="true" className="size-4 animate-spin text-brand-blue" />
            {t('qq.publishing')}
          </div>
        ) : (
          <Button
            tone="success"
            disabled={problem !== null}
            {...(problem === null ? {} : { disabledReason: problem })}
          >
            <Shuffle aria-hidden="true" className="size-4" />
            {t('qq.publishQuiz')}
          </Button>
        )}
      </div>
      {state?.ok === false && state.problem !== undefined ? (
        <Problem problem={state.problem} actingAs={actingAs} />
      ) : null}
    </form>
  );
};
