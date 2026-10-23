// AI Document Studio, Simple mode (docs/competencies/AI_DOCUMENT_STUDIO_ARCHITECTURE.md §12).
//
// Four states of one page, chosen by the URL so each can be reloaded and
// linked: the drop zone; the quiz settings for an uploaded document
// (`?document=&source=`); the questions of a job, to approve and publish
// (`?job=`); and the published quiz (`?job=&quiz=`). Approval is a person
// ticking each question; publishing is its own click; nothing in Simple mode
// approves or publishes on its own.

import { headers } from 'next/headers';
import { ButtonLink, Card, CardBody, PageHero } from '@knowzy/shared-ui';
import { AlertTriangle, CheckCircle2, ExternalLink, PartyPopper } from 'lucide-react';
import { t } from '../../copy';
import { api } from '../../lib/api';
import { Problem } from '../../components/Problem';
import { QuizDropzone, QuizSettingsForm } from '../../components/QuickQuiz';
import { APPROVABLE } from '../../components/quiz-status';
import { PublishQuizForm, QuizReview, type QuizQuestion } from '../../components/QuickQuizReview';
import type { GenerationProviderChoice, WizardDomain } from '../../components/GenerateWizard';

interface JobRead {
  readonly jobId: string;
  readonly status: string;
  readonly requestedQuestionCount: number;
  readonly persistedQuestionCount: number;
  readonly questionIds: readonly string[];
  readonly documents: readonly { readonly name: string; readonly displayName?: string }[];
}

/**
 * The learner portal, where a published quiz is taken: the same host on port
 * 3001, which is where the local stack serves it. A deployed environment will
 * need a declared address for it (docs/environment-and-configuration.md).
 */
const learnerUrl = async (): Promise<string> => {
  const host = (await headers()).get('host') ?? 'localhost';
  return `http://${host.replace(/:\d+$/, '')}:3001`;
};

const Hero = () => <PageHero title={t('qq.heading')} purpose={t('qq.intro')} />;

const STEPS = ['qq.step1', 'qq.step2', 'qq.step3', 'qq.step4'] as const;

/** `active` is the current step; 4 means every step is done. */
const Steps = ({ active }: { readonly active: 0 | 1 | 2 | 3 | 4 }) => (
  <ol
    className="flex flex-wrap items-center justify-center gap-2 text-sm"
    aria-label={t('qq.stepsLabel')}
  >
    {STEPS.map((key, index) => (
      <li key={key} className="flex items-center gap-2">
        <span
          {...(index === active ? { 'aria-current': 'step' as const } : {})}
          className={`flex items-center gap-2 rounded-pill px-3 py-1 ${
            index === active
              ? 'bg-brand-navy font-semibold text-white'
              : index < active
                ? 'bg-success-soft text-success'
                : 'bg-surface-sunken text-ink-muted'
          }`}
        >
          <span aria-hidden="true">{index < active ? '✓' : index + 1}</span>
          {t(key)}
        </span>
        {index < STEPS.length - 1 ? (
          <span aria-hidden="true" className="h-px w-6 bg-line-strong" />
        ) : null}
      </li>
    ))}
  </ol>
);

const titleOf = (fileName: string): string =>
  fileName.replace(/\.[A-Za-z0-9]{1,10}$/, '').trim() || fileName;

