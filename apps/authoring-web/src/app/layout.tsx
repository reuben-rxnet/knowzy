import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
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
 * Root layout.
 *
 * S2 (ux-design.md §7.1): landmark regions on every page, and a
 * skip-to-content link as the first focusable element. Both are here from the
 * first commit because they are structural, not decorative — retrofitting
 * landmarks means revisiting every screen.
 *
 * The acting-as identity is in the banner on every page, because which
 * identity is in force changes what every screen will let you do, and a
 * refusal is confusing when the identity is invisible.
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
            <Link href="/">{t('shell.change')}</Link>
          </span>
        </header>
        <nav aria-label={t('shell.nav')}>
          <ul>
            <li>
              <Link href="/">{t('nav.home')}</Link>
            </li>
            <li>
              <Link href="/sources">{t('nav.sources')}</Link>
            </li>
            <li>
              <Link href="/generate">{t('nav.generate')}</Link>
            </li>
            <li>
              <Link href="/review">{t('nav.review')}</Link>
            </li>
            <li>
              <Link href="/publish">{t('nav.publish')}</Link>
            </li>
          </ul>
        </nav>
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
