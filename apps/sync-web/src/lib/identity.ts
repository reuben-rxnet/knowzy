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
 * The KNOWZY Administrator holds every permission key and is the default, so
 * a pilot lead is never stopped by a missing capability while moving between
 * screens. The single-purpose roles below it remain, because they are how the
 * separation the platform depends on is demonstrated.
 *
 * One thing the administrator still cannot do: approve a question it authored.
 * Separation of duties is an IDENTITY comparison at approval
 * (`authorMayApproveOwn: false`), not a permission, so no amount of access
 * satisfies it. That is why a second administrator identity is seeded — the
 * pilot completes with one deliberate switch at the approval step instead of a
 * weakened gate.
 */
export const DEMO_SUBJECTS: readonly DemoSubject[] = [
  {
    upn: 'knowzy-administrator@local.invalid',
    label: 'KNOWZY Administrator',
    can: 'Full platform access',
  },
  {
    upn: 'knowzy-administrator-2@local.invalid',
    label: 'KNOWZY Administrator (second approver)',
    can: 'Full platform access — use to approve a question the first administrator authored',
  },
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

/** The administrator, so local and pilot work starts with full access. */
export const DEFAULT_SUBJECT: DemoSubject = DEMO_SUBJECTS[0] ?? {
  upn: 'knowzy-administrator@local.invalid',
  label: 'KNOWZY Administrator',
  can: 'Full platform access',
};

export const subjectByUpn = (upn: string | undefined): DemoSubject =>
  DEMO_SUBJECTS.find((subject) => subject.upn === upn) ?? DEFAULT_SUBJECT;

export const currentSubject = async (): Promise<DemoSubject> => {
  const store = await cookies();
  return subjectByUpn(store.get(SUBJECT_COOKIE)?.value);
};
