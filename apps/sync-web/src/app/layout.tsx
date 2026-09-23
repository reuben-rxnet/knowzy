// The Sync Manager shell.
//
// Deliberately NOT the Knowzy AuthoringShell: the approved design specifies a
// single operational dashboard with **no left navigation rail**, and reusing a
// shell built around one would contradict the specification on the first
// screen. What is reused is everything that carries behaviour — the header
// layout idea, the design-system primitives, the focus and dialog handling.
//
// The header states the product and what it does on every render:
//
//     SharePoint Sync Manager
//     Knowledge-source synchronization into KNOWZY
//
// That second line is load-bearing. The product name says SharePoint, and this
// release synchronizes INTO Knowzy rather than between two SharePoint
// locations, so the subtitle removes the inference instead of leaving it.

import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { publicEnvironmentName } from '@knowzy/configuration';
import { t } from '../copy';
import { currentSubject } from '../lib/identity';
import './globals.css';

export const metadata: Metadata = {
  title: `${t('app.name')} — ${t('app.subtitle')}`,
  description: t('app.tagline'),
  robots: { index: false, follow: false },
  icons: { icon: '/assets/knowzy/branding/favicon.svg' },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const subject = await currentSubject();
  const environment = publicEnvironmentName();

  return (
    <html lang="en">
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-brand-blue focus:px-4 focus:py-2 focus:text-white"
        >
          Skip to content
        </a>
        <div className="min-h-dvh">
          <header className="border-b border-line bg-brand-surface">
            <div className="sync-shell flex flex-wrap items-center justify-between gap-4 py-4">
              <div className="flex items-center gap-3">
                {/* The mark is a semantic heading, not an image used as one:
                    a screen reader announces the product, and the subtitle
                    that qualifies it is in the same landmark. */}
                <span
                  aria-hidden="true"
                  className="grid size-10 shrink-0 place-items-center rounded-md bg-brand-blue text-lg font-bold text-white"
                >
                  S
                </span>
                <div className="flex flex-col">
                  <span className="text-lg font-semibold text-brand-navy-text">
                    {t('app.name')}
                  </span>
                  <span className="text-2xs text-ink-muted">{t('app.subtitle')}</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-2xs text-ink-muted">
                <span>
                  {t('header.environment')}: <span className="font-semibold">{environment}</span>
                </span>
                <span>
                  {t('header.identity')}:{' '}
                  <span className="font-semibold text-brand-navy-text">{subject.label}</span>
                </span>
                {/* Settings, Help and Notifications appear in the approved
                    header. They are rendered DISABLED with a reason rather
                    than as links to nothing. */}
                {(['header.settings', 'header.help', 'header.notifications'] as const).map(
                  (key) => (
                    <button
                      key={key}
                      type="button"
                      disabled
                      aria-disabled="true"
                      title={t('header.plannedNote')}
                      className="cursor-not-allowed rounded-md px-2 py-1 text-ink-subtle ring-1 ring-inset ring-line"
                    >
                      {t(key)}
                      <span className="sr-only"> — {t('header.plannedNote')}</span>
                    </button>
                  ),
                )}
              </div>
            </div>
          </header>

          <main id="main" className="sync-shell py-6">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
