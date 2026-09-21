'use client';

// Publish a batch of approved questions, and show what happened to each one.
//
// The batch result is per-item on purpose (§4.2): one question can publish
// while another is refused by a gate, and a single "published" message would
// hide that. A dry run is also an outcome, not a failure — it means the bank
// adapter is not writable in this environment and says so.
//
// UI-M2 converted the markup. The per-item outcomes, the gate failures under
// each one, and the dry-run notice are all unchanged; ALREADY_PUBLISHED keeps
// its own tone, because it is neither a write nor a failure.

import { useActionState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  CheckboxRow,
  DataTable,
  EmptyState,
  Fieldset,
  StatusBadge,
  TBody,
  THead,
  Td,
  Th,
  Tr,
  type BadgeTone,
} from '@knowzy/shared-ui';
import { t } from '../copy';
import { publishQuestions } from '../app/actions';
import { Problem } from './Problem';

export interface ApprovedQuestion {
  readonly questionId: string;
  readonly questionText: string;
  readonly topic: string;
  readonly version: number;
}

interface ItemOutcome {
  readonly questionId: string;
  readonly outcome: string;
  readonly bankItemId: string | null;
  readonly publishedVersion: number | null;
  readonly detail: string;
  readonly gateFailures?: readonly { code: string; detail: string }[];
}

interface BatchResult {
  readonly batchId: string;
  readonly dryRun: boolean;
  readonly items: readonly ItemOutcome[];
  readonly publishedCount: number;
  readonly failedCount: number;
  readonly target?: { readonly writesEnabled?: boolean; readonly dryRunReason?: string | null };
}

/**
 * ALREADY_PUBLISHED is not a failure and not a write: the bank still holds the
 * item, so idempotent publishing reports it and moves on.
 */
const outcomeTone = (outcome: string): BadgeTone => {
  if (outcome === 'PUBLISHED' || outcome === 'UPDATED') return 'success';
  if (outcome === 'ALREADY_PUBLISHED') return 'info';
  if (outcome === 'DRY_RUN') return 'warning';
  return 'danger';
};

export const PublishPanel = ({ approved }: { approved: readonly ApprovedQuestion[] }) => {
  const [state, submit, pending] = useActionState(publishQuestions, null, '/publish');

  const batch = state?.ok === true ? (state.data as BatchResult) : null;
  const byId = new Map(approved.map((question) => [question.questionId, question]));

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader
          title={t('publish.approvedHeading')}
          description={t('publish.approvedIntro')}
          actions={
            approved.length === 0 ? undefined : (
              <Badge tone="neutral" withIcon={false}>
                {approved.length}
              </Badge>
            )
          }
        />
        {approved.length === 0 ? (
          <CardBody>
            <EmptyState title={t('publish.noApproved')} description={t('publish.noApprovedBody')} />
          </CardBody>
        ) : (
          <form action={submit}>
            <CardBody>
              <Fieldset legend={t('publish.approvedCaption')}>
                <div className="divide-y divide-line rounded-md border border-line">
                  {approved.map((question) => (
                    <CheckboxRow
                      key={question.questionId}
                      name="questionIds"
                      value={question.questionId}
                      defaultChecked
                      description={`${question.topic} · v${question.version}`}
                    >
                      {question.questionText}
                    </CheckboxRow>
                  ))}
                </div>
              </Fieldset>
            </CardBody>
            <CardFooter>
              <Button
                disabled={pending}
                {...(pending ? { disabledReason: t('sources.working') } : {})}
              >
                {t('publish.publishSelected')}
              </Button>
            </CardFooter>
          </form>
        )}
      </Card>

      {state?.ok === false && state.problem !== undefined ? (
        <Problem problem={state.problem} />
      ) : null}

      {batch === null ? null : (
        <Card>
          <CardHeader
            title={t('publish.resultHeading')}
            description={t('publish.resultCounts', {
              published: batch.publishedCount,
              failed: batch.failedCount,
            })}
            actions={batch.dryRun ? <StatusBadge status="DRY_RUN" tone="warning" /> : undefined}
          />
          <CardBody>
            <div className="flex flex-col gap-4">
              {batch.dryRun ? (
                <p
                  className="rounded-md bg-warning-soft px-3 py-2 text-base text-ink"
                  role="status"
                >
                  {t('publish.dryRun')}
                  {batch.target?.dryRunReason === null || batch.target?.dryRunReason === undefined
                    ? null
                    : ` — ${batch.target.dryRunReason}`}
                </p>
              ) : null}

              <DataTable caption={t('publish.resultHeading')} captionHidden>
                <THead>
                  <Tr>
                    <Th scope="col">{t('publish.question')}</Th>
                    <Th scope="col">{t('publish.outcome')}</Th>
                    <Th scope="col">{t('publish.bankItem')}</Th>
                    <Th scope="col">{t('publish.detail')}</Th>
                  </Tr>
                </THead>
                <TBody>
                  {batch.items.map((item) => (
                    <Tr key={item.questionId}>
                      <Th scope="row" className="max-w-md">
                        {byId.get(item.questionId)?.questionText ?? item.questionId}
                      </Th>
                      <Td>
                        <StatusBadge status={item.outcome} tone={outcomeTone(item.outcome)} />
                      </Td>
                      <Td>
                        <span className="font-mono text-sm">
                          {item.bankItemId ?? '—'}
                          {item.publishedVersion === null ? null : ` · v${item.publishedVersion}`}
                        </span>
                      </Td>
                      <Td>
                        {item.detail}
                        {item.gateFailures === undefined ||
                        item.gateFailures.length === 0 ? null : (
                          <ul className="mt-1.5 flex flex-col gap-1">
                            {item.gateFailures.map((failure) => (
                              <li
                                key={failure.code}
                                className="rounded-md bg-danger-soft px-2 py-1 text-sm"
                              >
                                <span className="font-semibold">{failure.code}</span> —{' '}
                                {failure.detail}
                              </li>
                            ))}
                          </ul>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </DataTable>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
};
