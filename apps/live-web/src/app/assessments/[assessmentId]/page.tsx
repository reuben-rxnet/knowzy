import { notFound } from 'next/navigation';
import {
  Badge,
  ButtonLink,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  KeyValue,
  PageHero,
  RefusalState,
} from '@knowzy/shared-ui';
import { ArrowLeft, Clock } from 'lucide-react';
import { t } from '../../../copy';
import { api } from '../../../lib/api';
import { Problem } from '../../../components/Problem';
import { StartForm } from '../../../components/StartForm';

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
  readonly inProgressSession: { readonly sessionId: string } | null;
}

/**
 * Start assessment.
 *
 * Read from the same eligibility list as the home page rather than from a
 * per-assessment endpoint, so a learner cannot open the start page for an
 * assessment the list would not have offered them.
 *
 * UI-M2b redesigned it from that one payload. The expectations panel states
 * only what the server will actually enforce; nothing about badges, points, or
 * a due date, because no such field exists.
 */
export default async function StartAssessmentPage({
  params,
}: {
  params: Promise<{ assessmentId: string }>;
}) {
  const { assessmentId } = await params;
  const result = await api<{ assessments: readonly AssessmentCardData[] }>(
    '/api/v1/learning/assessments',
  );

  const back = (
    <ButtonLink href="/" tone="secondary">
      <ArrowLeft aria-hidden="true" className="size-4" />
      {t('start.back')}
    </ButtonLink>
  );

  if (!result.ok) {
    return (
      <div className="flex flex-col gap-6">
        <PageHero title={t('start.heading')} actions={back} />
        <Problem problem={result.problem} />
      </div>
    );
  }

  const assessment = result.data.assessments.find(
    (candidate) => candidate.assessmentId === assessmentId,
  );
  if (assessment === undefined) notFound();

  return (
    <div className="flex flex-col gap-6">
      <PageHero
        title={assessment.name}
        purpose={assessment.description}
        secondaryText={
          <Badge tone="info" withIcon={false}>
            {assessment.domain}
          </Badge>
        }
        actions={back}
      />

      <Card>
        <CardHeader title={t('start.details')} description={t('start.rules')} />
        <CardBody>
          <KeyValue
            items={[
              { label: t('start.questions'), value: assessment.questionCount ?? '—' },
              {
                label: t('start.pass'),
                value: assessment.passPercentage === null ? '—' : `${assessment.passPercentage}%`,
              },
              {
                label: t('start.timeLimit'),
                value:
                  assessment.timeLimitMinutes === null ? (
                    t('list.noLimit')
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <Clock aria-hidden="true" className="size-4 text-ink-subtle" />
                      {assessment.timeLimitMinutes} {t('start.minutes')}
                    </span>
                  ),
              },
              { label: t('start.attempts'), value: assessment.attemptsUsed },
              {
                label: t('start.attemptLimit'),
                value: assessment.attemptLimit ?? t('list.noLimit'),
              },
            ]}
          />
        </CardBody>
        <CardFooter>
          {assessment.startable ? (
            <StartForm
              assessmentId={assessment.assessmentId}
              resume={assessment.inProgressSession !== null}
            />
          ) : null}
        </CardFooter>
      </Card>

      {/* Eligibility is decided by the server. A refused attempt says why
          instead of offering a button that would be refused. */}
      {assessment.startable ? null : (
        <RefusalState
          title={t('start.blocked')}
          reason={assessment.blockedReason ?? t('list.blockedNoReason')}
        />
      )}
    </div>
  );
}
