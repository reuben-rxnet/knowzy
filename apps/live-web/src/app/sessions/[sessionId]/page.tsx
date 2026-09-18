import Link from 'next/link';
import { t } from '../../../copy';
import { api } from '../../../lib/api';
import { Problem } from '../../../components/Problem';
import { QuizForm, type QuizQuestion } from '../../../components/QuizForm';

interface CurrentQuestion {
  readonly sessionId: string;
  readonly status: string;
  readonly currentIndex: number;
  readonly totalQuestions: number;
  readonly answeredCount: number;
  readonly remainingSeconds: number | null;
  readonly question: QuizQuestion;
  readonly allowBackNavigation: boolean;
}

/**
 * Formats a remaining duration.
 *
 * An untimed assessment still has a deadline — the idle window in §4.4, a day
 * wide — so this value is never absent. Printed as raw seconds it reads as a
 * countdown on a time limit that does not exist, which is why it is formatted
 * coarsely: hours and minutes when there is more than an hour left, seconds
 * only when seconds are what matter.
 */
const formatRemaining = (totalSeconds: number): string => {
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}${t('quiz.hoursShort')} ${minutes}${t('quiz.minutesShort')}`;
  if (minutes > 0) return `${minutes}${t('quiz.minutesShort')} ${seconds}${t('quiz.secondsShort')}`;
  return `${seconds}${t('quiz.secondsShort')}`;
};

/**
 * The quiz.
 *
 * One question at a time, read from the server every time. Nothing about the
 * attempt lives in the browser: not the pinned question list, not the answers,
 * not the position. That is what makes this URL a resume point — a learner who
 * closes the tab and comes back lands on the same question with the same
 * answer selected.
 *
 * No answer key reaches this page. The learner projection has no correct-option
 * field for any question type (K2), and a runtime assertion on the API side
 * fails the response if one ever appears (K3).
 */
export default async function QuizPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const result = await api<CurrentQuestion>(`/api/v1/learning/sessions/${sessionId}/current`);

  if (!result.ok) {
    return (
      <article>
        <h1>{t('app.portal')}</h1>
        <Problem problem={result.problem} />
        <p>
          <Link href="/">{t('result.back')}</Link>
        </p>
      </article>
    );
  }

  const current = result.data;

  return (
    <article>
      <h1>
        {t('quiz.heading', {
          index: current.currentIndex + 1,
          total: current.totalQuestions,
        })}
      </h1>
      <p className="muted">
        {t('quiz.progress', {
          answered: current.answeredCount,
          total: current.totalQuestions,
        })}
        {current.remainingSeconds === null
          ? ''
          : ` · ${t('quiz.remaining')}: ${formatRemaining(current.remainingSeconds)}`}
      </p>

      <p>
        <strong>{current.question.questionText}</strong>
      </p>

      <QuizForm
        sessionId={current.sessionId}
        question={current.question}
        answeredCount={current.answeredCount}
        totalQuestions={current.totalQuestions}
      />
    </article>
  );
}
