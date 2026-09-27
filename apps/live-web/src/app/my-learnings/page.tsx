import {
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  ExampleRegion,
  KnowzyBadgeArt,
  KpiCard,
  PageHero,
  PreviewNotice,
  TBody,
  THead,
  Td,
  Th,
  Tr,
  Badge,
  type BadgeArtworkName,
} from '@knowzy/shared-ui';
import { Award, BookOpenCheck, ClipboardList, PlayCircle } from 'lucide-react';
import { t, type CopyKey } from '../../copy';
import { listAssessments } from '../../lib/assessments';
import { Problem } from '../../components/Problem';
import {
  ExampleCard,
  ExampleGrid,
  FutureTag,
  LiveTag,
  PreviewAction,
} from '../../components/PreviewParts';

/**
 * My Learnings — a PREVIEW (LIVE-PREVIEW-M1), with two real sections.
 *
 * Real, from `GET /learning/assessments` and nothing else: the three progress
 * counts and the assessment history (attempts used, and a Resume link for an
 * attempt in progress). Learner §7.2 forbids reinterpreting an assessment as
 * a course, so assessments stay assessments here and are never drawn as a
 * learning path.
 *
 * Illustrative, inside ExampleRegions: learning paths (active and completed),
 * badges and certificates. No calendar at all — §7.5 forbids a fabricated
 * session or join link, and a fenced one would still be a date nobody set.
 */

interface ExamplePath {
  readonly title: CopyKey;
  readonly body: CopyKey;
  readonly source: CopyKey;
  readonly domain: CopyKey;
  readonly level: CopyKey;
  readonly duration: CopyKey;
  readonly modules: CopyKey;
  readonly progress: number;
}

const ACTIVE_PATHS: readonly ExamplePath[] = [
  {
    title: 'ex.pathOrderTitle',
    body: 'ex.pathOrderBody',
    source: 'ex.sourceInternal',
    domain: 'ex.domainOperations',
    level: 'ex.levelIntermediate',
    duration: 'ex.duration2h30',
    modules: 'ex.modules10',
    progress: 60,
  },
  {
    title: 'ex.pathQualityTitle',
    body: 'ex.pathQualityBody',
    source: 'ex.sourceSharePoint',
    domain: 'ex.domainQuality',
    level: 'ex.levelBeginner',
    duration: 'ex.duration1h20',
    modules: 'ex.modules6',
    progress: 35,
  },
  {
    title: 'ex.pathPrivacyTitle',
    body: 'ex.pathPrivacyBody',
    source: 'ex.sourceExternal',
    domain: 'ex.domainCompliance',
    level: 'ex.levelBeginner',
    duration: 'ex.duration45',
    modules: 'ex.modules4',
    progress: 0,
  },
];

const COMPLETED_PATHS: readonly { readonly title: CopyKey; readonly domain: CopyKey }[] = [
  { title: 'ex.pathSafetyTitle', domain: 'ex.domainOperations' },
  { title: 'ex.pathEscalationTitle', domain: 'ex.domainService' },
];

const BADGES: readonly {
  readonly art: BadgeArtworkName;
  readonly name: CopyKey;
  readonly alt: CopyKey;
  readonly rule: CopyKey;
}[] = [
  {
    art: 'assessmentPro',
    name: 'ml.badgeAssessmentPro',
    alt: 'ml.badgeAltAssessmentPro',
    rule: 'ml.badgeRuleAssessmentPro',
  },
  {
    art: 'continuousLearner',
    name: 'ml.badgeContinuousLearner',
    alt: 'ml.badgeAltContinuousLearner',
    rule: 'ml.badgeRuleContinuousLearner',
  },
  {
    art: 'domainSpecialist',
    name: 'ml.badgeDomainSpecialist',
    alt: 'ml.badgeAltDomainSpecialist',
    rule: 'ml.badgeRuleDomainSpecialist',
  },
  {
    art: 'knowledgeExplorer',
    name: 'ml.badgeKnowledgeExplorer',
    alt: 'ml.badgeAltKnowledgeExplorer',
    rule: 'ml.badgeRuleKnowledgeExplorer',
  },
];

