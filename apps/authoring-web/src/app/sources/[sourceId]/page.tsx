import Link from 'next/link';
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

/**
 * Document browser.
 *
 * Three reads, each optional: the containers, the items in the selected
 * container, and the sections of the selected document. Navigation lives in the
 * URL rather than in component state, so every view is linkable and the Back
 * button behaves.
 *
 * `isSelectable` gets its own column because it is the gate on generation: a
 * document that has not been extracted cannot be a generation input, and
 * hiding that would make the Generate page refuse for no visible reason.
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

  return (
    <article>
      <h1>{t('browser.heading')}</h1>
      <p className="lede">{t('browser.intro')}</p>
      <p>
        <Link href="/sources">{t('browser.backToSources')}</Link>
      </p>

      {!containers.ok ? <Problem problem={containers.problem} /> : null}

      {containers.ok ? (
        <>
          <h2>{t('browser.containers')}</h2>
          <ul>
            {containers.data.containers.map((container) => (
              <li key={container.containerId}>
                <Link
                  href={`/sources/${sourceId}?containerId=${encodeURIComponent(container.containerId)}`}
                >
                  {container.containerName}
                </Link>{' '}
                <span className="muted">({container.itemCount})</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {items !== null && !items.ok ? <Problem problem={items.problem} /> : null}

      {items !== null && items.ok ? (
        items.data.items.length === 0 ? (
          <p>{t('browser.empty')}</p>
        ) : (
          <table>
            <caption>
              {t('browser.tableCaption')} — {containerId}
              {folderPath === '' ? '' : ` / ${folderPath}`}
            </caption>
            <thead>
              <tr>
                <th scope="col">{t('browser.name')}</th>
                <th scope="col">{t('browser.kind')}</th>
                <th scope="col">{t('browser.extraction')}</th>
                <th scope="col">{t('browser.sections')}</th>
                <th scope="col">{t('browser.chars')}</th>
                <th scope="col">{t('browser.selectable')}</th>
                <th scope="col">{t('sources.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {items.data.items.map((item) => (
                <tr key={`${item.folderPath}/${item.sourceDocumentId}`}>
                  <th scope="row">
                    {item.kind === 'DOCUMENT' ? (
                      item.name
                    ) : (
                      <Link
                        href={browseHref(
                          folderPath === '' ? item.name : `${folderPath}/${item.name}`,
                        )}
                      >
                        {item.name}
                      </Link>
                    )}
                  </th>
                  <td>{item.kind === 'DOCUMENT' ? item.fileType.toUpperCase() : item.kind}</td>
                  <td>{item.kind === 'DOCUMENT' ? (item.extractionStatus ?? '—') : '—'}</td>
                  <td>{item.kind === 'DOCUMENT' ? (item.sectionCount ?? '—') : '—'}</td>
                  <td>
                    {item.kind === 'DOCUMENT'
                      ? (item.extractedCharCount?.toLocaleString('en-GB') ?? '—')
                      : '—'}
                  </td>
                  <td className={item.isSelectable ? 'pass' : 'fail'}>
                    {item.isSelectable ? t('browser.yes') : t('browser.no')}
                  </td>
                  <td>
                    {item.documentId === null ? null : (
                      <Link href={`${browseHref(folderPath)}&documentId=${item.documentId}`}>
                        {t('browser.viewSections')}
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : null}

      {sections !== null && !sections.ok ? <Problem problem={sections.problem} /> : null}

      {sections !== null && sections.ok ? (
        <>
          <h2>
            {t('browser.sectionsHeading')} — {sections.data.name}
          </h2>
          <table>
            <thead>
              <tr>
                <th scope="col">{t('browser.sectionOrdinal')}</th>
                <th scope="col">{t('browser.sectionHeading')}</th>
                <th scope="col">{t('browser.sectionOffsets')}</th>
                <th scope="col">{t('browser.sectionAssessable')}</th>
                <th scope="col">{t('browser.sectionCoverage')}</th>
              </tr>
            </thead>
            <tbody>
              {sections.data.sections.map((section) => (
                <tr key={section.sectionId}>
                  <td>{section.ordinal}</td>
                  <th scope="row">{section.headingPath ?? section.heading ?? '—'}</th>
                  {/* The offsets are shown because they are the claim the
                      platform makes: text.slice(start, end) is the evidence
                      span, and X2 requires that round-trip to hold. */}
                  <td className="mono">
                    {section.startOffset}–{section.endOffset}
                  </td>
                  <td className={section.isAssessable ? 'pass' : 'warn'}>
                    {section.isAssessable
                      ? `${section.assessableCharCount}`
                      : (section.nonAssessableReason ?? t('browser.no'))}
                  </td>
                  <td>{section.coverageStatus}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </article>
  );
}
