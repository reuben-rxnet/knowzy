'use client';

// Question bank import — preview, then commit.
//
// Two buttons, deliberately. Preview writes nothing and reports what was
// found, what was rejected and why; only then does Create drafts exist. A
// single button would put somebody else's question bank into the review queue
// before anyone had read the summary.
//
// The screen also states the two things an importer most needs to know and
// would otherwise assume: imported questions land as DRAFT and go through the
// same approval, and the file must already be synchronized because an
// imported question is grounded in the document it came from.

import { useActionState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  DataTable,
  Field,
  KpiCard,
  Select,
  StatusBadge,
  TBody,
  THead,
  Td,
  Th,
  Tr,
} from '@knowzy/shared-ui';
import { t } from '../copy';
import { importQuestions, type ActionState } from '../app/actions';
import { Problem } from './Problem';

export interface ImportDocument {
  readonly documentId: string;
  readonly name: string;
  readonly sourceName: string;
}

export interface ImportDomain {
  readonly domainId: string;
  readonly name: string;
  readonly topics: readonly { readonly topicId: string; readonly name: string }[];
}

interface PreviewQuestion {
  readonly ordinal: number;
  readonly locator: string;
  readonly questionText: string;
  readonly correctOption: string;
  readonly domainName: string | null;
  readonly topicName: string | null;
}

interface Issue {
  readonly locator: string;
  readonly code: string;
  readonly detail: string;
}

interface ImportResponse {
  readonly intent?: string;
  readonly documentName: string;
  readonly strategy: string | null;
  readonly counts: {
    readonly detected: number;
    readonly valid: number;
    readonly invalid: number;
    readonly created?: number;
    readonly rejected?: number;
  };
  readonly valid?: readonly PreviewQuestion[];
  readonly invalid: readonly Issue[];
  readonly rejected?: readonly (Issue & { readonly reason: string })[];
  readonly detectionIssues: readonly Issue[];
}

const asResponse = (state: ActionState | null): ImportResponse | null =>
  state?.ok === true ? (state.data as ImportResponse) : null;

