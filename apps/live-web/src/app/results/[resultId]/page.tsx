import {
  BandScale,
  Badge,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  KpiCard,
  Meter,
  PageHero,
  StatusBadge,
  TBody,
  THead,
  Td,
  Th,
  Tr,
  type MeterTone,
} from '@knowzy/shared-ui';
import { ArrowLeft, CheckCircle2, CircleSlash, Target, XCircle } from 'lucide-react';
import { t } from '../../../copy';
import { api } from '../../../lib/api';
import { Problem } from '../../../components/Problem';

interface TopicResult {
  readonly topicId: string;
  readonly topicName: string;
  readonly questionsAsked: number;
  readonly correct: number;
  readonly topicAccuracy: number;
  readonly topicBand: string;
  readonly isKnowledgeGap: boolean;
  readonly gapState: string;
}

interface Threshold {
  readonly band: string;
  readonly minInclusive: number;
  readonly maxExclusive: number;
}

interface ResultView {
  readonly resultId: string;
  readonly percentageScore: number;
  readonly passed: boolean;
  readonly proficiencyBand: string;
  readonly resultState: string;
  readonly totalQuestions: number;
  readonly correctAnswers: number;
  readonly incorrectAnswers: number;
  readonly unansweredCount: number;
  readonly timeTakenSeconds: number;
  readonly completedAt: string | null;
  readonly attemptNumber: number;
  /**
   * An ARRAY of bands, which is what the API sends. It used to be typed
   * `unknown` and read with `Object.entries`, so the page printed
   * `{"band":"EXPERT","maxExclusive":100.01,…}` as a list item.
   */
  readonly appliedThresholds: readonly Threshold[];
  readonly topics: readonly TopicResult[];
  readonly knowledgeGaps: readonly {
    readonly topicId: string;
    readonly topicName: string;
    readonly topicAccuracy: number;
  }[];
}

/** A band token as a sentence-case phrase: CRITICAL_KNOWLEDGE_GAP → Critical knowledge gap. */
const bandLabel = (band: string): string => {
  const words = band.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** Accuracy → a tone. The thresholds are the server's, so this only reads them. */
const accuracyTone = (accuracy: number, isGap: boolean): MeterTone => {
  if (isGap) return 'danger';
  if (accuracy >= 75) return 'success';
  if (accuracy >= 40) return 'warning';
  return 'danger';
};

const formatDuration = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
};

/**
 * Results.
 *
 * The stored, rounded score — the same number the pass decision was made on
 * (§5.2). Nothing is recomputed here: a second rounding in the browser could
 * disagree with the decision the platform recorded, and then the learner would
 * be reading two different results.
 *
 * The applied thresholds are shown because they were COPIED into the result at
 * scoring time. A later configuration change cannot restate what a learner was
 * already told.
 *
 * UI-M2b redesigned this screen from `GET /learning/results/:id` and nothing
 * else. The knowledge-gap visualization is the per-topic accuracy the server
 * computed, drawn as bars — every bar prints its own percentage and its
 * correct-of-asked denominator, so the picture adds nothing the text does not
 * already say. No trend, no comparison to other learners, no recommended next
 * step: none of the three has any data behind it.
 *
 * `gapState` carries a third answer beyond gap/not-gap — too few questions
 * asked to judge — and §5.3 excludes that case from gap reporting rather than
 * reporting it as a pass. It is rendered as its own word.
 */
