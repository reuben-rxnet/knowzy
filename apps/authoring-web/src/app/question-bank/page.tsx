// Question Bank -- the simple, read-only view (AI_DOCUMENT_STUDIO_ARCHITECTURE.md §12.6).
//
// Every published question, newest first, filterable by domain and topic,
// with its options, the answer and the explanation. Read-only on purpose:
// retiring and republishing stay on the full Publish screen, where their
// confirmations and reasons live. The filters are a plain GET form, so a
// filtered bank is a link.

import { Card, CardBody, EmptyState, Field, PageHero, Select } from '@knowzy/shared-ui';
import { t } from '../../copy';
import { api } from '../../lib/api';
import { Problem } from '../../components/Problem';
import { currentSubject } from '../../lib/identity';
import type { WizardDomain } from '../../components/GenerateWizard';
import { questionsLabel } from '../../components/quiz-status';

interface BankItem {
  readonly bankQuestionId: string;
  readonly questionId: string;
  readonly questionText: string;
  readonly status: string;
  readonly isActive: boolean;
  readonly publishedAt: string;
  readonly options: Readonly<Record<string, string>>;
  readonly proposedCorrectOption: string | null;
  readonly explanation: string;
  readonly domain: string;
  readonly topic: string;
  readonly sourceDocument: string;
}

export const dynamic = 'force-dynamic';

const day = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export default async function QuestionBankPage({
  searchParams,
}: {
  searchParams: Promise<{ domain?: string; topic?: string }>;
}) {
  const query = await searchParams;
  const subject = await currentSubject();
  const filter = new URLSearchParams();
  if (query.domain) filter.set('domainId', query.domain);
  if (query.topic) filter.set('topicId', query.topic);
  const [bank, taxonomy] = await Promise.all([
    api<{ count: number; items: readonly BankItem[] }>(
      `/api/v1/authoring/question-bank${filter.size > 0 ? `?${filter.toString()}` : ''}`,
    ),
    api<{ domains: readonly WizardDomain[] }>('/api/v1/authoring/taxonomy'),
  ]);
  const hero = <PageHero title={t('qb.heading')} purpose={t('qb.intro')} />;
  if (!bank.ok) {
    return (
      <div className="flex flex-col gap-6">
        {hero}
        <Problem problem={bank.problem} actingAs={subject.label} />
      </div>
    );
  }
  const domains = taxonomy.ok ? taxonomy.data.domains : [];
  const chosenDomain = domains.find((domain) => domain.domainId === query.domain);
  const topics = chosenDomain?.topics ?? domains.flatMap((domain) => domain.topics);
  const items = bank.data.items.filter((item) => item.status === 'PUBLISHED' && item.isActive);

  return (
    <div className="flex flex-col gap-6">
      {hero}
      <form method="get" className="flex flex-wrap items-end gap-4" aria-label={t('qb.filters')}>
        <Field id="qb-domain" label={t('qb.domain')}>
          <Select id="qb-domain" name="domain" defaultValue={query.domain ?? ''}>
            <option value="">{t('qb.allDomains')}</option>
            {domains.map((domain) => (
              <option key={domain.domainId} value={domain.domainId}>
                {domain.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="qb-topic" label={t('qb.topic')}>
          <Select id="qb-topic" name="topic" defaultValue={query.topic ?? ''}>
            <option value="">{t('qb.allTopics')}</option>
            {topics.map((topic) => (
              <option key={topic.topicId} value={topic.topicId}>
                {topic.name}
              </option>
            ))}
          </Select>
        </Field>
        <button
          type="submit"
          className="min-h-target rounded-md border border-line bg-brand-surface px-4 text-sm font-semibold text-brand-navy-text hover:bg-surface-hover"
        >
          {t('qb.apply')}
        </button>
        <span className="pb-2 text-sm text-ink-muted" data-bank-count={items.length}>
          {t('qb.count', { questions: questionsLabel(items.length) })}
        </span>
      </form>

      {items.length === 0 ? (
        <EmptyState title={t('qb.empty')} description={t('qb.emptyBody')} />
      ) : (
        <ol className="flex flex-col gap-4" data-bank-questions>
          {items.map((item) => (
            <li key={item.bankQuestionId}>
              <Card>
                <CardBody>
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h2 className="text-base font-semibold text-ink">{item.questionText}</h2>
                      <span className="shrink-0 font-mono text-2xs text-ink-subtle">
                        {item.bankQuestionId}
                      </span>
                    </div>
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {Object.entries(item.options).map(([key, text]) => {
                        const correct = key === item.proposedCorrectOption;
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
                                {t('qb.answer')}
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
                      <p className="mt-2 text-ink-muted">{item.explanation}</p>
                    </details>
                    <p className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-ink-muted">
                      <span>
                        {item.domain} › {item.topic}
                      </span>
                      <span>{t('qb.from', { name: item.sourceDocument })}</span>
                      <span>{t('qb.published', { date: day(item.publishedAt) })}</span>
                    </p>
                  </div>
                </CardBody>
              </Card>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
