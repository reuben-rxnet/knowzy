import {
  Badge,
  DataTable,
  ExampleRegion,
  KnowzyBadgeArt,
  Meter,
  PageHero,
  PreviewNotice,
  TBody,
  THead,
  Td,
  Th,
  Tr,
  type BadgeArtworkName,
} from '@knowzy/shared-ui';
import { Award, CalendarRange, Compass, Target } from 'lucide-react';
import type { ReactNode } from 'react';
import { t, type CopyKey } from '../../copy';
import { ExampleGrid, FutureTag, PreviewAction } from '../../components/PreviewParts';

/**
 * Badges — a PREVIEW (LIVE-PREVIEW-M2), entirely illustrative.
 *
 * No badge is awarded anywhere in this build (Phase 9), so unlike the other
 * previews this page has NO live section: there is no recorded award, rule or
 * progress to show, and a "Live" tag on a zero would still be a claim.
 *
 * Integration spec §17 and learner §14: a badge asset may appear in an
 * approved preview but must never imply it was earned. So every design is
 * greyed by `KnowzyBadgeArt` (which has no earned variant), the "recently
 * earned" list carries no date and says nothing has been awarded, and the
 * mockup's badge count, points, streak and achievement level are absent —
 * none of them is recorded, and a fenced number is still a number.
 */

interface GalleryBadge {
  readonly art: BadgeArtworkName;
  readonly name: CopyKey;
  readonly alt: CopyKey;
  readonly rule: CopyKey;
  readonly basis: CopyKey;
}

const GALLERY: readonly GalleryBadge[] = [
  {
    art: 'assessmentPro',
    name: 'ml.badgeAssessmentPro',
    alt: 'ml.badgeAltAssessmentPro',
    rule: 'ml.badgeRuleAssessmentPro',
    basis: 'badges.basisResults',
  },
  {
    art: 'domainSpecialist',
    name: 'ml.badgeDomainSpecialist',
    alt: 'ml.badgeAltDomainSpecialist',
    rule: 'ml.badgeRuleDomainSpecialist',
    basis: 'badges.basisBands',
  },
  {
    art: 'continuousLearner',
    name: 'ml.badgeContinuousLearner',
    alt: 'ml.badgeAltContinuousLearner',
    rule: 'ml.badgeRuleContinuousLearner',
    basis: 'badges.basisDates',
  },
  {
    art: 'knowledgeExplorer',
    name: 'ml.badgeKnowledgeExplorer',
    alt: 'ml.badgeAltKnowledgeExplorer',
    rule: 'ml.badgeRuleKnowledgeExplorer',
    basis: 'badges.basisDomains',
  },
  {
    art: 'growthMindset',
    name: 'badges.badgeGrowthMindset',
    alt: 'badges.altGrowthMindset',
    rule: 'badges.ruleGrowthMindset',
    basis: 'badges.basisBands',
  },
  {
    art: 'learningChampion',
    name: 'badges.badgeLearningChampion',
    alt: 'badges.altLearningChampion',
    rule: 'badges.ruleLearningChampion',
    basis: 'badges.basisBands',
  },
  {
    art: 'knowledgeSharer',
    name: 'badges.badgeKnowledgeSharer',
    alt: 'badges.altKnowledgeSharer',
    rule: 'badges.ruleKnowledgeSharer',
    basis: 'badges.basisNone',
  },
  {
    art: 'teamLearner',
    name: 'badges.badgeTeamLearner',
    alt: 'badges.altTeamLearner',
    rule: 'badges.ruleTeamLearner',
    basis: 'badges.basisNone',
  },
];

const CATEGORIES: readonly {
  readonly name: CopyKey;
  readonly body: CopyKey;
  readonly icon: ReactNode;
}[] = [
  {
    name: 'badges.catAssessment',
    body: 'badges.catAssessmentBody',
    icon: <Award className="size-5" />,
  },
  { name: 'badges.catMastery', body: 'badges.catMasteryBody', icon: <Target className="size-5" /> },
  {
    name: 'badges.catConsistency',
    body: 'badges.catConsistencyBody',
    icon: <CalendarRange className="size-5" />,
  },
  {
    name: 'badges.catExploration',
    body: 'badges.catExplorationBody',
    icon: <Compass className="size-5" />,
  },
];

