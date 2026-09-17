import { publicEnvironmentName } from '@knowzy/configuration';
import { t } from '../copy.js';

/**
 * Phase 1 landing page.
 *
 * Deliberately not a dashboard. The Authoring Dashboard is specified in
 * authoring-portal.md §2 and depends on reporting read models (Phase 10) and
 * the pipeline states that Phases 3–5 create. A mocked dashboard here would
 * display counts the platform has not measured, which X2 forbids: "Never claim
 * more than the platform knows."
 *
 * The environment is read on the server. It is the one value this page can
 * state truthfully.
 */
export default function Page() {
  // Read through the public-subset accessor, never process.env (C3). That
  // accessor cannot return a server-side variable, which is what keeps B1
  // true for the browser bundle.
  const environment = publicEnvironmentName();

  return (
    <article>
      <h1>{t('phase1.heading')}</h1>
      <p>{t('phase1.body')}</p>
      <dl>
        <dt>{t('phase1.environmentLabel')}</dt>
        <dd>{environment}</dd>
        <dt>{t('phase1.nextLabel')}</dt>
        <dd>{t('phase1.nextValue')}</dd>
      </dl>
    </article>
  );
}
