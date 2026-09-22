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
 * One learner, and one identity that is not a learner.
 *
 * The second one is here on purpose: a result belongs to the learner who
 * earned it (§5.4), and the only way to show that is to try to read it as
 * somebody else. The refusal is part of the demonstration.
 */
export const DEMO_SUBJECTS: readonly DemoSubject[] = [
  {
    upn: 'learner@local.invalid',
    label: 'Local Learner',
    can: 'Take assessments, see their own results',
  },
  {
    // Present so a pilot lead can finish the workflow they started in the
    // authoring portal without borrowing the learner's identity. Its
    // `learning.*` grants are the same own-scoped ones the learner holds, so
    // it can read ITS OWN results and nobody else's -- the privacy rule is
    // unchanged by the amount of access the role carries elsewhere.
    upn: 'knowzy-administrator@local.invalid',
    label: 'KNOWZY Administrator',
    can: 'Full platform access — take an assessment to complete a pilot run',
  },
  {
    upn: 'manager@local.invalid',
    label: 'Local Manager',
    can: 'Has no Live Portal access — shown so a refusal can be demonstrated',
  },
];

export const DEFAULT_SUBJECT: DemoSubject = DEMO_SUBJECTS[0] ?? {
  upn: 'learner@local.invalid',
  label: 'Local Learner',
  can: '',
};

export const subjectByUpn = (upn: string | undefined): DemoSubject =>
  DEMO_SUBJECTS.find((subject) => subject.upn === upn) ?? DEFAULT_SUBJECT;

export const currentSubject = async (): Promise<DemoSubject> => {
  const store = await cookies();
  return subjectByUpn(store.get(SUBJECT_COOKIE)?.value);
};
