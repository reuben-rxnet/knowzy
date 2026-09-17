// Externalized copy — ux-design.md §9.2 C1.
//
// "All UI copy is externalized from the first commit: labels, headings, empty
//  states, validation messages, error messages... No user-visible string
//  literal in a component."
//
// Established in Phase 1 with the few strings Phase 1 has, because retrofitting
// externalization is expensive and always incomplete. C3: interpolation is
// named, never positional or concatenated.

export const copy = {
  'app.name': 'Knowzy',
  'app.portal': 'Authoring and Administration',
  'shell.skipToContent': 'Skip to content',

  'phase1.heading': 'Foundation phase',
  'phase1.body':
    'The platform foundation is in place: schema, configuration, audit, and boundaries. ' +
    'Authoring screens arrive with the phases that own them.',
  'phase1.environmentLabel': 'Environment',
  'phase1.nextLabel': 'Next phase',
  'phase1.nextValue': 'Phase 2 — Identity and access',
} as const;

export type CopyKey = keyof typeof copy;

/** Resolves a copy key. A missing key is a build-time error, not a blank UI. */
export const t = (key: CopyKey): string => copy[key];