export default async function ResultPage({ params }: { params: Promise<{ resultId: string }> }) {
  const { resultId } = await params;
  const result = await api<ResultView>(`/api/v1/learning/results/${resultId}`);

  const back = (
    <ButtonLink href="/" tone="secondary">
      <ArrowLeft aria-hidden="true" className="size-4" />
      {t('result.back')}
    </ButtonLink>
  );

  if (!result.ok) {
    return (
      <div className="flex flex-col gap-6">
        <PageHero title={t('result.heading')} actions={back} />
        <Problem problem={result.problem} />
      </div>
    );
  }

  const view = result.data;
  const thresholds = Array.isArray(view.appliedThresholds) ? view.appliedThresholds : [];

  return (
    <div className="flex flex-col gap-6">
      <PageHero
        title={t('result.heading')}
        purpose={t('result.intro')}
        secondaryText={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge
              status={view.passed ? t('result.passed') : t('result.notPassed')}
              tone={view.passed ? 'success' : 'danger'}
            />
            <Badge tone="info" withIcon={false}>
              {bandLabel(view.proficiencyBand)}
            </Badge>
            <Badge tone="neutral" withIcon={false}>
              {t('result.attempt')} {view.attemptNumber}
            </Badge>
            <StatusBadge status={view.resultState} />
          </span>
        }
        actions={back}
      />

      {/* ------------------------------------------------------ the headline */}
      <Card elevation="raised">
        <CardBody>
          <div className="flex flex-col gap-5">
            <Meter
              label={t('result.score')}
              percent={Number(view.percentageScore)}
              tone={view.passed ? 'success' : 'danger'}
              summary={t('result.scoreSummary', {
                correct: view.correctAnswers,
                total: view.totalQuestions,
              })}
              trailing={
                <span className="text-base font-semibold text-ink-muted">
                  {bandLabel(view.proficiencyBand)}
                </span>
              }
              thresholds={thresholds.map((threshold) => ({
                at: threshold.minInclusive,
                label: bandLabel(threshold.band),
              }))}
            />
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label={t('result.correct')}
          value={`${view.correctAnswers} / ${view.totalQuestions}`}
          icon={<CheckCircle2 aria-hidden="true" className="size-5" />}
          tone="success"
        />
        <KpiCard
          label={t('result.incorrect')}
          value={view.incorrectAnswers}
          icon={<XCircle aria-hidden="true" className="size-5" />}
          tone="warning"
        />
        <KpiCard
          label={t('result.unanswered')}
          value={view.unansweredCount}
          icon={<CircleSlash aria-hidden="true" className="size-5" />}
          tone="neutral"
          caption={t('result.unansweredNote')}
        />
        <KpiCard
          label={t('result.timeTaken')}
          value={formatDuration(view.timeTakenSeconds)}
          icon={<Target aria-hidden="true" className="size-5" />}
          tone="info"
          {...(view.completedAt === null
            ? {}
            : {
                caption: new Date(view.completedAt).toLocaleString('en-GB', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }),
              })}
        />
      </div>

      {/* ------------------------------------------------- knowledge by topic */}
      <Card>
        <CardHeader title={t('result.topicsHeading')} description={t('result.topicsIntro')} />
        <CardBody>
          <div className="flex flex-col gap-5">
            {view.topics.map((topic) => (
              <Meter
                key={topic.topicId}
                label={topic.topicName}
                percent={Number(Number(topic.topicAccuracy).toFixed(2))}
                tone={accuracyTone(Number(topic.topicAccuracy), topic.isKnowledgeGap)}
                summary={t('result.topicSummary', {
                  correct: topic.correct,
                  asked: topic.questionsAsked,
                })}
                trailing={
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Badge tone="neutral" withIcon={false}>
                      {bandLabel(topic.topicBand)}
                    </Badge>
                    <StatusBadge
                      status={topic.gapState}
                      tone={topic.isKnowledgeGap ? 'danger' : 'neutral'}
                    />
                  </span>
                }
              />
            ))}
          </div>
        </CardBody>
      </Card>

      {/* --------------------------------------------------------- the gaps */}
      <Card>
        <CardHeader title={t('result.gapsHeading')} description={t('result.gapNote')} />
        <CardBody>
          {view.knowledgeGaps.length === 0 ? (
            <EmptyState title={t('result.noGaps')} description={t('result.noGapsBody')} />
          ) : (
            <DataTable caption={t('result.gapsHeading')} captionHidden>
              <THead>
                <Tr>
                  <Th scope="col">{t('result.topic')}</Th>
                  <Th scope="col" align="end">
                    {t('result.accuracy')}
                  </Th>
                  <Th scope="col">{t('result.asked')}</Th>
                </Tr>
              </THead>
              <TBody>
                {view.knowledgeGaps.map((gap) => {
                  const topic = view.topics.find((row) => row.topicId === gap.topicId);
                  return (
                    <Tr key={gap.topicId}>
                      <Th scope="row">{gap.topicName}</Th>
                      <Td numeric>{Number(gap.topicAccuracy).toFixed(2)}%</Td>
                      <Td>
                        {topic === undefined
                          ? '—'
                          : t('result.topicSummary', {
                              correct: topic.correct,
                              asked: topic.questionsAsked,
                            })}
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </DataTable>
          )}
        </CardBody>
      </Card>

      {/* ------------------------------------------------- the bands applied */}
      {thresholds.length === 0 ? null : (
        <Card>
          <CardHeader title={t('result.thresholds')} description={t('result.thresholdNote')} />
          <CardBody>
            <BandScale
              bands={thresholds}
              score={Number(view.percentageScore)}
              currentBand={view.proficiencyBand}
              bandLabel={bandLabel}
            />
          </CardBody>
        </Card>
      )}

      <p className="text-sm text-ink-subtle">{t('result.noKey')}</p>
    </div>
  );
}