export const SimpleStudio = async ({
  query,
  actingAs,
  storageConfigured,
}: {
  readonly query: {
    document?: string;
    source?: string;
    name?: string;
    job?: string;
    quiz?: string;
  };
  readonly actingAs: string;
  readonly storageConfigured: boolean;
}) => {
  if (query.job !== undefined && query.quiz !== undefined) {
    return <QuizLive versionId={query.quiz} actingAs={actingAs} />;
  }
  if (query.job !== undefined) return <QuizResult jobId={query.job} actingAs={actingAs} />;
  if (query.document !== undefined && query.source !== undefined) {
    return (
      <QuizSettings
        documentId={query.document}
        sourceId={query.source}
        name={query.name ?? null}
        actingAs={actingAs}
      />
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <Hero />
      <Steps active={0} />
      <Card>
        <CardBody>
          <div className="mx-auto w-full max-w-4xl py-4">
            {storageConfigured ? (
              <QuizDropzone actingAs={actingAs} />
            ) : (
              <p className="text-sm text-ink-muted">{t('qq.noStorage')}</p>
            )}
          </div>
        </CardBody>
      </Card>
    </div>
  );
};

const QuizSettings = async ({
  documentId,
  sourceId,
  name,
  actingAs,
}: {
  readonly documentId: string;
  readonly sourceId: string;
  readonly name: string | null;
  readonly actingAs: string;
}) => {
  const [sections, taxonomy, providers] = await Promise.all([
    api<{ name: string; sections: readonly unknown[] }>(
      `/api/v1/authoring/sources/${encodeURIComponent(sourceId)}/documents/${encodeURIComponent(documentId)}/sections`,
    ),
    api<{ domains: readonly WizardDomain[] }>('/api/v1/authoring/taxonomy'),
    api<{ providers: readonly GenerationProviderChoice[] }>(
      '/api/v1/authoring/generation/providers',
    ),
  ]);
  const problem = !sections.ok ? sections.problem : !taxonomy.ok ? taxonomy.problem : null;
  if (problem !== null || !sections.ok || !taxonomy.ok) {
    return (
      <div className="flex flex-col gap-6">
        <Hero />
        {problem === null ? null : <Problem problem={problem} actingAs={actingAs} />}
      </div>
    );
  }
  // The active provider when it can run, else the deterministic generator --
  // the same default the Generate screen uses (GEN-PROVIDER-M1).
  const list = providers.ok ? providers.data.providers : [];
  const provider =
    list.find((row) => row.active && row.available) ??
    list.find((row) => row.providerId === 'DETERMINISTIC_LOCAL');
  const providerId = provider?.providerId ?? 'DETERMINISTIC_LOCAL';
  const providerLabel =
    providerId === 'DETERMINISTIC_LOCAL'
      ? t('qq.providerTemplate')
      : `${provider?.displayName ?? providerId}${provider?.modelId ? ` (${provider.modelId})` : ''}`;

  return (
    <div className="flex flex-col gap-6">
      <Hero />
      <Steps active={1} />
      <Card>
        <CardBody>
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 py-2">
            <h2 className="text-2xl font-bold text-brand-navy-text">{t('qq.settingsHeading')}</h2>
            <QuizSettingsForm
              documentId={documentId}
              sourceId={sourceId}
              fileName={name ?? sections.data.name}
              sectionCount={sections.data.sections.length}
              domains={taxonomy.data.domains.filter((domain) => domain.topics.length > 0)}
              providerId={providerId}
              providerLabel={providerLabel}
              actingAs={actingAs}
            />
          </div>
        </CardBody>
      </Card>
    </div>
  );
};

const QuizResult = async ({
  jobId,
  actingAs,
}: {
  readonly jobId: string;
  readonly actingAs: string;
}) => {
  const job = await api<JobRead>(`/api/v1/authoring/generation-jobs/${encodeURIComponent(jobId)}`);
  if (!job.ok) {
    return (
      <div className="flex flex-col gap-6">
        <Hero />
        <Problem problem={job.problem} actingAs={actingAs} />
      </div>
    );
  }
  const questions = (
    await Promise.all(
      job.data.questionIds.map((id) =>
        api<QuizQuestion>(`/api/v1/authoring/questions/${encodeURIComponent(id)}`),
      ),
    )
  ).flatMap((row) => (row.ok ? [row.data] : []));
  const count = job.data.persistedQuestionCount;
  const completed = job.data.status === 'SUCCEEDED' || job.data.status === 'PARTIAL';
  const approved = questions.filter(
    (question) => question.status === 'APPROVED' || question.status === 'PUBLISHED',
  ).length;
  const waiting = questions.filter((question) => APPROVABLE.has(question.status)).length;
  const document = job.data.documents[0];
  const defaultName = titleOf(document?.displayName ?? document?.name ?? t('qq.heading'));

  return (
    <div className="flex flex-col gap-6">
      <Hero />
      <Steps active={approved > 0 && waiting === 0 ? 3 : 2} />
      <Card>
        <CardBody>
          <div className="mx-auto flex w-full max-w-4xl flex-col items-center gap-3 py-6 text-center">
            {count > 0 ? (
              <CheckCircle2 aria-hidden="true" className="size-14 text-success" />
            ) : (
              <AlertTriangle aria-hidden="true" className="size-14 text-warning" />
            )}
            <h2 className="text-2xl font-bold text-brand-navy-text" data-quiz-result={count}>
              {count > 0 ? t('qq.resultTitle', { count }) : t('qq.resultNone')}
            </h2>
            <p className="max-w-prose text-sm text-ink-muted">
              {count > 0
                ? t('qq.resultBody', { requested: job.data.requestedQuestionCount, count })
                : completed
                  ? t('qq.resultNoneBody')
                  : t('qq.resultStatus', { status: job.data.status })}
            </p>
            {count > 0 ? (
              <p className="text-sm font-semibold text-ink" data-quiz-progress>
                {t('qq.progress', { approved, total: questions.length })}
              </p>
            ) : (
              <ButtonLink tone="secondary" href="/document-studio">
                {t('qq.another')}
              </ButtonLink>
            )}
          </div>
        </CardBody>
      </Card>

      {questions.length > 0 ? <QuizReview questions={questions} actingAs={actingAs} /> : null}

      {approved > 0 ? (
        <Card>
          <CardBody>
            <div className="flex flex-col gap-4" data-publish-quiz>
              <h2 className="text-xl font-bold text-brand-navy-text">{t('qq.publishHeading')}</h2>
              <p className="max-w-prose text-sm text-ink-muted">
                {waiting > 0
                  ? t('qq.publishWaiting', { approved, waiting })
                  : t('qq.publishReady', { approved })}
              </p>
              <PublishQuizForm
                jobId={jobId}
                defaultName={defaultName}
                actingAs={actingAs}
              />
            </div>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
};

const QuizLive = async ({
  versionId,
  actingAs,
}: {
  readonly versionId: string;
  readonly actingAs: string;
}) => {
  const list = await api<{
    assessments: readonly {
      assessmentVersionId: string | null;
      name: string;
      versionStatus: string | null;
      questionCount: number | null;
      passPercentage: number | null;
    }[];
  }>('/api/v1/authoring/assessments');
  if (!list.ok) {
    return (
      <div className="flex flex-col gap-6">
        <Hero />
        <Problem problem={list.problem} actingAs={actingAs} />
      </div>
    );
  }
  const quiz = list.data.assessments.find((row) => row.assessmentVersionId === versionId);
  const learner = await learnerUrl();
  return (
    <div className="flex flex-col gap-6">
      <Hero />
      <Steps active={4} />
      <Card>
        <CardBody>
          <div
            className="mx-auto flex w-full max-w-3xl flex-col items-center gap-4 py-10 text-center"
            data-quiz-live={quiz?.versionStatus ?? 'UNKNOWN'}
          >
            <span className="flex size-20 items-center justify-center rounded-full bg-success-soft">
              <PartyPopper aria-hidden="true" className="size-10 text-success" />
            </span>
            <h2 className="text-2xl font-bold text-brand-navy-text">
              {quiz?.versionStatus === 'PUBLISHED'
                ? t('qq.liveTitle', { name: quiz.name })
                : t('qq.liveMissing')}
            </h2>
            {quiz === undefined ? null : (
              <p className="max-w-prose text-sm text-ink-muted">
                {t('qq.liveBody', {
                  count: quiz.questionCount ?? 0,
                  pass: quiz.passPercentage ?? 0,
                })}
              </p>
            )}
            <div className="mt-2 flex flex-wrap justify-center gap-3">
              <ButtonLink tone="primary" href={learner}>
                <ExternalLink aria-hidden="true" className="size-4" />
                {t('qq.openLearner')}
              </ButtonLink>
              <ButtonLink tone="secondary" href="/document-studio">
                {t('qq.another')}
              </ButtonLink>
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
};
