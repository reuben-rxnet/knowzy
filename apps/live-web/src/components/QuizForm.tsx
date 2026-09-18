'use client';

// One question, one answer, one write.
//
// The question index comes from the server and is submitted back with the
// answer, because the server decides what "current" means — a client that kept
// its own counter could write an answer against the wrong question after a
// resume. §4.5 makes the API's index authoritative and this form only carries
// it.
//
// Saving revalidates the route, so the next question arrives from the server
// rather than from anything held here. That is the same path a resume takes,
// which is why a reload mid-quiz behaves identically to a save.

import { useActionState } from 'react';
import { t } from '../copy';
import { answerQuestion, completeSession } from '../app/actions';
import { Problem } from './Problem';

export interface QuizQuestion {
  readonly questionId: string;
  readonly presentationIndex: number;
  readonly questionText: string;
  readonly options: Readonly<Record<string, string>>;
  readonly selectedOption: string | null;
}

export const QuizForm = ({
  sessionId,
  question,
  answeredCount,
  totalQuestions,
}: {
  sessionId: string;
  question: QuizQuestion;
  answeredCount: number;
  totalQuestions: number;
}) => {
  // Permalinks back to the session URL — the same place a resume lands, so a
  // replayed submission cannot end up somewhere else.
  const [answerState, submitAnswer, answerPending] = useActionState(
    answerQuestion,
    null,
    `/sessions/${sessionId}`,
  );
  const [completeState, submitComplete, completePending] = useActionState(
    completeSession,
    null,
    `/sessions/${sessionId}`,
  );

  return (
    <>
      <form action={submitAnswer}>
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="questionIndex" value={question.presentationIndex} />
        <fieldset>
          <legend>{t('quiz.chooseOne')}</legend>
          {Object.entries(question.options).map(([letter, text]) => (
            <label className="option" key={letter}>
              <input
                type="radio"
                name="selectedOption"
                value={letter}
                defaultChecked={question.selectedOption === letter}
              />{' '}
              <strong>{letter}.</strong> {text}
            </label>
          ))}
        </fieldset>
        <button type="submit" disabled={answerPending}>
          {t('quiz.save')}
        </button>
      </form>

      {answerState?.ok === false && answerState.problem !== undefined ? (
        <Problem problem={answerState.problem} />
      ) : null}
      {answerState?.ok === true ? (
        <p className="pass" role="status">
          {t('quiz.saved')}
        </p>
      ) : null}

      <h2>{t('quiz.finish')}</h2>
      <p className="lede">{t('quiz.finishHint')}</p>
      {answeredCount === totalQuestions ? <p className="pass">{t('quiz.complete')}</p> : null}
      <form action={submitComplete}>
        <input type="hidden" name="sessionId" value={sessionId} />
        <button
          type="submit"
          className={answeredCount === totalQuestions ? undefined : 'secondary'}
          disabled={completePending}
        >
          {t('quiz.finish')}
        </button>
      </form>
      {completeState?.ok === false && completeState.problem !== undefined ? (
        <Problem problem={completeState.problem} />
      ) : null}
    </>
  );
};
