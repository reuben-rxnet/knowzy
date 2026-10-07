// Which seeded subject the demo is acting as.
//
// Same mechanism as the Authoring Portal, and the same disclaimer: the local
// stub issuer identifies a caller by `x-knowzy-subject` and refuses to run
// outside the `local` environment. This is a demonstration affordance, not
// authentication.
//
// The two portals do NOT share this module. They are separate deployables with
// separate app registrations (ADR-001), and @knowzy/shared-ui may import only
// @knowzy/shared-types (B6) — so a shared identity helper has nowhere to live
// that both could reach. The duplication is the boundary working, not an
// oversight.

import { cookies } from 'next/headers';

export const SUBJECT_COOKIE = 'knowzy_learner';

export interface DemoSubject {
  readonly upn: string;
  readonly label: string;
  readonly can: string;
}

/**
 * The Learner and the Authoring Administrator -- the only two identities in
 * use since the Authoring Role Simplification (2026-10-07,
 * docs/access-control.md §2.0).
 *
 * The administrator is here so a pilot lead can finish in this portal the
 * workflow they started in the authoring one. Its `learning.*` grants are the
 * same own-scoped ones the learner holds, so it reads ITS OWN results and
 * nobody else's -- the privacy rule does not depend on how much access the role
 * has elsewhere. (A retired Manager identity used to be listed to show a
 * refusal; it is deprovisioned and no longer offered.)
 */
export const DEMO_SUBJECTS: readonly DemoSubject[] = [
  {
    upn: 'learner@local.invalid',
    label: 'Learner',
    can: 'Take assessments, see their own results',
  },
  {
    upn: 'knowzy-administrator@local.invalid',
    label: 'Authoring Administrator',
    can: 'Takes an assessment to complete a pilot run; sees only its own results',
  },
];

export const DEFAULT_SUBJECT: DemoSubject = DEMO_SUBJECTS[0] ?? {
  upn: 'learner@local.invalid',
  label: 'Learner',
  can: '',
};

export const subjectByUpn = (upn: string | undefined): DemoSubject =>
  DEMO_SUBJECTS.find((subject) => subject.upn === upn) ?? DEFAULT_SUBJECT;

export const currentSubject = async (): Promise<DemoSubject> => {
  const store = await cookies();
  return subjectByUpn(store.get(SUBJECT_COOKIE)?.value);
};
