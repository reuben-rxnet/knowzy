import {
  Badge,
  ButtonLink,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  EmptyState,
  Meter,
  PageHero,
  PlannedState,
  RefusalState,
} from '@knowzy/shared-ui';
import { ArrowRight, CheckCircle2, Clock, PlayCircle } from 'lucide-react';
import { t } from '../copy';
import { api } from '../lib/api';
import { Problem } from '../components/Problem';

interface AssessmentCardData {
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
  /**
   * The API's own shape, not a guess at it.
   *
   * `answeredOf` arrives as a rendered string ("3 of 4"). This interface used
   * to declare `currentIndex` and `totalQuestions`, which the API never sent —
   * so the card printed "NaN / " from arithmetic on two undefined fields, and
   * TypeScript could not catch it because a hand-written interface is an
   * assertion, not a contract.
   */
  readonly inProgressSession: {
    readonly sessionId: string;
    readonly answeredOf: string;
  } | null;
}

/** "1 of 2" → 50, for the resume bar. Returns null if the shape is not that. */
const answeredPercent = (answeredOf: string): number | null => {
  const match = /^(\d+)\s+of\s+(\d+)$/.exec(answeredOf.trim());
  if (match === null) return null;
  const answered = Number(match[1]);
  const total = Number(match[2]);
  if (total <= 0) return null;
  return Math.round((answered / total) * 100);
};

/**
 * Learner home.
 *
 * Only ACTIVE assessments with a PUBLISHED version appear, because a session
 * may only be built from a pinned eligibility snapshot — there is nothing to
 * serve otherwise.
 *
 * An assessment that is visible but not startable states the reason (§3.2)
 * rather than showing a dead button.
 *
 * UI-M2b redesigned this screen from `GET /learning/assessments` and nothing
 * else. Every field on a card is in that payload: name, description, domain,
 * question count, pass mark, time limit, attempts used and allowed,
 * startability, the blocking reason, and the in-progress session.
 *
 * What is therefore absent, and stays absent: streaks, points, levels, badges,
 * due dates, recommended-for-you, continue-learning carousels, and a course or
 * learning-path hierarchy. None of them has a backing field, and the learner
 * specification §7.2 forbids reinterpreting an assessment as a course to fill
 * the gap.
 */
