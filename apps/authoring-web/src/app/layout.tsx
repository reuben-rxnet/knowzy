import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { t } from '../copy';

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
 * Root layout.
 *
 * S2 (ux-design.md §7.1): landmark regions on every page, and a
 * skip-to-content link as the first focusable element. Both are here from the
 * first commit because they are structural, not decorative — retrofitting
 * landmarks means revisiting every screen.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main">{t('shell.skipToContent')}</a>
        <header role="banner">
          <strong>{t('app.name')}</strong> · {t('app.portal')}
        </header>
        <main id="main" role="main">
          {children}
        </main>
      </body>
    </html>
  );
}
