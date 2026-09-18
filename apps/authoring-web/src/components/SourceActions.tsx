'use client';

// Test Connection and Synchronize, with their results.
//
// A client component for one reason: both actions return a structured result
// that has to stay on screen next to the row that produced it. Test Connection
// is a five-check list with an outcome each; a sync is a set of counts. A plain
// redirect-and-rerender would throw both away.
//
// The actions themselves are server actions — the fetch, the identity header,
// and the API address all stay on the server.

import { useActionState } from 'react';
import { t } from '../copy';
import { synchronizeSource, testConnection } from '../app/actions';
import { Problem } from './Problem';

interface ConnectionCheck {
  readonly name: string;
  readonly outcome: string;
  readonly detail: string;
}

interface TestResult {
  readonly ok: boolean;
  readonly checks: readonly ConnectionCheck[];
  readonly durationMs: number;
  readonly capabilities: Readonly<Record<string, unknown>>;
}

interface SyncResult {
  readonly outcome: string;
  readonly scanned: number;
  readonly added: number;
  readonly modified: number;
  readonly unchanged: number;
  readonly failed: number;
  readonly extractedChars: number;
  readonly failures: readonly { documentName?: string; reason?: string; detail?: string }[];
}

const outcomeClass = (outcome: string): string =>
  outcome === 'PASS' || outcome === 'SUCCEEDED' ? 'pass' : outcome === 'FAIL' ? 'fail' : 'warn';

export const SourceActions = ({ sourceId }: { sourceId: string }) => {
  // The third argument is the permalink React navigates to if a submission is
  // ever replayed outside the hook's control. These forms do need JavaScript:
  // React renders a throwing action attribute until hydration, so this is not a
  // no-script fallback and is not claimed as one.
  const [testState, runTest, testPending] = useActionState(testConnection, null, '/sources');
  const [syncState, runSync, syncPending] = useActionState(synchronizeSource, null, '/sources');

  const test = testState?.ok === true ? (testState.data as TestResult) : null;
  const sync = syncState?.ok === true ? (syncState.data as SyncResult) : null;

  return (
    <>
      <div className="row">
        <form action={runTest}>
          <input type="hidden" name="sourceId" value={sourceId} />
          <button type="submit" className="secondary" disabled={testPending}>
            {t('sources.test')}
          </button>
        </form>
        <form action={runSync}>
          <input type="hidden" name="sourceId" value={sourceId} />
          <button type="submit" disabled={syncPending}>
            {t('sources.sync')}
          </button>
        </form>
      </div>

      {testState?.ok === false && testState.problem !== undefined ? (
        <Problem problem={testState.problem} />
      ) : null}
      {test === null ? null : (
        <div className="panel">
          <h3>{t('sources.testHeading')}</h3>
          <table>
            <caption>{test.durationMs} ms</caption>
            <thead>
              <tr>
                <th scope="col">{t('sources.checkName')}</th>
                <th scope="col">{t('sources.checkOutcome')}</th>
                <th scope="col">{t('sources.checkDetail')}</th>
              </tr>
            </thead>
            <tbody>
              {test.checks.map((check) => (
                <tr key={check.name}>
                  <th scope="row">{check.name}</th>
                  <td className={outcomeClass(check.outcome)}>{check.outcome}</td>
                  <td>{check.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h4>{t('sources.capabilities')}</h4>
          <p className="muted">{t('sources.capabilityNote')}</p>
          <ul className="plain">
            {Object.entries(test.capabilities).map(([name, value]) => (
              <li key={name}>
                <code>{name}</code>: {Array.isArray(value) ? value.join(', ') : String(value)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {syncState?.ok === false && syncState.problem !== undefined ? (
        <Problem problem={syncState.problem} />
      ) : null}
      {sync === null ? null : (
        <div className="panel">
          <h3>{t('sources.syncHeading')}</h3>
          <p className={outcomeClass(sync.outcome)}>{sync.outcome}</p>
          <dl className="kv">
            <dt>{t('sources.syncScanned')}</dt>
            <dd>{sync.scanned}</dd>
            <dt>{t('sources.syncAdded')}</dt>
            <dd>{sync.added}</dd>
            <dt>{t('sources.syncModified')}</dt>
            <dd>{sync.modified}</dd>
            <dt>{t('sources.syncUnchanged')}</dt>
            <dd>{sync.unchanged}</dd>
            <dt>{t('sources.syncFailed')}</dt>
            <dd>{sync.failed}</dd>
            <dt>{t('sources.syncChars')}</dt>
            <dd>{sync.extractedChars.toLocaleString('en-GB')}</dd>
          </dl>
          {/* A document the caller may not read is a per-item failure, not a
              failed sync. Listing them is the difference between "4 of 5" and
              a silently short index. */}
          {sync.failures.length === 0 ? null : (
            <ul>
              {sync.failures.map((failure, index) => (
                <li key={`${failure.documentName ?? index}`}>
                  {failure.documentName ?? '?'} — {failure.reason ?? ''} {failure.detail ?? ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
};
