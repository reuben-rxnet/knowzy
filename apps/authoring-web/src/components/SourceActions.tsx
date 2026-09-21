'use client';

// Test Connection and Synchronize, with their results.
//
// A client component for one reason: both actions return a structured result
// that has to stay on screen. Test Connection is a five-check list with an
// outcome each; a sync is a set of counts and a per-document failure list. A
// plain redirect-and-rerender would throw both away.
//
// The actions themselves are server actions — the fetch, the identity header,
// and the API address all stay on the server.
//
// UI-M2 moved the results into a drawer (§30: "detail panels become drawers").
// They used to push the table down the page; a drawer keeps the list in place,
// and it is the shared one, so Escape, the focus trap, and focus restoration
// come with it rather than being reimplemented here.

import { useEffect, useState } from 'react';
import {
  Badge,
  Button,
  DataTable,
  Drawer,
  KeyValue,
  StatusBadge,
  TBody,
  THead,
  Td,
  Th,
  Tr,
  statusTone,
} from '@knowzy/shared-ui';
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

export const SourceActions = ({
  sourceId,
  sourceName,
}: {
  readonly sourceId: string;
  readonly sourceName: string;
}) => {
  // The third argument is the permalink React navigates to if a submission is
  // ever replayed outside the hook's control. These forms do need JavaScript:
  // React renders a throwing action attribute until hydration, so this is not
  // a no-script fallback and is not claimed as one.
  const [testState, runTest, testPending] = useActionState(testConnection, null, '/sources');
  const [syncState, runSync, syncPending] = useActionState(synchronizeSource, null, '/sources');
  const [open, setOpen] = useState(false);

  const test = testState?.ok === true ? (testState.data as TestResult) : null;
  const sync = syncState?.ok === true ? (syncState.data as SyncResult) : null;
  const problem =
    testState?.ok === false
      ? testState.problem
      : syncState?.ok === false
        ? syncState.problem
        : undefined;

  // Open on a result — including a refusal, which is a result the author has
  // to see rather than a silence.
  useEffect(() => {
    if (test !== null || sync !== null || problem !== undefined) setOpen(true);
  }, [test, sync, problem]);

  return (
    <>
      <div className="flex flex-wrap gap-3">
        <form action={runTest}>
          <input type="hidden" name="sourceId" value={sourceId} />
          <Button
            tone="secondary"
            disabled={testPending}
            {...(testPending ? { disabledReason: t('sources.working') } : {})}
          >
            {t('sources.test')}
          </Button>
        </form>
        <form action={runSync}>
          <input type="hidden" name="sourceId" value={sourceId} />
          <Button
            disabled={syncPending}
            {...(syncPending ? { disabledReason: t('sources.working') } : {})}
          >
            {t('sources.sync')}
          </Button>
        </form>
      </div>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={`${sourceName} — ${t('sources.resultsTitle')}`}
        width="wide"
      >
        <div className="flex flex-col gap-6">
          {problem === undefined ? null : <Problem problem={problem} />}

          {test === null ? null : (
            <section className="flex flex-col gap-3">
              <h3 className="text-md font-semibold text-brand-navy-text">
                {t('sources.testHeading')}
              </h3>
              <DataTable
                caption={`${t('sources.testDuration')} ${test.durationMs} ${t('sources.milliseconds')}`}
              >
                <THead>
                  <Tr>
                    <Th scope="col">{t('sources.checkName')}</Th>
                    <Th scope="col">{t('sources.checkOutcome')}</Th>
                    <Th scope="col">{t('sources.checkDetail')}</Th>
                  </Tr>
                </THead>
                <TBody>
                  {test.checks.map((check) => (
                    <Tr key={check.name}>
                      <Th scope="row">{check.name}</Th>
                      <Td>
                        {/* A SKIP is an honest answer, not a failure: the mock
                            source needs no credential and says so. */}
                        <StatusBadge status={check.outcome} tone={statusTone(check.outcome)} />
                      </Td>
                      <Td>{check.detail}</Td>
                    </Tr>
                  ))}
                </TBody>
              </DataTable>

              <div className="flex flex-col gap-2">
                <h4 className="text-base font-semibold text-brand-navy-text">
                  {t('sources.capabilities')}
                </h4>
                <p className="text-sm text-ink-muted">{t('sources.capabilityNote')}</p>
                <ul className="flex flex-wrap gap-2">
                  {Object.entries(test.capabilities).map(([name, value]) => (
                    <li key={name}>
                      <Badge tone="neutral" withIcon={false}>
                        <span className="font-mono">{name}</span>
                        <span aria-hidden="true" className="text-ink-subtle">
                          ·
                        </span>
                        <span className="text-ink">
                          {Array.isArray(value) ? value.join(', ') : String(value)}
                        </span>
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          {sync === null ? null : (
            <section className="flex flex-col gap-3">
              <h3 className="flex items-center gap-2 text-md font-semibold text-brand-navy-text">
                {t('sources.syncHeading')}
                <StatusBadge status={sync.outcome} />
              </h3>
              <KeyValue
                items={[
                  { label: t('sources.syncScanned'), value: sync.scanned },
                  { label: t('sources.syncAdded'), value: sync.added },
                  { label: t('sources.syncModified'), value: sync.modified },
                  { label: t('sources.syncUnchanged'), value: sync.unchanged },
                  { label: t('sources.syncFailed'), value: sync.failed },
                  {
                    label: t('sources.syncChars'),
                    value: sync.extractedChars.toLocaleString('en-GB'),
                  },
                ]}
              />
              {/* A document the caller may not read is a per-item failure, not
                  a failed sync. Listing them is the difference between "4 of
                  5" and a silently short index. */}
              {sync.failures.length === 0 ? null : (
                <div className="flex flex-col gap-2">
                  <h4 className="text-base font-semibold text-brand-navy-text">
                    {t('sources.syncFailures')}
                  </h4>
                  <ul className="flex flex-col gap-1">
                    {sync.failures.map((failure, index) => (
                      <li
                        key={`${failure.documentName ?? index}`}
                        className="rounded-md bg-warning-soft px-3 py-2 text-sm text-ink"
                      >
                        <span className="font-semibold">{failure.documentName ?? '—'}</span>{' '}
                        {failure.reason ?? ''} {failure.detail ?? ''}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}
        </div>
      </Drawer>
    </>
  );
};
