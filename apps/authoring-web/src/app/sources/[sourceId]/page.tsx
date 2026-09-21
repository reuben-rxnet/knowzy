import {
  Badge,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  PageHero,
  StatusBadge,
  TBody,
  THead,
  TabNav,
  Td,
  Th,
  Tr,
  TextLink,
  statusTone,
} from '@knowzy/shared-ui';
import { ArrowLeft, ChevronRight, File, Folder } from 'lucide-react';
import { t } from '../../../copy';
import { api } from '../../../lib/api';
import { Problem } from '../../../components/Problem';

interface Container {
  readonly containerId: string;
  readonly containerName: string;
  readonly itemCount: number;
}

interface Item {
  readonly kind: string;
  readonly name: string;
  readonly folderPath: string;
  readonly sourceDocumentId: string;
  readonly documentId: string | null;
  readonly fileType: string;
  readonly extractionStatus: string | null;
  readonly sectionCount: number | null;
  readonly extractedCharCount: number | null;
  readonly isSelectable: boolean;
}

interface Section {
  readonly sectionId: string;
  readonly ordinal: number;
  readonly heading: string | null;
  readonly headingPath: string | null;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly assessableCharCount: number;
  readonly isAssessable: boolean;
  readonly nonAssessableReason: string | null;
  readonly coverageStatus: string;
}

const DASH = '—';

/**
 * Document browser.
 *
 * Three reads, each optional: the containers, the items in the selected
 * container, and the sections of the selected document. Navigation lives in the
 * URL rather than in component state, so every view is linkable and the Back
 * button behaves — which is also why the containers are a link-based TabNav
 * rather than ARIA tabs.
 *
 * `isSelectable` gets its own column because it is the gate on generation: a
 * document that has not been extracted cannot be a generation input, and
 * hiding that would make the Generate page refuse for no visible reason.
 *
 * UI-M2 converted this screen. Same three reads, same URL contract, same
 * refusals. §14 also requires that a document the caller may not read is
 * absent rather than greyed out — that filtering is the API's, and this page
 * adds no client-side pass that could contradict it.
 */
