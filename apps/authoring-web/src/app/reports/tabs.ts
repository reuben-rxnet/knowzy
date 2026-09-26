// The Reports section's own navigation.
//
// ONE rail entry, a tab strip inside it — the same shape Governance and
// Administration already use. The approved dashboard draws eight top-level
// sidebar entries; `REPORTING_AND_ANALYTICS_UI_SOURCE_OF_TRUTH.md` §2 records
// why that is not adopted: the shell carries one destination per section, and
// eight reporting entries beside three other sections is a rail nobody reads.
//
// Two of the mockup's eight are deliberately ABSENT here and present as links
// in the dashboard instead: AI Usage & Budgets and the Audit Explorer already
// exist under Governance. A second copy reading the same data through a
// different route is two screens that will disagree within a month.

export const REPORT_TABS = [
  { href: '/reports', labelKey: 'rep.tabDashboard' },
  { href: '/reports/question-pipeline', labelKey: 'rep.tabPipeline' },
  { href: '/reports/generation', labelKey: 'rep.tabGeneration' },
  { href: '/reports/assessments', labelKey: 'rep.tabAssessments' },
  { href: '/reports/filing', labelKey: 'rep.tabFiling' },
  { href: '/reports/sources', labelKey: 'rep.tabSources' },
] as const satisfies readonly {
  readonly href: string;
  readonly labelKey:
    | 'rep.tabDashboard'
    | 'rep.tabPipeline'
    | 'rep.tabGeneration'
    | 'rep.tabAssessments'
    | 'rep.tabFiling'
    | 'rep.tabSources';
}[];
