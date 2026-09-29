// The dry-run report — docs/competencies/COMPETENCY_IMPORT_PLAN.md §6.
//
// Rendered from the plan and nothing else, so it can contain only what the
// plan contains: header labels, sheet names, counts and decisions. The
// privacy test asserts over this text as well as over the plan.

import type { CompetencyImportPlan, FindingSeverity } from './import-plan.js';

const SEVERITY_ORDER: readonly FindingSeverity[] = [
  'BLOCKING',
  'DECISION_REQUIRED',
  'WARNING',
  'INFO',
];

export const formatCompetencyImportReport = (plan: CompetencyImportPlan): string => {
  const lines: string[] = [];
  const s = plan.summary;
  lines.push(`Competency import — ${plan.framework.name} (${plan.framework.code})`);
  lines.push(`Profile ${plan.profileCode}, importer ${plan.importerVersion}`);
  lines.push(`Source ${plan.sourceFileName}, sha256 ${plan.sourceContentSha256}`);
  lines.push('Mode: structure-only. No person row was read; person rows are counted only.');
  lines.push('');
  lines.push('Summary');
  lines.push(`  Sheets inspected ........... ${s.sheetsInspected}`);
  lines.push(`  Categories detected ........ ${s.categoriesDetected}`);
  lines.push(`  Competencies detected ...... ${s.competenciesDetected}`);
  lines.push(`  Aliases proposed ........... ${s.aliasesProposed}`);
  lines.push(
    `  Duplicate definitions ...... ${s.duplicateDefinitions} (header occurrences resolving to a definition already seen)`,
  );
  lines.push(`  Person rows skipped ........ ${s.personRowsSkipped}`);
  lines.push(`  Ambiguities ................ ${s.ambiguities}`);
  lines.push(`  Decisions required ......... ${s.decisionsRequired}`);
  lines.push(
    `  Blocking findings .......... ${s.blocking}${s.blocking > 0 ? '  <- apply will refuse' : ''}`,
  );
  lines.push('');

  lines.push('Sheets');
  for (const sheet of plan.sheets) {
    const rows =
      sheet.personRowsSkipped > 0 ? `, ${sheet.personRowsSkipped} person rows skipped` : '';
    const headers =
      sheet.competencyHeadersRead > 0 ? `, ${sheet.competencyHeadersRead} competency headers` : '';
    lines.push(`  [${sheet.sheetClass}] ${sheet.name}${headers}${rows}`);
    if (sheet.excludedColumns.length > 0) {
      lines.push(`      excluded person columns: ${sheet.excludedColumns.join(' · ')}`);
    }
  }
  lines.push('');

  lines.push('Level scales');
  for (const scale of plan.scales) {
    lines.push(`  ${scale.code} — ${scale.name}`);
    for (const level of scale.levels) {
      const labels =
        level.sourceLabels.length > 0 ? `  [source labels: ${level.sourceLabels.join(' | ')}]` : '';
      lines.push(`      ${level.ordinal} ${level.code.padEnd(10)} ${level.label}${labels}`);
    }
  }
  lines.push('');

  lines.push('Categories and competencies');
  for (const category of plan.categories) {
    lines.push(`  ${category.code} — ${category.name} (${category.kind})`);
    for (const entry of plan.competencies.filter(
      (competency) => competency.categoryCode === category.code,
    )) {
      const aliases = entry.aliases
        .filter((alias) => alias.alias !== entry.name)
        .map(
          (alias) =>
            `${alias.alias} [${alias.decision}${alias.contextCode !== entry.categoryCode ? ` under ${alias.contextCode}` : ''}]`,
        );
      const flag = entry.declared ? '' : '  (UNDECLARED)';
      lines.push(
        `      ${entry.code.padEnd(42)} ${entry.name}${flag}${aliases.length > 0 ? `  <- ${aliases.join(', ')}` : ''}`,
      );
    }
  }
  lines.push('');

  lines.push('Findings');
  for (const severity of SEVERITY_ORDER) {
    const findings = plan.findings.filter((finding) => finding.severity === severity);
    if (findings.length === 0) continue;
    lines.push(`  ${severity} (${findings.length})`);
    for (const finding of findings) {
      const where = [finding.sheetName, finding.cellReference]
        .filter((part) => part !== null)
        .join('!');
      const subject = finding.subjectLabel === null ? '' : ` "${finding.subjectLabel}"`;
      lines.push(
        `    ${finding.code}${where.length > 0 ? ` @ ${where}` : ''}${subject}: ${finding.message}`,
      );
    }
  }
  return lines.join('\n');
};
