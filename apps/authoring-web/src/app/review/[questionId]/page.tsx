import {
  Badge,
  BlockedBadge,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  KeyValue,
  PageHero,
  StatusBadge,
  StatusIndicator,
  TBody,
  THead,
  TabNav,
  Td,
  Th,
  Tr,
  VersionBadge,
} from '@knowzy/shared-ui';
import { ArrowLeft, Check } from 'lucide-react';
import { t, type CopyKey } from '../../../copy';
import { api } from '../../../lib/api';
import { Problem } from '../../../components/Problem';
import { DecisionForm } from '../../../components/DecisionForm';
import { DispositionForm, EditExplanationForm } from '../../../components/QuestionForms';
import {
  approveQuestion,
  claimQuestion,
  rejectQuestion,
  requestChanges,
  submitQuestion,
} from '../../actions';

interface QuestionDetail {
  readonly questionId: string;
  readonly status: string;
  readonly version: number;
  readonly questionText: string;
  readonly options: Readonly<Record<string, string>>;
  readonly proposedCorrectOption: string;
  readonly explanation: string;
  readonly domain: { readonly code: string; readonly name: string };
  readonly topic: string;
  readonly createdByUserId: string | null;
  readonly needsRevalidation: boolean;
  readonly revalidationReason: string | null;
  readonly source: {
    readonly documentName: string;
    readonly folderPath: string | null;
    readonly url: string;
    readonly sectionKey: string;
    readonly versionAtGeneration: string;
  };
  readonly evidence: {
    readonly span: string;
    readonly startOffset: number;
    readonly endOffset: number;
    readonly mode: string;
    readonly similarityScore: number | null;
  };
  readonly confidence: {
    readonly score: number;
    readonly components: Readonly<Record<string, unknown>>;
  };
  readonly duplicate: {
    readonly maxSimilarityScore: number | null;
    readonly disposition: string | null;
    readonly note: string | null;
    readonly blocksApproval: boolean;
  };
  readonly generatedBy: { readonly jobId: string | null; readonly modelId: string | null };
  readonly published: {
    readonly bankQuestionId: string;
    readonly publishedVersion: number;
    readonly status: string;
  } | null;
  readonly reviews: readonly {
    readonly reviewId: string;
    readonly kind: string;
    readonly outcome: string;
    readonly comment: string;
    readonly questionVersion: number;
    readonly createdAt: string;
  }[];
  readonly approvals: readonly {
    readonly approvalId: string;
    readonly decision: string;
    readonly comment: string | null;
    readonly questionVersion: number;
    readonly decidedAt: string;
  }[];
}

interface GateResult {
  readonly gate: number;
  readonly code: string;
  readonly passed: boolean;
  readonly detail: string;
  readonly field: string | null;
}

interface VersionEntry {
  readonly version: number;
  readonly changeKind: string;
  readonly changedAt: string;
  readonly changedFields: readonly string[];
  readonly evidenceReverified: boolean;
}

const TABS = ['question', 'evidence', 'source', 'governance', 'reviews', 'versions'] as const;
type Tab = (typeof TABS)[number];

const isTab = (value: string | undefined): value is Tab =>
  value !== undefined && (TABS as readonly string[]).includes(value);

const TAB_LABEL: Record<Tab, CopyKey> = {
  question: 'question.tabQuestion',
  evidence: 'question.tabEvidence',
  source: 'question.tabSource',
  governance: 'question.tabGovernance',
  reviews: 'question.tabReviews',
  versions: 'question.tabVersions',
};

const DASH = '—';