export default async function MyLearningsPage() {
  const result = await listAssessments();
  const assessments = result.ok ? result.data.assessments : [];
  const attempted = assessments.filter(
    (item) => item.attemptsUsed > 0 || item.inProgressSession !== null,
  );
  const inProgress = assessments.filter((item) => item.inProgressSession !== null);

  return (
    <div className="flex flex-col gap-6">
      <PageHero title={t('ml.heading')} purpose={t('ml.intro')} backdrop="wave" />

      <PreviewNotice
        label={t('preview.label')}
        title={t('ml.previewTitle')}
        requirement={t('ml.previewRequirement')}
      >
        <p>{t('ml.previewBody')}</p>
      </PreviewNotice>

      {!result.ok ? <Problem problem={result.problem} /> : null}

      {/* REAL: three counts straight from the eligibility payload. */}
      <section aria-labelledby="ml-progress" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="ml-progress" className="text-lg font-semibold text-brand-navy-text">
            {t('ml.progressHeading')}
          </h2>
          <LiveTag />
        </div>
        <p className="text-sm text-ink-muted">{t('ml.progressIntro')}</p>
        {result.ok ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <KpiCard
              label={t('ml.kpiAvailable')}
              value={result.data.count}
              icon={<ClipboardList className="size-5" />}
            />
            <KpiCard
              label={t('ml.kpiAttempted')}
              value={attempted.length}
              tone="success"
              icon={<BookOpenCheck className="size-5" />}
            />
            <KpiCard
              label={t('ml.kpiInProgress')}
              value={inProgress.length}
              tone="warning"
              icon={<PlayCircle className="size-5" />}
            />
          </div>
        ) : null}
      </section>

      {/* REAL: the history this release can state — attempts used, per
          assessment. No list of earlier RESULTS exists to show. */}
      <Card ariaLabelledBy="ml-history">
        <CardHeader
          id="ml-history"
          title={t('ml.historyHeading')}
          description={t('ml.historyIntro')}
          actions={<LiveTag />}
        />
        <CardBody>
          {result.ok && attempted.length === 0 ? (
            <EmptyState title={t('ml.historyEmpty')} description={t('ml.historyEmptyBody')} />
          ) : null}
          {attempted.length === 0 ? null : (
            <DataTable caption={t('ml.historyHeading')} captionHidden>
              <THead>
                <Tr>
                  <Th scope="col">{t('list.name')}</Th>
                  <Th scope="col">{t('list.domain')}</Th>
                  <Th scope="col">{t('list.attempts')}</Th>
                  <Th scope="col">{t('ml.colState')}</Th>
                </Tr>
              </THead>
              <TBody>
                {attempted.map((item) => (
                  <Tr key={item.assessmentId}>
                    <Td>{item.name}</Td>
                    <Td>{item.domain}</Td>
                    <Td>
                      {item.attemptLimit === null
                        ? t('list.attemptsUsedOnly', { used: item.attemptsUsed })
                        : t('list.attemptsOf', {
                            used: item.attemptsUsed,
                            limit: item.attemptLimit,
                          })}
                    </Td>
                    <Td>
                      {item.inProgressSession === null ? (
                        <Badge tone="neutral" withIcon={false}>
                          {t('ml.stateAttempted')}
                        </Badge>
                      ) : (
                        <ButtonLink
                          href={`/sessions/${item.inProgressSession.sessionId}`}
                          tone="success"
                          size="sm"
                        >
                          {t('ml.resume')}
                        </ButtonLink>
                      )}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </DataTable>
          )}
        </CardBody>
      </Card>

      <ExampleRegion
        id="ml-paths"
        heading={t('ml.pathsHeading')}
        tag={t('preview.exampleTagYours')}
        description={t('ml.pathsIntro')}
        aside={<FutureTag />}
      >
        <ExampleGrid>
          {ACTIVE_PATHS.map((path) => (
            <ExampleCard
              key={path.title}
              eyebrow={t(path.source)}
              title={t(path.title)}
              body={t(path.body)}
              tags={[t(path.domain), t(path.level)]}
              meta={[t(path.duration), t(path.modules)]}
              progress={path.progress}
              action={path.progress === 0 ? t('preview.start') : t('preview.continue')}
            />
          ))}
        </ExampleGrid>
      </ExampleRegion>

      <ExampleRegion
        id="ml-completed"
        heading={t('ml.completedHeading')}
        tag={t('preview.exampleTagYours')}
        description={t('ml.completedIntro')}
        aside={<FutureTag />}
      >
        <ul className="flex flex-col divide-y divide-line">
          {COMPLETED_PATHS.map((path) => (
            <li key={path.title} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <span className="flex flex-col">
                <span className="font-semibold text-brand-navy-text">{t(path.title)}</span>
                <span className="text-sm text-ink-muted">{t(path.domain)}</span>
              </span>
              <span className="flex items-center gap-2">
                <Badge tone="neutral" withIcon={false}>
                  {t('ml.completedState')}
                </Badge>
                <PreviewAction label={t('preview.open')} />
              </span>
            </li>
          ))}
        </ul>
      </ExampleRegion>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <ExampleRegion
            id="ml-badges"
            heading={t('ml.badgesHeading')}
            tag={t('preview.exampleTag')}
            description={t('ml.badgesIntro')}
            aside={<FutureTag phase9 />}
          >
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {BADGES.map((badge) => (
                <li
                  key={badge.art}
                  className="flex items-start gap-3 rounded-md border border-line p-3"
                >
                  <KnowzyBadgeArt name={badge.art} label={t(badge.alt)} className="size-14" />
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="font-semibold text-brand-navy-text">{t(badge.name)}</span>
                    <span className="text-xs font-semibold text-ink-subtle">
                      {t('ml.badgeNotEarned')}
                    </span>
                    <span className="text-sm text-ink-muted">{t(badge.rule)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </ExampleRegion>
        </div>

        <ExampleRegion
          id="ml-certificates"
          heading={t('ml.certHeading')}
          tag={t('preview.exampleTag')}
          description={t('ml.certIntro')}
          aside={<FutureTag phase9 />}
        >
          <div className="flex flex-col gap-3 rounded-md border border-line bg-surface-sunken p-4">
            <Award aria-hidden="true" className="size-8 text-ink-subtle" />
            <p className="font-semibold text-brand-navy-text">{t('ml.certTitle')}</p>
            <p className="text-sm text-ink-muted">{t('ml.certBody')}</p>
            <div className="flex flex-wrap gap-2">
              <PreviewAction label={t('ml.certDownload')} />
              <PreviewAction label={t('ml.certVerify')} />
            </div>
          </div>
        </ExampleRegion>
      </div>
    </div>
  );
}