export default async function AssessmentListPage() {
  const result = await api<{ count: number; assessments: readonly AssessmentCardData[] }>(
    '/api/v1/learning/assessments',
  );

  const assessments = result.ok ? result.data.assessments : [];
  const resumable = assessments.filter((item) => item.inProgressSession !== null);

  return (
    <div className="flex flex-col gap-6">
      <PageHero
        title={t('home.heading')}
        purpose={t('home.intro')}
        backdrop="wave"
        actions={
          result.ok ? (
            <Badge tone="neutral" withIcon={false}>
              {t('home.countLabel', { count: result.data.count })}
            </Badge>
          ) : undefined
        }
      />

      {!result.ok ? <Problem problem={result.problem} /> : null}

      {/* An in-progress attempt comes first (§4.4): the learner who closed the
          tab mid-quiz should not have to find their way back to it. */}
      {resumable.map((assessment) =>
        assessment.inProgressSession === null ? null : (
          <Card key={assessment.inProgressSession.sessionId} elevation="raised">
            <CardHeader
              title={t('home.resume')}
              description={assessment.name}
              icon={<PlayCircle aria-hidden="true" className="size-5" />}
            />
            <CardBody>
              {(() => {
                const percent = answeredPercent(assessment.inProgressSession.answeredOf);
                return percent === null ? (
                  <p className="text-base text-ink">
                    {t('home.answeredOf', { progress: assessment.inProgressSession.answeredOf })}
                  </p>
                ) : (
                  <Meter
                    label={t('home.progressLabel')}
                    percent={percent}
                    tone="info"
                    summary={t('home.answeredOf', {
                      progress: assessment.inProgressSession.answeredOf,
                    })}
                  />
                );
              })()}
            </CardBody>
            <CardFooter>
              <ButtonLink
                href={`/sessions/${assessment.inProgressSession.sessionId}`}
                tone="success"
              >
                {t('home.resume')}
                <ArrowRight aria-hidden="true" className="size-4" />
              </ButtonLink>
            </CardFooter>
          </Card>
        ),
      )}

      {result.ok && assessments.length === 0 ? (
        <EmptyState
          title={t('home.empty')}
          description={t('home.emptyBody')}
          illustration="learning"
        />
      ) : null}

      {assessments.length === 0 ? null : (
        <div className={`grid gap-4 ${assessments.length > 1 ? 'xl:grid-cols-2' : ''}`}>
          {assessments.map((assessment) => (
            <Card key={assessment.assessmentId}>
              <CardHeader
                title={assessment.name}
                description={assessment.description}
                actions={
                  <Badge tone="info" withIcon={false}>
                    {assessment.domain}
                  </Badge>
                }
              />
              <CardBody>
                <div className="flex flex-col gap-4">
                  {/* Four figures, all from the eligibility payload. A grid
                      rather than a label/value list: on a card the numbers are
                      what the learner is scanning for. */}
                  <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="flex flex-col rounded-md bg-surface-sunken px-3 py-2">
                      <dt className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle">
                        {t('list.questions')}
                      </dt>
                      <dd className="font-mono text-lg font-bold tabular-nums text-brand-navy-text">
                        {assessment.questionCount ?? '—'}
                      </dd>
                    </div>
                    <div className="flex flex-col rounded-md bg-surface-sunken px-3 py-2">
                      <dt className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle">
                        {t('list.pass')}
                      </dt>
                      <dd className="font-mono text-lg font-bold tabular-nums text-brand-navy-text">
                        {assessment.passPercentage === null ? '—' : `${assessment.passPercentage}%`}
                      </dd>
                    </div>
                    <div className="flex flex-col rounded-md bg-surface-sunken px-3 py-2">
                      <dt className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle">
                        {t('list.timeLimit')}
                      </dt>
                      <dd className="flex items-center gap-1.5 text-base font-semibold text-brand-navy-text">
                        {assessment.timeLimitMinutes === null ? (
                          t('list.noLimit')
                        ) : (
                          <>
                            <Clock aria-hidden="true" className="size-4 text-ink-subtle" />
                            {assessment.timeLimitMinutes} {t('start.minutes')}
                          </>
                        )}
                      </dd>
                    </div>
                    <div className="flex flex-col rounded-md bg-surface-sunken px-3 py-2">
                      <dt className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle">
                        {t('list.attempts')}
                      </dt>
                      <dd className="text-base font-semibold text-brand-navy-text">
                        {assessment.attemptLimit === null
                          ? t('list.attemptsUsedOnly', { used: assessment.attemptsUsed })
                          : t('list.attemptsOf', {
                              used: assessment.attemptsUsed,
                              limit: assessment.attemptLimit,
                            })}
                      </dd>
                    </div>
                  </dl>

                  {/* Eligibility is the server's decision, stated either way —
                      a ready card says so rather than leaving the learner to
                      infer it from a button. */}
                  {assessment.startable ? (
                    <p className="flex items-center gap-2 text-base font-semibold text-success">
                      <CheckCircle2 aria-hidden="true" className="size-4" />
                      {t('list.ready')}
                    </p>
                  ) : (
                    <RefusalState
                      title={t('list.blocked')}
                      reason={assessment.blockedReason ?? t('list.blockedNoReason')}
                    />
                  )}
                </div>
              </CardBody>
              {assessment.startable ? (
                <CardFooter>
                  <ButtonLink href={`/assessments/${assessment.assessmentId}`}>
                    {t('list.open')}
                    <ArrowRight aria-hidden="true" className="size-4" />
                  </ButtonLink>
                </CardFooter>
              ) : null}
            </Card>
          ))}
        </div>
      )}

      {/* The identity picker MOVED to the header's profile menu (2026-09-26),
          so a learner can be switched from the quiz, the results page or
          anywhere else rather than only from here. */}

      {/* A declared absence, not a footnote.
          
          The learner brief permits assessment, result, proficiency and
          knowledge-gap data on this page. Only the first is reachable:
          `GET /learning/results/:resultId` serves ONE result BY ID and there
          is no per-learner results LIST anywhere in the 48 routes, so a
          progress panel, a proficiency trend or a knowledge-gap summary could
          only be assembled by inventing the read behind it.

          So it is stated as a capability this release does not include, in the
          same component every other unbuilt capability uses, rather than as
          grey small print under the cards — which reads as an apology for a
          missing feature instead of a recorded decision. `attemptsUsed` on the
          cards is real and stays; it is the only history the payload carries. */}
      <PlannedState
        title={t('home.progressHeading')}
        description={t('home.progressNote')}
        requirement={t('list.historyNote')}
      />
    </div>
  );
}
