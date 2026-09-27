import {
  Badge,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ExampleRegion,
  PageHero,
  PreviewNotice,
} from '@knowzy/shared-ui';
import { ArrowRight } from 'lucide-react';
import { t, type CopyKey } from '../../copy';
import { listAssessments, visibleDomains } from '../../lib/assessments';
import { Problem } from '../../components/Problem';
import {
  DisabledFilters,
  ExampleCard,
  ExampleGrid,
  FutureTag,
  LiveTag,
} from '../../components/PreviewParts';

/**
 * Discover — a PREVIEW (LIVE-PREVIEW-M1), with one real section.
 *
 * Real: the subjects (domains) of the assessments published to this learner,
 * with how many each has. Learner §12.3: topics and domains must come from
 * configured data, never mockup labels — so the only live list on the page is
 * one the server produced.
 *
 * Illustrative, inside ExampleRegions: suggested topics, trending topics,
 * popular assessments and suggested paths. Each suggestion carries the reason
 * §12.4 requires ("Suggested because: …"), so the finished design is shown
 * with explainability built in rather than bolted on. No example carries a
 * learner count or a popularity figure: there is no usage measure behind one.
 */

const SUGGESTED_TOPICS: readonly { readonly topic: CopyKey; readonly reason: CopyKey }[] = [
  { topic: 'ex.topicReturns', reason: 'ex.reasonGap' },
  { topic: 'ex.topicPersonalData', reason: 'ex.reasonRole' },
  { topic: 'ex.topicInspection', reason: 'ex.reasonPath' },
];

const TRENDING: readonly CopyKey[] = [
  'ex.topicOrderExceptions',
  'ex.topicSafety',
  'ex.topicEscalation',
  'ex.topicReporting',
  'ex.topicPersonalData',
];

const POPULAR: readonly {
  readonly title: CopyKey;
  readonly domain: CopyKey;
  readonly questions: CopyKey;
}[] = [
  { title: 'ex.assessOrders', domain: 'ex.domainOperations', questions: 'ex.questions15' },
  { title: 'ex.assessPrivacy', domain: 'ex.domainCompliance', questions: 'ex.questions10' },
  { title: 'ex.assessQuality', domain: 'ex.domainQuality', questions: 'ex.questions10' },
];

export default async function DiscoverPage() {
  const result = await listAssessments();
  const domains = result.ok ? visibleDomains(result.data.assessments) : [];

  return (
    <div className="flex flex-col gap-6">
      <PageHero title={t('disc.heading')} purpose={t('disc.intro')} backdrop="dots" />

      <PreviewNotice
        label={t('preview.label')}
        title={t('disc.previewTitle')}
        requirement={t('disc.previewRequirement')}
      >
        <p>{t('disc.previewBody')}</p>
      </PreviewNotice>

      {!result.ok ? <Problem problem={result.problem} /> : null}

      <Card ariaLabelledBy="disc-subjects">
        <CardHeader
          id="disc-subjects"
          title={t('disc.subjectsHeading')}
          description={t('disc.subjectsIntro')}
          actions={<LiveTag />}
        />
        <CardBody>
          {result.ok && domains.length === 0 ? (
            <EmptyState title={t('disc.subjectsEmpty')} />
          ) : (
            <div className="flex flex-col gap-4">
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {domains.map((entry) => (
                  <li
                    key={entry.domain}
                    className="flex flex-col gap-1 rounded-md border border-line bg-surface-sunken px-4 py-3"
                  >
                    <span className="font-semibold text-brand-navy-text">{entry.domain}</span>
                    <span className="text-sm text-ink-muted">
                      {t('disc.domainCount', { count: entry.assessments })}
                    </span>
                  </li>
                ))}
              </ul>
              {domains.length === 0 ? null : (
                <div>
                  <ButtonLink href="/" tone="secondary" size="sm">
                    {t('disc.goHome')}
                    <ArrowRight aria-hidden="true" className="size-4" />
                  </ButtonLink>
                </div>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      <ExampleRegion
        id="disc-search"
        heading={t('preview.searchLabel')}
        tag={t('preview.exampleTag')}
        aside={<FutureTag phase9 />}
      >
        <DisabledFilters
          idPrefix="disc"
          searchPlaceholder={t('disc.searchPlaceholder')}
          filters={[
            t('disc.filterType'),
            t('disc.filterLevel'),
            t('disc.filterDomain'),
            t('disc.filterDuration'),
          ]}
        />
      </ExampleRegion>

      <ExampleRegion
        id="disc-topics"
        heading={t('disc.topicsHeading')}
        tag={t('preview.exampleTagYours')}
        description={t('disc.topicsIntro')}
        aside={<FutureTag phase9 />}
      >
        <ExampleGrid>
          {SUGGESTED_TOPICS.map((item) => (
            <ExampleCard
              key={item.topic}
              title={t(item.topic)}
              body={t(item.reason)}
              action={t('preview.open')}
            />
          ))}
        </ExampleGrid>
      </ExampleRegion>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ExampleRegion
          id="disc-trending"
          heading={t('disc.trendingHeading')}
          tag={t('preview.exampleTag')}
          description={t('disc.trendingIntro')}
          aside={<FutureTag />}
        >
          <ul className="flex flex-wrap gap-2">
            {TRENDING.map((topic) => (
              <li key={topic}>
                <Badge tone="neutral" withIcon={false}>
                  {t(topic)}
                </Badge>
              </li>
            ))}
          </ul>
        </ExampleRegion>

        <ExampleRegion
          id="disc-popular"
          heading={t('disc.popularHeading')}
          tag={t('preview.exampleTag')}
          description={t('disc.popularIntro')}
          aside={<FutureTag />}
        >
          <ul className="flex flex-col divide-y divide-line">
            {POPULAR.map((item) => (
              <li key={item.title} className="flex flex-col gap-0.5 py-2.5">
                <span className="font-semibold text-brand-navy-text">{t(item.title)}</span>
                <span className="text-sm text-ink-muted">
                  {t(item.domain)} · {t(item.questions)}
                </span>
              </li>
            ))}
          </ul>
        </ExampleRegion>
      </div>

      <ExampleRegion
        id="disc-paths"
        heading={t('disc.pathsHeading')}
        tag={t('preview.exampleTagYours')}
        description={t('disc.pathsIntro')}
        aside={<FutureTag />}
      >
        <ExampleGrid>
          <ExampleCard
            eyebrow={t('ex.sourceInternal')}
            title={t('ex.pathOrderTitle')}
            body={t('ex.reasonGap')}
            tags={[t('ex.domainOperations'), t('ex.levelIntermediate')]}
            meta={[t('ex.duration2h30'), t('ex.modules10')]}
            action={t('preview.start')}
          />
          <ExampleCard
            eyebrow={t('ex.sourceExternal')}
            title={t('ex.pathPrivacyTitle')}
            body={t('ex.reasonRole')}
            tags={[t('ex.domainCompliance'), t('ex.levelBeginner')]}
            meta={[t('ex.duration45'), t('ex.modules4')]}
            action={t('preview.start')}
          />
          <ExampleCard
            eyebrow={t('ex.sourceSharePoint')}
            title={t('ex.pathQualityTitle')}
            body={t('ex.reasonPath')}
            tags={[t('ex.domainQuality'), t('ex.levelBeginner')]}
            meta={[t('ex.duration1h20'), t('ex.modules6')]}
            action={t('preview.start')}
          />
        </ExampleGrid>
      </ExampleRegion>
    </div>
  );
}