export const ImportPanel = ({
  documents,
  domains,
}: {
  readonly documents: readonly ImportDocument[];
  readonly domains: readonly ImportDomain[];
}): React.JSX.Element => {
  const [state, submit, pending] = useActionState(importQuestions, null);

  const shown = asResponse(state);
  // The action echoes the intent, so the screen can tell "nothing was written"
  // from "drafts were created" without keeping its own flag in step.
  const imported = shown !== null && shown.intent === 'import' ? shown : null;
  const topics = domains[0]?.topics ?? [];

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader title={t('import.selectTitle')} description={t('import.selectBody')} />
        <CardBody>
          {documents.length === 0 ? (
            <p className="text-sm text-ink-muted">{t('import.noDocuments')}</p>
          ) : (
            <form action={submit} className="flex flex-col gap-4">
              <div className="grid gap-4 md:grid-cols-3">
                <Field id="documentId" label={t('import.documentLabel')}>
                  <Select id="documentId" name="documentId">
                    {documents.map((document) => (
                      <option key={document.documentId} value={document.documentId}>
                        {document.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field id="domainId" label={t('import.domainLabel')}>
                  <Select id="domainId" name="domainId">
                    {domains.map((domain) => (
                      <option key={domain.domainId} value={domain.domainId}>
                        {domain.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field id="topicId" label={t('import.topicLabel')}>
                  <Select id="topicId" name="topicId">
                    {topics.map((topic) => (
                      <option key={topic.topicId} value={topic.topicId}>
                        {topic.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <p className="text-2xs text-ink-muted">{t('import.groundingNote')}</p>
              <CardFooter>
                <span className="flex flex-wrap gap-2">
                  <Button type="submit" name="intent" value="preview" disabled={pending}>
                    {pending ? t('import.previewing') : t('import.previewAction')}
                  </Button>
                  <Button
                    type="submit"
                    name="intent"
                    value="import"
                    tone="secondary"
                    disabled={pending || shown === null}
                    {...(pending || shown === null
                      ? { disabledReason: t('import.importDisabled') }
                      : {})}
                  >
                    {pending ? t('import.importing') : t('import.importAction')}
                  </Button>
                </span>
              </CardFooter>
            </form>
          )}
        </CardBody>
      </Card>

      {state !== null && state.ok === false && state.problem !== undefined ? (
        <Problem problem={state.problem} />
      ) : null}

      {shown === null ? null : (
        <Card>
          <CardHeader
            title={t('import.summaryTitle')}
            // Names the document it describes, because the select above is
            // uncontrolled and resets to its first option after the action
            // runs -- so the summary would otherwise appear to be about
            // whichever document happens to be showing.
            description={`${shown.documentName} — ${t('import.summaryBody')}`}
            actions={
              <Badge tone="neutral" withIcon={false}>
                {shown.strategy ?? t('import.noStrategy')}
              </Badge>
            }
          />
          <CardBody>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <KpiCard label={t('import.countDetected')} value={String(shown.counts.detected)} />
              <KpiCard label={t('import.countValid')} value={String(shown.counts.valid)} />
              <KpiCard label={t('import.countInvalid')} value={String(shown.counts.invalid)} />
              <KpiCard
                label={t('import.countCreated')}
                value={shown.counts.created === undefined ? '—' : String(shown.counts.created)}
              />
              <KpiCard
                label={t('import.countRejected')}
                value={shown.counts.rejected === undefined ? '—' : String(shown.counts.rejected)}
              />
            </div>
            {/* Three states, not two. Saying "drafts are in the review queue"
                after a run that created NOTHING is the kind of small lie that
                makes a screen untrustworthy -- and it happens on the most
                likely real import: the same bank imported twice, where every
                question is blocked as a duplicate. */}
            <p className="mt-3 text-2xs text-ink-muted">
              {imported === null
                ? t('import.previewOnlyNote')
                : (imported.counts.created ?? 0) > 0
                  ? t('import.createdNote')
                  : t('import.createdNoneNote')}
            </p>
          </CardBody>
        </Card>
      )}

      {shown?.valid === undefined || shown.valid.length === 0 ? null : (
        <Card>
          <CardHeader title={t('import.validTitle')} description={t('import.validBody')} />
          <CardBody>
            <DataTable caption={t('import.validTitle')}>
              <THead>
                <Tr>
                  <Th scope="col">{t('import.colLocator')}</Th>
                  <Th scope="col">{t('import.colQuestion')}</Th>
                  <Th scope="col">{t('import.colAnswer')}</Th>
                  <Th scope="col">{t('import.colTaxonomy')}</Th>
                </Tr>
              </THead>
              <TBody>
                {shown.valid.map((question) => (
                  <Tr key={question.ordinal}>
                    <Td>
                      <span className="font-mono text-2xs">{question.locator}</span>
                    </Td>
                    <Td>{question.questionText}</Td>
                    <Td>
                      <Badge tone="success" withIcon={false}>
                        {question.correctOption}
                      </Badge>
                    </Td>
                    <Td>
                      <span className="text-2xs text-ink-muted">
                        {[question.domainName, question.topicName].filter(Boolean).join(' · ') ||
                          '—'}
                      </span>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </DataTable>
          </CardBody>
        </Card>
      )}

      {shown === null ||
      (shown.invalid.length === 0 &&
        (shown.rejected ?? []).length === 0 &&
        shown.detectionIssues.length === 0) ? null : (
        <Card>
          <CardHeader title={t('import.issuesTitle')} description={t('import.issuesBody')} />
          <CardBody>
            <ol className="flex flex-col divide-y divide-line rounded-md border border-line">
              {[
                ...shown.detectionIssues.map((issue) => ({ ...issue, stage: 'DETECTION' })),
                ...shown.invalid.map((issue) => ({ ...issue, stage: 'VALIDATION' })),
                ...(shown.rejected ?? []).map((issue) => ({
                  ...issue,
                  code: issue.reason,
                  stage: 'GATE',
                })),
              ].map((issue, index) => (
                <li key={`${issue.locator}-${index}`} className="flex flex-col gap-1 px-3 py-2.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={issue.stage} tone="warning" />
                    <span className="font-mono text-2xs font-bold text-ink-subtle">
                      {issue.code}
                    </span>
                    <span className="font-mono text-2xs text-ink-muted">{issue.locator}</span>
                  </span>
                  <span className="text-sm text-ink-muted">{issue.detail}</span>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      )}
    </div>
  );
};
