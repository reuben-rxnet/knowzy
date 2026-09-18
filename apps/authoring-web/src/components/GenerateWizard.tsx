'use client';

// The three-step generation flow, in one component.
//
// It is a client component because the steps share state that the server has
// no way to carry: a preflight result, then the decision recorded against it,
// then the job. workflows.md §4.2 is explicit that a preflight AUTHORIZES
// NOTHING until an action is recorded against it, so the steps cannot be
// collapsed into one button — and a preflight id has to survive between them.
//
// Every call is still a server action. The browser never sees the API address
// or the identity header.

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { t } from '../copy';
import { recordDecision, runGeneration, runPreflight } from '../app/actions';
import { Problem } from './Problem';

export interface WizardDocument {
  readonly documentId: string;
  readonly name: string;
  readonly containerName: string;
  readonly sectionCount: number;
}

export interface WizardTopic {
  readonly topicId: string;
  readonly name: string;
}

export interface WizardDomain {
  readonly domainId: string;
  readonly name: string;
  readonly topics: readonly WizardTopic[];
}

interface PreflightCheck {
  readonly check: string;
  readonly status?: string;
  readonly detail?: string;
}

interface DocumentPreflight {
  readonly documentId: string;
  readonly documentName: string;
  readonly coveragePercent: number;
  readonly uncoveredSectionCount: number;
  readonly check1: PreflightCheck & { readonly jobIds: readonly string[] };
  readonly check2: PreflightCheck & {
    readonly approvedCount: number;
    readonly publishedCount: number;
    readonly draftCount: number;
  };
  readonly check3: PreflightCheck;
  readonly check4: PreflightCheck & { readonly existingStemCount: number };
}

interface PreflightResponse {
  readonly preflightId: string;
  readonly recommendation: string;
  readonly recommendationReason: string;
  readonly offeredActions: readonly string[];
  readonly documents: readonly DocumentPreflight[];
  readonly check5: { readonly matches: readonly unknown[]; readonly detail: string };
  readonly check6: { readonly status: string; readonly detail: string };
  readonly decisionRequired: string;
}

interface GenerationResponse {
  readonly jobId: string;
  readonly status: string;
  readonly scope: string;
  readonly sectionCount: number;
  readonly requestedQuestionCount: number;
  readonly acceptedQuestionCount: number;
  readonly questionIds: readonly string[];
  readonly rejections: readonly {
    readonly reason: string;
    readonly detail: string;
    readonly sectionKey: string | null;
  }[];
  readonly insufficientEvidenceSections: readonly {
    readonly sectionKey: string;
    readonly reason: string;
  }[];
  readonly rejectionCounts: Readonly<Record<string, number>>;
  readonly tokens: { readonly input: number; readonly output: number };
}

const SCOPES = ['ENTIRE_DOCUMENT', 'MODIFIED_SECTIONS_ONLY', 'UNCOVERED_SECTIONS_ONLY'] as const;

const REASON_CODES = [
  'NEW_KNOWLEDGE',
  'CONTENT_CHANGED',
  'COVERAGE_GAP',
  'PUBLISHER_REQUESTED',
] as const;

