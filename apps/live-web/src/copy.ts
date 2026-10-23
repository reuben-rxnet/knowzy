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
  'identity.inForce': 'In force',
  'identity.menuNote':
    'These identities are selected, not authenticated. The local stub issuer runs only in the local environment, and the API re-resolves the learner from the database on every request.',
  'shell.environment': 'Environment',
  'shell.localOnly':
    'Local demonstration build. Identities are selected, not authenticated — the stub issuer runs only in the local environment.',

  'home.heading': 'Your assessments',
  'home.intro':
    'Only published assessments appear here, and only the questions that were published at the moment the assessment was published.',
  'home.empty':
    'No assessment is available to you yet. Publish questions and an assessment in the Authoring Portal first.',
  'home.countLabel': '{count} available to you',
  'home.emptyBody':
    'An assessment appears here once it has been published. Nothing is hidden from you — there is nothing yet.',
  'home.progressLabel': 'Answered',
  'home.progressHeading': 'Your progress over time',
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
  'list.ready': 'Ready to start',
  'list.historyNote':
    'Needs a per-learner result history read. A result is shown at the end of the attempt that produced it, and this release stores no way to list an earlier one, so nothing is shown here rather than an estimate.',
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
  'result.noGaps': 'No topic needs extra work',
  'result.noGapsButMissed':
    'A topic counts as a gap when you score below {threshold}% in it, and you were above that in every topic. You still missed {missed}. See them under "Review your answers" below.',
  'result.gapRule':
    'A topic counts as a gap when you score below {threshold}% in it. A topic with too few questions to judge is left out rather than guessed at.',
  'result.gapStateGap': 'Needs work',
  'result.gapStateOk': 'Above the gap line',
  'result.gapStateFew': 'Too few questions to judge',
  'result.reviewHeading': 'Review your answers',
  'result.reviewIntro':
    'You missed {missed}. For each question: your answer, the correct answer, and why.',
  'result.reviewAllRight':
    'You answered every question correctly. Here they are with the explanations.',
  'result.reviewRight': 'Correct',
  'result.reviewWrong': 'Incorrect',
  'result.reviewCorrectAnswer': 'Correct answer',
  'result.reviewYourAnswer': 'Your answer',
  'result.reviewUnanswered': 'You did not answer this question.',
  'result.reviewWhy': 'Why',
  'result.reviewPolicy':
    'The answers are not shown for this quiz. Its author turned review off, usually because the same questions are used again in later attempts.',
  'result.reviewNotFinished': 'Answers are shown once the attempt is finished.',
  'result.gapNote':
    'A topic is reported as a gap only when enough questions were asked about it to say so. A topic with too few questions is excluded rather than guessed at.',
  'result.thresholds': 'Bands applied to this attempt',
  'result.thresholdNote':
    'The thresholds were copied into the result when it was scored, so a later configuration change cannot restate what you were told.',
  'result.noKey':
    'Correct answers and explanations are not shown. The answer key never leaves the server.',
  'result.back': 'Back to your assessments',

  // ---------------------------------------------------------------- previews
  // LIVE-PREVIEW-M1 (2026-09-27): four destinations the product owner asked to
  // see as previews. Every string here is scanned by no-fabricated-metrics like
  // the rest of this file. Keys under `ex.` are ILLUSTRATIVE content and are
  // rendered only inside an ExampleRegion, which labels them on screen.
  'preview.label': 'Preview',
  'preview.exampleTag': 'Illustrative example — not real data',
  'preview.exampleTagYours': 'Illustrative example — not your data',
  'preview.disabledReason':
    'Not available in this release. This is a preview of a planned capability.',
  'preview.phase9': 'Coming in Phase 9',
  'preview.future': 'Future capability',
  'preview.live': 'Live — from this release',
  'preview.searchLabel': 'Search',
  'preview.filtersLegend': 'Search and filters — not available in this release',
  'preview.filterAll': 'All',
  'preview.bookmark': 'Bookmark',
  'preview.open': 'Open',
  'preview.continue': 'Continue',
  'preview.start': 'Start',
  'preview.viewAll': 'View all',

  'ml.heading': 'My Learnings',
  'ml.intro':
    'Your assessments and the attempts you have made — and, in a later release, the learning paths assigned to you.',
  'ml.previewTitle': 'Learning paths, badges and certificates are not live yet.',
  'ml.previewBody':
    'Progress tracking and assessment history on this page are real: they come from your account. Everything inside a dashed frame is an illustrative example of what the finished page is expected to show. None of it is your data, and none of its controls work.',
  'ml.previewRequirement':
    'Learning paths need the learning catalog and enrolment (LIVE-FULL-M1 and M2). Badges and certificates need recognition rules, which arrive in Phase 9.',
  'ml.progressHeading': 'Progress tracking',
  'ml.progressIntro': 'Counted from the assessments published to you, as the server reports them.',
  'ml.kpiAvailable': 'Assessments available to you',
  'ml.kpiAttempted': 'Assessments you have attempted',
  'ml.kpiInProgress': 'Attempts in progress',
  'ml.historyHeading': 'Assessment history',
  'ml.historyIntro':
    'Every assessment you have attempted, with the attempts used. A result is shown at the end of the attempt that produced it; this release keeps no list of earlier results, so none is shown here.',
  'ml.historyEmpty': 'You have not attempted an assessment yet.',
  'ml.historyEmptyBody': 'Start one from Home. It appears here as soon as you have.',
  'ml.colState': 'State',
  'ml.stateInProgress': 'In progress',
  'ml.stateAttempted': 'Attempted',
  'ml.resume': 'Resume',
  'ml.pathsHeading': 'Active learning paths',
  'ml.pathsIntro':
    'Paths you have started, with how far through them you are and what is left. Assigned paths would carry their due date.',
  'ml.completedHeading': 'Completed learning paths',
  'ml.completedIntro': 'Paths you have finished, kept for reference and revision.',
  'ml.completedState': 'Completed',
  'ml.badgesHeading': 'Badges',
  'ml.badgesIntro':
    'Badges will be awarded by published, deterministic rules applied to your recorded results — never by a model. No badge has been awarded to anyone in this build.',
  'ml.badgeNotEarned': 'Design only — not earned',
  'ml.badgeAssessmentPro': 'Assessment Pro',
  'ml.badgeContinuousLearner': 'Continuous Learner',
  'ml.badgeDomainSpecialist': 'Domain Specialist',
  'ml.badgeKnowledgeExplorer': 'Knowledge Explorer',
  'ml.badgeAltAssessmentPro': 'Badge design: Assessment Pro. Not earned.',
  'ml.badgeAltContinuousLearner': 'Badge design: Continuous Learner. Not earned.',
  'ml.badgeAltDomainSpecialist': 'Badge design: Domain Specialist. Not earned.',
  'ml.badgeAltKnowledgeExplorer': 'Badge design: Knowledge Explorer. Not earned.',
  'ml.badgeRuleAssessmentPro': 'Example rule: pass five assessments at Proficient or above.',
  'ml.badgeRuleContinuousLearner': 'Example rule: complete an assessment in each of three months.',
  'ml.badgeRuleDomainSpecialist': 'Example rule: reach Expert in every topic of one domain.',
  'ml.badgeRuleKnowledgeExplorer': 'Example rule: pass assessments in three different domains.',
  'ml.certHeading': 'Certificates',
  'ml.certIntro':
    'A certificate will be issued, rendered and verified on the server, and can be revoked. None has been issued in this build.',
  'ml.certTitle': 'Certificate of completion',
  'ml.certBody':
    'Names the learner and the assessment or path completed, the date issued, and a verification code that anyone can check.',
  'ml.certDownload': 'Download PDF',
  'ml.certVerify': 'Verify',

  'disc.heading': 'Discover',
  'disc.intro': 'Find the next thing to learn — topics, assessments and paths that fit your role.',
  'disc.previewTitle': 'Discovery and personal suggestions are not live yet.',
  'disc.previewBody':
    'The subjects list below is real: it shows the domains of the assessments published to you. Everything inside a dashed frame is an illustrative example. Nothing on this page is personalised yet, and nothing in a frame is your data.',
  'disc.previewRequirement':
    'Suggestions need recommendation history, which arrives in Phase 9. Trending and popularity need usage analytics, and the catalog needs LIVE-FULL-M1 and M3.',
  'disc.subjectsHeading': 'Subjects you can be assessed on',
  'disc.subjectsIntro':
    'The domains of the assessments published to you, and how many each one has. Start them from Home.',
  'disc.subjectsEmpty': 'No assessment is published to you yet, so there is no subject to show.',
  'disc.domainCount': '{count} published to you',
  'disc.goHome': 'Go to your assessments',
  'disc.searchPlaceholder': 'Search topics, assessments and learning resources',
  'disc.filterType': 'Type',
  'disc.filterLevel': 'Level',
  'disc.filterDomain': 'Domain',
  'disc.filterDuration': 'Duration',
  'disc.topicsHeading': 'Suggested topics for you',
  'disc.topicsIntro':
    'Each suggestion says why it was made — from a knowledge gap in a result, your role, or a path you have not finished.',
  'disc.trendingHeading': 'Trending topics',
  'disc.trendingIntro':
    'What learners in your organisation are studying most, once usage is measured and aggregated with suppression.',
  'disc.popularHeading': 'Popular assessments',
  'disc.popularIntro': 'The assessments taken most often, once attempt counts are aggregated.',
  'disc.pathsHeading': 'Suggested learning paths',
  'disc.pathsIntro': 'Sequences of resources and assessments that build one skill end to end.',

  'lib.heading': 'Knowledge Library',
  'lib.intro':
    'Approved learning resources from across the organisation, in one place, trimmed to what you are allowed to see.',
  'lib.previewTitle': 'The library catalog is not live yet.',
  'lib.previewBody':
    'The domains below are real: they come from the assessments published to you. Sources, categories, resources and the document view are illustrative examples inside dashed frames. No source is connected for learners in this build.',
  'lib.previewRequirement':
    'Needs the learning catalog with access-trimmed search (LIVE-FULL-M1 and M4). Permission-aware knowledge search arrives in Phase 9.',
  'lib.domainsHeading': 'Domains',
  'lib.domainsIntro':
    'Taken from the assessments published to you. The full taxonomy is not yet exposed to learners, so a domain with nothing published to you is not listed.',
  'lib.domainsEmpty': 'No assessment is published to you yet, so there is no domain to show.',
  'lib.domainCount': '{count} published to you',
  'lib.sourcesHeading': 'Sources',
  'lib.sourcesIntro':
    'Where the library draws from. Each source needs an approved integration, access trimming and a deep-link policy before it appears here connected.',
  'lib.notConnected': 'Not connected',
  'lib.categoriesHeading': 'Categories and topics',
  'lib.categoriesIntro': 'Browse by kind of resource, then narrow by topic.',
  'lib.resourcesHeading': 'Resources',
  'lib.resourcesIntro':
    'Each card names its source, type and length. Only resources you can open in their source are ever listed.',
  'lib.filterSource': 'Source',
  'lib.filterDomain': 'Domain',
  'lib.filterType': 'Content type',
  'lib.filterLevel': 'Skill level',
  'lib.searchPlaceholder': 'Search the knowledge library',
  'lib.detailHeading': 'Document detail',
  'lib.detailIntro':
    'Opening a resource shows where it lives, its version, and what it covers before you leave KNOWZY.',
  'lib.detailSource': 'Source',
  'lib.detailDomain': 'Domain',
  'lib.detailTopic': 'Topic',
  'lib.detailVersion': 'Version',
  'lib.detailType': 'Type',
  'lib.detailAccess':
    'You would see this only because you can open it in its source. KNOWZY never lists a title you cannot access.',
  'lib.openInSource': 'Open in source',

  'help.heading': 'Help & Support',
  'help.intro': 'How this portal works, answers to common questions, and where to get help.',
  'help.previewTitle': 'Help search, tutorials and support channels are not live yet.',
  'help.previewBody':
    'The guides and questions below are real: they describe exactly how this release behaves. Tutorials and support channels inside dashed frames are illustrative examples. No support channel is connected, so none of them can be used.',
  'help.previewRequirement':
    'Support channels each need an approved integration — ticketing, mailbox, chat, scheduling, status (LIVE-FULL-M6).',
  'help.searchPlaceholder': 'Search help articles',
  'help.guidesHeading': 'User guides',
  'help.guidesIntro':
    'Short guides to what you can do in this release. Your administrator holds the full user guide (section 5).',
  'help.guideStartTitle': 'Take an assessment',
  'help.guideStart1': 'Open Home. Only assessments published to you appear there.',
  'help.guideStart2': 'Choose Open on an assessment, read what to expect, then choose Start.',
  'help.guideStart3': 'Answer one question at a time and choose Save and continue.',
  'help.guideStart4':
    'Choose Finish and score when you are ready. Unanswered questions count as incorrect.',
  'help.guideResumeTitle': 'Come back to an attempt',
  'help.guideResume1': 'Every answer is saved on the server as you go.',
  'help.guideResume2': 'Close the tab whenever you like. Home shows a Resume card for the attempt.',
  'help.guideResume3': 'Resume returns you to the same question with your answer still selected.',
  'help.guideResultTitle': 'Read your result',
  'help.guideResult1':
    'Your score, the pass decision and your proficiency band, as the server recorded them.',
  'help.guideResult2': 'How you did by topic, with the numbers behind every bar.',
  'help.guideResult3': 'Where to focus: the topics identified as knowledge gaps.',
  'help.faqHeading': 'Frequently asked questions',
  'help.faqQ1': 'Why can I not see an assessment a colleague mentioned?',
  'help.faqA1':
    'Only assessments that are published and that you are eligible for appear. If one is missing, it has not been published to you.',
  'help.faqQ2': 'An assessment says it is not available. Why?',
  'help.faqA2':
    'The card says why: it may be closed, not yet open, or you may have used every attempt allowed. The server decides, and the reason is shown instead of a button.',
  'help.faqQ3': 'Will I lose my answers if my browser closes?',
  'help.faqA3':
    'No. Each answer is saved on the server when you choose Save and continue. Reopen the portal and resume from the same question.',
  'help.faqQ4': 'Why are the correct answers not shown after I finish?',
  'help.faqA4':
    'The answer key never leaves the server, so questions can be reused fairly. Your result shows your score, your bands and your knowledge gaps.',
  'help.faqQ5': 'Does an unanswered question count against me?',
  'help.faqA5': 'Yes. An unanswered question counts as incorrect when the attempt is scored.',
  'help.faqQ6': 'Can I see my earlier results?',
  'help.faqA6':
    'Not in this release. A result is shown at the end of the attempt that produced it. My Learnings shows how many attempts you have used on each assessment.',
  'help.faqQ7': 'Why does the header say the identity is selected, not authenticated?',
  'help.faqA7':
    'This is a local demonstration build. You choose which learner to act as, and the server re-checks that learner on every request. A deployed build signs you in.',
  'help.tutorialsHeading': 'Tutorials',
  'help.tutorialsIntro':
    'Short walkthroughs of the portal, once approved tutorial content is published.',
  'help.play': 'Play',
  'help.channelsHeading': 'Support channels',
  'help.channelsIntro':
    'How to reach support once each channel is approved and connected. No address, number or hours are published until then.',
  'help.channelNotConfigured': 'Not configured',
  'help.channelTicket': 'Raise a support ticket',
  'help.channelTicketBody': 'Track a request from report to resolution.',
  'help.channelEmail': 'Email support',
  'help.channelEmailBody':
    'Write to the support team. The address is published when the mailbox is approved.',
  'help.channelChat': 'Live chat',
  'help.channelChatBody': 'Talk to the support team during support hours.',
  'help.channelCall': 'Schedule a call',
  'help.channelCallBody': 'Book time with a support specialist.',
  'help.statusHeading': 'System status',
  'help.statusBody':
    'Not connected to a status service, so no status is claimed. When it is, this panel shows the current state and when it was last checked.',
  'help.hoursHeading': 'Support hours',
  'help.hoursBody': 'Published by the support team when the service is approved.',

  'badges.heading': 'Badges',
  'badges.intro':
    'Recognition for what your recorded results show — awarded by published rules, verifiable, and never decided by a model.',
  'badges.previewTitle': 'No badge is awarded in this build.',
  'badges.previewBody':
    'Everything on this page is an illustrative example inside a dashed frame: the categories, the designs, the rules, how an award would be listed and how progress toward one would look. Nothing here is your data, no badge has been awarded to anyone, and none of the controls work.',
  'badges.previewRequirement':
    'Needs badge rules, evaluation and award records, which arrive in Phase 9 — a Future Phase 9 capability.',
  'badges.categoriesHeading': 'Badge categories',
  'badges.categoriesIntro':
    'Every badge belongs to one category, so the gallery can be browsed by what it recognises.',
  'badges.catAssessment': 'Assessment',
  'badges.catAssessmentBody': 'Passing assessments, and passing them well.',
  'badges.catMastery': 'Domain mastery',
  'badges.catMasteryBody': 'Reaching a proficiency band across a whole domain.',
  'badges.catConsistency': 'Consistency',
  'badges.catConsistencyBody': 'Keeping at it over weeks and months.',
  'badges.catExploration': 'Exploration',
  'badges.catExplorationBody': 'Learning beyond your own domain.',
  'badges.galleryHeading': 'Badge gallery',
  'badges.galleryIntro':
    'The approved badge designs. Each is shown greyed, as a design, because none can be earned in this release.',
  'badges.criteriaHeading': 'Badge criteria',
  'badges.criteriaIntro':
    'A rule names the recorded fields it reads, so anyone can check why a badge was or was not awarded. These rules are examples.',
  'badges.colBadge': 'Badge',
  'badges.colRule': 'Example rule',
  'badges.colBasis': 'Reads',
  'badges.basisResults': 'Scored results and pass decisions',
  'badges.basisBands': 'Topic proficiency bands',
  'badges.basisDates': 'Result dates',
  'badges.basisDomains': 'Assessment domains',
  'badges.basisNone': 'Nothing the platform records today',
  'badges.recentHeading': 'Recently earned badges',
  'badges.recentIntro':
    'How an award would be listed: the badge, the rule that was met and the result that met it. Nothing has been awarded, so these rows are examples of the layout and carry no date.',
  'badges.recentTag': 'Illustrative example — nothing has been awarded',
  'badges.recentWhen': 'Award date shown here',
  'badges.recentResult': 'Linked to the result that met the rule',
  'badges.progressHeading': 'Badge progress',
  'badges.progressIntro':
    'How far you are toward a badge, counted from your recorded results against its rule.',
  'badges.progressAssessmentPro':
    'Assessment Pro — example: 3 of 5 assessments passed at Proficient',
  'badges.progressExplorer': 'Knowledge Explorer — example: 1 of 3 domains passed',
  'badges.view': 'View badge',
  'badges.share': 'Share',
  'badges.badgeGrowthMindset': 'Growth Mindset',
  'badges.badgeKnowledgeSharer': 'Knowledge Sharer',
  'badges.badgeLearningChampion': 'Learning Champion',
  'badges.badgeTeamLearner': 'Team Learner',
  'badges.altGrowthMindset': 'Badge design: Growth Mindset. Not earned.',
  'badges.altKnowledgeSharer': 'Badge design: Knowledge Sharer. Not earned.',
  'badges.altLearningChampion': 'Badge design: Learning Champion. Not earned.',
  'badges.altTeamLearner': 'Badge design: Team Learner. Not earned.',
  'badges.ruleGrowthMindset': 'Example rule: move up at least one band on a retaken assessment.',
  'badges.ruleKnowledgeSharer':
    'Needs contribution records, which the platform does not keep. Shown as a design only.',
  'badges.ruleLearningChampion': 'Example rule: reach Expert on five different assessments.',
  'badges.ruleTeamLearner':
    'Needs team learning, which the platform does not model. Shown as a design only.',

  'prog.heading': 'My Progress',
  'prog.intro': 'How far you have come, by topic and by domain, and what to work on next.',
  'prog.previewTitle': 'Progress over time is not live yet.',
  'prog.previewBody':
    'Assessment completion below is real: it is counted from the assessments published to you. Everything inside a dashed frame is an illustrative example of the finished page. Your per-topic results today are on each result page, at the end of the attempt that produced them.',
  'prog.previewRequirement':
    'Needs a per-learner result history and a cross-result proficiency roll-up (LIVE-UI-M2); the learning journey needs the learning catalog (LIVE-FULL-M1 and M2).',
  'prog.completionHeading': 'Assessment completion',
  'prog.completionIntro':
    'Of the assessments published to you, how many you have attempted. Counted by the server; nothing is estimated.',
  'prog.completionMeter': 'Attempted',
  'prog.completionSummary': '{attempted} of {available} attempted',
  'prog.completionEmpty': 'No assessment is published to you yet.',
  'prog.filtersPeriod': 'Period',
  'prog.filtersDomain': 'Domain',
  'prog.searchPlaceholder': 'Filter topics',
  'prog.topicHeading': 'Progress by topic',
  'prog.topicIntro':
    'Your latest accuracy on each topic you have been assessed on, across all your results rather than one.',
  'prog.domainHeading': 'Progress by domain',
  'prog.domainIntro': 'The same results rolled up by domain.',
  'prog.competencyHeading': 'Competency overview',
  'prog.competencyIntro':
    'Your current proficiency band in each domain, using the same five bands a result is scored against.',
  'prog.colDomain': 'Domain',
  'prog.colBand': 'Current band',
  'prog.colBasis': 'Based on',
  'prog.bandExpert': 'Expert',
  'prog.bandProficient': 'Proficient',
  'prog.bandDeveloping': 'Developing',
  'prog.bandNeedsImprovement': 'Needs improvement',
  'prog.basisExample1': 'Example: 2 results, 24 questions',
  'prog.basisExample2': 'Example: 1 result, 10 questions',
  'prog.basisExample3': 'Example: 3 results, 30 questions',
  'prog.journeyHeading': 'Learning journey',
  'prog.journeyIntro':
    'The milestones along your way, in order — each one linked to the record behind it.',
  'prog.journey1': 'Joined the learning portal',
  'prog.journey2': 'Completed a first assessment',
  'prog.journey3': 'Reached Proficient in a domain',
  'prog.journey4': 'Closed a knowledge gap on a retake',
  'prog.journey5': 'Next: reach Expert in a domain',
  'prog.journeyDone': 'Example milestone',
  'prog.journeyNext': 'Example next step',

  'ex.pathOrderTitle': 'Customer order fundamentals',
  'ex.pathOrderBody':
    'How an order moves from entry to delivery, and how to fix the common exceptions.',
  'ex.pathQualityTitle': 'Quality inspection basics',
  'ex.pathQualityBody': 'Inspection steps, tolerances and how to record a defect.',
  'ex.pathPrivacyTitle': 'Data protection essentials',
  'ex.pathPrivacyBody': 'What personal data is, how to handle it, and what to do after a mistake.',
  'ex.pathSafetyTitle': 'Workplace safety induction',
  'ex.pathEscalationTitle': 'Handling customer escalations',
  'ex.sourceInternal': 'Internal learning',
  'ex.sourceSharePoint': 'SharePoint',
  'ex.sourceExternal': 'External provider',
  'ex.domainOperations': 'Operations',
  'ex.domainQuality': 'Quality',
  'ex.domainCompliance': 'Compliance',
  'ex.domainService': 'Customer service',
  'ex.levelBeginner': 'Beginner',
  'ex.levelIntermediate': 'Intermediate',
  'ex.duration2h30': '2 h 30 min',
  'ex.duration1h20': '1 h 20 min',
  'ex.duration45': '45 min',
  'ex.duration20': '20 min',
  'ex.duration15': '15 min',
  'ex.duration3': '3 min',
  'ex.modules10': '10 modules',
  'ex.modules6': '6 modules',
  'ex.modules4': '4 modules',
  'ex.progressLabel': 'Example progress',
  'ex.reasonGap': 'Suggested because: a knowledge gap in your last result',
  'ex.reasonRole': 'Suggested because: your assigned role',
  'ex.reasonPath': 'Suggested because: a path you have not finished',
  'ex.topicReturns': 'Returns and exchanges',
  'ex.topicInspection': 'Inspection tolerances',
  'ex.topicPersonalData': 'Handling personal data',
  'ex.topicOrderExceptions': 'Order exceptions',
  'ex.topicSafety': 'Safe handling',
  'ex.topicEscalation': 'Escalation paths',
  'ex.topicReporting': 'Incident reporting',
  'ex.assessOrders': 'Order management check',
  'ex.assessPrivacy': 'Data protection check',
  'ex.assessQuality': 'Quality basics check',
  'ex.questions10': '10 questions',
  'ex.questions15': '15 questions',
  'ex.catGuides': 'Guides and manuals',
  'ex.catProcedures': 'Procedures',
  'ex.catVideos': 'Videos',
  'ex.catExternal': 'External training',
  'ex.typeDocument': 'Document',
  'ex.typeGuide': 'Guide',
  'ex.typeVideo': 'Video',
  'ex.typeTraining': 'Training',
  'ex.resOrderGuide': 'Order entry guide',
  'ex.resOrderGuideBody': 'Step-by-step order entry, with the checks at each stage.',
  'ex.resReturnsProcedure': 'Returns procedure',
  'ex.resReturnsProcedureBody': 'When a return is accepted, and how it is recorded.',
  'ex.resInspectionVideo': 'Inspecting a finished product',
  'ex.resInspectionVideoBody': 'A short walkthrough of a visual inspection.',
  'ex.resPrivacyTraining': 'Personal data in daily work',
  'ex.resPrivacyTrainingBody': 'Practical rules for handling customer data.',
  'ex.detailVersion': 'Version 3',
  'ex.detailSummary':
    'Covers returns eligibility, the approval steps, how a refund or exchange is recorded, and the exceptions that need a supervisor.',
  'ex.tutorialFirst': 'Your first assessment',
  'ex.tutorialResume': 'Pausing and resuming an attempt',
  'ex.tutorialResult': 'Understanding your result',

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
