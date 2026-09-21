import Link from 'next/link';
import { t } from '../../copy';
import { api } from '../../lib/api';
import { Problem } from '../../components/Problem';

interface QueueItem {
  readonly questionId: string;
  readonly status: string;
  readonly version: number;
  readonly questionText: string;
  readonly topic: string;
  readonly domain: { readonly code: string; readonly name: string };
  readonly source: { readonly documentName: string; readonly sectionKey: string };
  readonly confidence: { readonly score: number };
  readonly duplicate: {
    readonly maxSimilarityScore: number | null;
    readonly disposition: string | null;
    readonly blocksApproval: boolean;
  };
}

const QUEUES = ['author', 'approval', 'publish', 'published', 'all'] as const;
type Queue = (typeof QUEUES)[number];

const isQueue = (value: string | undefined): value is Queue =>
  value !== undefined && (QUEUES as readonly string[]).includes(value);

/**
 * Draft review queue.
 *
 * Five views of one list, chosen by the URL: the author's own drafts, the ones
 * submitted for approval, the approved ones waiting to be published, the
 * published ones, and everything. They are the same table because they are the
 * same rows at different points in §3.1's state machine — a separate screen
 * each would imply five lists.
 *
 * `all` exists so "what already exists from this document" can be answered in
 * full, including the states the workflow queues hide: rejected, retired, and
 * archived. With `?documentId=` it is the view preflight sends an author to
 * when it reports that approved or published questions already cite a
 * document.
 *
 * Ordered by confidence ascending, as the API returns it: the drafts most
 * likely to need work come first rather than last.
 */
export default async function ReviewQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ queue?: string; documentId?: string }>;
}) {
  const query = await searchParams;
  const queue: Queue = isQueue(query.queue) ? query.queue : 'author';
  const documentId = query.documentId;

  const result = await api<{ queue: string; count: number; items: readonly QueueItem[] }>(
    `/api/v1/authoring/questions/review?queue=${queue}` +
      (documentId === undefined ? '' : `&documentId=${encodeURIComponent(documentId)}`),
  );

  return (
    <article>
      <h1>{t('review.heading')}</h1>
      <p className="lede">{t('review.intro')}</p>

      <nav aria-label={t('review.queueLabel')}>
        <ul>
          <li>
            <Link href="/review?queue=author">{t('review.queueAuthor')}</Link>
          </li>
          <li>
            <Link href="/review?queue=approval">{t('review.queueApproval')}</Link>
          </li>
          <li>
            <Link href="/review?queue=publish">{t('publish.approvedHeading')}</Link>
          </li>
          <li>
            <Link href="/review?queue=published">{t('review.queuePublished')}</Link>
          </li>
          <li>
            <Link href="/review?queue=all">{t('review.queueAll')}</Link>
          </li>
        </ul>
      </nav>

      {documentId === undefined ? null : (
        <p className="panel">
          {t('review.documentFilter')}{' '}
          <Link href={`/review?queue=${queue}`}>{t('review.clearFilter')}</Link>
        </p>
      )}

      {!result.ok ? <Problem problem={result.problem} /> : null}

      {result.ok && result.data.items.length === 0 ? <p>{t('review.empty')}</p> : null}

      {result.ok && result.data.items.length > 0 ? (
        <table>
          <caption>
            {t('review.tableCaption')} — {queue} ({result.data.count})
          </caption>
          <thead>
            <tr>
              <th scope="col">{t('review.question')}</th>
              <th scope="col">{t('review.status')}</th>
              <th scope="col">{t('review.confidence')}</th>
              <th scope="col">{t('review.source')}</th>
              <th scope="col">{t('review.duplicate')}</th>
              <th scope="col">{t('sources.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {result.data.items.map((item) => (
              <tr key={item.questionId}>
                <th scope="row">{item.questionText}</th>
                <td>
                  {item.status} <span className="muted">v{item.version}</span>
                </td>
                <td>{Number(item.confidence.score).toFixed(3)}</td>
                <td>
                  {item.source.documentName}
                  <br />
                  <span className="muted">{item.topic}</span>
                </td>
                <td>
                  {item.duplicate.maxSimilarityScore === null
                    ? '—'
                    : Number(item.duplicate.maxSimilarityScore).toFixed(3)}
                  {item.duplicate.blocksApproval ? (
                    <>
                      <br />
                      <span className="fail">{t('review.blocksApproval')}</span>
                    </>
                  ) : null}
                </td>
                <td>
                  <Link href={`/review/${item.questionId}`}>{t('review.open')}</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </article>
  );
}
