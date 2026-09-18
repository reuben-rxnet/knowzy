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
 * The seeded local users this portal needs.
 *
 * Deliberately NOT every seeded role: the workflow needs an author, a
 * reviewer/approver, a publisher, a source administrator, and an assessment
 * manager. The role catalogue separates authoring from approval, so no single
 * identity can carry a question end to end — which is the point.
 */
export const DEMO_SUBJECTS: readonly DemoSubject[] = [
  {
    upn: 'source-administrator@local.invalid',
    label: 'Source administrator',
    can: 'Register sources, test connections, synchronize documents',
  },
  {
    upn: 'author@local.invalid',
    label: 'Author',
    can: 'Browse documents, generate questions, edit and submit drafts',
  },
  {
    upn: 'approver@local.invalid',
    label: 'Approver',
    can: 'Review, comment, disposition duplicates, approve or reject',
  },
  {
    upn: 'publisher@local.invalid',
    label: 'Publisher',
    can: 'Publish approved questions to the Question Bank, retire them',
  },
  {
    upn: 'assessment-manager@local.invalid',
    label: 'Assessment manager',
    can: 'Create, validate, and publish assessments',
  },
];

export const DEFAULT_SUBJECT: DemoSubject = DEMO_SUBJECTS[1] ?? {
  upn: 'author@local.invalid',
  label: 'Author',
  can: '',
};

export const subjectByUpn = (upn: string | undefined): DemoSubject =>
  DEMO_SUBJECTS.find((subject) => subject.upn === upn) ?? DEFAULT_SUBJECT;

export const currentSubject = async (): Promise<DemoSubject> => {
  const store = await cookies();
  return subjectByUpn(store.get(SUBJECT_COOKIE)?.value);
};
