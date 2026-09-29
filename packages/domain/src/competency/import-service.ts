// Applying a structure-only competency import plan —
// docs/competencies/COMPETENCY_IMPORT_PLAN.md §6.
//
// One transaction, one audit event, and IDEMPOTENT at every level: the
// framework is matched by code, the version by the file's content hash, every
// definition by its framework-scoped code, every alias by its folded spelling
// in context, and every provenance row by (version, subject, sheet, cell). A
// second apply of the same file therefore creates nothing, and records that as
// a batch with outcome NO_CHANGES -- the attempt happened, and an audit trail
// that omitted it would be wrong about who did what.
//
// What this never does: create a JobRole, a role target, a version approval, or
// anything about a person. The plan has no field that could carry one.
//
// Existing definitions are MATCHED, never updated. Once a catalogue exists, an
// administrator may curate it (a later milestone), and a re-import silently
// reverting their edit would be the importer overruling a person.

import {
  createAuditWriter,
  transactWithAudit,
  type AuditWriter,
  type PrismaClient,
  type TransactionClient,
} from '@knowzy/database';
import type { Clock } from '@knowzy/observability';
import type { CompetencyImportPlan } from './import-plan.js';

export interface CompetencyImportDeps {
  readonly prisma: PrismaClient;
  readonly clock: Clock;
  readonly auditWriter?: AuditWriter;
}

export interface CompetencyImportActor {
  /** Free text from the operator; recorded AS free text. */
  readonly label: string | null;
  readonly correlationId: string;
}

export interface ApplyImportArgs {
  readonly plan: CompetencyImportPlan;
  readonly versionLabel: string;
}

export interface ApplyImportResult {
  readonly batchId: string;
  readonly frameworkVersionId: string;
  readonly outcome: 'APPLIED' | 'NO_CHANGES';
  readonly created: {
    readonly framework: number;
    readonly version: number;
    readonly scales: number;
    readonly levels: number;
    readonly categories: number;
    readonly competencies: number;
    readonly aliases: number;
    readonly provenance: number;
  };
}

export class CompetencyImportError extends Error {
  constructor(
    readonly code:
      'COMPETENCY_IMPORT_BLOCKED' | 'COMPETENCY_VERSION_LABEL_TAKEN' | 'COMPETENCY_IMPORT_INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'CompetencyImportError';
  }
}

const ACTION = 'ADMIN.COMPETENCY.IMPORT_APPLIED' as const;

export const applyCompetencyImportPlan = async (
  deps: CompetencyImportDeps,
  actor: CompetencyImportActor,
  args: ApplyImportArgs,
): Promise<ApplyImportResult> => {
  const { plan } = args;
  const versionLabel = args.versionLabel.trim();
  if (versionLabel.length === 0) {
    throw new CompetencyImportError('COMPETENCY_IMPORT_INVALID', 'A version label is required.');
  }
  const blocking = plan.findings.filter((finding) => finding.severity === 'BLOCKING');
  if (blocking.length > 0) {
    throw new CompetencyImportError(
      'COMPETENCY_IMPORT_BLOCKED',
      `The plan has ${blocking.length} blocking finding(s) and cannot be applied: ` +
        blocking.map((finding) => finding.code).join(', '),
    );
  }

  const startedAt = deps.clock.now();
  const auditWriter = deps.auditWriter ?? createAuditWriter({ clock: deps.clock });

  return transactWithAudit({
    prisma: deps.prisma,
    auditWriter,
    action: ACTION,
    timeoutMs: 60_000,
    work: (tx) => applyInTransaction(tx, actor, plan, versionLabel, startedAt, deps.clock),
    audit: (result) => ({
      action: ACTION,
      outcome: 'SUCCESS' as const,
      actorType: 'SYSTEM' as const,
      actorUserId: null,
      actorDisplayName: 'competency-import command',
      actorRoles: [],
      portal: 'SYSTEM' as const,
      correlationId: actor.correlationId,
      requestId: null,
      entityType: 'CompetencyImportBatch',
      entityId: result.batchId,
      entityLabel: `${plan.framework.code} ${versionLabel}`,
      detail: {
        frameworkCode: plan.framework.code,
        versionLabel,
        profileCode: plan.profileCode,
        outcome: result.outcome,
        categoriesCreated: result.created.categories,
        competenciesCreated: result.created.competencies,
        aliasesCreated: result.created.aliases,
        levelsCreated: result.created.levels,
        provenanceCreated: result.created.provenance,
        findingCount: plan.findings.length,
        personRowsSkipped: plan.summary.personRowsSkipped,
      },
    }),
  });
};

