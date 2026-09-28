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

import { useActionState, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  AiBadge,
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  CheckboxRow,
  EmptyState,
  Field,
  Fieldset,
  KeyValue,
  Meter,
  RefusalState,
  Select,
  StatusBadge,
  TextInput,
  Textarea,
  TextLink,
  statusTone,
  type BadgeTone,
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
  /** The check's own name, e.g. `SOURCE_CONTENT_CHANGED`. */
  readonly check: string;
  readonly status?: string;
  readonly detail?: string;
}

interface DocumentPreflight {
  readonly documentId: string;
  readonly documentName: string;
  readonly coveragePercent: number;
  readonly uncoveredSectionCount: number;
  readonly sections?: {
    readonly assessable: number;
    readonly attempted: number;
    readonly generated: number;
    readonly refused: number;
    readonly unresolved: number;
    readonly neverAttempted: number;
  };
  readonly check1: PreflightCheck & {
    readonly jobIds: readonly string[];
    readonly lastGeneratedAt?: string | null;
  };
  readonly check2: PreflightCheck & {
    readonly approvedCount: number;
    readonly publishedCount: number;
    readonly draftCount: number;
  };
  readonly check3: PreflightCheck & {
    readonly versionChanged?: boolean;
    readonly hashChanged?: boolean;
  };
  readonly check4: PreflightCheck & {
    readonly existingStemCount: number;
    readonly assessableSectionCount?: number;
  };
}

