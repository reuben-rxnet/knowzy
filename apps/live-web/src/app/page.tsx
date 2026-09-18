import Link from 'next/link';
import { t } from '../copy';
import { api } from '../lib/api';
import { Problem } from '../components/Problem';
import { switchLearner } from './actions';
import { currentSubject, DEMO_SUBJECTS } from '../lib/identity';

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
  readonly inProgressSession: {
    readonly sessionId: string;
    readonly currentIndex: number;
    readonly totalQuestions: number;
  } | null;
}

/**
 * Assessment list.
 *
 * Only ACTIVE assessments with a PUBLISHED version appear, because a session
 * may only be built from a pinned eligibility snapshot — there is nothing to
 * serve otherwise.
 *
 * An assessment that is visible but not startable states the reason (§3.2)
 * rather than showing a dead button.
 */
export default async function AssessmentListPage() {
  const subject = await currentSubject();
  const result = await api<{ count: number; assessments: readonly AssessmentCard[] }>(
    '/api/v1/learning/assessments',
  );

  return (
    <article>
      <h1>{t('home.heading')}</h1>
      <p className="lede">{t('home.intro')}</p>

      <form action={switchLearner}>
        <fieldset>
          <legend>{t('home.identityHeading')}</legend>
          {DEMO_SUBJECTS.map((option) => (
            <label key={option.upn} style={{ fontWeight: 400 }}>
              <input
                type="radio"
                name="subject"
                value={option.upn}
                defaultChecked={option.upn === subject.upn}
              />{' '}
              <strong>{option.label}</strong> <span className="muted">— {option.can}</span>
            </label>
          ))}
          <button type="submit">{t('home.identitySubmit')}</button>
        </fieldset>
      </form>

      {!result.ok ? <Problem problem={result.problem} /> : null}

      {result.ok && result.data.assessments.length === 0 ? <p>{t('home.empty')}</p> : null}

      {result.ok
        ? result.data.assessments.map((assessment) => (
            <section key={assessment.assessmentId} className="panel">
              <h2>{assessment.name}</h2>
              {assessment.description === null ? null : <p>{assessment.description}</p>}
              <dl className="kv">
                <dt>{t('list.domain')}</dt>
                <dd>{assessment.domain}</dd>
                <dt>{t('list.questions')}</dt>
                <dd>{assessment.questionCount ?? '—'}</dd>
                <dt>{t('list.pass')}</dt>
                <dd>
                  {assessment.passPercentage === null ? '—' : `${assessment.passPercentage}%`}
                </dd>
                <dt>{t('list.timeLimit')}</dt>
                <dd>
                  {assessment.timeLimitMinutes === null
                    ? t('list.noLimit')
                    : `${assessment.timeLimitMinutes} ${t('start.minutes')}`}
                </dd>
                <dt>{t('list.attempts')}</dt>
                <dd>
                  {assessment.attemptsUsed}
                  {assessment.attemptLimit === null ? '' : ` / ${assessment.attemptLimit}`}
                </dd>
              </dl>

              {/* An in-progress session is surfaced first (§4.4): the learner
                  who closed the tab mid-quiz should not have to find their way
                  back to it. */}
              {assessment.inProgressSession === null ? null : (
                <p>
                  <Link href={`/sessions/${assessment.inProgressSession.sessionId}`}>
                    {t('home.resume')}
                  </Link>{' '}
                  <span className="muted">
                    ({assessment.inProgressSession.currentIndex + 1} /{' '}
                    {assessment.inProgressSession.totalQuestions})
                  </span>
                </p>
              )}

              {assessment.startable ? (
                <p>
                  <Link href={`/assessments/${assessment.assessmentId}`}>{t('list.open')}</Link>
                </p>
              ) : (
                <p className="warn">
                  {t('list.blocked')} — {assessment.blockedReason ?? ''}
                </p>
              )}
            </section>
          ))
        : null}
    </article>
  );
}
