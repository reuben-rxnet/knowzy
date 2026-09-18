import Link from 'next/link';
import { t } from '../../../copy';
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

/**
 * Question approval.
 *
 * Everything §5.2 requires an approver to see, on one page: the question, the
 * proposed answer, the evidence span with its offsets, the confidence
 * components, the duplicate state, the full thirteen-gate checklist, the
 * version history, and the review trail.
 *
 * The gate panel is ADVISORY and says so. The server re-evaluates every gate at
 * the moment of the transition, so this list can only ever be a preview — and
 * an approver who reads it as permission would be wrong.
 */
export default async function QuestionPage({
  params,
}: {
  params: Promise<{ questionId: string }>;
}) {
  const { questionId } = await params;

  const [question, gates, versions] = await Promise.all([
    api<QuestionDetail>(`/api/v1/authoring/questions/${questionId}`),
    api<{ passed: boolean; gates: readonly GateResult[]; advisory: string }>(
      `/api/v1/authoring/questions/${questionId}/gates`,
    ),
    api<{ versions: readonly VersionEntry[] }>(
      `/api/v1/authoring/questions/${questionId}/versions`,
    ),
  ]);

  if (!question.ok) {
    return (
      <article>
        <h1>{t('question.heading')}</h1>
        <Problem problem={question.problem} />
        <p>
          <Link href="/review">{t('question.backToQueue')}</Link>
        </p>
      </article>
    );
  }

  const detail = question.data;

  return (
    <article>
      <h1>{t('question.heading')}</h1>
      <p>
        <Link href="/review">{t('question.backToQueue')}</Link>
      </p>

      <dl className="kv">
        <dt>{t('review.status')}</dt>
        <dd>
          <strong>{detail.status}</strong> <span className="muted">v{detail.version}</span>
        </dd>
        <dt>{t('generate.domainLabel')}</dt>
        <dd>
          {detail.domain.name} <span className="muted">({detail.domain.code})</span>
        </dd>
        <dt>{t('generate.topicLabel')}</dt>
        <dd>{detail.topic}</dd>
        {detail.published === null ? null : (
          <>
            <dt>{t('publish.bankQuestionId')}</dt>
            <dd className="mono">
              {detail.published.bankQuestionId} · v{detail.published.publishedVersion} ·{' '}
              {detail.published.status}
            </dd>
          </>
        )}
      </dl>

      {detail.needsRevalidation ? (
        <p className="panel warn" role="status">
          {detail.revalidationReason ?? 'Needs revalidation.'}
        </p>
      ) : null}

      <h2>{t('question.questionHeading')}</h2>
      <p>
        <strong>{detail.questionText}</strong>
      </p>
      <table>
        <caption>{t('question.optionsCaption')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('question.option')}</th>
            <th scope="col">{t('question.text')}</th>
            <th scope="col">{t('question.proposed')}</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(detail.options).map(([letter, text]) => (
            <tr key={letter}>
              <th scope="row">{letter}</th>
              <td>{text}</td>
              <td className={letter === detail.proposedCorrectOption ? 'pass' : ''}>
                {letter === detail.proposedCorrectOption ? '✓' : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>{t('question.explanationHeading')}</h3>
      <p>{detail.explanation}</p>

      <h2>{t('question.evidenceHeading')}</h2>
      {/* The span, verbatim. An approver is checking that the question is
          answerable FROM THIS TEXT, so paraphrasing it here would defeat the
          purpose of showing it. */}
      <blockquote>
        <span className="evidence">{detail.evidence.span}</span>
      </blockquote>
      <dl className="kv">
        <dt>{t('question.evidenceMode')}</dt>
        <dd>{detail.evidence.mode}</dd>
        <dt>{t('question.evidenceOffsets')}</dt>
        <dd className="mono">
          {detail.evidence.startOffset}–{detail.evidence.endOffset}
        </dd>
        <dt>{t('question.evidenceScore')}</dt>
        <dd>
          {detail.evidence.similarityScore === null
            ? '—'
            : Number(detail.evidence.similarityScore).toFixed(3)}
        </dd>
        <dt>{t('question.sourceDocument')}</dt>
        <dd>
          {detail.source.folderPath === null || detail.source.folderPath === ''
            ? detail.source.documentName
            : `${detail.source.folderPath}/${detail.source.documentName}`}
        </dd>
        <dt>{t('question.sourceSection')}</dt>
        <dd className="mono">{detail.source.sectionKey.slice(0, 16)}…</dd>
        <dt>{t('question.sourceVersion')}</dt>
        <dd>{detail.source.versionAtGeneration}</dd>
      </dl>

      <h2>{t('question.confidenceHeading')}</h2>
      <table>
        <caption>
          {t('question.confidenceCaption')} — {Number(detail.confidence.score).toFixed(3)}
        </caption>
        <thead>
          <tr>
            <th scope="col">{t('question.confidenceComponent')}</th>
            <th scope="col">{t('question.confidenceValue')}</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(detail.confidence.components).map(([name, value]) => (
            <tr key={name}>
              <th scope="row">{name}</th>
              <td>{typeof value === 'number' ? value.toFixed(3) : String(value)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>{t('question.gatesHeading')}</h2>
      {!gates.ok ? <Problem problem={gates.problem} /> : null}
      {gates.ok ? (
        <>
          <p className="muted">{gates.data.advisory}</p>
          <table>
            <caption>
              {t('question.gatesCaption')} —{' '}
              <span className={gates.data.passed ? 'pass' : 'fail'}>
                {gates.data.passed ? t('question.gatePass') : t('question.gateFail')}
              </span>
            </caption>
            <thead>
              <tr>
                <th scope="col">{t('question.gate')}</th>
                <th scope="col">{t('question.gateCode')}</th>
                <th scope="col">{t('question.gateResult')}</th>
                <th scope="col">{t('question.gateDetail')}</th>
              </tr>
            </thead>
            <tbody>
              {gates.data.gates.map((gate) => (
                <tr key={gate.code}>
                  <td>{gate.gate}</td>
                  <th scope="row">{gate.code}</th>
                  <td className={gate.passed ? 'pass' : 'fail'}>
                    {gate.passed ? t('question.gatePass') : t('question.gateFail')}
                  </td>
                  <td>{gate.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      {detail.duplicate.note !== null ? (
        <>
          <h2>{t('question.dispositionHeading')}</h2>
          <dl className="kv">
            <dt>{t('review.duplicate')}</dt>
            <dd>
              {detail.duplicate.maxSimilarityScore === null
                ? '—'
                : Number(detail.duplicate.maxSimilarityScore).toFixed(3)}
            </dd>
            <dt>{t('question.dispositionLabel')}</dt>
            <dd className={detail.duplicate.disposition === null ? 'fail' : 'pass'}>
              {detail.duplicate.disposition ?? t('review.blocksApproval')}
            </dd>
          </dl>
          <p>{detail.duplicate.note}</p>
          {detail.duplicate.disposition === null ? (
            <DispositionForm questionId={detail.questionId} />
          ) : null}
        </>
      ) : null}

      <h2>{t('question.actionsHeading')}</h2>
      <DecisionForm
        questionId={detail.questionId}
        action={claimQuestion}
        labelKey="question.claim"
        variant="secondary"
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
        variant="secondary"
      />
      <DecisionForm
        questionId={detail.questionId}
        action={rejectQuestion}
        labelKey="question.reject"
        commentKey="question.commentLabel"
        commentRequired
        variant="danger"
      />

      <h2>{t('question.editHeading')}</h2>
      <EditExplanationForm questionId={detail.questionId} explanation={detail.explanation} />

      <h2>{t('question.versionsHeading')}</h2>
      {!versions.ok ? <Problem problem={versions.problem} /> : null}
      {versions.ok ? (
        <table>
          <caption>{t('question.versionsCaption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('question.version')}</th>
              <th scope="col">{t('question.changeKind')}</th>
              <th scope="col">{t('question.changedFields')}</th>
              <th scope="col">{t('question.changedAt')}</th>
            </tr>
          </thead>
          <tbody>
            {versions.data.versions.map((entry) => (
              <tr key={entry.version}>
                <th scope="row">{entry.version}</th>
                <td>{entry.changeKind}</td>
                <td>{entry.changedFields.join(', ')}</td>
                <td>{new Date(entry.changedAt).toISOString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <h2>{t('question.reviewsHeading')}</h2>
      {detail.reviews.length === 0 && detail.approvals.length === 0 ? (
        <p>{t('question.noReviews')}</p>
      ) : (
        <table>
          <caption>{t('question.reviewsCaption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('question.reviewKind')}</th>
              <th scope="col">{t('question.reviewOutcome')}</th>
              <th scope="col">{t('question.version')}</th>
              <th scope="col">{t('question.reviewComment')}</th>
            </tr>
          </thead>
          <tbody>
            {detail.reviews.map((review) => (
              <tr key={review.reviewId}>
                <td>{review.kind}</td>
                <td>{review.outcome}</td>
                <td>{review.questionVersion}</td>
                <td>{review.comment}</td>
              </tr>
            ))}
            {detail.approvals.map((approval) => (
              <tr key={approval.approvalId}>
                <td>APPROVAL</td>
                <td>{approval.decision}</td>
                <td>{approval.questionVersion}</td>
                <td>{approval.comment ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </article>
  );
}
