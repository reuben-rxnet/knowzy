import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ExampleRegion,
  PageHero,
  PreviewNotice,
} from '@knowzy/shared-ui';
import { BookOpen, FileText, GraduationCap, PlayCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { t, type CopyKey } from '../../copy';
import { listAssessments, visibleDomains } from '../../lib/assessments';
import { Problem } from '../../components/Problem';
import {
  DisabledFilters,
  ExampleCard,
  ExampleGrid,
  FutureTag,
  LiveTag,
  PreviewAction,
} from '../../components/PreviewParts';

/**
 * Knowledge Library — a PREVIEW (LIVE-PREVIEW-M1), with one real section.
 *
 * Real: the domains of the assessments published to this learner. It is the
 * only taxonomy the learner API exposes, and because it is derived from what
 * is published TO THEM it is permission-trimmed by construction (§13.4).
 *
 * Illustrative, inside ExampleRegions: sources (every one "Not connected" —
 * §13.2: never imply a source is connected until it is configured and
 * verified), categories and topics, the resource grid, search and filters,
 * and one document detail. No resource has an item count, a popularity rank
 * or a real title: a title shown to a learner must be one they can open.
 */

const SOURCES: readonly CopyKey[] = [
  'ex.sourceSharePoint',
  'ex.sourceInternal',
  'ex.sourceExternal',
];

const CATEGORIES: readonly { readonly name: CopyKey; readonly icon: ReactNode }[] = [
  { name: 'ex.catGuides', icon: <BookOpen className="size-5" /> },
  { name: 'ex.catProcedures', icon: <FileText className="size-5" /> },
  { name: 'ex.catVideos', icon: <PlayCircle className="size-5" /> },
  { name: 'ex.catExternal', icon: <GraduationCap className="size-5" /> },
];

const TOPICS: readonly CopyKey[] = [
  'ex.topicReturns',
  'ex.topicOrderExceptions',
  'ex.topicInspection',
  'ex.topicPersonalData',
  'ex.topicSafety',
  'ex.topicEscalation',
];

const RESOURCES: readonly {
  readonly title: CopyKey;
  readonly body: CopyKey;
  readonly source: CopyKey;
  readonly domain: CopyKey;
  readonly type: CopyKey;
  readonly duration: CopyKey;
}[] = [
  {
    title: 'ex.resOrderGuide',
    body: 'ex.resOrderGuideBody',
    source: 'ex.sourceSharePoint',
    domain: 'ex.domainOperations',
    type: 'ex.typeGuide',
    duration: 'ex.duration15',
  },
  {
    title: 'ex.resReturnsProcedure',
    body: 'ex.resReturnsProcedureBody',
    source: 'ex.sourceSharePoint',
    domain: 'ex.domainService',
    type: 'ex.typeDocument',
    duration: 'ex.duration20',
  },
  {
    title: 'ex.resInspectionVideo',
    body: 'ex.resInspectionVideoBody',
    source: 'ex.sourceInternal',
    domain: 'ex.domainQuality',
    type: 'ex.typeVideo',
    duration: 'ex.duration3',
  },
  {
    title: 'ex.resPrivacyTraining',
    body: 'ex.resPrivacyTrainingBody',
    source: 'ex.sourceExternal',
    domain: 'ex.domainCompliance',
    type: 'ex.typeTraining',
    duration: 'ex.duration45',
  },
];

const DetailRow = ({ label, value }: { readonly label: string; readonly value: string }) => (
  <div className="flex flex-col gap-0.5">
    <dt className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle">{label}</dt>
    <dd className="text-sm font-medium text-ink">{value}</dd>
  </div>
);

export default async function KnowledgeLibraryPage() {
  const result = await listAssessments();
  const domains = result.ok ? visibleDomains(result.data.assessments) : [];

  return (
    <div className="flex flex-col gap-6">
      <PageHero title={t('lib.heading')} purpose={t('lib.intro')} backdrop="wave" />

      <PreviewNotice
        label={t('preview.label')}
        title={t('lib.previewTitle')}
        requirement={t('lib.previewRequirement')}
      >
        <p>{t('lib.previewBody')}</p>
      </PreviewNotice>

      {!result.ok ? <Problem problem={result.problem} /> : null}

      <Card ariaLabelledBy="lib-domains">
        <CardHeader
          id="lib-domains"
          title={t('lib.domainsHeading')}
          description={t('lib.domainsIntro')}
          actions={<LiveTag />}
        />
        <CardBody>
          {result.ok && domains.length === 0 ? (
            <EmptyState title={t('lib.domainsEmpty')} />
          ) : (
            <ul className="flex flex-wrap gap-2">
              {domains.map((entry) => (
                <li
                  key={entry.domain}
                  className="flex items-center gap-2 rounded-pill border border-line bg-surface-sunken px-3 py-1.5"
                >
                  <span className="font-semibold text-brand-navy-text">{entry.domain}</span>
                  <span className="text-xs text-ink-muted">
                    {t('lib.domainCount', { count: entry.assessments })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <ExampleRegion
        id="lib-sources"
        heading={t('lib.sourcesHeading')}
        tag={t('preview.exampleTag')}
        description={t('lib.sourcesIntro')}
        aside={<FutureTag />}
      >
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {SOURCES.map((source) => (
            <li
              key={source}
              className="flex items-center justify-between gap-3 rounded-md border border-line px-4 py-3"
            >
              <span className="font-semibold text-brand-navy-text">{t(source)}</span>
              <Badge tone="neutral" withIcon={false}>
                {t('lib.notConnected')}
              </Badge>
            </li>
          ))}
        </ul>
      </ExampleRegion>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="flex flex-col gap-6 xl:col-span-2">
          <ExampleRegion
            id="lib-search"
            heading={t('preview.searchLabel')}
            tag={t('preview.exampleTag')}
            aside={<FutureTag phase9 />}
          >
            <DisabledFilters
              idPrefix="lib"
              searchPlaceholder={t('lib.searchPlaceholder')}
              filters={[
                t('lib.filterSource'),
                t('lib.filterDomain'),
                t('lib.filterType'),
                t('lib.filterLevel'),
              ]}
            />
          </ExampleRegion>

          <ExampleRegion
            id="lib-resources"
            heading={t('lib.resourcesHeading')}
            tag={t('preview.exampleTag')}
            description={t('lib.resourcesIntro')}
            aside={<FutureTag />}
          >
            <ExampleGrid columns={2}>
              {RESOURCES.map((resource) => (
                <ExampleCard
                  key={resource.title}
                  eyebrow={t(resource.source)}
                  title={t(resource.title)}
                  body={t(resource.body)}
                  tags={[t(resource.domain)]}
                  meta={[t(resource.type), t(resource.duration)]}
                  action={t('preview.open')}
                />
              ))}
            </ExampleGrid>
          </ExampleRegion>
        </div>

        <div className="flex flex-col gap-6">
          <ExampleRegion
            id="lib-categories"
            heading={t('lib.categoriesHeading')}
            tag={t('preview.exampleTag')}
            description={t('lib.categoriesIntro')}
            aside={<FutureTag />}
          >
            <ul className="flex flex-col gap-2">
              {CATEGORIES.map((category) => (
                <li
                  key={category.name}
                  className="flex items-center gap-3 rounded-md border border-line px-3 py-2"
                >
                  <span aria-hidden="true" className="text-ink-subtle">
                    {category.icon}
                  </span>
                  <span className="font-medium text-ink">{t(category.name)}</span>
                </li>
              ))}
            </ul>
            <ul className="mt-4 flex flex-wrap gap-1.5">
              {TOPICS.map((topic) => (
                <li key={topic}>
                  <Badge tone="neutral" withIcon={false}>
                    {t(topic)}
                  </Badge>
                </li>
              ))}
            </ul>
          </ExampleRegion>

          <ExampleRegion
            id="lib-detail"
            heading={t('lib.detailHeading')}
            tag={t('preview.exampleTag')}
            description={t('lib.detailIntro')}
            aside={<FutureTag />}
          >
            <div className="flex flex-col gap-4">
              <h3 className="text-base font-semibold text-brand-navy-text">
                {t('ex.resReturnsProcedure')}
              </h3>
              <p className="text-sm text-ink-muted">{t('ex.detailSummary')}</p>
              <dl className="grid grid-cols-2 gap-3">
                <DetailRow label={t('lib.detailSource')} value={t('ex.sourceSharePoint')} />
                <DetailRow label={t('lib.detailType')} value={t('ex.typeDocument')} />
                <DetailRow label={t('lib.detailDomain')} value={t('ex.domainService')} />
                <DetailRow label={t('lib.detailTopic')} value={t('ex.topicReturns')} />
                <DetailRow label={t('lib.detailVersion')} value={t('ex.detailVersion')} />
              </dl>
              <p className="text-xs text-ink-subtle">{t('lib.detailAccess')}</p>
              <div className="flex flex-wrap gap-2">
                <PreviewAction label={t('lib.openInSource')} tone="primary" />
                <PreviewAction label={t('preview.bookmark')} />
              </div>
            </div>
          </ExampleRegion>
        </div>
      </div>
    </div>
  );
}