interface PreflightResponse {
  readonly preflightId: string;
  readonly recommendation: string;
  readonly recommendationReason: string;
  readonly offeredActions: readonly string[];
  readonly documents: readonly DocumentPreflight[];
  readonly check5: {
    readonly check?: string;
    readonly matches: readonly unknown[];
    readonly detail: string;
  };
  readonly check6: {
    readonly check?: string;
    readonly status: string;
    readonly detail: string;
    readonly conflicts?: readonly unknown[];
  };
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

const formatWhen = (value: string): string =>
  new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

/** The step number badge every zone carries. */
const Step = ({ n }: { readonly n: number }) => (
  <span
    aria-hidden="true"
    className="grid size-6 shrink-0 place-items-center rounded-pill bg-brand-navy text-sm font-bold text-white"
  >
    {n}
  </span>
);

export interface OrgOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface OrgOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

/**
 * A provider an author may choose (GEN-PROVIDER-M1), from
 * `GET /authoring/generation/providers`. A MENU, not the control: creating the
 * job re-checks the gate, so a choice that went stale is refused there.
 */
export interface GenerationProviderChoice {
  readonly providerId: string;
  readonly displayName: string;
  readonly modelId: string | null;
  readonly available: boolean;
  readonly reason: string;
  readonly active: boolean;
}

/** The deterministic generator, when the provider list could not be read. */
const DETERMINISTIC_ONLY: readonly GenerationProviderChoice[] = [
  {
    providerId: 'DETERMINISTIC_LOCAL',
    displayName: 'DETERMINISTIC_LOCAL',
    modelId: 'knowzy-deterministic-local-1',
    available: true,
    reason: '',
    active: true,
  },
];

export const GenerateWizard = ({
  sourceId,
  documents,
  domains,
  departments,
  jobRoles,
  providers = DETERMINISTIC_ONLY,
}: {
  sourceId: string;
  documents: readonly WizardDocument[];
  domains: readonly WizardDomain[];
  /** Active departments and roles. Both are optional on a job. */
  departments: readonly OrgOption[];
  jobRoles: readonly OrgOption[];
  providers?: readonly GenerationProviderChoice[];
}) => {
  // The active provider when it can run; otherwise the deterministic one,
  // which always can. Never a provider the gate would refuse.
  const defaultProvider =
    providers.find((choice) => choice.active && choice.available)?.providerId ??
    'DETERMINISTIC_LOCAL';
  const [chosenProvider, setChosenProvider] = useState(defaultProvider);
  const [reasonCode, setReasonCode] = useState('NEW_KNOWLEDGE');
  const chosen = providers.find((choice) => choice.providerId === chosenProvider);
  const unavailable = providers.filter((choice) => !choice.available);
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

  // React resets the job form once its action completes, WITHOUT firing the
  // form's reset event, so any state mirroring a field goes stale. After every
  // submission the mirrors are re-read from the fields themselves, so the
  // provider note and the justification box always match what is on screen
  // -- and what the next submission will send.
  useEffect(() => {
    if (jobState === null) return;
    const provider = document.getElementById('providerId');
    if (provider instanceof HTMLSelectElement) setChosenProvider(provider.value);
    const reason = document.getElementById('reasonCode');
    if (reason instanceof HTMLSelectElement) setReasonCode(reason.value);
  }, [jobState]);

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
            actions={
              <span className="flex flex-wrap items-center gap-2">
                <Badge tone="info">{preflight.recommendation}</Badge>
                {decision === null ? null : (
                  <Badge tone="success">
                    {t('generate.decisionRecorded', { action: decision.chosenAction })}
                  </Badge>
                )}
              </span>
            }
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

              {/* The six §4.2 checks, per document, as a checklist rather
                  than a seven-column table.

                  The table had one cell per check and could show only a
                  status badge in each. Every check also carries its own NAME
                  and its own SENTENCE, and four of them carry the counts and
                  job ids behind the verdict — all of which the API was
                  sending and the table had nowhere to put. A reader could see
                  that check 4 said HIGH but not that it said so because three
                  questions already cover three assessable sections.

                  It deliberately reads like the approval gate checklist: the
                  two governance surfaces in this product should look like the
                  same kind of thing. */}
              {preflight.documents.map((document) => {
                const existing =
                  document.check2.approvedCount +
                  document.check2.publishedCount +
                  document.check2.draftCount;

                const checks: readonly {
                  readonly check: PreflightCheck;
                  readonly facts?: readonly { readonly label: string; readonly value: ReactNode }[];
                  readonly link?: string;
                }[] = [
                  {
                    check: document.check1,
                    facts: [
                      ...(document.check1.lastGeneratedAt === undefined ||
                      document.check1.lastGeneratedAt === null
                        ? []
                        : [
                            {
                              label: t('generate.lastGenerated'),
                              value: formatWhen(document.check1.lastGeneratedAt),
                            },
                          ]),
                      ...(document.check1.jobIds.length === 0
                        ? []
                        : [
                            {
                              label: t('generate.priorJobs'),
                              value: (
                                <span className="font-mono text-2xs">
                                  {document.check1.jobIds.join(', ')}
                                </span>
                              ),
                            },
                          ]),
                    ],
                  },
                  {
                    check: document.check2,
                    facts: [
                      {
                        label: t('generate.existingTotal'),
                        value: t('generate.existingCounts', {
                          approved: document.check2.approvedCount,
                          published: document.check2.publishedCount,
                          draft: document.check2.draftCount,
                        }),
                      },
                    ],
                    ...(existing > 0
                      ? { link: `/review?queue=all&documentId=${document.documentId}` }
                      : {}),
                  },
                  { check: document.check3 },
                  {
                    check: document.check4,
                    facts: [
                      {
                        label: t('generate.similarStems'),
                        value: t('generate.stemsOverSections', {
                          stems: document.check4.existingStemCount,
                          sections: document.check4.assessableSectionCount ?? 0,
                        }),
                      },
                    ],
                  },
                ];

                return (
                  <section
                    key={document.documentId}
                    className="flex flex-col gap-4 rounded-lg border border-line p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <h4 className="text-md font-semibold text-brand-navy-text">
                        {document.documentName}
                      </h4>
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge tone="neutral" withIcon={false}>
                          {t('generate.uncoveredCount', {
                            count: document.uncoveredSectionCount,
                          })}
                        </Badge>
                      </span>
                    </div>

                    {/* Coverage, drawn. Its own number and its denominator are
                        printed beside it, so the bar adds nothing the text
                        does not already say. */}
                    <Meter
                      label={t('generate.coverage')}
                      percent={Number(document.coveragePercent)}
                      tone={document.coveragePercent >= 75 ? 'success' : 'warning'}
                      summary={t('generate.coverageSummary', {
                        generated: document.sections?.generated ?? 0,
                        assessable: document.sections?.assessable ?? 0,
                      })}
                    />

                    {/* The five states, side by side. Coverage alone cannot
                        distinguish "no question here" from "a run looked and
                        found nothing" from "nothing has ever looked", and
                        collapsing them is what let every refusal count as
                        coverage. */}
                    {document.sections === undefined ? null : (
                      <div className="flex flex-col gap-2">
                        <span className="text-2xs font-bold uppercase tracking-wide text-ink-subtle">
                          {t('generate.sectionAccounting')}
                        </span>
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-5">
                          {(
                            [
                              ['generate.sectionsAssessable', document.sections.assessable],
                              ['generate.sectionsAttempted', document.sections.attempted],
                              ['generate.sectionsGenerated', document.sections.generated],
                              ['generate.sectionsRefused', document.sections.refused],
                              ['generate.sectionsUnresolved', document.sections.unresolved],
                            ] as const
                          ).map(([key, value]) => (
                            <div key={key} className="flex flex-col">
                              <dt className="text-2xs text-ink-subtle">{t(key)}</dt>
                              <dd className="font-mono text-sm font-bold text-brand-navy-text">
                                {value}
                              </dd>
                            </div>
                          ))}
                        </dl>
                        <p className="text-2xs text-ink-muted">{t('generate.accountingNote')}</p>
                      </div>
                    )}

                    <ol className="flex flex-col divide-y divide-line rounded-md border border-line">
                      {checks.map((entry) => (
                        <li key={entry.check.check} className="flex flex-col gap-1 px-3 py-2.5">
                          <span className="flex flex-wrap items-center gap-2">
                            <StatusBadge
                              status={entry.check.status ?? '—'}
                              tone={statusTone(entry.check.status ?? '')}
                            />
                            <span className="font-mono text-2xs font-bold text-ink-subtle">
                              {entry.check.check}
                            </span>
                          </span>
                          {entry.check.detail === undefined ? null : (
                            <span className="text-sm text-ink-muted">{entry.check.detail}</span>
                          )}
                          {entry.facts === undefined || entry.facts.length === 0 ? null : (
                            <dl className="mt-0.5 grid gap-x-4 gap-y-0.5 sm:grid-cols-[minmax(8rem,auto)_1fr]">
                              {entry.facts.map((fact) => (
                                <div key={fact.label} className="contents">
                                  <dt className="text-sm text-ink-subtle">{fact.label}</dt>
                                  <dd className="text-sm text-ink">{fact.value}</dd>
                                </div>
                              ))}
                            </dl>
                          )}
                          {entry.link === undefined ? null : (
                            <span>
                              <TextLink href={entry.link}>{t('review.existing')}</TextLink>
                            </span>
                          )}
                        </li>
                      ))}
                    </ol>
                  </section>
                );
              })}

              {/* The two checks that are about the whole selection rather than
                  one document. */}
              <ol className="flex flex-col divide-y divide-line rounded-md border border-line">
                {[
                  {
                    name: preflight.check5.check ?? 'CROSS_DOMAIN_DUPLICATES',
                    status: t('generate.matchCount', {
                      count: preflight.check5.matches.length,
                    }),
                    tone: preflight.check5.matches.length === 0 ? 'success' : 'warning',
                    detail: preflight.check5.detail,
                  },
                  {
                    name: preflight.check6.check ?? 'POOL_CONFLICTS',
                    status: preflight.check6.status,
                    tone: statusTone(preflight.check6.status),
                    detail: preflight.check6.detail,
                  },
                ].map((entry) => (
                  <li key={entry.name} className="flex flex-col gap-1 px-3 py-2.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={entry.status} tone={entry.tone as BadgeTone} />
                      <span className="font-mono text-2xs font-bold text-ink-subtle">
                        {entry.name}
                      </span>
                    </span>
                    <span className="text-sm text-ink-muted">{entry.detail}</span>
                  </li>
                ))}
              </ol>

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
          <form
            action={submitJob}
            onReset={() => {
              setChosenProvider(defaultProvider);
              setReasonCode('NEW_KNOWLEDGE');
            }}
          >
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
                <Field
                  id="departmentId"
                  label={t('generate.departmentLabel')}
                  hint={t('generate.orgHint')}
                >
                  <Select id="departmentId" name="departmentId" defaultValue="">
                    <option value="">{t('generate.orgUnspecified')}</option>
                    {departments.map((department) => (
                      <option key={department.id} value={department.id}>
                        {department.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field id="jobRoleId" label={t('generate.roleLabel')}>
                  <Select id="jobRoleId" name="jobRoleId" defaultValue="">
                    <option value="">{t('generate.orgUnspecified')}</option>
                    {jobRoles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
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
                  <Select
                    id="reasonCode"
                    name="reasonCode"
                    defaultValue="NEW_KNOWLEDGE"
                    onChange={(event) => setReasonCode(event.target.value)}
                  >
                    {REASON_CODES.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </Select>
                </Field>
                {/* PUBLISHER_REQUESTED needs a written justification of at
                    least 20 characters (job-creation precondition 9). The form
                    offered the reason with nowhere to write it, so choosing it
                    could only be refused. Shown only for that reason. */}
                {reasonCode === 'PUBLISHER_REQUESTED' ? (
                  <div className="md:col-span-2 xl:col-span-3">
                    <Field
                      id="justification"
                      label={t('generate.justificationLabel')}
                      hint={t('generate.justificationHint')}
                    >
                      <Textarea id="justification" name="justification" rows={2} required />
                    </Field>
                  </div>
                ) : null}
                {/* Provider (GEN-PROVIDER-M1). Every declared provider is listed;
                    one the gate would refuse is a DISABLED option with its
                    reason beneath, so the list says what exists and what
                    stands in the way without offering a choice that cannot be
                    honoured. The server re-checks the gate on submit. */}
                <Field id="providerId" label={t('generate.providerLabel')}>
                  {/* UNCONTROLLED, with the default as its defaultValue. React
                      resets a form after its action runs; a controlled select
                      was put back on the FIRST option by that reset while the
                      component still held the previous choice, so the screen
                      showed one provider and described another. Now the reset
                      restores the default, and onReset (on the form) puts the
                      note back to match it. */}
                  <Select
                    id="providerId"
                    name="providerId"
                    defaultValue={defaultProvider}
                    onChange={(event) => setChosenProvider(event.target.value)}
                  >
                    {providers.map((choice) => (
                      <option
                        key={choice.providerId}
                        value={choice.providerId}
                        disabled={!choice.available}
                      >
                        {choice.providerId === 'DETERMINISTIC_LOCAL'
                          ? t('generate.providerDeterministic')
                          : choice.displayName}
                        {choice.modelId === null || choice.providerId === 'DETERMINISTIC_LOCAL'
                          ? ''
                          : ` — ${choice.modelId}`}
                        {choice.available ? '' : ` (${t('generate.providerNotAvailable')})`}
                      </option>
                    ))}
                  </Select>
                  <p className="mt-1 text-2xs text-ink-muted">
                    {chosenProvider === 'DETERMINISTIC_LOCAL'
                      ? t('generate.providerDeterministicNote')
                      : t('generate.providerNetworkNote', {
                          provider: chosen?.displayName ?? chosenProvider,
                        })}
                  </p>
                  {unavailable.length === 0 ? null : (
                    <details className="mt-1 text-2xs text-ink-subtle">
                      <summary className="cursor-pointer">
                        {t('generate.providerWhyUnavailable', { count: unavailable.length })}
                      </summary>
                      <ul className="mt-1 flex flex-col gap-1">
                        {unavailable.map((choice) => (
                          <li key={choice.providerId}>
                            <span className="font-semibold">{choice.displayName}</span>:{' '}
                            {choice.reason}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </Field>
                <Field id="executionMode" label={t('generate.executionModeLabel')}>
                  <Select id="executionMode" name="executionMode" defaultValue="PLATFORM_MANAGED">
                    <option value="PLATFORM_MANAGED">{t('generate.executionModePlatform')}</option>
                  </Select>
                  <p className="mt-1 text-2xs text-ink-muted">{t('generate.executionModeNote')}</p>
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
                  { label: t('generate.scope'), value: job.scope },
                  { label: t('generate.rejections'), value: job.rejections.length },
                  {
                    label: t('generate.insufficient'),
                    value: job.insufficientEvidenceSections.length,
                  },
                  { label: t('generate.jobRef'), value: job.jobId, mono: true },
                  {
                    label: t('generate.tokens'),
                    value: t('generate.tokenUsage', {
                      input: job.tokens.input.toLocaleString('en-GB'),
                      output: job.tokens.output.toLocaleString('en-GB'),
                    }),
                  },
                ]}
              />

              {/* Which control refused how many candidates. `rejectionCounts`
                  was in the response and unread, so the screen could say
                  "7 rejections" without saying what refused them — and the
                  breakdown IS the evidence that generation is governed. */}
              {Object.keys(job.rejectionCounts).length === 0 ? null : (
                <div className="flex flex-col gap-2">
                  <h4 className="text-base font-semibold text-brand-navy-text">
                    {t('generate.rejectionBreakdown')}
                  </h4>
                  <ul className="flex flex-wrap gap-2">
                    {Object.entries(job.rejectionCounts)
                      .sort(([, a], [, b]) => b - a)
                      .map(([reason, count]) => (
                        <li key={reason}>
                          <Badge tone="warning" withIcon={false}>
                            <span className="font-mono text-2xs">{reason}</span>
                            <span className="font-bold">{count}</span>
                          </Badge>
                        </li>
                      ))}
                  </ul>
                </div>
              )}

              {/* The drafts this job actually created. `questionIds` was in
                  the response and was being dropped, which made the accepted
                  count a number with nothing behind it. */}
              {job.questionIds.length === 0 ? null : (
                <div className="flex flex-col gap-2">
                  <h4 className="text-base font-semibold text-brand-navy-text">
                    {t('generate.createdHeading')}
                  </h4>
                  <ul className="flex flex-col gap-1">
                    {job.questionIds.map((questionId, index) => (
                      <li key={questionId} className="text-base">
                        <TextLink href={`/review/${questionId}`}>
                          {t('generate.createdItem', { n: index + 1 })}
                        </TextLink>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

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
