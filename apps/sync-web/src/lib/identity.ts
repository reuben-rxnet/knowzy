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
 * Two identities since the Authoring Role Simplification (2026-10-07,
 * docs/access-control.md §2.0): the Authoring Administrator, who runs every
 * workflow here, and the Learner, listed so the refusal this console gives an
 * identity without source permissions can be seen. The retired single-purpose
 * identities are deprovisioned and not offered.
 */
export const DEMO_SUBJECTS: readonly DemoSubject[] = [
  {
    upn: 'knowzy-administrator@local.invalid',
    label: 'Authoring Administrator',
    can: 'Every authoring function, including source workflows and schedules',
  },
  {
    upn: 'learner@local.invalid',
    label: 'Learner',
    can: 'No access to this console — shown so the refusal can be seen',
  },
];

/** The administrator, so local and pilot work starts with full access. */
export const DEFAULT_SUBJECT: DemoSubject = DEMO_SUBJECTS[0] ?? {
  upn: 'knowzy-administrator@local.invalid',
  label: 'Authoring Administrator',
  can: 'Full platform access',
};

export const subjectByUpn = (upn: string | undefined): DemoSubject =>
  DEMO_SUBJECTS.find((subject) => subject.upn === upn) ?? DEFAULT_SUBJECT;

export const currentSubject = async (): Promise<DemoSubject> => {
  const store = await cookies();
  return subjectByUpn(store.get(SUBJECT_COOKIE)?.value);
};
