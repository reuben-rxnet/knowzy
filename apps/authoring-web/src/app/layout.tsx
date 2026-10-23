import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { publicEnvironmentName } from '@knowzy/configuration';
import {
  AUTHORING_NAV,
  AuthoringShell,
  KNOWZY_TAGLINE,
  KNOWZY_WORKFLOW_STAGES,
  WorkflowRibbon,
} from '@knowzy/shared-ui';
import { t } from '../copy';
import { IdentityMenu } from '../components/IdentityMenu';
import { currentSubject, DEMO_SUBJECTS } from '../lib/identity';
import { api } from '../lib/api';
import './globals.css';

export const metadata: Metadata = {
  title: `${t('app.name')} — ${t('app.portal')}`,
  description: t('home.intro'),
  robots: { index: false, follow: false },
  // The approved favicon, from the design asset pack, served at the
  // synchronized path (`npm run assets:sync`). The contract test asserts it
  // is byte-identical to the approved source.
  icons: { icon: '/assets/knowzy/branding/favicon.svg' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

/**
 * Which workflow stage the current path belongs to.
 *
 * §11 allows the ribbon only where a stage is actually known, and requires
 * that a stage is marked complete only when completion is known. This returns
 * a stage label or `null`, and nothing here claims completion: the ribbon
 * renders every other stage neutral, which is the honest default until a
 * coverage read model exists (capability matrix A1).
 */
const stageForPath = (location: string): string | null => {
  const [path = location, query = ''] = location.split('?');
  if (path.startsWith('/sources')) return 'Knowledge Sources';
  if (path.startsWith('/generate')) return 'AI Generation';
  if (path.startsWith('/review')) {
    // The approval queue is its own stage in the ribbon, not part of review.
    return new URLSearchParams(query).get('queue') === 'approval' ? 'Approval' : 'Review';
  }
  if (path.startsWith('/import')) return 'Import Questions';
  if (path.startsWith('/publish')) return 'Question Bank';
  return null;
};

/**
 * The sidebar in the Document Studio's Simple mode (AI_DOCUMENT_STUDIO §12.5):
 * only the simple path. The other screens are HIDDEN, not removed -- each
 * still answers at its address, and Full mode shows them again. A failed read
 * shows the full sidebar: hiding a working screen because a read failed would
 * be the worse error.
 */
const SIMPLE_NAV_HREFS: ReadonlySet<string> = new Set([
  '/',
  '/sources',
  '/document-studio',
  '/administration/taxonomy',
]);

const navFor = async () => {
  const mode = await api<{ mode: string }>('/api/v1/authoring/document-studio/mode');
  return mode.ok && mode.data.mode === 'SIMPLE'
    ? AUTHORING_NAV.filter((item) => item.href !== undefined && SIMPLE_NAV_HREFS.has(item.href))
    : AUTHORING_NAV;
};

/**
 * Root layout — the authoring shell.
 *
 * UI-M1 replaces the shell only. Every page below renders its existing markup,
 * server actions, and refusals unchanged; the modernization of the pages
 * themselves is UI-M2 onward, one screen per milestone.
 *
 * The acting identity stays in the banner on every page, because which
 * identity is in force changes what every screen will let you do — and a
 * refusal is confusing when the identity is invisible.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const subject = await currentSubject();
  const environment = publicEnvironmentName();

  // Set by src/middleware.ts: a layout has no pathname of its own, and the
  // shell needs one to mark the active navigation item.
  const currentPath = (await headers()).get('x-knowzy-path') ?? '/';
  const stage = stageForPath(currentPath);
  const nav = await navFor();

  return (
    <html lang="en">
      <body>
        <AuthoringShell
          nav={nav}
          currentPath={currentPath}
          header={{
            portalName: t('app.portal'),
            tagline: KNOWZY_TAGLINE,
            identity: {
              displayName: subject.label,
              roleLabel: subject.can,
              // §34: a selected persona is never presented as a real employee.
              isLocalDevelopmentIdentity: environment === 'local',
            },
            // The switcher, in the header on every page rather than in a card
            // on the home page. A refusal is the most common reason to change
            // identity, and a refusal happens where you are.
            identityAction: (
              <IdentityMenu
                current={subject}
                subjects={DEMO_SUBJECTS}
                isLocalDevelopmentIdentity={environment === 'local'}
              />
            ),
          }}
          {...(stage === null
            ? {}
            : {
                ribbon: <WorkflowRibbon stages={KNOWZY_WORKFLOW_STAGES} activeLabel={stage} />,
              })}
          footerNote={
            <>
              {t('shell.environment')}: {environment} · {t('shell.localOnly')}
            </>
          }
        >
          {children}
        </AuthoringShell>
      </body>
    </html>
  );
}
