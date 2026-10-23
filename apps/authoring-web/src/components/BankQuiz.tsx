'use client';

// AI Document Studio, Simple mode -- build a quiz from the question bank
// (docs/competencies/AI_DOCUMENT_STUDIO_ARCHITECTURE.md §12.7).
//
// One form. The domain drives the topic list and the count of published
// questions available, so the number asked for can be checked against what
// exists before anything is sent; only domains and topics with published
// questions are offered. The server checks the count again.

import { useActionState, useState } from 'react';
import { Button, Field, Select, TextInput } from '@knowzy/shared-ui';
import { Loader2, Shuffle } from 'lucide-react';
import { t } from '../copy';
import { buildBankQuizAction } from '../app/document-studio/quick-actions';
import { Problem } from './Problem';
import { questionsLabel } from './quiz-status';
import type { WizardDomain } from './GenerateWizard';

export interface PoolCount {
  readonly domainId: string;
  readonly topicId: string;
  readonly count: number;
}

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
  const withQuestions = domains.filter((domain) =>
    pools.some((pool) => pool.domainId === domain.domainId && pool.count > 0),
  );
  const [domainId, setDomainId] = useState(withQuestions[0]?.domainId ?? '');
  const [topicId, setTopicId] = useState('');
  const domain = withQuestions.find((row) => row.domainId === domainId);
  const topics = (domain?.topics ?? []).filter((topic) =>
    pools.some((pool) => pool.topicId === topic.topicId && pool.count > 0),
  );
  const countIn = (id: string): number =>
    pools.filter((pool) => pool.topicId === id).reduce((sum, pool) => sum + pool.count, 0);
  const available =
    topicId.length > 0
      ? countIn(topicId)
      : pools.filter((pool) => pool.domainId === domainId).reduce((sum, p) => sum + p.count, 0);

  if (withQuestions.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line bg-brand-surface px-5 py-6 text-sm text-ink-muted">
        {t('bq.emptyBank')}
      </p>
    );
  }

  return (
    <form action={submit} className="flex flex-col gap-6" data-bank-quiz>
      <div className="grid gap-5 md:grid-cols-3">
        <Field id="bq-domain" label={t('bq.domain')}>
          <Select
            id="bq-domain"
            name="domainId"
            value={domainId}
            onChange={(event) => {
              setDomainId(event.target.value);
              setTopicId('');
            }}
          >
            {withQuestions.map((row) => (
              <option key={row.domainId} value={row.domainId}>
                {row.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="bq-topic" label={t('bq.topic')}>
          <Select
            id="bq-topic"
            name="topicId"
            value={topicId}
            onChange={(event) => setTopicId(event.target.value)}
          >
            <option value="">{t('bq.allTopics')}</option>
            {topics.map((topic) => (
              <option key={topic.topicId} value={topic.topicId}>
                {topic.name} ({countIn(topic.topicId)})
              </option>
            ))}
          </Select>
        </Field>
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
            defaultValue={Math.min(10, Math.max(1, available))}
            required
          />
        </Field>
      </div>
      <p className="max-w-prose text-sm text-ink-muted">{t('bq.drawNote')}</p>

      <div className="grid gap-5 md:grid-cols-[2fr_1fr]">
        <Field id="bq-name" label={t('qq.quizName')}>
          <TextInput
            id="bq-name"
            name="name"
            defaultValue={
              topicId.length > 0
                ? (topics.find((topic) => topic.topicId === topicId)?.name ?? '')
                : (domain?.name ?? '')
            }
            key={`${domainId}|${topicId}`}
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
            disabled={available === 0}
            {...(available === 0 ? { disabledReason: t('bq.emptyTopic') } : {})}
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
