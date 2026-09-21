// Externalized copy — ux-design.md §9.2 C1.
//
// C8: content is never localized. Questions, options, explanations, evidence,
// and document names render in the language of the source. Only chrome lives
// here.

export const copy = {
  'app.name': 'Knowzy',
  'app.portal': 'Learning',
  'shell.skipToContent': 'Skip to content',
  'shell.actingAs': 'Signed in as',
  'shell.change': 'Change',
  'shell.environment': 'Environment',
  'shell.localOnly':
    'Local demonstration build. Identities are selected, not authenticated — the stub issuer runs only in the local environment.',

  'home.heading': 'Your assessments',
  'home.intro':
    'Only published assessments appear here, and only the questions that were published at the moment the assessment was published.',
  'home.identityHeading': 'Choose an identity',
  'home.identityLabel': 'Sign in as',
  'home.identitySubmit': 'Switch identity',
  'home.empty':
    'No assessment is available to you yet. Publish questions and an assessment in the Authoring Portal first.',
  'home.countLabel': '{count} available to you',
  'home.emptyBody':
    'An assessment appears here once it has been published. Nothing is hidden from you — there is nothing yet.',
  'home.identityIntro':
    'Switch identity to see what a different person is allowed to do. Refusals are part of the demonstration.',
  'home.progressLabel': 'Answered',
  'home.progressNote':
    'Per-topic accuracy is recorded on each result. This release keeps no badges, points, streaks or levels.',
  'home.resume': 'Resume where you left off',
  'home.answeredOf': '{progress} answered',

  'list.name': 'Assessment',
  'list.domain': 'Subject',
  'list.questions': 'Questions',
  'list.pass': 'Pass mark',
  'list.attempts': 'Attempts used',
  'list.timeLimit': 'Time limit',
  'list.noLimit': 'None',
  'list.open': 'Open',
  'list.attemptsOf': '{used} of {limit} used',
  'list.attemptsUsedOnly': '{used} used · no limit',
  'list.blockedNoReason': 'The server did not permit this attempt.',
  'list.blocked': 'Not available',

  'start.working': 'Working — the server is starting your attempt.',
  'start.heading': 'Start assessment',
  'start.back': 'Back to your assessments',
  'start.details': 'What to expect',
  'start.questions': 'Questions in this attempt',
  'start.pass': 'Pass mark',
  'start.timeLimit': 'Time limit',
  'start.attempts': 'Attempts used',
  'start.attemptLimit': 'Attempt limit',
  'start.minutes': 'minutes',
  'start.rules':
    'One question at a time. Every answer is saved on the server as you go, so closing the tab does not lose your progress — you can come back and continue from the same question.',
  'start.begin': 'Start',
  'start.resume': 'Resume',
  'start.blocked': 'This assessment cannot be started right now.',

  'quiz.heading': 'Question {index} of {total}',
  'quiz.progress': 'Answered {answered} of {total}',
  'quiz.remaining': 'Time remaining',
  'quiz.hoursShort': 'h',
  'quiz.minutesShort': 'm',
  'quiz.secondsShort': 's',
  'quiz.chooseOne': 'Choose one answer',
  'quiz.save': 'Save and continue',
  'quiz.finish': 'Finish and score',
  'quiz.finishHint':
    'Scoring happens on the server. Unanswered questions count as incorrect, so finish only when you are ready.',
  'quiz.selectRequired': 'Select an answer before continuing.',
  'quiz.saved': 'Answer saved.',
  'quiz.complete': 'Every question has been answered.',

  'result.heading': 'Your result',
  'result.score': 'Score',
  'result.outcome': 'Outcome',
  'result.passed': 'Passed',
  'result.notPassed': 'Not passed',
  'result.band': 'Proficiency',
  'result.correct': 'Correct',
  'result.incorrect': 'Incorrect',
  'result.unanswered': 'Unanswered',
  'result.timeTaken': 'Time taken',
  'result.attempt': 'Attempt',
  'result.state': 'Result state',
  'result.intro': 'The score the platform recorded, and what it was judged against.',
  'result.scoreSummary': '{correct} of {total} correct',
  'result.unansweredNote': 'Counted as incorrect',
  'result.topicSummary': '{correct} of {asked} correct',
  'result.topicsIntro':
    'Accuracy per topic, from the questions this attempt actually asked. Each bar prints its own numbers.',
  'result.noGapsBody':
    'A topic becomes a gap only when enough questions were asked to judge it. Nothing here was below the line.',
  'result.topicsHeading': 'How you did by topic',
  'result.topic': 'Topic',
  'result.asked': 'Asked',
  'result.topicCorrect': 'Correct',
  'result.accuracy': 'Accuracy',
  'result.topicBand': 'Band',
  'result.gap': 'Knowledge gap',
  'result.gapsHeading': 'Where to focus',
  'result.noGaps': 'No knowledge gap was identified in this attempt.',
  'result.gapNote':
    'A topic is reported as a gap only when enough questions were asked about it to say so. A topic with too few questions is excluded rather than guessed at.',
  'result.thresholds': 'Bands applied to this attempt',
  'result.thresholdNote':
    'The thresholds were copied into the result when it was scored, so a later configuration change cannot restate what you were told.',
  'result.noKey':
    'Correct answers and explanations are not shown. The answer key never leaves the server.',
  'result.back': 'Back to your assessments',

  'error.heading': 'That did not work',
  'error.code': 'Code',
} as const;

export type CopyKey = keyof typeof copy;

/** Named interpolation only (C3). A missing key is a build-time error. */
export const t = (key: CopyKey, values?: Readonly<Record<string, string | number>>): string => {
  const template = copy[key];
  if (values === undefined) return template;
  return Object.entries(values).reduce<string>(
    (text, [name, value]) => text.split(`{${name}}`).join(String(value)),
    template,
  );
};