export const GenerateWizard = ({
  sourceId,
  documents,
  domains,
}: {
  sourceId: string;
  documents: readonly WizardDocument[];
  domains: readonly WizardDomain[];
}) => {
  // Third argument: the permalink. See SourceActions on what it does and does
  // not buy.
  const [preflightState, submitPreflight, preflightPending] = useActionState(
    runPreflight,
    null,
    '/generate',
  );
  const [decisionState, submitDecision, decisionPending] = useActionState(
    recordDecision,
    null,
    '/generate',
  );
  const [jobState, submitJob, jobPending] = useActionState(runGeneration, null, '/generate');

  const [domainId, setDomainId] = useState<string>(domains[0]?.domainId ?? '');
  const topics = domains.find((domain) => domain.domainId === domainId)?.topics ?? [];

  const preflight = preflightState?.ok === true ? (preflightState.data as PreflightResponse) : null;
  const decided = decisionState?.ok === true;
  const job = jobState?.ok === true ? (jobState.data as GenerationResponse) : null;

  if (documents.length === 0) {
    return <p>{t('generate.noDocuments')}</p>;
  }

  return (
    <>
      <h2>{t('generate.step1')}</h2>
      <form action={submitPreflight}>
        <input type="hidden" name="sourceId" value={sourceId} />
        <fieldset>
          <legend>{t('generate.documentsLabel')}</legend>
          <p className="hint">{t('generate.documentsHint')}</p>
          {documents.map((document) => (
            <label key={document.documentId} style={{ fontWeight: 400 }}>
              <input type="checkbox" name="documentIds" value={document.documentId} />{' '}
              {document.containerName} / <strong>{document.name}</strong>{' '}
              <span className="muted">
                {document.sectionCount} {t('generate.sections').toLowerCase()}
              </span>
            </label>
          ))}
          <button type="submit" disabled={preflightPending}>
            {t('generate.runPreflight')}
          </button>
        </fieldset>
      </form>

      {preflightState?.ok === false && preflightState.problem !== undefined ? (
        <Problem problem={preflightState.problem} />
      ) : null}

      {preflight === null ? null : (
        <>
          <h2>{t('generate.step2')}</h2>
          <div className="panel">
            <dl className="kv">
              <dt>{t('generate.recommendation')}</dt>
              <dd>
                <strong>{preflight.recommendation}</strong>
              </dd>
              <dt>{t('generate.reason')}</dt>
              <dd>{preflight.recommendationReason}</dd>
            </dl>
            {/* Stated by the API, repeated here on purpose: a recommendation is
                not permission. */}
            <p className="muted">{preflight.decisionRequired}</p>
          </div>

          <table>
            <caption>{t('generate.checksCaption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('generate.document')}</th>
                <th scope="col">{t('generate.coverage')}</th>
                <th scope="col">{t('generate.uncovered')}</th>
                <th scope="col">1</th>
                <th scope="col">2</th>
                <th scope="col">3</th>
                <th scope="col">4</th>
              </tr>
            </thead>
            <tbody>
              {preflight.documents.map((document) => (
                <tr key={document.documentId}>
                  <th scope="row">{document.documentName}</th>
                  <td>{document.coveragePercent}%</td>
                  <td>{document.uncoveredSectionCount}</td>
                  <td title={document.check1.check}>{document.check1.status ?? '—'}</td>
                  <td title={document.check2.check}>
                    {document.check2.status ?? '—'} ({document.check2.approvedCount}/
                    {document.check2.publishedCount}/{document.check2.draftCount})
                  </td>
                  <td title={document.check3.detail ?? document.check3.check}>
                    {document.check3.status ?? '—'}
                  </td>
                  <td title={document.check4.detail ?? document.check4.check}>
                    {document.check4.status ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">
            {t('generate.crossDomain')}: {preflight.check5.matches.length} —{' '}
            {preflight.check5.detail}
          </p>
          <p className="muted">
            {t('generate.poolConflicts')}: {preflight.check6.status} — {preflight.check6.detail}
          </p>

          <h3>{t('generate.decideHeading')}</h3>
          <p className="lede">{t('generate.decideIntro')}</p>
          <form action={submitDecision}>
            <input type="hidden" name="preflightId" value={preflight.preflightId} />
            <label htmlFor="chosenAction">{t('generate.actionLabel')}</label>
            <select id="chosenAction" name="chosenAction" defaultValue={preflight.recommendation}>
              {/* The recommendation is not always one of the four §4.2 actions:
                  a document nothing has been generated from recommends
                  GENERATE_NEW, which is not an alternative to anything. Union,
                  recommendation first, so the recommended action is always
                  selectable. */}
              {[
                preflight.recommendation,
                ...preflight.offeredActions.filter((action) => action !== preflight.recommendation),
              ].map((action) => (
                <option key={action} value={action}>
                  {action}
                </option>
              ))}
            </select>
            <button type="submit" disabled={decisionPending}>
              {t('generate.decide')}
            </button>
          </form>
          {decisionState?.ok === false && decisionState.problem !== undefined ? (
            <Problem problem={decisionState.problem} />
          ) : null}
        </>
      )}

      {preflight === null || !decided ? null : (
        <>
          <h2>{t('generate.step3')}</h2>
          <form action={submitJob}>
            <input type="hidden" name="preflightId" value={preflight.preflightId} />
            <div className="row">
              <div>
                <label htmlFor="domainId">{t('generate.domainLabel')}</label>
                <select
                  id="domainId"
                  name="domainId"
                  value={domainId}
                  onChange={(event) => setDomainId(event.target.value)}
                >
                  {domains.map((domain) => (
                    <option key={domain.domainId} value={domain.domainId}>
                      {domain.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="topicId">{t('generate.topicLabel')}</label>
                <select id="topicId" name="topicId">
                  {topics.map((topic) => (
                    <option key={topic.topicId} value={topic.topicId}>
                      {topic.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="row">
              <div>
                <label htmlFor="scope">{t('generate.scopeLabel')}</label>
                <select id="scope" name="scope" defaultValue="ENTIRE_DOCUMENT">
                  {SCOPES.map((scope) => (
                    <option key={scope} value={scope}>
                      {scope}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="reasonCode">{t('generate.reasonCodeLabel')}</label>
                <select id="reasonCode" name="reasonCode" defaultValue="NEW_KNOWLEDGE">
                  {REASON_CODES.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="requestedQuestionCount">{t('generate.countLabel')}</label>
                <input
                  id="requestedQuestionCount"
                  name="requestedQuestionCount"
                  type="number"
                  min={1}
                  max={50}
                  defaultValue={5}
                />
              </div>
            </div>
            <button type="submit" disabled={jobPending}>
              {t('generate.run')}
            </button>
          </form>
          {jobState?.ok === false && jobState.problem !== undefined ? (
            <Problem problem={jobState.problem} />
          ) : null}
        </>
      )}

      {job === null ? null : (
        <div className="panel okpanel">
          <h3>{t('generate.resultHeading')}</h3>
          <dl className="kv">
            <dt>{t('review.status')}</dt>
            <dd className={job.status === 'SUCCEEDED' ? 'pass' : 'warn'}>{job.status}</dd>
            <dt>{t('generate.accepted')}</dt>
            <dd>
              {job.acceptedQuestionCount} / {job.requestedQuestionCount}
            </dd>
            <dt>{t('generate.sections')}</dt>
            <dd>{job.sectionCount}</dd>
            <dt>{t('generate.rejections')}</dt>
            <dd>{job.rejections.length}</dd>
            <dt>{t('generate.insufficient')}</dt>
            <dd>{job.insufficientEvidenceSections.length}</dd>
          </dl>
          {/* Rejections are the interesting half of the result: a question the
              platform refused to keep is evidence the controls ran. §5.3 */}
          {job.rejections.length === 0 ? null : (
            <ul>
              {job.rejections.map((rejection, index) => (
                <li key={`${rejection.reason}-${index}`}>
                  <strong>{rejection.reason}</strong> — {rejection.detail}
                </li>
              ))}
            </ul>
          )}
          {job.insufficientEvidenceSections.length === 0 ? null : (
            <ul>
              {job.insufficientEvidenceSections.map((section) => (
                <li key={section.sectionKey}>
                  <code>{section.sectionKey.slice(0, 12)}</code> — {section.reason}
                </li>
              ))}
            </ul>
          )}
          <p>
            <Link href="/review">{t('generate.toReview')}</Link>
          </p>
        </div>
      )}
    </>
  );
};
