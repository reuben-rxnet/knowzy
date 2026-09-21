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
//
// UI-M2 converted the markup and nothing else. §15's three zones are now three
// numbered cards, which is what the zones were always meant to be; the
// preflight checks are a real table; and there is still no Publish button and
// no difficulty control, because §15 forbids both here.

import { useActionState, useState } from 'react';
import {
  AiBadge,
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  CheckboxRow,
  DataTable,
  EmptyState,
  Field,
  Fieldset,
  KeyValue,
  RefusalState,
  Select,
  StatusBadge,
  TBody,
  THead,
  Td,
  Th,
  TextInput,
  TextLink,
  Tr,
  statusTone,
} from '@knowzy/shared-ui';
import { Check, ChevronRight } from 'lucide-react';
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

/**
 * The recorded actions that authorize a generation job.
 *
 * VIEW_EXISTING and REUSE_EXISTING are decisions NOT to generate, and job
 * creation refuses them outright ("the recorded decision was VIEW_EXISTING,
 * which does not authorize generation"). Offering the generate form after one
 * of those was recorded invited an author to fill it in and be refused, so the
 * form is not offered — the existing questions are, which is what those two
 * decisions are actually about.
 */
const GENERATING_ACTIONS: readonly string[] = ['GENERATE_NEW', 'GENERATE_ADDITIONAL', 'REGENERATE'];

/**
 * The three §15 zones as a stepper.
 *
 * A step is "done" only because the record behind it exists — a preflight
 * result, a recorded decision, a finished job. Nothing is inferred from
 * position, so the stepper cannot claim progress the server has not made.
 */
