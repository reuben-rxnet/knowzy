import Link from 'next/link';
import { notFound } from 'next/navigation';
import { t } from '../../../copy';
import { api } from '../../../lib/api';
import { Problem } from '../../../components/Problem';
import { StartForm } from '../../../components/StartForm';

interface AssessmentCard {
  readonly assessmentId: string;
  readonly name: string;
  readonly description: string | null;
  readonly domain: string;
  readonly questionCount: number | null;
  readonly passPercentage: number | null;
  readonly timeLimitMinutes: number | null;
  readonly attemptsUsed: number;
  readonly attemptLimit: number | null;
  readonly startable: boolean;
  readonly blockedReason: string | null;
  readonly inProgressSession: { readonly sessionId: string } | null;
}

/**
 * Start assessment.
 *
 * Read from the same eligibility list as the home page rather than from a
 * per-assessment endpoint, so a learner cannot open the start page for an
 * assessment the list would not have offered them.
 */
export default async function StartAssessmentPage({
  params,
}: {
  params: Promise<{ assessmentId: string }>;
}) {
  const { assessmentId } = await params;
  const result = await api<{ assessments: readonly AssessmentCard[] }>(
    '/api/v1/learning/assessments',
  );

  if (!result.ok) {
    return (
      <article className="legacy-page">
        <h1>{t('start.heading')}</h1>
        <Problem problem={result.problem} />
      </article>
    );
  }

  const assessment = result.data.assessments.find(
    (candidate) => candidate.assessmentId === assessmentId,
  );
  if (assessment === undefined) notFound();

  return (
    <article className="legacy-page">
      <h1>{assessment.name}</h1>
      <p>
        <Link href="/">{t('start.back')}</Link>
      </p>
      {assessment.description === null ? null : <p className="lede">{assessment.description}</p>}

      <h2>{t('start.details')}</h2>
      <dl className="kv">
        <dt>{t('start.questions')}</dt>
        <dd>{assessment.questionCount ?? '—'}</dd>
        <dt>{t('start.pass')}</dt>
        <dd>{assessment.passPercentage === null ? '—' : `${assessment.passPercentage}%`}</dd>
        <dt>{t('start.timeLimit')}</dt>
        <dd>
          {assessment.timeLimitMinutes === null
            ? t('list.noLimit')
            : `${assessment.timeLimitMinutes} ${t('start.minutes')}`}
        </dd>
        <dt>{t('start.attempts')}</dt>
        <dd>{assessment.attemptsUsed}</dd>
        <dt>{t('start.attemptLimit')}</dt>
        <dd>{assessment.attemptLimit ?? t('list.noLimit')}</dd>
      </dl>

      <p className="lede">{t('start.rules')}</p>

      {assessment.startable ? (
        <StartForm
          assessmentId={assessment.assessmentId}
          resume={assessment.inProgressSession !== null}
        />
      ) : (
        <p className="warn">
          {t('start.blocked')} {assessment.blockedReason ?? ''}
        </p>
      )}
    </article>
  );
}
