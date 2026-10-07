// Which seeded subject the demo is acting as.
//
// The local stub issuer identifies a caller by the `x-knowzy-subject` header
// (M1), and it REFUSES to run outside the `local` environment — so this picker
// exists only where the stub does. It is a demonstration affordance, not an
// authentication mechanism, and the UI says so.
//
// The choice lives in an httpOnly cookie so the browser cannot read it back and
// nothing in a page can forge a different one client-side. The server reads the
// cookie and attaches the header; the API then re-resolves roles and scope from
// the database, which is what makes invariant 8 hold regardless of what this
// cookie says.

import { cookies } from 'next/headers';

export const SUBJECT_COOKIE = 'knowzy_subject';

export interface DemoSubject {
  readonly upn: string;
  readonly label: string;
  /** What this identity can demonstrate, so the picker is self-explanatory. */
  readonly can: string;
}

/**
 * The seeded local users this portal offers -- TWO, since the Authoring Role
 * Simplification (2026-10-07, docs/access-control.md §2.0).
 *
 * The Authoring Administrator holds every authoring permission and is the
 * default. Self-approval is permitted by configuration, so one administrator
 * takes a question from draft to publication; the records still name who did
 * each step. The Learner is listed so the refusal an authoring screen gives a
 * learner can be seen; it has no authoring access.
 *
 * The retired identities (author, approver, publisher, the second
 * administrator...) still exist as DEPROVISIONED users for history, and are
 * deliberately not offered here.
 */
export const DEMO_SUBJECTS: readonly DemoSubject[] = [
  {
    upn: 'knowzy-administrator@local.invalid',
    label: 'Authoring Administrator',
    can: 'Every authoring function, including approving and publishing your own work',
  },
  {
    upn: 'learner@local.invalid',
    label: 'Learner',
    can: 'Takes assessments in the Live Learning Portal; no authoring access',
  },
];

/** The administrator, so local and pilot work starts with full access. */
export const DEFAULT_SUBJECT: DemoSubject = DEMO_SUBJECTS[0] ?? {
  upn: 'knowzy-administrator@local.invalid',
  label: 'Authoring Administrator',
  can: 'Every authoring function',
};

export const subjectByUpn = (upn: string | undefined): DemoSubject =>
  DEMO_SUBJECTS.find((subject) => subject.upn === upn) ?? DEFAULT_SUBJECT;

export const currentSubject = async (): Promise<DemoSubject> => {
  const store = await cookies();
  return subjectByUpn(store.get(SUBJECT_COOKIE)?.value);
};
