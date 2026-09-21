import Link from 'next/link';
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
  readonly attemptNumber: number;
  readonly appliedThresholds: unknown;
  readonly topics: readonly TopicResult[];
  readonly knowledgeGaps: readonly {
    readonly topicId: string;
    readonly topicName: string;
    readonly topicAccuracy: number;
  }[];
}

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
 */
export default async function ResultPage({ params }: { params: Promise<{ resultId: string }> }) {
  const { resultId } = await params;
  const result = await api<ResultView>(`/api/v1/learning/results/${resultId}`);

  if (!result.ok) {
    return (
      <article className="legacy-page">
        <h1>{t('result.heading')}</h1>
        <Problem problem={result.problem} />
        <p>
          <Link href="/">{t('result.back')}</Link>
        </p>
      </article>
    );
  }

  const view = result.data;
  const thresholds =
    typeof view.appliedThresholds === 'object' && view.appliedThresholds !== null
      ? Object.entries(view.appliedThresholds as Record<string, unknown>)
      : [];

  return (
    <article className="legacy-page">
      <h1>{t('result.heading')}</h1>

      <div className="panel">
        <p className="big">{view.percentageScore.toFixed(2)}%</p>
        <p className={view.passed ? 'pass' : 'fail'}>
          {view.passed ? t('result.passed') : t('result.notPassed')} · {view.proficiencyBand}
        </p>
        <dl className="kv">
          <dt>{t('result.correct')}</dt>
          <dd>
            {view.correctAnswers} / {view.totalQuestions}
          </dd>
          <dt>{t('result.incorrect')}</dt>
          <dd>{view.incorrectAnswers}</dd>
          <dt>{t('result.unanswered')}</dt>
          <dd>{view.unansweredCount}</dd>
          <dt>{t('result.timeTaken')}</dt>
          <dd>{view.timeTakenSeconds}s</dd>
          <dt>{t('result.attempt')}</dt>
          <dd>{view.attemptNumber}</dd>
          <dt>{t('result.state')}</dt>
          <dd>{view.resultState}</dd>
        </dl>
      </div>

      <h2>{t('result.topicsHeading')}</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">{t('result.topic')}</th>
            <th scope="col">{t('result.asked')}</th>
            <th scope="col">{t('result.topicCorrect')}</th>
            <th scope="col">{t('result.accuracy')}</th>
            <th scope="col">{t('result.topicBand')}</th>
            <th scope="col">{t('result.gap')}</th>
          </tr>
        </thead>
        <tbody>
          {view.topics.map((topic) => (
            <tr key={topic.topicId}>
              <th scope="row">{topic.topicName}</th>
              <td>{topic.questionsAsked}</td>
              <td>{topic.correct}</td>
              <td>{Number(topic.topicAccuracy).toFixed(2)}%</td>
              <td>{topic.topicBand}</td>
              {/* gapState carries the third answer: not a gap, a gap, or too
                  few questions asked to say. §5.3 excludes the last from gap
                  reporting rather than reporting it as a pass. */}
              <td className={topic.isKnowledgeGap ? 'fail' : ''}>{topic.gapState}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>{t('result.gapsHeading')}</h2>
      <p className="muted">{t('result.gapNote')}</p>
      {view.knowledgeGaps.length === 0 ? (
        <p>{t('result.noGaps')}</p>
      ) : (
        <ul>
          {view.knowledgeGaps.map((gap) => (
            <li key={gap.topicId}>
              <strong>{gap.topicName}</strong> — {Number(gap.topicAccuracy).toFixed(2)}%
            </li>
          ))}
        </ul>
      )}

      {thresholds.length === 0 ? null : (
        <>
          <h2>{t('result.thresholds')}</h2>
          <p className="muted">{t('result.thresholdNote')}</p>
          <ul>
            {thresholds.map(([band, bound]) => (
              <li key={band}>
                <strong>{band}</strong>:{' '}
                {typeof bound === 'object' && bound !== null
                  ? JSON.stringify(bound)
                  : String(bound)}
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="muted">{t('result.noKey')}</p>
      <p>
        <Link href="/">{t('result.back')}</Link>
      </p>
    </article>
  );
}
