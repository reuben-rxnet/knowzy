// The approved design assets this build serves, as a typed registry.
//
// `design/approved/knowzy_design_elements_asset_pack/` is immutable reference
// material (CLAUDE.md). Nothing reads from it at runtime: `npm run
// assets:sync` copies the files named here into each application's
// `public/assets/knowzy/`, and `packages/testing/contracts/design-assets.test.ts`
// asserts that every copy is byte-identical to its source, that none is
// missing, and that no unlisted file has appeared. That is the whole
// missing-asset detection story — a broken reference fails `npm run verify`
// rather than showing an empty box in a demo.
//
// Why a registry rather than a path argument:
//
//   * A component that took a path would accept any string, which is a path
//     traversal and an injection surface in one (integration spec §8).
//   * The mapping from a MEANING ("the Home destination") to a FILE lives in
//     exactly one place, so renaming an asset is one edit.
//   * TypeScript then rejects an asset name that does not exist, at build
//     time, in both applications.
//
// Not everything in the pack is here. `docs/ui/knowzy-design-asset-inventory.md`
// classifies all 82 files and gives a reason for each one that is absent.

/** Where the synchronized copies live inside each app's `public`. */
export const ASSET_BASE = '/assets/knowzy' as const;

/**
 * Navigation icons.
 *
 * Every one is a single-colour line icon drawn with `currentColor`, so it is
 * rendered as a CSS mask and takes its colour from the surrounding text. That
 * keeps one file serving the inactive, active and disabled states rather than
 * three.
 */
export const NAV_ICONS = {
  home: 'navigation/icon_home.svg',
  myLearnings: 'navigation/icon_my_learnings.svg',
  assessments: 'navigation/icon_assessments.svg',
  discover: 'navigation/icon_discover.svg',
  badges: 'navigation/icon_badges.svg',
  library: 'navigation/icon_library.svg',
  progress: 'navigation/icon_progress.svg',
  help: 'navigation/icon_help.svg',
  search: 'navigation/icon_search.svg',
  notification: 'navigation/icon_notification.svg',
  copilot: 'navigation/icon_copilot.svg',
} as const;

export type NavIconName = keyof typeof NAV_ICONS;

/**
 * Illustrations, for empty and zero states.
 *
 * Multi-colour and purely decorative: they carry no information the adjacent
 * heading does not already state, so they render with an empty accessible
 * name (integration spec §18, §19).
 */
export const ILLUSTRATIONS = {
  learning: 'illustrations/illustration_learning.svg',
  goal: 'illustrations/illustration_goal.svg',
  growth: 'illustrations/illustration_growth.svg',
  idea: 'illustrations/illustration_idea.svg',
  people: 'illustrations/illustration_people.svg',
} as const;

export type IllustrationName = keyof typeof ILLUSTRATIONS;

/**
 * Badge designs, for the My Learnings and Badges PREVIEWS only.
 *
 * No badge is awarded anywhere in this build (Phase 9), so these are drawn
 * desaturated by `KnowzyBadgeArt` and captioned as designs. Integration spec
 * §17: an asset may appear in an approved preview, never as an award.
 */
export const BADGE_ARTWORK = {
  assessmentPro: 'badges/badge_assessment_pro.svg',
  continuousLearner: 'badges/badge_continuous_learner.svg',
  domainSpecialist: 'badges/badge_domain_specialist.svg',
  knowledgeExplorer: 'badges/badge_knowledge_explorer.svg',
  growthMindset: 'badges/badge_growth_mindset.svg',
  knowledgeSharer: 'badges/badge_knowledge_sharer.svg',
  learningChampion: 'badges/badge_learning_champion.svg',
  teamLearner: 'badges/badge_team_learner.svg',
} as const;

export type BadgeArtworkName = keyof typeof BADGE_ARTWORK;

/** Decorative page-hero artwork. */
export const BACKDROPS = {
  wave: 'backgrounds/bg_wave.svg',
  dots: 'backgrounds/bg_dots.svg',
  gradient: 'backgrounds/bg_gradient.svg',
} as const;

export type BackdropName = keyof typeof BACKDROPS;

/**
 * The favicon, installed through Next's `metadata.icons` convention rather
 * than referenced by a component.
 */
export const FAVICON = 'branding/favicon.svg' as const;

/** Every file the synchronizer copies and the contract test checks. */
export const SERVED_ASSETS: readonly string[] = [
  ...Object.values(NAV_ICONS),
  ...Object.values(ILLUSTRATIONS),
  ...Object.values(BACKDROPS),
  ...Object.values(BADGE_ARTWORK),
  FAVICON,
];

/** The public URL for a served asset. Never built from caller input. */
export const assetUrl = (file: string): string => `${ASSET_BASE}/${file}`;
