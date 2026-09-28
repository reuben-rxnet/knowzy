import {
  Badge,
  Button,
  Field,
  Select,
  BlockedBadge,
  ButtonLink,
  CellNote,
  DataTable,
  EmptyState,
  PageHero,
  StatusBadge,
  TBody,
  THead,
  TabNav,
  Td,
  Th,
  TextLink,
  Tr,
  VersionBadge,
} from '@knowzy/shared-ui';
import { t, type CopyKey } from '../../copy';
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
  /** Which job and model drafted it. Null model: imported, not generated. */
  readonly generatedBy?: { readonly jobId: string | null; readonly modelId: string | null };
  readonly duplicate: {
    readonly maxSimilarityScore: number | null;
    readonly disposition: string | null;
    readonly blocksApproval: boolean;
  };
}

const QUEUES = ['author', 'approval', 'publish', 'published', 'all'] as const;

/** The generators a question can come from, as the filter offers them. */
const GENERATORS = [
  { id: 'OPENAI', label: 'review.generatorOpenai' },
  { id: 'DETERMINISTIC_LOCAL', label: 'review.generatorDeterministic' },
  { id: 'IMPORTED', label: 'review.generatorImported' },
] as const;
type Generator = (typeof GENERATORS)[number]['id'];
const isGenerator = (value: string | undefined): value is Generator =>
  GENERATORS.some((option) => option.id === value);
type Queue = (typeof QUEUES)[number];

const isQueue = (value: string | undefined): value is Queue =>
  value !== undefined && (QUEUES as readonly string[]).includes(value);

const QUEUE_LABEL: Record<Queue, CopyKey> = {
  author: 'review.queueAuthor',
  approval: 'review.queueApproval',
  publish: 'publish.approvedHeading',
  published: 'review.queuePublished',
  all: 'review.queueAll',
};

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
 *
 * UI-M2 converted the screen. The five queues, the document filter, and the
 * ordering are unchanged; the queue switch is a link-based TabNav so each view
 * stays bookmarkable.
 */
