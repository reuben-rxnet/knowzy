import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { publicEnvironmentName } from '@knowzy/configuration';
import { t } from '../copy';
import { currentSubject } from '../lib/identity';
import './globals.css';

export const metadata: Metadata = {
  title: `${t('app.name')} — ${t('app.portal')}`,
  description: t('home.intro'),
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

/**
 * Learner shell — deliberately minimal (live-learning-portal.md §2).
 *
 * No admin affordances exist in this bundle, and there is no link into the
 * Authoring Portal: the two applications are separate deployables with separate
 * app registrations (ADR-001), so cross-portal navigation does not exist.
 *
 * S2: landmarks on every page, and the skip link as the first focusable
 * element.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const subject = await currentSubject();
  const environment = publicEnvironmentName();

  return (
    <html lang="en">
      <body>
        <a className="skip" href="#main">
          {t('shell.skipToContent')}
        </a>
        <header role="banner">
          <span>
            <strong>{t('app.name')}</strong> · {t('app.portal')}
          </span>
          <span>
            {t('shell.actingAs')}: <strong>{subject.label}</strong>{' '}
            <a href="/">{t('shell.change')}</a>
          </span>
        </header>
        <main id="main" role="main">
          {children}
        </main>
        <footer role="contentinfo">
          {t('shell.environment')}: {environment} · {t('shell.localOnly')}
        </footer>
      </body>
    </html>
  );
}
