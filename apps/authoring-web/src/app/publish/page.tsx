import { t } from '../../copy';
import { api } from '../../lib/api';
import { Problem } from '../../components/Problem';
import { PublishPanel, type ApprovedQuestion } from '../../components/PublishPanel';
import { AssessmentForm } from '../../components/AssessmentForm';
import { RetireForm } from '../../components/RetireForm';
import type { WizardDomain } from '../../components/GenerateWizard';

interface QueueItem {
  readonly questionId: string;
  readonly questionText: string;
  readonly topic: string;
  readonly version: number;
}

interface InventoryItem {
  readonly bankQuestionId: string;
  readonly questionId: string;
  readonly questionText: string;
  readonly publishedVersion: number;
  readonly status: string;
  readonly isActive: boolean;
  readonly publishedAt: string | null;
  readonly retiredAt: string | null;
  readonly retireComment: string | null;
}

interface AssessmentRow {
  readonly assessmentId: string;
  readonly name: string;
  readonly domain: string;
  readonly status: string;
  readonly versionNumber: number | null;
  readonly versionStatus: string | null;
  readonly questionCount: number | null;
  readonly pinnedPoolSize: number | null;
  readonly sessionCount: number;
}

/**
 * Publish.
 *
 * Three things, in the order the workflow needs them: publish the approved
 * questions, see the inventory that resulted, and make an assessment out of it
 * so the Live Learning Portal has something to serve.
 *
 * The inventory is the LOCAL PROJECTION and the API labels it as such. §8
 * reconciles it against the bank; until then a reader has to know which of the
 * two they are looking at.
 */
export default async function PublishPage() {
  const [approved, inventory, assessments, taxonomy] = await Promise.all([
    api<{ items: readonly QueueItem[] }>('/api/v1/authoring/questions/review?queue=publish'),
    api<{ count: number; source: string; items: readonly InventoryItem[] }>(
      '/api/v1/authoring/question-bank',
    ),
    api<{ assessments: readonly AssessmentRow[] }>('/api/v1/authoring/assessments'),
    api<{ domains: readonly WizardDomain[] }>('/api/v1/authoring/taxonomy'),
  ]);

  const approvedQuestions: readonly ApprovedQuestion[] = approved.ok
    ? approved.data.items.map((item) => ({
        questionId: item.questionId,
        questionText: item.questionText,
        topic: item.topic,
        version: item.version,
      }))
    : [];

  return (
    <article>
      <h1>{t('publish.heading')}</h1>
      <p className="lede">{t('publish.intro')}</p>

      <h2>{t('publish.approvedHeading')}</h2>
      {!approved.ok ? <Problem problem={approved.problem} /> : null}
      <PublishPanel approved={approvedQuestions} />

      <h2>{t('publish.inventoryHeading')}</h2>
      {!inventory.ok ? <Problem problem={inventory.problem} /> : null}
      {inventory.ok && inventory.data.items.length === 0 ? <p>{t('publish.noInventory')}</p> : null}
      {inventory.ok && inventory.data.items.length > 0 ? (
        <table>
          <caption>
            {t('publish.inventoryCaption')} — {inventory.data.source}
          </caption>
          <thead>
            <tr>
              <th scope="col">{t('publish.bankQuestionId')}</th>
              <th scope="col">{t('publish.question')}</th>
              <th scope="col">{t('publish.version')}</th>
              <th scope="col">{t('publish.status')}</th>
              <th scope="col">{t('publish.active')}</th>
              <th scope="col">{t('publish.publishedAt')}</th>
              <th scope="col">{t('sources.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {inventory.data.items.map((item) => (
              <tr key={item.bankQuestionId}>
                <th scope="row" className="mono">
                  {item.bankQuestionId}
                </th>
                <td>{item.questionText}</td>
                <td>{item.publishedVersion}</td>
                <td>{item.status}</td>
                <td className={item.isActive ? 'pass' : 'warn'}>
                  {item.isActive ? t('browser.yes') : t('browser.no')}
                </td>
                <td>
                  {item.publishedAt === null ? '—' : new Date(item.publishedAt).toISOString()}
                </td>
                <td>
                  {/* Retirement, never deletion: G7 gives the bank adapter no
                      delete method at all. */}
                  {item.retiredAt === null ? (
                    <RetireForm questionId={item.questionId} />
                  ) : (
                    <span className="muted">{item.retireComment ?? '—'}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <h2>{t('publish.assessmentHeading')}</h2>
      {!taxonomy.ok ? <Problem problem={taxonomy.problem} /> : null}
      {taxonomy.ok ? <AssessmentForm domains={taxonomy.data.domains} /> : null}

      {!assessments.ok ? <Problem problem={assessments.problem} /> : null}
      {assessments.ok && assessments.data.assessments.length === 0 ? (
        <p>{t('publish.noAssessments')}</p>
      ) : null}
      {assessments.ok && assessments.data.assessments.length > 0 ? (
        <table>
          <caption>{t('publish.assessmentsCaption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('publish.assessmentName')}</th>
              <th scope="col">{t('publish.assessmentStatus')}</th>
              <th scope="col">{t('publish.assessmentQuestions')}</th>
              <th scope="col">{t('publish.assessmentPool')}</th>
            </tr>
          </thead>
          <tbody>
            {assessments.data.assessments.map((assessment) => (
              <tr key={assessment.assessmentId}>
                <th scope="row">{assessment.name}</th>
                <td>
                  {assessment.status}
                  {assessment.versionStatus === null ? null : (
                    <span className="muted">
                      {' '}
                      · v{assessment.versionNumber} {assessment.versionStatus}
                    </span>
                  )}
                </td>
                <td>{assessment.questionCount ?? '—'}</td>
                <td>{assessment.pinnedPoolSize ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </article>
  );
}
