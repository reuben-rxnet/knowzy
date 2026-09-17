// Externalized copy — ux-design.md §9.2 C1.
//
// C8: content is never localized. Questions, options, explanations, evidence,
// and document names render in the language of the source. Only chrome lives
// here.

export const copy = {
  'app.name': 'Knowzy',
  'app.portal': 'Learning',
  'shell.skipToContent': 'Skip to content',

  'phase1.heading': 'Foundation phase',
  'phase1.body':
    'Assessments are not available yet. Assessment discovery and the quiz runner arrive with ' +
    'the phases that build them.',
  'phase1.environmentLabel': 'Environment',
  'phase1.nextLabel': 'Next phase',
  'phase1.nextValue': 'Phase 2 — Identity and access',
} as const;

export type CopyKey = keyof typeof copy;

/** Resolves a copy key. A missing key is a build-time error, not a blank UI. */
export const t = (key: CopyKey): string => copy[key];
