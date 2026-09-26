// The Governance section's own navigation.
//
// The shell's left-hand rail carries ONE destination per section, so a section
// with two screens needs a tab strip rather than a second rail entry — and the
// alternative, two top-level entries for one concern, is how a navigation grows
// into a list nobody reads.
//
// Declared once, used by every governance screen, so the strip cannot disagree
// with itself from page to page.

export const GOVERNANCE_TABS = [
  { href: '/governance/ai-usage', labelKey: 'gov.tabAiUsage' },
  { href: '/governance/audit', labelKey: 'gov.tabAudit' },
] as const satisfies readonly {
  readonly href: string;
  readonly labelKey: 'gov.tabAiUsage' | 'gov.tabAudit';
}[];
