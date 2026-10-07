// The Administration section's own navigation.
//
// Same reasoning as `governance/tabs.ts`: the shell's rail carries ONE
// destination per section, so a section with two screens needs a tab strip
// rather than a second rail entry. Declared once so the strip cannot disagree
// with itself from page to page.

export const ADMINISTRATION_TABS = [
  { href: '/administration/taxonomy', labelKey: 'admin.tabTaxonomy' },
  { href: '/administration/providers', labelKey: 'admin.tabProviders' },
  { href: '/administration/competencies', labelKey: 'admin.tabCompetencies' },
] as const satisfies readonly {
  readonly href: string;
  readonly labelKey: 'admin.tabTaxonomy' | 'admin.tabProviders' | 'admin.tabCompetencies';
}[];