const applyInTransaction = async (
  tx: TransactionClient,
  actor: CompetencyImportActor,
  plan: CompetencyImportPlan,
  versionLabel: string,
  startedAt: Date,
  clock: Clock,
): Promise<ApplyImportResult> => {
  // ------------------------------------------------------------- framework
  let framework = await tx.competencyFramework.findUnique({ where: { code: plan.framework.code } });
  const frameworkCreated = framework === null ? 1 : 0;
  framework ??= await tx.competencyFramework.create({
    data: {
      code: plan.framework.code,
      name: plan.framework.name,
      description: plan.framework.description,
    },
  });
  const frameworkId = framework.id;

  // --------------------------------------------------------------- version
  let version = await tx.competencyFrameworkVersion.findUnique({
    where: {
      frameworkId_sourceContentSha256: {
        frameworkId,
        sourceContentSha256: plan.sourceContentSha256,
      },
    },
  });
  let versionCreated = 0;
  if (version === null) {
    const labelled = await tx.competencyFrameworkVersion.findUnique({
      where: { frameworkId_versionLabel: { frameworkId, versionLabel } },
    });
    if (labelled !== null) {
      throw new CompetencyImportError(
        'COMPETENCY_VERSION_LABEL_TAKEN',
        `Version ${versionLabel} of ${plan.framework.code} already names a different file ` +
          `(${labelled.sourceFileName}). A version label names one file; choose another label.`,
      );
    }
    version = await tx.competencyFrameworkVersion.create({
      data: {
        frameworkId,
        versionLabel,
        sourceFileName: plan.sourceFileName,
        sourceContentSha256: plan.sourceContentSha256,
        importerVersion: plan.importerVersion,
      },
    });
    versionCreated = 1;
  }
  const frameworkVersionId = version.id;

  // ---------------------------------------------------------- scales, levels
  let scalesCreated = 0;
  let levelsCreated = 0;
  const scaleIds = new Map<string, string>();
  const levelIds = new Map<string, string>();
  for (const scale of plan.scales) {
    let row = await tx.competencyLevelScale.findUnique({
      where: { frameworkId_code: { frameworkId, code: scale.code } },
    });
    if (row === null) {
      row = await tx.competencyLevelScale.create({
        data: { frameworkId, code: scale.code, name: scale.name, description: scale.description },
      });
      scalesCreated += 1;
    }
    scaleIds.set(scale.code, row.id);
    for (const level of scale.levels) {
      let levelRow = await tx.competencyLevel.findUnique({
        where: { scaleId_code: { scaleId: row.id, code: level.code } },
      });
      if (levelRow === null) {
        levelRow = await tx.competencyLevel.create({
          data: {
            scaleId: row.id,
            code: level.code,
            label: level.label,
            ordinal: level.ordinal,
            sourceLabels: [...level.sourceLabels],
          },
        });
        levelsCreated += 1;
      } else {
        // The one additive update: a newly seen spelling of a level is
        // appended. A source label is evidence of usage, not curation.
        const known = new Set(levelRow.sourceLabels);
        const added = level.sourceLabels.filter((label) => !known.has(label));
        if (added.length > 0) {
          levelRow = await tx.competencyLevel.update({
            where: { id: levelRow.id },
            data: { sourceLabels: [...levelRow.sourceLabels, ...added] },
          });
        }
      }
      levelIds.set(`${scale.code}\u0000${level.code}`, levelRow.id);
    }
  }

  // ------------------------------------------------------------ categories
  const existingCategories = await tx.competencyCategory.findMany({ where: { frameworkId } });
  const categoryIds = new Map(existingCategories.map((row) => [row.code, row.id]));
  const newCategories = plan.categories.filter((category) => !categoryIds.has(category.code));
  if (newCategories.length > 0) {
    await tx.competencyCategory.createMany({
      data: newCategories.map((category) => ({
        frameworkId,
        code: category.code,
        name: category.name,
        kind: category.kind,
        ordinal: category.ordinal,
      })),
    });
    for (const row of await tx.competencyCategory.findMany({ where: { frameworkId } })) {
      categoryIds.set(row.code, row.id);
    }
  }

  // ---------------------------------------------------------- competencies
  const existingCompetencies = await tx.competency.findMany({ where: { frameworkId } });
  const competencyIds = new Map(existingCompetencies.map((row) => [row.code, row.id]));
  const newCompetencies = plan.competencies.filter((entry) => !competencyIds.has(entry.code));
  for (const entry of newCompetencies) {
    if (!categoryIds.has(entry.categoryCode) || !scaleIds.has(entry.scaleCode)) {
      throw new CompetencyImportError(
        'COMPETENCY_IMPORT_INVALID',
        `Competency ${entry.code} names a category or scale the plan does not define.`,
      );
    }
  }
  if (newCompetencies.length > 0) {
    await tx.competency.createMany({
      data: newCompetencies.map((entry) => ({
        frameworkId,
        categoryId: categoryIds.get(entry.categoryCode) as string,
        levelScaleId: scaleIds.get(entry.scaleCode) as string,
        code: entry.code,
        name: entry.name,
      })),
    });
    for (const row of await tx.competency.findMany({ where: { frameworkId } })) {
      competencyIds.set(row.code, row.id);
    }
  }

  // --------------------------------------------------------------- aliases
  const aliasRows = [
    ...plan.categories.flatMap((category) =>
      category.aliases.map((alias) => ({
        frameworkId,
        subject: 'CATEGORY' as const,
        contextCode: '',
        categoryId: categoryIds.get(category.code) as string,
        competencyId: null,
        alias: alias.alias,
        foldedAlias: alias.foldedAlias,
        decision: alias.decision,
        note: alias.note,
      })),
    ),
    ...plan.competencies.flatMap((entry) =>
      entry.aliases.map((alias) => ({
        frameworkId,
        subject: 'COMPETENCY' as const,
        contextCode: alias.contextCode,
        // The category the spelling APPEARED under, which is its context.
        categoryId: categoryIds.get(alias.contextCode) as string,
        competencyId: competencyIds.get(entry.code) as string,
        alias: alias.alias,
        foldedAlias: alias.foldedAlias,
        decision: alias.decision,
        note: alias.note,
      })),
    ),
  ];
  const aliases =
    aliasRows.length === 0
      ? { count: 0 }
      : await tx.competencyAlias.createMany({ data: aliasRows, skipDuplicates: true });

  // ----------------------------------------------------------------- batch
  const batch = await tx.competencyImportBatch.create({
    data: {
      frameworkVersionId,
      // Decided below, once the provenance count is known; APPLIED until then.
      outcome: 'APPLIED',
      profileCode: plan.profileCode,
      importerVersion: plan.importerVersion,
      sourceFileName: plan.sourceFileName,
      sourceContentSha256: plan.sourceContentSha256,
      actorLabel: actor.label,
      correlationId: actor.correlationId,
      startedAt,
      completedAt: startedAt,
    },
  });

  // ------------------------------------------------------------ provenance
  const provenanceRows = [
    ...plan.categories.flatMap((category) =>
      category.provenance.map((ref) => ({
        frameworkVersionId,
        batchId: batch.id,
        subject: 'CATEGORY' as const,
        categoryId: categoryIds.get(category.code) as string,
        ...ref,
      })),
    ),
    ...plan.competencies.flatMap((entry) =>
      entry.provenance.map((ref) => ({
        frameworkVersionId,
        batchId: batch.id,
        subject: 'COMPETENCY' as const,
        competencyId: competencyIds.get(entry.code) as string,
        ...ref,
      })),
    ),
    ...plan.scales.flatMap((scale) =>
      scale.levels.flatMap((level) =>
        level.provenance.map((ref) => ({
          frameworkVersionId,
          batchId: batch.id,
          subject: 'LEVEL' as const,
          levelId: levelIds.get(`${scale.code}\u0000${level.code}`) as string,
          ...ref,
        })),
      ),
    ),
  ];
  const provenance =
    provenanceRows.length === 0
      ? { count: 0 }
      : await tx.competencyImportProvenance.createMany({
          data: provenanceRows,
          skipDuplicates: true,
        });

  if (plan.findings.length > 0) {
    await tx.competencyImportFinding.createMany({
      data: plan.findings.map((finding) => ({ batchId: batch.id, ...finding })),
    });
  }

  const created = {
    framework: frameworkCreated,
    version: versionCreated,
    scales: scalesCreated,
    levels: levelsCreated,
    categories: newCategories.length,
    competencies: newCompetencies.length,
    aliases: aliases.count,
    provenance: provenance.count,
  };
  const outcome = Object.values(created).every((value) => value === 0) ? 'NO_CHANGES' : 'APPLIED';

  await tx.competencyImportBatch.update({
    where: { id: batch.id },
    data: { outcome, completedAt: clock.now(), summary: { ...plan.summary, created } },
  });

  return { batchId: batch.id, frameworkVersionId, outcome, created };
};
