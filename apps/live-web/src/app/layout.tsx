import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { publicEnvironmentName } from '@knowzy/configuration';
import { KNOWZY_TAGLINE, LearnerShell } from '@knowzy/shared-ui';
import { t } from '../copy';
import { currentSubject } from '../lib/identity';
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
 * Root layout — the learner shell.
 *
 * Deliberately simpler than the authoring shell: learner §4 asks for lower
 * information density, and §11's workflow ribbon is an authoring concept, so
 * there is none here.
 *
 * No admin affordance exists in this bundle and there is no link into the
 * Authoring Portal: the two applications are separate deployables with
 * separate app registrations (ADR-001), so cross-portal navigation does not
 * exist.
 *
 * UI-M1 replaces the shell only. The four learner routes keep their existing
 * markup, actions, and — critically — their answer-key-free payloads.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const subject = await currentSubject();
  const environment = publicEnvironmentName();
  const currentPath = (await headers()).get('x-knowzy-path') ?? '/';

  return (
    <html lang="en">
      <body>
        <LearnerShell
          currentPath={currentPath}
          header={{
            portalName: t('app.portal'),
            tagline: KNOWZY_TAGLINE,
            identity: {
              displayName: subject.label,
              roleLabel: 'Learner',
              // Learner §5.1: persona switching is labelled, never presented
              // as a real employee.
              isLocalDevelopmentIdentity: environment === 'local',
            },
          }}
          footerNote={
            <>
              {t('shell.environment')}: {environment} · {t('shell.localOnly')}
            </>
          }
        >
          {children}
        </LearnerShell>
      </body>
    </html>
  );
}