export default function BadgesPage() {
  const recent = GALLERY.slice(0, 2);

  return (
    <div className="flex flex-col gap-6">
      <PageHero title={t('badges.heading')} purpose={t('badges.intro')} backdrop="wave" />

      <PreviewNotice
        label={t('preview.label')}
        title={t('badges.previewTitle')}
        requirement={t('badges.previewRequirement')}
      >
        <p>{t('badges.previewBody')}</p>
      </PreviewNotice>

      <ExampleRegion
        id="badges-categories"
        heading={t('badges.categoriesHeading')}
        tag={t('preview.exampleTag')}
        description={t('badges.categoriesIntro')}
        aside={<FutureTag phase9 />}
      >
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {CATEGORIES.map((category) => (
            <li
              key={category.name}
              className="flex items-start gap-3 rounded-md border border-line p-3"
            >
              <span aria-hidden="true" className="mt-0.5 text-ink-subtle">
                {category.icon}
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="font-semibold text-brand-navy-text">{t(category.name)}</span>
                <span className="text-sm text-ink-muted">{t(category.body)}</span>
              </span>
            </li>
          ))}
        </ul>
      </ExampleRegion>

      <ExampleRegion
        id="badges-gallery"
        heading={t('badges.galleryHeading')}
        tag={t('preview.exampleTag')}
        description={t('badges.galleryIntro')}
        aside={<FutureTag phase9 />}
      >
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {GALLERY.map((badge) => (
            <li
              key={badge.art}
              className="flex flex-col items-center gap-2 rounded-md border border-line p-3 text-center"
            >
              <KnowzyBadgeArt name={badge.art} label={t(badge.alt)} className="size-16" />
              <span className="text-sm font-semibold text-brand-navy-text">{t(badge.name)}</span>
              <span className="text-2xs font-semibold text-ink-subtle">
                {t('ml.badgeNotEarned')}
              </span>
            </li>
          ))}
        </ul>
      </ExampleRegion>

      <ExampleRegion
        id="badges-criteria"
        heading={t('badges.criteriaHeading')}
        tag={t('preview.exampleTag')}
        description={t('badges.criteriaIntro')}
        aside={<FutureTag phase9 />}
      >
        <DataTable caption={t('badges.criteriaHeading')} captionHidden>
          <THead>
            <Tr>
              <Th scope="col">{t('badges.colBadge')}</Th>
              <Th scope="col">{t('badges.colRule')}</Th>
              <Th scope="col">{t('badges.colBasis')}</Th>
            </Tr>
          </THead>
          <TBody>
            {GALLERY.map((badge) => (
              <Tr key={badge.art}>
                <Td>{t(badge.name)}</Td>
                <Td>{t(badge.rule)}</Td>
                <Td>{t(badge.basis)}</Td>
              </Tr>
            ))}
          </TBody>
        </DataTable>
      </ExampleRegion>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 [&>*]:min-w-0">
        <ExampleRegion
          id="badges-recent"
          heading={t('badges.recentHeading')}
          tag={t('badges.recentTag')}
          description={t('badges.recentIntro')}
          aside={<FutureTag phase9 />}
        >
          <ul className="flex flex-col divide-y divide-line">
            {recent.map((badge) => (
              <li key={badge.art} className="flex flex-wrap items-center gap-3 py-3">
                <KnowzyBadgeArt name={badge.art} label={t(badge.alt)} className="size-10" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-semibold text-brand-navy-text">{t(badge.name)}</span>
                  <span className="text-xs text-ink-subtle">
                    {t('badges.recentWhen')} · {t('badges.recentResult')}
                  </span>
                </span>
                <span className="flex gap-2">
                  <PreviewAction label={t('badges.view')} />
                  <PreviewAction label={t('badges.share')} />
                </span>
              </li>
            ))}
          </ul>
        </ExampleRegion>

        <ExampleRegion
          id="badges-progress"
          heading={t('badges.progressHeading')}
          tag={t('preview.exampleTagYours')}
          description={t('badges.progressIntro')}
          aside={<FutureTag phase9 />}
        >
          <ExampleGrid columns={2}>
            <Meter label={t('badges.progressAssessmentPro')} percent={60} tone="neutral" />
            <Meter label={t('badges.progressExplorer')} percent={33} tone="neutral" />
          </ExampleGrid>
          <p className="mt-4">
            <Badge tone="neutral" withIcon={false}>
              {t('ml.badgeNotEarned')}
            </Badge>
          </p>
        </ExampleRegion>
      </div>
    </div>
  );
}
