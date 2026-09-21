import Link from 'next/link';
import { publicEnvironmentName } from '@knowzy/configuration';
import { t } from '../copy';
import { switchSubject } from './actions';
import { currentSubject, DEMO_SUBJECTS } from '../lib/identity';

/**
 * Home, and the identity picker.
 *
 * Still not a dashboard: the Authoring Dashboard in authoring-portal.md §2
 * depends on reporting read models that do not exist yet, and a mocked one
 * would display counts the platform has never measured (X2).
 *
 * What it does instead is the thing the demonstration actually needs — choose
 * which seeded identity is acting. The role catalogue separates authoring from
 * approval, so the workflow CANNOT be walked by one person, and this page is
 * where you change hands.
 */
export default async function Page() {
  // The public subset, never process.env (C3). It cannot return a server-only
  // variable, which is what keeps the browser bundle inside B1.
  const environment = publicEnvironmentName();
  const subject = await currentSubject();

  return (
    <article className="legacy-page">
      <h1>{t('home.heading')}</h1>
      <p className="lede">{t('home.intro')}</p>

      <h2>{t('home.identityHeading')}</h2>
      <p className="lede">{t('home.identityIntro')}</p>
      <form action={switchSubject}>
        <fieldset>
          <legend>{t('home.identityLabel')}</legend>
          {DEMO_SUBJECTS.map((option) => (
            <label key={option.upn} style={{ fontWeight: 400 }}>
              <input
                type="radio"
                name="subject"
                value={option.upn}
                defaultChecked={option.upn === subject.upn}
              />{' '}
              <strong>{option.label}</strong> <span className="muted">— {option.can}</span>
            </label>
          ))}
          <button type="submit">{t('home.identitySubmit')}</button>
        </fieldset>
      </form>

      <h2>{t('home.stepsHeading')}</h2>
      <ol>
        <li>
          <Link href="/sources">{t('home.step1')}</Link>
        </li>
        <li>{t('home.step2')}</li>
        <li>
          <Link href="/generate">{t('home.step3')}</Link>
        </li>
        <li>
          <Link href="/review">{t('home.step4')}</Link>
        </li>
        <li>{t('home.step5')}</li>
        <li>
          <Link href="/publish">{t('home.step6')}</Link>
        </li>
      </ol>

      <h2>{t('home.liveHeading')}</h2>
      <p>{t('home.liveBody')}</p>

      <dl className="kv">
        <dt>{t('shell.environment')}</dt>
        <dd>{environment}</dd>
      </dl>
    </article>
  );
}
