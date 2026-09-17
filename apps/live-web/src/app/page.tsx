import { publicEnvironmentName } from '@knowzy/configuration';
import { t } from '../copy.js';

/**
 * Phase 1 learner landing page.
 *
 * Shows no assessments, because none can exist yet: a published assessment
 * requires an approved, published question (Phases 3–6). Listing a placeholder
 * assessment would be the learner-facing version of claiming more than the
 * platform knows.
 */
export default function Page() {
  // Public-subset accessor, never process.env (C3).
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