export default async function ReviewQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ queue?: string; documentId?: string; generator?: string }>;
}) {
  const query = await searchParams;
  const queue: Queue = isQueue(query.queue) ? query.queue : 'author';
  const documentId = query.documentId;
  // EVAL-M1: which generator drafted the questions. Carried on every tab, so
  // "Codex only" stays chosen from the author queue to publication.
  const generator = isGenerator(query.generator) ? query.generator : undefined;

  const filters =
    (documentId === undefined ? '' : `&documentId=${encodeURIComponent(documentId)}`) +
    (generator === undefined ? '' : `&generator=${generator}`);
  const suffix = filters;
  // Up to 100 per page (the API's ceiling). The count beside each tab is the
  // TRUE total, which the page states when it holds more than fits.
  const queueUrl = (name: string) =>
    `/api/v1/authoring/questions/review?queue=${name}&limit=100${filters}`;

  // All five counts, so the tabs say where the work is instead of making an
  // author click each one to find out. Same endpoint the page already uses; a
  // refused count is omitted rather than shown as zero.
  const [result, ...counts] = await Promise.all([
    api<{ queue: string; count: number; shown?: number; items: readonly QueueItem[] }>(
      queueUrl(queue),
    ),
    ...QUEUES.map((name) => api<{ count: number }>(queueUrl(name))),
  ]);

  const countFor = (name: Queue): number | undefined => {
    const index = QUEUES.indexOf(name);
    const read = counts[index];
    return read !== undefined && read.ok ? read.data.count : undefined;
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHero
        title={t('review.heading')}
        purpose={t('review.intro')}
        actions={
          result.ok ? (
            <Badge tone="neutral" withIcon={false}>
              {t('review.countLabel', { count: result.data.count })}
            </Badge>
          ) : undefined
        }
      />

      <TabNav
        ariaLabel={t('review.queueLabel')}
        activeHref={`/review?queue=${queue}${suffix}`}
        items={QUEUES.map((name) => {
          const count = countFor(name);
          return {
            label: t(QUEUE_LABEL[name]),
            href: `/review?queue=${name}${suffix}`,
            ...(count === undefined ? {} : { count }),
          };
        })}
      />

      {/* The generator filter: a plain GET form, so it needs no client state
          and a filtered view is a link. */}
      <form method="get" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="queue" value={queue} />
        {documentId === undefined ? null : (
          <input type="hidden" name="documentId" value={documentId} />
        )}
        <Field id="generator" label={t('review.generatorFilter')}>
          <Select id="generator" name="generator" defaultValue={generator ?? ''}>
            <option value="">{t('review.generatorAll')}</option>
            {GENERATORS.map((option) => (
              <option key={option.id} value={option.id}>
                {t(option.label)}
              </option>
            ))}
          </Select>
        </Field>
        <Button tone="secondary" size="sm">
          {t('review.generatorApply')}
        </Button>
        {generator === undefined ? null : (
          <TextLink
            href={`/review?queue=${queue}${documentId === undefined ? '' : `&documentId=${encodeURIComponent(documentId)}`}`}
          >
            {t('review.clearFilter')}
          </TextLink>
        )}
      </form>

      {result.ok && (result.data.shown ?? result.data.items.length) < result.data.count ? (
        <p className="text-sm text-ink-muted" role="status">
          {t('review.showingOf', {
            shown: result.data.shown ?? result.data.items.length,
            total: result.data.count,
          })}
        </p>
      ) : null}

      {documentId === undefined ? null : (
        <div
          className="flex flex-wrap items-center gap-3 rounded-md bg-info-soft px-4 py-3 text-base text-ink"
          role="status"
        >
          <span>{t('review.documentFilter')}</span>
          <TextLink href={`/review?queue=${queue}`}>{t('review.clearFilter')}</TextLink>
        </div>
      )}

      {!result.ok ? <Problem problem={result.problem} /> : null}

      {result.ok && result.data.items.length === 0 ? (
        <EmptyState
          title={t('review.empty')}
          description={t('review.emptyBody')}
          illustration="learning"
        />
      ) : null}

      {result.ok && result.data.items.length > 0 ? (
        <DataTable caption={`${t('review.tableCaption')} — ${queue} (${result.data.count})`}>
          <THead>
            <Tr>
              <Th scope="col">{t('review.question')}</Th>
              <Th scope="col">{t('review.status')}</Th>
              <Th scope="col" align="end">
                {t('review.confidence')}
              </Th>
              <Th scope="col">{t('review.source')}</Th>
              <Th scope="col">{t('review.duplicate')}</Th>
              <Th scope="col">{t('sources.actions')}</Th>
            </Tr>
          </THead>
          <TBody>
            {result.data.items.map((item) => (
              <Tr key={item.questionId}>
                <Th scope="row" className="max-w-xl">
                  <span className="block font-semibold">{item.questionText}</span>
                  <CellNote>
                    {item.domain.name} · {item.topic}
                  </CellNote>
                  {/* GEN-PROVIDER-M1: which model drafted it, so a queue with
                      questions from two generators can be read apart. */}
                  <CellNote>
                    {t('review.generatedBy', {
                      model: item.generatedBy?.modelId ?? t('review.generatedByImport'),
                    })}
                  </CellNote>
                </Th>
                <Td>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={item.status} />
                    <VersionBadge version={item.version} />
                  </span>
                </Td>
                {/* Computed by the platform, and it authorizes nothing — the
                    gates do. Sorted ascending by it, so the weakest drafts are
                    read first. */}
                <Td numeric>{Number(item.confidence.score).toFixed(3)}</Td>
                <Td>
                  {item.source.documentName}
                  <CellNote>{item.source.sectionKey.slice(0, 12)}</CellNote>
                </Td>
                <Td>
                  {item.duplicate.maxSimilarityScore === null ? (
                    <span className="text-ink-subtle">—</span>
                  ) : (
                    <span className="font-mono tabular-nums">
                      {Number(item.duplicate.maxSimilarityScore).toFixed(3)}
                    </span>
                  )}
                  {item.duplicate.blocksApproval ? (
                    <span className="mt-1 block">
                      <BlockedBadge>{t('review.blocksApproval')}</BlockedBadge>
                    </span>
                  ) : null}
                  {/* A recorded disposition is why a similar question is no
                      longer blocking: real field, previously dropped. */}
                  {item.duplicate.disposition === null ? null : (
                    <span className="mt-1 block">
                      <StatusBadge status={item.duplicate.disposition} tone="success" />
                    </span>
                  )}
                </Td>
                <Td>
                  <ButtonLink href={`/review/${item.questionId}`} size="sm">
                    {t('review.open')}
                  </ButtonLink>
                </Td>
              </Tr>
            ))}
          </TBody>
        </DataTable>
      ) : null}
    </div>
  );
}