const formatWhen = (value: string): string =>
  new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Question approval.
 *
 * Everything §5.2 requires an approver to see: the question, the proposed
 * answer, the evidence span with its offsets, the confidence components, the
 * duplicate state, the full thirteen-gate checklist, the version history, and
 * the review trail.
 *
 * The gate panel is ADVISORY and says so. The server re-evaluates every gate at
 * the moment of the transition, so this list can only ever be a preview — and
 * an approver who reads it as permission would be wrong.
 *
 * UI-M2 arranged it into the six §5.2 detail tabs, selected by `?tab=` so each
 * one is linkable. Two things are deliberately NOT inside a tab: the gate
 * verdict and the decision panel. Burying "eleven of thirteen gates pass"
 * one click away would be hiding the only thing on the page that says whether
 * this question may proceed.
 */
export default async function QuestionPage({
  params,
  searchParams,
}: {
  params: Promise<{ questionId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { questionId } = await params;
  const tab: Tab = isTab((await searchParams).tab) ? ((await searchParams).tab as Tab) : 'question';

  const [question, gates, versions] = await Promise.all([
    api<QuestionDetail>(`/api/v1/authoring/questions/${questionId}`),
    api<{ passed: boolean; gates: readonly GateResult[]; advisory: string }>(
      `/api/v1/authoring/questions/${questionId}/gates`,
    ),
    api<{ versions: readonly VersionEntry[] }>(
      `/api/v1/authoring/questions/${questionId}/versions`,
    ),
  ]);

  const backToQueue = (
    <ButtonLink href="/review" tone="secondary">
      <ArrowLeft aria-hidden="true" className="size-4" />
      {t('question.backToQueue')}
    </ButtonLink>
  );

  if (!question.ok) {
    return (
      <div className="flex flex-col gap-6">
        <PageHero title={t('question.heading')} actions={backToQueue} />
        <Problem problem={question.problem} />
      </div>
    );
  }

  const detail = question.data;
  const failedGates = gates.ok ? gates.data.gates.filter((gate) => !gate.passed) : [];

  return (
    <div className="flex flex-col gap-6">
      <PageHero
        title={t('question.heading')}
        purpose={detail.questionText}
        secondaryText={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={detail.status} />
            <VersionBadge version={detail.version} />
            <Badge tone="neutral" withIcon={false}>
              {detail.domain.name} · {detail.topic}
            </Badge>
            {detail.published === null ? null : (
              <Badge tone="success">
                {detail.published.bankQuestionId} · v{detail.published.publishedVersion}
              </Badge>
            )}
            {detail.duplicate.blocksApproval ? (
              <BlockedBadge>{t('review.blocksApproval')}</BlockedBadge>
            ) : null}
          </span>
        }
        actions={backToQueue}
      />

      {detail.needsRevalidation ? (
        <div className="rounded-md bg-warning-soft px-4 py-3 text-base text-ink" role="status">
          {detail.revalidationReason ?? t('question.needsRevalidation')}
        </div>
      ) : null}

      {/* The verdict, never behind a tab. Advisory, and it says so. */}
      {!gates.ok ? (
        <Problem problem={gates.problem} />
      ) : (
        <Card>
          <CardHeader
            title={t('question.gatesHeading')}
            description={gates.data.advisory}
            actions={
              <StatusBadge
                status={
                  gates.data.passed
                    ? t('question.gatePass')
                    : t('question.gatesFailedCount', { count: failedGates.length })
                }
                tone={gates.data.passed ? 'success' : 'danger'}
              />
            }
          />
          {failedGates.length === 0 ? null : (
            <CardBody>
              <ul className="flex flex-col gap-1.5">
                {failedGates.map((gate) => (
                  <li
                    key={gate.code}
                    className="rounded-md bg-danger-soft px-3 py-2 text-sm text-ink"
                  >
                    <span className="font-semibold">
                      {gate.gate}. {gate.code}
                    </span>
                    <span className="mt-0.5 block text-ink-muted">{gate.detail}</span>
                  </li>
                ))}
              </ul>
            </CardBody>
          )}
        </Card>
      )}

      <TabNav
        ariaLabel={t('question.tabsLabel')}
        activeHref={`/review/${questionId}?tab=${tab}`}
        items={TABS.map((name) => ({
          label: t(TAB_LABEL[name]),
          href: `/review/${questionId}?tab=${name}`,
        }))}
      />

      {/* ------------------------------------------------------------ question */}
      {tab !== 'question' ? null : (
        <>
          <Card>
            <CardHeader title={t('question.questionHeading')} />
            <CardBody>
              <div className="flex flex-col gap-4">
                <p className="text-md font-semibold text-brand-navy-text">{detail.questionText}</p>
                <DataTable caption={t('question.optionsCaption')}>
                  <THead>
                    <Tr>
                      <Th scope="col">{t('question.option')}</Th>
                      <Th scope="col">{t('question.text')}</Th>
                      <Th scope="col">{t('question.proposed')}</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {Object.entries(detail.options).map(([letter, text]) => {
                      const proposed = letter === detail.proposedCorrectOption;
                      return (
                        <Tr key={letter} className={proposed ? 'bg-success-soft' : ''}>
                          <Th scope="row">{letter}</Th>
                          <Td>{text}</Td>
                          <Td>
                            {/* Not colour alone: the proposed answer carries a
                                tick and a word. §7 */}
                            {proposed ? (
                              <StatusIndicator tone="success">
                                <Check aria-hidden="true" className="size-4" />
                                {t('question.proposed')}
                              </StatusIndicator>
                            ) : (
                              <span className="text-ink-subtle">{DASH}</span>
                            )}
                          </Td>
                        </Tr>
                      );
                    })}
                  </TBody>
                </DataTable>
                <div className="flex flex-col gap-1">
                  <h3 className="text-base font-semibold text-brand-navy-text">
                    {t('question.explanationHeading')}
                  </h3>
                  <p className="max-w-prose text-base text-ink">{detail.explanation}</p>
                </div>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t('question.editHeading')} />
            <CardBody>
              <EditExplanationForm
                questionId={detail.questionId}
                explanation={detail.explanation}
              />
            </CardBody>
          </Card>
        </>
      )}

      {/* ------------------------------------------------------------ evidence */}
      {tab !== 'evidence' ? null : (
        <Card>
          <CardHeader title={t('question.evidenceHeading')} />
          <CardBody>
            <div className="flex flex-col gap-4">
              {/* The span, verbatim. An approver is checking that the question
                  is answerable FROM THIS TEXT, so paraphrasing it here would
                  defeat the purpose of showing it. */}
              <blockquote className="border-l-4 border-brand-green bg-surface-sunken px-4 py-3 text-base italic text-ink">
                {detail.evidence.span}
              </blockquote>
              <KeyValue
                items={[
                  { label: t('question.evidenceMode'), value: detail.evidence.mode },
                  {
                    label: t('question.evidenceOffsets'),
                    value: `${detail.evidence.startOffset}–${detail.evidence.endOffset}`,
                    mono: true,
                  },
                  {
                    label: t('question.evidenceScore'),
                    value:
                      detail.evidence.similarityScore === null
                        ? DASH
                        : Number(detail.evidence.similarityScore).toFixed(3),
                  },
                ]}
              />
            </div>
          </CardBody>
        </Card>
      )}

      {/* -------------------------------------------------------------- source */}
      {tab !== 'source' ? null : (
        <Card>
          <CardHeader title={t('question.tabSource')} description={t('question.sourceIntro')} />
          <CardBody>
            <KeyValue
              items={[
                {
                  label: t('question.sourceDocument'),
                  value:
                    detail.source.folderPath === null || detail.source.folderPath === ''
                      ? detail.source.documentName
                      : `${detail.source.folderPath}/${detail.source.documentName}`,
                },
                { label: t('question.sourceSection'), value: detail.source.sectionKey, mono: true },
                { label: t('question.sourceVersion'), value: detail.source.versionAtGeneration },
                {
                  label: t('question.generatedBy'),
                  value: detail.generatedBy.modelId ?? DASH,
                  mono: true,
                },
                {
                  label: t('question.jobId'),
                  value: detail.generatedBy.jobId ?? DASH,
                  mono: true,
                },
              ]}
            />
          </CardBody>
        </Card>
      )}

      {/* ---------------------------------------------------------- governance */}
      {tab !== 'governance' ? null : (
        <>
          {!gates.ok ? null : (
            <Card>
              <CardHeader
                title={t('question.gatesCaption')}
                description={gates.data.advisory}
                actions={
                  <StatusBadge
                    status={gates.data.passed ? t('question.gatePass') : t('question.gateFail')}
                    tone={gates.data.passed ? 'success' : 'danger'}
                  />
                }
              />
              <CardBody>
                <DataTable caption={t('question.gatesCaption')} captionHidden>
                  <THead>
                    <Tr>
                      <Th scope="col" align="end">
                        {t('question.gate')}
                      </Th>
                      <Th scope="col">{t('question.gateCode')}</Th>
                      <Th scope="col">{t('question.gateResult')}</Th>
                      <Th scope="col">{t('question.gateDetail')}</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {gates.data.gates.map((gate) => (
                      <Tr key={gate.code}>
                        <Td numeric>{gate.gate}</Td>
                        <Th scope="row">{gate.code}</Th>
                        <Td>
                          <StatusBadge
                            status={gate.passed ? t('question.gatePass') : t('question.gateFail')}
                            tone={gate.passed ? 'success' : 'danger'}
                          />
                        </Td>
                        <Td>{gate.detail}</Td>
                      </Tr>
                    ))}
                  </TBody>
                </DataTable>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader
              title={t('question.confidenceHeading')}
              description={t('question.confidenceIntro')}
              actions={
                <Badge tone="info" withIcon={false}>
                  {Number(detail.confidence.score).toFixed(3)}
                </Badge>
              }
            />
            <CardBody>
              <KeyValue
                items={Object.entries(detail.confidence.components).map(([name, value]) => ({
                  label: name,
                  value: typeof value === 'number' ? value.toFixed(3) : String(value),
                }))}
              />
            </CardBody>
          </Card>

          {detail.duplicate.note === null ? null : (
            <Card>
              <CardHeader
                title={t('question.dispositionHeading')}
                actions={
                  detail.duplicate.disposition === null ? (
                    <BlockedBadge>{t('review.blocksApproval')}</BlockedBadge>
                  ) : (
                    <Badge tone="success">{detail.duplicate.disposition}</Badge>
                  )
                }
              />
              <CardBody>
                <div className="flex flex-col gap-4">
                  <KeyValue
                    items={[
                      {
                        label: t('review.duplicate'),
                        value:
                          detail.duplicate.maxSimilarityScore === null
                            ? DASH
                            : Number(detail.duplicate.maxSimilarityScore).toFixed(3),
                      },
                      {
                        label: t('question.dispositionLabel'),
                        value: detail.duplicate.disposition ?? t('review.blocksApproval'),
                      },
                    ]}
                  />
                  <p className="max-w-prose text-base text-ink">{detail.duplicate.note}</p>
                  {detail.duplicate.disposition === null ? (
                    <DispositionForm questionId={detail.questionId} />
                  ) : null}
                </div>
              </CardBody>
            </Card>
          )}
        </>
      )}

      {/* ------------------------------------------------------------- reviews */}
      {tab !== 'reviews' ? null : (
        <Card>
          <CardHeader title={t('question.reviewsHeading')} />
          <CardBody>
            {detail.reviews.length === 0 && detail.approvals.length === 0 ? (
              <EmptyState title={t('question.noReviews')} />
            ) : (
              <DataTable caption={t('question.reviewsCaption')} captionHidden>
                <THead>
                  <Tr>
                    <Th scope="col">{t('question.reviewKind')}</Th>
                    <Th scope="col">{t('question.reviewOutcome')}</Th>
                    <Th scope="col" align="end">
                      {t('question.version')}
                    </Th>
                    <Th scope="col">{t('question.reviewComment')}</Th>
                    <Th scope="col">{t('question.changedAt')}</Th>
                  </Tr>
                </THead>
                <TBody>
                  {detail.reviews.map((review) => (
                    <Tr key={review.reviewId}>
                      <Th scope="row">{review.kind}</Th>
                      <Td>
                        <StatusBadge status={review.outcome} />
                      </Td>
                      <Td numeric>{review.questionVersion}</Td>
                      <Td>{review.comment}</Td>
                      <Td>{formatWhen(review.createdAt)}</Td>
                    </Tr>
                  ))}
                  {/* An approval is a different kind of record from a review,
                      and gate 13 means it was made by a different person. */}
                  {detail.approvals.map((approval) => (
                    <Tr key={approval.approvalId}>
                      <Th scope="row">{t('question.approvalRecord')}</Th>
                      <Td>
                        <StatusBadge status={approval.decision} />
                      </Td>
                      <Td numeric>{approval.questionVersion}</Td>
                      <Td>{approval.comment ?? DASH}</Td>
                      <Td>{formatWhen(approval.decidedAt)}</Td>
                    </Tr>
                  ))}
                </TBody>
              </DataTable>
            )}
          </CardBody>
        </Card>
      )}

      {/* ------------------------------------------------------------ versions */}
      {tab !== 'versions' ? null : (
        <Card>
          <CardHeader title={t('question.versionsHeading')} />
          <CardBody>
            {!versions.ok ? (
              <Problem problem={versions.problem} />
            ) : (
              <DataTable caption={t('question.versionsCaption')} captionHidden>
                <THead>
                  <Tr>
                    <Th scope="col" align="end">
                      {t('question.version')}
                    </Th>
                    <Th scope="col">{t('question.changeKind')}</Th>
                    <Th scope="col">{t('question.changedFields')}</Th>
                    <Th scope="col">{t('question.evidenceReverified')}</Th>
                    <Th scope="col">{t('question.changedAt')}</Th>
                  </Tr>
                </THead>
                <TBody>
                  {versions.data.versions.map((entry) => (
                    <Tr key={entry.version}>
                      <Td numeric>{entry.version}</Td>
                      <Th scope="row">{entry.changeKind}</Th>
                      <Td>{entry.changedFields.join(', ')}</Td>
                      <Td>
                        <StatusBadge
                          status={entry.evidenceReverified ? t('browser.yes') : t('browser.no')}
                          tone={entry.evidenceReverified ? 'success' : 'neutral'}
                        />
                      </Td>
                      <Td>{formatWhen(entry.changedAt)}</Td>
                    </Tr>
                  ))}
                </TBody>
              </DataTable>
            )}
          </CardBody>
        </Card>
      )}

      {/* The decisions, always available — this is what the page is for. Each
          one is re-evaluated by the server, so a button being visible is not a
          claim that it will succeed. */}
      <Card>
        <CardHeader title={t('question.actionsHeading')} description={t('question.actionsIntro')} />
        <CardBody>
          <div className="grid gap-4 xl:grid-cols-2">
            <DecisionForm
              questionId={detail.questionId}
              action={claimQuestion}
              labelKey="question.claim"
              tone="secondary"
            />
            <DecisionForm
              questionId={detail.questionId}
              action={submitQuestion}
              labelKey="question.submit"
            />
            <DecisionForm
              questionId={detail.questionId}
              action={approveQuestion}
              labelKey="question.approve"
              commentKey="question.approvalCommentLabel"
            />
            <DecisionForm
              questionId={detail.questionId}
              action={requestChanges}
              labelKey="question.requestChanges"
              commentKey="question.commentLabel"
              commentRequired
              tone="secondary"
            />
            <DecisionForm
              questionId={detail.questionId}
              action={rejectQuestion}
              labelKey="question.reject"
              commentKey="question.commentLabel"
              commentRequired
              tone="danger"
            />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