const Stepper = ({
  hasPreflight,
  hasDecision,
  hasJob,
}: {
  readonly hasPreflight: boolean;
  readonly hasDecision: boolean;
  readonly hasJob: boolean;
}) => {
  const steps = [
    { label: t('generate.step1'), done: hasPreflight },
    { label: t('generate.step2'), done: hasDecision },
    { label: t('generate.step3'), done: hasJob },
  ];
  // The current step is the first that is not done.
  const currentIndex = steps.findIndex((step) => !step.done);

  return (
    <ol className="flex flex-wrap items-center gap-2">
      {steps.map((step, index) => {
        const current = index === currentIndex;
        return (
          <li key={step.label} className="flex items-center gap-2">
            <span
              className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-semibold ${
                step.done
                  ? 'bg-success-soft text-success'
                  : current
                    ? 'bg-brand-navy text-white'
                    : 'bg-surface-sunken text-ink-subtle'
              }`}
              {...(current ? { 'aria-current': 'step' as const } : {})}
            >
              <span
                aria-hidden="true"
                className="grid size-5 place-items-center rounded-pill bg-white/20 text-2xs font-bold"
              >
                {step.done ? <Check className="size-3" /> : index + 1}
              </span>
              {step.label}
              {step.done ? <span className="knowzy-sr-only">{t('generate.stepDone')}</span> : null}
            </span>
            {index < steps.length - 1 ? (
              <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-ink-subtle" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
};

/** The step number badge every zone carries. */
const Step = ({ n }: { readonly n: number }) => (
  <span
    aria-hidden="true"
    className="grid size-6 shrink-0 place-items-center rounded-pill bg-brand-navy text-sm font-bold text-white"
  >
    {n}
  </span>
);

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
  const decision =
    decisionState?.ok === true ? (decisionState.data as { chosenAction: string }) : null;
  const authorizesGeneration =
    decision !== null && GENERATING_ACTIONS.includes(decision.chosenAction);
  const job = jobState?.ok === true ? (jobState.data as GenerationResponse) : null;

  if (documents.length === 0) {
    return <EmptyState title={t('generate.noDocuments')} description={t('generate.noDocsBody')} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <Stepper
        hasPreflight={preflight !== null}
        hasDecision={decision !== null}
        hasJob={job !== null}
      />

      {/* ------------------------------------------------- zone 1: selection */}
      <Card>
        <CardHeader title={t('generate.step1')} icon={<Step n={1} />} />
        <form action={submitPreflight}>
          <CardBody>
            <input type="hidden" name="sourceId" value={sourceId} />
            <Fieldset legend={t('generate.documentsLabel')} hint={t('generate.documentsHint')}>
              <div className="divide-y divide-line rounded-md border border-line">
                {documents.map((document) => (
                  <CheckboxRow
                    key={document.documentId}
                    name="documentIds"
                    value={document.documentId}
                    description={`${document.containerName} · ${document.sectionCount} ${t(
                      'generate.sections',
                    ).toLowerCase()}`}
                  >
                    {document.name}
                  </CheckboxRow>
                ))}
              </div>
            </Fieldset>
          </CardBody>
          <CardFooter>
            <Button
              disabled={preflightPending}
              {...(preflightPending ? { disabledReason: t('sources.working') } : {})}
            >
              {t('generate.runPreflight')}
            </Button>
          </CardFooter>
        </form>
      </Card>

      {preflightState?.ok === false && preflightState.problem !== undefined ? (
        <Problem problem={preflightState.problem} />
      ) : null}

      {/* -------------------------------------------------- zone 2: decision */}
      {preflight === null ? null : (
        <Card>
          <CardHeader
            title={t('generate.step2')}
            icon={<Step n={2} />}
            actions={<Badge tone="info">{preflight.recommendation}</Badge>}
          />
          <CardBody>
            <div className="flex flex-col gap-5">
              <KeyValue
                items={[
                  { label: t('generate.recommendation'), value: preflight.recommendation },
                  { label: t('generate.reason'), value: preflight.recommendationReason },
                ]}
              />
              {/* Stated by the API, repeated here on purpose: a recommendation
                  is not permission. */}
              <p className="rounded-md bg-warning-soft px-3 py-2 text-base text-ink">
                {preflight.decisionRequired}
              </p>

              <DataTable caption={t('generate.checksCaption')}>
                <THead>
                  <Tr>
                    <Th scope="col">{t('generate.document')}</Th>
                    <Th scope="col" align="end">
                      {t('generate.coverage')}
                    </Th>
                    <Th scope="col" align="end">
                      {t('generate.uncovered')}
                    </Th>
                    <Th scope="col">{t('generate.check1')}</Th>
                    <Th scope="col">{t('generate.check2')}</Th>
                    <Th scope="col">{t('generate.check3')}</Th>
                    <Th scope="col">{t('generate.check4')}</Th>
                  </Tr>
                </THead>
                <TBody>
                  {preflight.documents.map((document) => {
                    const existing =
                      document.check2.approvedCount +
                      document.check2.publishedCount +
                      document.check2.draftCount;
                    return (
                      <Tr key={document.documentId}>
                        <Th scope="row">{document.documentName}</Th>
                        <Td numeric>{document.coveragePercent}%</Td>
                        <Td numeric>{document.uncoveredSectionCount}</Td>
                        <Td>
                          <StatusBadge
                            status={document.check1.status ?? '—'}
                            tone={statusTone(document.check1.status ?? '')}
                          />
                        </Td>
                        <Td>
                          <StatusBadge
                            status={document.check2.status ?? '—'}
                            tone={statusTone(document.check2.status ?? '')}
                          />
                          {/* A count is only useful if you can see what it
                              counts. */}
                          <span className="mt-1 block text-sm text-ink-subtle">
                            {t('generate.existingCounts', {
                              approved: document.check2.approvedCount,
                              published: document.check2.publishedCount,
                              draft: document.check2.draftCount,
                            })}
                          </span>
                          {existing > 0 ? (
                            <span className="mt-1 block">
                              <TextLink
                                href={`/review?queue=all&documentId=${document.documentId}`}
                              >
                                {t('review.existing')}
                              </TextLink>
                            </span>
                          ) : null}
                        </Td>
                        <Td>
                          <StatusBadge
                            status={document.check3.status ?? '—'}
                            tone={statusTone(document.check3.status ?? '')}
                          />
                          {document.check3.detail === undefined ? null : (
                            <span className="mt-1 block text-sm text-ink-subtle">
                              {document.check3.detail}
                            </span>
                          )}
                        </Td>
                        <Td>
                          <StatusBadge
                            status={document.check4.status ?? '—'}
                            tone={statusTone(document.check4.status ?? '')}
                          />
                          {document.check4.detail === undefined ? null : (
                            <span className="mt-1 block text-sm text-ink-subtle">
                              {document.check4.detail}
                            </span>
                          )}
                        </Td>
                      </Tr>
                    );
                  })}
                </TBody>
              </DataTable>

              <KeyValue
                items={[
                  {
                    label: t('generate.crossDomain'),
                    value: `${preflight.check5.matches.length} — ${preflight.check5.detail}`,
                  },
                  {
                    label: t('generate.poolConflicts'),
                    value: `${preflight.check6.status} — ${preflight.check6.detail}`,
                  },
                ]}
              />

              <form action={submitDecision} className="flex flex-col gap-3">
                <input type="hidden" name="preflightId" value={preflight.preflightId} />
                <Field
                  id="chosenAction"
                  label={t('generate.actionLabel')}
                  hint={t('generate.decideIntro')}
                  className="max-w-md"
                >
                  <Select
                    id="chosenAction"
                    name="chosenAction"
                    defaultValue={preflight.recommendation}
                  >
                    {/* The recommendation is not always one of the four §4.2
                        actions: a document nothing has been generated from
                        recommends GENERATE_NEW, which is not an alternative to
                        anything. Union, recommendation first, so the
                        recommended action is always selectable. */}
                    {[
                      preflight.recommendation,
                      ...preflight.offeredActions.filter(
                        (action) => action !== preflight.recommendation,
                      ),
                    ].map((action) => (
                      <option key={action} value={action}>
                        {action}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div>
                  <Button
                    disabled={decisionPending}
                    {...(decisionPending ? { disabledReason: t('sources.working') } : {})}
                  >
                    {t('generate.decide')}
                  </Button>
                </div>
              </form>

              {decisionState?.ok === false && decisionState.problem !== undefined ? (
                <Problem problem={decisionState.problem} />
              ) : null}
            </div>
          </CardBody>
        </Card>
      )}

      {/* A decision not to generate is an outcome, not a dead end: what those
          two decisions are about is the questions that already exist. */}
      {decision === null || authorizesGeneration ? null : (
        <RefusalState
          title={t('generate.notAuthorizedHeading')}
          reason={t('generate.notAuthorized', { action: decision.chosenAction })}
          details={
            <ul className="flex flex-col gap-1">
              {(preflight?.documents ?? []).map((document) => (
                <li key={document.documentId}>
                  <TextLink href={`/review?queue=all&documentId=${document.documentId}`}>
                    {t('review.existing')}: {document.documentName}
                  </TextLink>
                </li>
              ))}
            </ul>
          }
        />
      )}

      {/* ------------------------------------------------ zone 3: generation */}
      {preflight === null || !authorizesGeneration ? null : (
        <Card>
          <CardHeader
            title={t('generate.step3')}
            icon={<Step n={3} />}
            actions={<AiBadge>{t('generate.aiBadge')}</AiBadge>}
          />
          <form action={submitJob}>
            <CardBody>
              <input type="hidden" name="preflightId" value={preflight.preflightId} />
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <Field id="domainId" label={t('generate.domainLabel')}>
                  <Select
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
                  </Select>
                </Field>
                <Field id="topicId" label={t('generate.topicLabel')}>
                  <Select id="topicId" name="topicId">
                    {topics.map((topic) => (
                      <option key={topic.topicId} value={topic.topicId}>
                        {topic.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field id="scope" label={t('generate.scopeLabel')}>
                  <Select id="scope" name="scope" defaultValue="ENTIRE_DOCUMENT">
                    {SCOPES.map((scope) => (
                      <option key={scope} value={scope}>
                        {scope}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field id="reasonCode" label={t('generate.reasonCodeLabel')}>
                  <Select id="reasonCode" name="reasonCode" defaultValue="NEW_KNOWLEDGE">
                    {REASON_CODES.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field id="requestedQuestionCount" label={t('generate.countLabel')}>
                  <TextInput
                    id="requestedQuestionCount"
                    name="requestedQuestionCount"
                    type="number"
                    min={1}
                    max={50}
                    defaultValue={5}
                  />
                </Field>
              </div>
            </CardBody>
            <CardFooter>
              <Button
                disabled={jobPending}
                {...(jobPending ? { disabledReason: t('sources.working') } : {})}
              >
                {t('generate.run')}
              </Button>
            </CardFooter>
          </form>
          {jobState?.ok === false && jobState.problem !== undefined ? (
            <CardBody>
              <Problem problem={jobState.problem} />
            </CardBody>
          ) : null}
        </Card>
      )}

      {/* ------------------------------------------------------ the outcome */}
      {job === null ? null : (
        <Card>
          <CardHeader
            title={t('generate.resultHeading')}
            actions={<StatusBadge status={job.status} />}
          />
          <CardBody>
            <div className="flex flex-col gap-5">
              <KeyValue
                items={[
                  {
                    label: t('generate.accepted'),
                    value: `${job.acceptedQuestionCount} / ${job.requestedQuestionCount}`,
                  },
                  { label: t('generate.sections'), value: job.sectionCount },
                  { label: t('generate.rejections'), value: job.rejections.length },
                  {
                    label: t('generate.insufficient'),
                    value: job.insufficientEvidenceSections.length,
                  },
                ]}
              />

              {/* Rejections are the interesting half of the result: a question
                  the platform refused to keep is evidence the controls ran.
                  §5.3 */}
              {job.rejections.length === 0 ? null : (
                <div className="flex flex-col gap-2">
                  <h4 className="text-base font-semibold text-brand-navy-text">
                    {t('generate.rejections')}
                  </h4>
                  <ul className="flex flex-col gap-1.5">
                    {job.rejections.map((rejection, index) => (
                      <li
                        key={`${rejection.reason}-${index}`}
                        className="rounded-md bg-warning-soft px-3 py-2 text-sm text-ink"
                      >
                        <span className="font-semibold">{rejection.reason}</span>
                        <span className="mt-0.5 block text-ink-muted">{rejection.detail}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {job.insufficientEvidenceSections.length === 0 ? null : (
                <div className="flex flex-col gap-2">
                  <h4 className="text-base font-semibold text-brand-navy-text">
                    {t('generate.insufficient')}
                  </h4>
                  <ul className="flex flex-col gap-1.5">
                    {job.insufficientEvidenceSections.map((section) => (
                      <li key={section.sectionKey} className="text-sm text-ink">
                        <code className="font-mono text-ink-muted">
                          {section.sectionKey.slice(0, 12)}
                        </code>{' '}
                        — {section.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </CardBody>
          <CardFooter>
            <TextLink href="/review">{t('generate.toReview')}</TextLink>
          </CardFooter>
        </Card>
      )}
    </div>
  );
};
