import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { t } from '../copy.js';

export const metadata: Metadata = {
  title: `${t('app.name')} — ${t('app.portal')}`,
  description: t('phase1.body'),
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
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main">{t('shell.skipToContent')}</a>
        <header role="banner">
          <strong>{t('app.name')}</strong>
        </header>
        <main id="main" role="main">
          {children}
        </main>
      </body>
    </html>
  );
}
