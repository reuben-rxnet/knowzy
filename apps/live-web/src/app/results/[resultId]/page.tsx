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
  readonly gapThreshold?: number;
}

interface ReviewedQuestion {
  readonly presentationIndex: number;
  readonly questionText: string;
  readonly options: Readonly<Record<string, string>>;
  readonly selectedOption: string | null;
  readonly correctOption: string;
  readonly isCorrect: boolean;
  readonly explanation: string;
}

type Review =
  | { readonly available: true; readonly questions: readonly ReviewedQuestion[] }
  | { readonly available: false; readonly reason: 'POLICY' | 'NOT_FINISHED' };

/** gapState in words a learner reads; the enum never reaches the screen. */
const gapWords = (state: string): string =>
  state === 'GAP'
    ? t('result.gapStateGap')
    : state === 'INSUFFICIENT_EVIDENCE'
      ? t('result.gapStateFew')
      : t('result.gapStateOk');

/**
 * Question review (live-learning-portal.md §6, item 3), from the one learner
 * read that carries the key -- served only for a finished attempt, and only
 * when the assessment allows it. Correctness is icon + text + colour (§9).
 */
const ReviewSection = ({ review }: { readonly review: Review }) => {
  if (!review.available) {
    return (
      <Card>
        <CardHeader title={t('result.reviewHeading')} />
        <CardBody>
          <p className="text-sm text-ink-muted">
            {review.reason === 'POLICY' ? t('result.reviewPolicy') : t('result.reviewNotFinished')}
          </p>
        </CardBody>
      </Card>
    );
  }
  const missed = review.questions.filter((question) => !question.isCorrect).length;
  return (
    <section className="flex flex-col gap-4" aria-labelledby="review-heading" data-answer-review>
      <div className="flex flex-col gap-1">
        <h2 id="review-heading" className="text-xl font-bold text-brand-navy-text">
          {t('result.reviewHeading')}
        </h2>
        <p className="text-sm text-ink-muted">
          {missed === 0 ? t('result.reviewAllRight') : t('result.reviewIntro', { missed })}
        </p>
      </div>
      <ol className="flex flex-col gap-4">
        {review.questions.map((question, index) => (
          <li key={question.presentationIndex}>
            <Card>
              <CardBody>
                <div className="flex flex-col gap-3" data-review-correct={question.isCorrect}>
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-base font-semibold text-ink">
                      <span className="mr-2 text-brand-blue">{index + 1}.</span>
                      {question.questionText}
                    </h3>
                    <span
                      className={`flex shrink-0 items-center gap-1 rounded-pill px-2 py-0.5 text-2xs font-semibold ${
                        question.isCorrect
                          ? 'bg-success-soft text-success'
                          : 'bg-danger-soft text-danger'
                      }`}
                    >
                      {question.isCorrect ? (
                        <CheckCircle2 aria-hidden="true" className="size-3.5" />
                      ) : (
                        <XCircle aria-hidden="true" className="size-3.5" />
                      )}
                      {question.isCorrect ? t('result.reviewRight') : t('result.reviewWrong')}
                    </span>
                  </div>
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {Object.entries(question.options).map(([key, text]) => {
                      const correct = key === question.correctOption;
                      const chosen = key === question.selectedOption;
                      return (
                        <li
                          key={key}
                          className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm text-ink ${
                            correct
                              ? 'border-success bg-success-soft'
                              : chosen
                                ? 'border-danger bg-danger-soft'
                                : 'border-line'
                          }`}
                        >
                          <span className="font-semibold">{key}.</span>
                          <span className="flex-1">{text}</span>
                          <span className="flex flex-col items-end text-2xs font-semibold">
                            {correct ? (
                              <span className="text-success">
                                {t('result.reviewCorrectAnswer')}
                              </span>
                            ) : null}
                            {chosen ? (
                              <span className={correct ? 'text-success' : 'text-danger'}>
                                {t('result.reviewYourAnswer')}
                              </span>
                            ) : null}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  {question.selectedOption === null ? (
                    <p className="text-sm text-ink-muted">{t('result.reviewUnanswered')}</p>
                  ) : null}
                  <div className="rounded-lg bg-surface-sunken px-4 py-3 text-sm text-ink">
                    <span className="block text-2xs font-semibold uppercase text-ink-muted">
                      {t('result.reviewWhy')}
                    </span>
                    {question.explanation}
                  </div>
                </div>
              </CardBody>
            </Card>
          </li>
        ))}
      </ol>
    </section>
  );
};

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
  const [result, reviewRead] = await Promise.all([
    api<ResultView>(`/api/v1/learning/results/${resultId}`),
    api<Review>(`/api/v1/learning/results/${resultId}/review`),
  ]);

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
  // The band the score fell into, so its range can be shown beside its name.
  const band = thresholds.find((threshold) => threshold.band === view.proficiencyBand);
  const bandRange =
    band === undefined ? undefined : `${band.minInclusive}–${Math.min(100, band.maxExclusive)}%`;

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
              {bandRange === undefined ? '' : ` · ${bandRange}`}
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
                <span className="flex items-baseline gap-2">
                  <span className="text-base font-semibold text-ink-muted">
                    {bandLabel(view.proficiencyBand)}
                  </span>
                  {bandRange === undefined ? null : (
                    <span className="font-mono text-sm text-ink-subtle">{bandRange}</span>
                  )}
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
                    <Badge tone={topic.isKnowledgeGap ? 'danger' : 'neutral'} withIcon={false}>
                      {gapWords(topic.gapState)}
                    </Badge>
                  </span>
                }
              />
            ))}
          </div>
        </CardBody>
      </Card>

      {/* --------------------------------------------------------- the gaps */}
      <Card>
        <CardHeader
          title={t('result.gapsHeading')}
          description={t('result.gapRule', { threshold: view.gapThreshold ?? 60 })}
        />
        <CardBody>
          {view.knowledgeGaps.length === 0 ? (
            <EmptyState
              title={t('result.noGaps')}
              description={
                view.incorrectAnswers + view.unansweredCount > 0
                  ? t('result.noGapsButMissed', {
                      threshold: view.gapThreshold ?? 60,
                      missed: view.incorrectAnswers + view.unansweredCount,
                    })
                  : t('result.noGapsBody')
              }
              illustration="goal"
            />
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

      {reviewRead.ok ? <ReviewSection review={reviewRead.data} /> : null}
    </div>
  );
}
