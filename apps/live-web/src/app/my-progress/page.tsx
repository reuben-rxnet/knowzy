import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  ExampleRegion,
  Meter,
  PageHero,
  PreviewNotice,
  TBody,
  THead,
  Td,
  Th,
  Tr,
} from '@knowzy/shared-ui';
import { CheckCircle2, Circle } from 'lucide-react';
import { t, type CopyKey } from '../../copy';
import { listAssessments } from '../../lib/assessments';
import { Problem } from '../../components/Problem';
import { DisabledFilters, ExampleGrid, FutureTag, LiveTag } from '../../components/PreviewParts';

/**
 * My Progress — a PREVIEW (LIVE-PREVIEW-M2), with one real section.
 *
 * Real: assessment completion — how many of the assessments published to the
 * learner they have attempted, from `GET /learning/assessments`.
 *
 * Illustrative, inside ExampleRegions: progress by topic and by domain, the
 * competency overview and the learning journey. Per-topic accuracy IS
 * recorded, but only on one result at a time and there is no per-learner
 * result list to roll it up from (LIVE-UI-M2), so a cross-result figure could
 * only be invented. The band names are the platform's own
 * (`ProficiencyBand`), so the example uses the vocabulary a real result does.
 *
 * Absent, not framed: the mockup's courses completed, learning hours, average
 * score, streak, badges earned and every "this quarter" delta. None has a
 * backing field.
 */

const TOPICS: readonly { readonly topic: CopyKey; readonly percent: number }[] = [
  { topic: 'ex.topicOrderExceptions', percent: 82 },
  { topic: 'ex.topicReturns', percent: 64 },
  { topic: 'ex.topicInspection', percent: 45 },
  { topic: 'ex.topicPersonalData', percent: 90 },
];

const DOMAINS: readonly {
  readonly domain: CopyKey;
  readonly percent: number;
  readonly band: CopyKey;
  readonly basis: CopyKey;
}[] = [
  {
    domain: 'ex.domainOperations',
    percent: 76,
    band: 'prog.bandProficient',
    basis: 'prog.basisExample1',
  },
  {
    domain: 'ex.domainCompliance',
    percent: 90,
    band: 'prog.bandExpert',
    basis: 'prog.basisExample2',
  },
  {
    domain: 'ex.domainQuality',
    percent: 48,
    band: 'prog.bandNeedsImprovement',
    basis: 'prog.basisExample3',
  },
];

const JOURNEY: readonly { readonly step: CopyKey; readonly done: boolean }[] = [
  { step: 'prog.journey1', done: true },
  { step: 'prog.journey2', done: true },
  { step: 'prog.journey3', done: true },
  { step: 'prog.journey4', done: true },
  { step: 'prog.journey5', done: false },
];

export default async function MyProgressPage() {
  const result = await listAssessments();
  const assessments = result.ok ? result.data.assessments : [];
  const attempted = assessments.filter(
    (item) => item.attemptsUsed > 0 || item.inProgressSession !== null,
  ).length;
  const available = result.ok ? result.data.count : 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHero title={t('prog.heading')} purpose={t('prog.intro')} backdrop="wave" />

      <PreviewNotice
        label={t('preview.label')}
        title={t('prog.previewTitle')}
        requirement={t('prog.previewRequirement')}
      >
        <p>{t('prog.previewBody')}</p>
      </PreviewNotice>

      {!result.ok ? <Problem problem={result.problem} /> : null}

      <Card ariaLabelledBy="prog-completion">
        <CardHeader
          id="prog-completion"
          title={t('prog.completionHeading')}
          description={t('prog.completionIntro')}
          actions={<LiveTag />}
        />
        <CardBody>
          {result.ok && available === 0 ? (
            <EmptyState title={t('prog.completionEmpty')} />
          ) : result.ok ? (
            <Meter
              label={t('prog.completionMeter')}
              percent={Math.round((attempted / available) * 100)}
              tone="success"
              summary={t('prog.completionSummary', { attempted, available })}
            />
          ) : null}
        </CardBody>
      </Card>

      <ExampleRegion
        id="prog-filters"
        heading={t('preview.searchLabel')}
        tag={t('preview.exampleTag')}
        aside={<FutureTag />}
      >
        <DisabledFilters
          idPrefix="prog"
          searchPlaceholder={t('prog.searchPlaceholder')}
          filters={[t('prog.filtersPeriod'), t('prog.filtersDomain')]}
        />
      </ExampleRegion>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 [&>*]:min-w-0">
        <ExampleRegion
          id="prog-topics"
          heading={t('prog.topicHeading')}
          tag={t('preview.exampleTagYours')}
          description={t('prog.topicIntro')}
          aside={<FutureTag />}
        >
          <div className="flex flex-col gap-4">
            {TOPICS.map((item) => (
              <Meter key={item.topic} label={t(item.topic)} percent={item.percent} tone="neutral" />
            ))}
          </div>
        </ExampleRegion>

        <ExampleRegion
          id="prog-domains"
          heading={t('prog.domainHeading')}
          tag={t('preview.exampleTagYours')}
          description={t('prog.domainIntro')}
          aside={<FutureTag />}
        >
          <div className="flex flex-col gap-4">
            {DOMAINS.map((item) => (
              <Meter
                key={item.domain}
                label={t(item.domain)}
                percent={item.percent}
                tone="neutral"
              />
            ))}
          </div>
        </ExampleRegion>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3 [&>*]:min-w-0">
        <div className="xl:col-span-2">
          <ExampleRegion
            id="prog-competency"
            heading={t('prog.competencyHeading')}
            tag={t('preview.exampleTagYours')}
            description={t('prog.competencyIntro')}
            aside={<FutureTag />}
          >
            <DataTable caption={t('prog.competencyHeading')} captionHidden>
              <THead>
                <Tr>
                  <Th scope="col">{t('prog.colDomain')}</Th>
                  <Th scope="col">{t('prog.colBand')}</Th>
                  <Th scope="col">{t('prog.colBasis')}</Th>
                </Tr>
              </THead>
              <TBody>
                {DOMAINS.map((item) => (
                  <Tr key={item.domain}>
                    <Td>{t(item.domain)}</Td>
                    <Td>
                      <Badge tone="neutral" withIcon={false}>
                        {t(item.band)}
                      </Badge>
                    </Td>
                    <Td>{t(item.basis)}</Td>
                  </Tr>
                ))}
              </TBody>
            </DataTable>
          </ExampleRegion>
        </div>

        <ExampleRegion
          id="prog-journey"
          heading={t('prog.journeyHeading')}
          tag={t('preview.exampleTagYours')}
          description={t('prog.journeyIntro')}
          aside={<FutureTag />}
        >
          <ExampleGrid columns={2}>
            <ol className="col-span-full flex flex-col gap-3">
              {JOURNEY.map((item) => (
                <li key={item.step} className="flex items-start gap-3">
                  {item.done ? (
                    <CheckCircle2
                      aria-hidden="true"
                      className="mt-0.5 size-5 shrink-0 text-ink-subtle"
                    />
                  ) : (
                    <Circle aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-ink-subtle" />
                  )}
                  <span className="flex flex-col">
                    <span className="font-medium text-ink">{t(item.step)}</span>
                    <span className="text-xs text-ink-subtle">
                      {item.done ? t('prog.journeyDone') : t('prog.journeyNext')}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </ExampleGrid>
        </ExampleRegion>
      </div>
    </div>
  );
}