export default async function DocumentBrowserPage({
  params,
  searchParams,
}: {
  params: Promise<{ sourceId: string }>;
  searchParams: Promise<{ containerId?: string; folderPath?: string; documentId?: string }>;
}) {
  const { sourceId } = await params;
  const query = await searchParams;

  const containers = await api<{ supportsContainers: boolean; containers: readonly Container[] }>(
    `/api/v1/authoring/sources/${sourceId}/containers`,
  );

  const containerId =
    query.containerId ?? (containers.ok ? containers.data.containers[0]?.containerId : undefined);

  // A container holds folders as well as documents, so the folder path is part
  // of the URL too. Without it the SOPs library looks empty of documents —
  // everything in it lives one level down.
  const folderPath = query.folderPath ?? '';
  const itemsPath =
    `/api/v1/authoring/sources/${sourceId}/items?containerId=${encodeURIComponent(
      containerId ?? '',
    )}` + (folderPath === '' ? '' : `&folderPath=${encodeURIComponent(folderPath)}`);

  const items =
    containerId === undefined
      ? null
      : await api<{ items: readonly Item[]; totalCount: number }>(itemsPath);

  const browseHref = (nextFolder: string): string =>
    `/sources/${sourceId}?containerId=${encodeURIComponent(containerId ?? '')}` +
    (nextFolder === '' ? '' : `&folderPath=${encodeURIComponent(nextFolder)}`);

  const sections =
    query.documentId === undefined
      ? null
      : await api<{ name: string; sections: readonly Section[] }>(
          `/api/v1/authoring/sources/${sourceId}/documents/${query.documentId}/sections`,
        );

  // Each segment of the folder path is a link back to that level.
  const segments = folderPath === '' ? [] : folderPath.split('/');

  return (
    <div className="flex flex-col gap-6">
      <PageHero
        title={t('browser.heading')}
        purpose={t('browser.intro')}
        actions={
          <ButtonLink href="/sources" tone="secondary">
            <ArrowLeft aria-hidden="true" className="size-4" />
            {t('browser.backToSources')}
          </ButtonLink>
        }
      />

      {!containers.ok ? <Problem problem={containers.problem} /> : null}

      {containers.ok ? (
        <TabNav
          ariaLabel={t('browser.containers')}
          activeHref={`/sources/${sourceId}?containerId=${encodeURIComponent(containerId ?? '')}`}
          items={containers.data.containers.map((container) => ({
            label: container.containerName,
            href: `/sources/${sourceId}?containerId=${encodeURIComponent(container.containerId)}`,
            count: container.itemCount,
          }))}
        />
      ) : null}

      {segments.length === 0 ? null : (
        <nav aria-label={t('browser.breadcrumb')} className="flex flex-wrap items-center gap-1">
          <TextLink href={browseHref('')}>{containerId}</TextLink>
          {segments.map((segment, index) => {
            const upTo = segments.slice(0, index + 1).join('/');
            const last = index === segments.length - 1;
            return (
              <span key={upTo} className="flex items-center gap-1">
                <ChevronRight aria-hidden="true" className="size-4 text-ink-subtle" />
                {last ? (
                  <span
                    aria-current="page"
                    className="text-base font-semibold text-brand-navy-text"
                  >
                    {segment}
                  </span>
                ) : (
                  <TextLink href={browseHref(upTo)}>{segment}</TextLink>
                )}
              </span>
            );
          })}
        </nav>
      )}

      {items !== null && !items.ok ? <Problem problem={items.problem} /> : null}

      {items !== null && items.ok && items.data.items.length === 0 ? (
        <EmptyState title={t('browser.empty')} description={t('browser.emptyBody')} />
      ) : null}

      {items !== null && items.ok && items.data.items.length > 0 ? (
        <DataTable
          caption={`${t('browser.tableCaption')} — ${containerId}${folderPath === '' ? '' : ` / ${folderPath}`}`}
        >
          <THead>
            <Tr>
              <Th scope="col">{t('browser.name')}</Th>
              <Th scope="col">{t('browser.kind')}</Th>
              <Th scope="col">{t('browser.extraction')}</Th>
              <Th scope="col" align="end">
                {t('browser.sections')}
              </Th>
              <Th scope="col" align="end">
                {t('browser.chars')}
              </Th>
              <Th scope="col">{t('browser.selectable')}</Th>
              <Th scope="col">{t('sources.actions')}</Th>
            </Tr>
          </THead>
          <TBody>
            {items.data.items.map((item) => {
              const isDocument = item.kind === 'DOCUMENT';
              return (
                <Tr key={`${item.folderPath}/${item.sourceDocumentId}`}>
                  <Th scope="row">
                    <span className="flex items-start gap-2">
                      <span aria-hidden="true" className="mt-0.5 text-ink-subtle">
                        {isDocument ? (
                          <File className="size-4" />
                        ) : (
                          <Folder className="size-4 text-brand-blue" />
                        )}
                      </span>
                      {isDocument ? (
                        item.name
                      ) : (
                        <TextLink
                          href={browseHref(
                            folderPath === '' ? item.name : `${folderPath}/${item.name}`,
                          )}
                        >
                          {item.name}
                        </TextLink>
                      )}
                    </span>
                  </Th>
                  <Td>{isDocument ? item.fileType.toUpperCase() : item.kind}</Td>
                  <Td>
                    {isDocument && item.extractionStatus !== null ? (
                      <StatusBadge status={item.extractionStatus} />
                    ) : (
                      DASH
                    )}
                  </Td>
                  <Td numeric>{isDocument ? (item.sectionCount ?? DASH) : DASH}</Td>
                  <Td numeric>
                    {isDocument ? (item.extractedCharCount?.toLocaleString('en-GB') ?? DASH) : DASH}
                  </Td>
                  <Td>
                    {isDocument ? (
                      <StatusBadge
                        status={item.isSelectable ? t('browser.yes') : t('browser.no')}
                        tone={item.isSelectable ? 'success' : 'warning'}
                      />
                    ) : (
                      DASH
                    )}
                  </Td>
                  <Td>
                    {item.documentId === null ? null : (
                      <ButtonLink
                        href={`${browseHref(folderPath)}&documentId=${item.documentId}`}
                        size="sm"
                      >
                        {t('browser.viewSections')}
                      </ButtonLink>
                    )}
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </DataTable>
      ) : null}

      {sections !== null && !sections.ok ? <Problem problem={sections.problem} /> : null}

      {sections !== null && sections.ok ? (
        <Card>
          <CardHeader
            title={`${t('browser.sectionsHeading')} — ${sections.data.name}`}
            description={t('browser.sectionsSubtitle')}
            actions={
              <Badge tone="info" withIcon={false}>
                {sections.data.sections.filter((section) => section.isAssessable).length}
                {' / '}
                {sections.data.sections.length} {t('browser.assessableCount')}
              </Badge>
            }
          />
          <CardBody>
            <DataTable caption={t('browser.sectionsHeading')} captionHidden>
              <THead>
                <Tr>
                  <Th scope="col" align="end">
                    {t('browser.sectionOrdinal')}
                  </Th>
                  <Th scope="col">{t('browser.sectionHeading')}</Th>
                  <Th scope="col">{t('browser.sectionOffsets')}</Th>
                  <Th scope="col">{t('browser.sectionAssessable')}</Th>
                  <Th scope="col">{t('browser.sectionCoverage')}</Th>
                </Tr>
              </THead>
              <TBody>
                {sections.data.sections.map((section) => (
                  <Tr key={section.sectionId}>
                    <Td numeric>{section.ordinal}</Td>
                    <Th scope="row">{section.headingPath ?? section.heading ?? DASH}</Th>
                    {/* The offsets are shown because they are the claim the
                        platform makes: text.slice(start, end) is the evidence
                        span, and X2 requires that round-trip to hold. */}
                    <Td numeric>
                      {section.startOffset}–{section.endOffset}
                    </Td>
                    <Td>
                      {section.isAssessable ? (
                        <StatusBadge
                          status={`${section.assessableCharCount.toLocaleString('en-GB')} ${t('browser.assessableChars')}`}
                          tone="success"
                        />
                      ) : (
                        <StatusBadge
                          status={section.nonAssessableReason ?? t('browser.no')}
                          tone="warning"
                        />
                      )}
                    </Td>
                    <Td>
                      <StatusBadge
                        status={section.coverageStatus}
                        tone={statusTone(section.coverageStatus)}
                      />
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </DataTable>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
