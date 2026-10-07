// Competency administration -- COMPETENCY-M2.
//
// Specification: docs/competencies/COMPETENCY_ADMINISTRATION.md, which was
// written before this file. Read it first; this header only names the rules a
// change here is most likely to break.
//
//   * REFERENCE DEFINITIONS ONLY. Nothing here reads, writes or infers anything
//     about a person. A role target names a ROLE.
//
//   * EVERY WRITE is one transaction holding the change, its audit event and,
//     for a definition, a row in the append-only competency_definition_change.
//     A framework version's editors are READ from that log.
//
//   * A VERSION IS A SNAPSHOT. Its approval covers `definitionsSha256`, and the
//     hash is recomputed INSIDE the approving transaction: a definition edited
//     between the screen loading and the click makes the version stale.
//
//   * APPROVAL IS SEPARATED FROM EDITING (decision A3). The service refuses an
//     approver who created or edited the thing, with words; a CHECK in 0016
//     refuses it again for any write that bypasses the service.
//
//   * NOTHING IS DELETED. Deactivation is status RETIRED.

import { transactWithAudit, type TransactionClient } from '@knowzy/database';
import type { ErrorCode } from '@knowzy/shared-types';
import {
  taxonomyActorFields,
  taxonomyWriter,
  type TaxonomyActor,
  type TaxonomyDeps,
} from '../taxonomy/taxonomy-service.js';
import { deriveCodeSegment, foldLabel, isNearMatch } from './fold.js';
import {
  definitionsDigest,
  separationRefusal,
  type FrameworkDefinitions,
} from './definitions-digest.js';
import {
  STRICT_COMPETENCY_SEPARATION,
  type CompetencySeparation,
} from '../review/separation-settings.js';

export interface CompetencyAdminDeps extends TaxonomyDeps {
  /**
   * The separation settings in force (Authoring Role Simplification). ABSENT
   * MEANS STRICT: a caller that forgets to load them gets the separated
   * behaviour, never the permissive one. The editors are recorded either way.
   */
  readonly separation?: CompetencySeparation;
}
export type CompetencyAdminActor = TaxonomyActor;

/** A refusal carrying the API code. The service owns the wording. */
export class CompetencyAdminError extends Error {
  constructor(
    readonly code: ErrorCode,
    detail: string,
  ) {
    super(detail);
    this.name = 'CompetencyAdminError';
  }
}

/** The closed list of "domains" (decision A1): the category kinds. */
export const COMPETENCY_DOMAINS = [
  'PRODUCT_KNOWLEDGE',
  'FUNCTIONAL_DOMAIN',
  'TECHNICAL',
  'PROCESS',
  'AGILE_PRACTICE',
  'POWER_SKILL',
] as const;
export type CompetencyDomain = (typeof COMPETENCY_DOMAINS)[number];

/** Decisions a person may choose for an alias. UNDECLARED is the importer's. */
export const ADMIN_ALIAS_DECISIONS = [
  'EXACT',
  'CASE_OR_SPACING',
  'SPELLING_CORRECTION',
  'ABBREVIATION',
  'CATEGORY_QUALIFIED',
  'PROVISIONAL',
] as const;
export type AdminAliasDecision = (typeof ADMIN_ALIAS_DECISIONS)[number];

type Status = 'ACTIVE' | 'RETIRED';

// ---------------------------------------------------------------------------
// Normalization

const NAME_MAX = 200;
const TEXT_MAX = 2_000;
const REFERENCE_MIN = 3;

const text = (input: string | null | undefined, what: string, max = TEXT_MAX): string | null => {
  if (input === null || input === undefined) return null;
  const value = input.trim();
  if (value.length === 0) return null;
  if (value.length > max) {
    throw new CompetencyAdminError(
      'VALIDATION_FAILED',
      `${what} may be at most ${max} characters.`,
    );
  }
  return value;
};

const requiredName = (input: string, what: string): string => {
  const value = input.trim().replace(/\s+/g, ' ');
  if (value.length < 2 || value.length > NAME_MAX) {
    throw new CompetencyAdminError(
      'VALIDATION_FAILED',
      `${what} must be between 2 and ${NAME_MAX} characters.`,
    );
  }
  return value;
};

const requiredText = (input: string | null | undefined, what: string, min: number): string => {
  const value = text(input, what);
  if (value === null || value.length < min) {
    throw new CompetencyAdminError(
      'VALIDATION_FAILED',
      `${what} is required (at least ${min} characters).`,
    );
  }
  return value;
};

/** A category code or competency code segment: upper snake case. */
const codePart = (input: string, what: string): string => {
  const code = input
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  if (!/^[A-Z0-9_]{2,60}$/.test(code)) {
    throw new CompetencyAdminError(
      'VALIDATION_FAILED',
      `${what} may contain only letters, digits and underscores, 2 to 60 characters.`,
    );
  }
  return code;
};

const isDomain = (value: string): value is CompetencyDomain =>
  (COMPETENCY_DOMAINS as readonly string[]).includes(value);

const isAliasDecision = (value: string): value is AdminAliasDecision =>
  (ADMIN_ALIAS_DECISIONS as readonly string[]).includes(value);

const parseDate = (input: string | null | undefined): Date | null => {
  if (input === null || input === undefined || input.trim().length === 0) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.trim())) {
    throw new CompetencyAdminError('VALIDATION_FAILED', 'A date must be written YYYY-MM-DD.');
  }
  const date = new Date(`${input.trim()}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new CompetencyAdminError('VALIDATION_FAILED', 'That date does not exist.');
  }
  return date;
};

// ---------------------------------------------------------------------------
// Shared helpers

const notFound = (what: string): CompetencyAdminError =>
  new CompetencyAdminError('NOT_FOUND', `No ${what} with that id exists.`);

/** Read every definition of a framework in the shape the digest takes. */
export const readFrameworkDefinitions = async (
  db: TransactionClient,
  frameworkId: string,
): Promise<FrameworkDefinitions> => {
  const framework = await db.competencyFramework.findUnique({
    where: { id: frameworkId },
    select: { code: true },
  });
  if (framework === null) throw notFound('framework');
  const [scales, categories, competencies, aliases] = await Promise.all([
    db.competencyLevelScale.findMany({
      where: { frameworkId },
      select: {
        code: true,
        name: true,
        levels: { select: { code: true, label: true, ordinal: true } },
      },
    }),
    db.competencyCategory.findMany({
      where: { frameworkId },
      select: { code: true, name: true, kind: true, ordinal: true, status: true },
    }),
    db.competency.findMany({
      where: { frameworkId },
      select: {
        code: true,
        name: true,
        description: true,
        status: true,
        category: { select: { code: true } },
        levelScale: { select: { code: true } },
      },
    }),
    db.competencyAlias.findMany({
      where: { frameworkId },
      select: {
        subject: true,
        contextCode: true,
        foldedAlias: true,
        alias: true,
        decision: true,
        status: true,
        category: { select: { code: true } },
        competency: { select: { code: true } },
      },
    }),
  ]);
  return {
    frameworkCode: framework.code,
    scales,
    categories,
    competencies: competencies.map((row) => ({
      code: row.code,
      name: row.name,
      description: row.description,
      categoryCode: row.category.code,
      scaleCode: row.levelScale.code,
      status: row.status,
    })),
    aliases: aliases.map((row) => ({
      subject: row.subject,
      contextCode: row.contextCode,
      foldedAlias: row.foldedAlias,
      alias: row.alias,
      targetCode: row.competency?.code ?? row.category?.code ?? '',
      decision: row.decision,
      status: row.status,
    })),
  };
};

/**
 * The people who changed a framework's definitions since a moment (exclusive).
 * Null `since` means "ever".
 */
export const editorsSince = async (
  db: TransactionClient,
  frameworkId: string,
  since: Date | null,
): Promise<string[]> => {
  const rows = await db.competencyDefinitionChange.findMany({
    where: { frameworkId, ...(since === null ? {} : { createdAt: { gt: since } }) },
    select: { actorUserId: true },
    distinct: ['actorUserId'],
  });
  return rows.map((row) => row.actorUserId);
};

/**
 * Snapshot a framework for a new version: its definitions hash, and the
 * editors since the previous version was created. Used by this service and by
 * the importer, so an imported version and an administration version are
 * judged by one rule.
 */
export const snapshotFramework = async (
  db: TransactionClient,
  frameworkId: string,
  excludeVersionId?: string,
): Promise<{ readonly definitionsSha256: string; readonly editorUserIds: string[] }> => {
  const previous = await db.competencyFrameworkVersion.findFirst({
    where: {
      frameworkId,
      ...(excludeVersionId === undefined ? {} : { id: { not: excludeVersionId } }),
    },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  return {
    definitionsSha256: definitionsDigest(await readFrameworkDefinitions(db, frameworkId)),
    editorUserIds: await editorsSince(db, frameworkId, previous?.createdAt ?? null),
  };
};

const logChange = async (
  tx: TransactionClient,
  args: {
    readonly frameworkId: string;
    readonly subject: 'CATEGORY' | 'COMPETENCY' | 'ALIAS';
    readonly subjectId: string;
    readonly action: 'CREATED' | 'UPDATED';
    readonly actorUserId: string;
    readonly changedFields: readonly string[];
    readonly previousValue: Record<string, unknown> | null;
    readonly newValue: Record<string, unknown>;
  },
): Promise<void> => {
  await tx.competencyDefinitionChange.create({
    data: {
      frameworkId: args.frameworkId,
      subject: args.subject,
      subjectId: args.subjectId,
      action: args.action,
      actorUserId: args.actorUserId,
      changedFields: [...args.changedFields],
      ...(args.previousValue === null ? {} : { previousValue: args.previousValue as object }),
      newValue: args.newValue as object,
    },
  });
};

const audited = <T>(
  deps: CompetencyAdminDeps,
  actor: CompetencyAdminActor,
  action: string,
  work: (tx: TransactionClient) => Promise<T>,
  entry: (result: T) => {
    readonly entityType: string;
    readonly entityId: string;
    readonly entityLabel: string;
    readonly detail: Record<string, unknown>;
    readonly previousValue?: Record<string, unknown>;
    readonly newValue?: Record<string, unknown>;
  },
): Promise<T> =>
  transactWithAudit({
    prisma: deps.prisma,
    auditWriter: taxonomyWriter(deps),
    action: action as never,
    work,
    audit: (result) => ({
      ...taxonomyActorFields(actor),
      actorType: 'USER' as const,
      action: action as never,
      outcome: 'SUCCESS' as const,
      ...entry(result),
    }),
  });

const displayNames = async (
  deps: CompetencyAdminDeps,
  ids: readonly (string | null)[],
): Promise<Map<string, string>> => {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
  if (wanted.length === 0) return new Map();
  const users = await deps.prisma.user.findMany({
    where: { id: { in: wanted } },
    select: { id: true, displayName: true },
  });
  return new Map(users.map((user) => [user.id, user.displayName]));
};

// ---------------------------------------------------------------------------
// Read

export interface CatalogueVersion {
  readonly versionId: string;
  readonly versionLabel: string;
  readonly origin: 'IMPORT' | 'ADMINISTRATION';
  readonly status: 'DRAFT' | 'APPROVED' | 'SUPERSEDED';
  readonly sourceFileName: string;
  readonly definitionsSha256: string | null;
  /** True when the framework's definitions no longer hash to this version. */
  readonly stale: boolean;
  readonly createdAt: string;
  readonly createdBy: string | null;
  readonly editors: readonly { readonly userId: string; readonly displayName: string }[];
  readonly approvedAt: string | null;
  readonly approvedBy: string | null;
  readonly approvalReference: string | null;
  readonly effectiveFrom: string | null;
}

export interface CatalogueFramework {
  readonly frameworkId: string;
  readonly code: string;
  readonly name: string;
  readonly currentDefinitionsSha256: string;
  readonly hasApprovedVersion: boolean;
  readonly versions: readonly CatalogueVersion[];
  readonly scales: readonly {
    readonly scaleId: string;
    readonly code: string;
    readonly name: string;
    readonly levels: readonly {
      readonly levelId: string;
      readonly code: string;
      readonly label: string;
      readonly ordinal: number;
    }[];
  }[];
  readonly categories: readonly {
    readonly categoryId: string;
    readonly code: string;
    readonly name: string;
    readonly kind: CompetencyDomain;
    readonly status: Status;
    readonly competencyCount: number;
  }[];
  readonly competencies: readonly {
    readonly competencyId: string;
    readonly code: string;
    readonly name: string;
    readonly description: string | null;
    readonly status: Status;
    readonly categoryId: string;
    readonly categoryCode: string;
    readonly kind: CompetencyDomain;
    readonly scaleCode: string;
    readonly aliasCount: number;
    readonly targetCount: number;
  }[];
  readonly aliases: readonly {
    readonly aliasId: string;
    readonly subject: 'CATEGORY' | 'COMPETENCY';
    readonly alias: string;
    readonly targetCode: string;
    readonly targetName: string;
    readonly decision: string;
    readonly note: string | null;
    readonly status: Status;
  }[];
  readonly domains: readonly {
    readonly kind: CompetencyDomain;
    readonly categoryCount: number;
    readonly competencyCount: number;
    readonly activeCompetencyCount: number;
  }[];
  readonly recentChanges: readonly {
    readonly subject: string;
    readonly action: string;
    readonly changedFields: readonly string[];
    readonly label: string;
    readonly actor: string;
    readonly at: string;
  }[];
}

export const readCompetencyCatalogue = async (
  deps: CompetencyAdminDeps,
): Promise<readonly CatalogueFramework[]> => {
  const frameworks = await deps.prisma.competencyFramework.findMany({
    orderBy: { code: 'asc' },
    select: { id: true, code: true, name: true },
  });
  const out: CatalogueFramework[] = [];
  for (const framework of frameworks) {
    const db = deps.prisma as unknown as TransactionClient;
    const [definitions, versions, scales, categories, competencies, aliases, changes] =
      await Promise.all([
        readFrameworkDefinitions(db, framework.id),
        deps.prisma.competencyFrameworkVersion.findMany({
          where: { frameworkId: framework.id },
          orderBy: { createdAt: 'desc' },
        }),
        deps.prisma.competencyLevelScale.findMany({
          where: { frameworkId: framework.id },
          orderBy: { code: 'asc' },
          select: {
            id: true,
            code: true,
            name: true,
            levels: {
              orderBy: { ordinal: 'asc' },
              select: { id: true, code: true, label: true, ordinal: true },
            },
          },
        }),
        deps.prisma.competencyCategory.findMany({
          where: { frameworkId: framework.id },
          orderBy: [{ ordinal: 'asc' }, { code: 'asc' }],
          select: {
            id: true,
            code: true,
            name: true,
            kind: true,
            status: true,
            _count: { select: { competencies: true } },
          },
        }),
        deps.prisma.competency.findMany({
          where: { frameworkId: framework.id },
          orderBy: { code: 'asc' },
          select: {
            id: true,
            code: true,
            name: true,
            description: true,
            status: true,
            categoryId: true,
            category: { select: { code: true, kind: true } },
            levelScale: { select: { code: true } },
            _count: { select: { aliases: true, expectations: true } },
          },
        }),
        deps.prisma.competencyAlias.findMany({
          where: { frameworkId: framework.id },
          orderBy: [{ subject: 'asc' }, { foldedAlias: 'asc' }],
          select: {
            id: true,
            subject: true,
            alias: true,
            decision: true,
            note: true,
            status: true,
            category: { select: { code: true, name: true } },
            competency: { select: { code: true, name: true } },
          },
        }),
        deps.prisma.competencyDefinitionChange.findMany({
          where: { frameworkId: framework.id },
          orderBy: { createdAt: 'desc' },
          take: 15,
        }),
      ]);

    const names = await displayNames(deps, [
      ...versions.flatMap((version) => [
        version.createdByUserId,
        version.approvedByUserId,
        ...(version.editorUserIds ?? []),
      ]),
      ...changes.map((change) => change.actorUserId),
    ]);
    const nameOf = (id: string | null): string | null =>
      id === null ? null : (names.get(id) ?? null);
    const current = definitionsDigest(definitions);

    const labelOf = (subject: string, subjectId: string): string => {
      if (subject === 'CATEGORY') {
        return categories.find((row) => row.id === subjectId)?.code ?? subjectId;
      }
      if (subject === 'COMPETENCY') {
        return competencies.find((row) => row.id === subjectId)?.code ?? subjectId;
      }
      return aliases.find((row) => row.id === subjectId)?.alias ?? subjectId;
    };

    out.push({
      frameworkId: framework.id,
      code: framework.code,
      name: framework.name,
      currentDefinitionsSha256: current,
      hasApprovedVersion: versions.some((version) => version.status === 'APPROVED'),
      versions: versions.map((version) => ({
        versionId: version.id,
        versionLabel: version.versionLabel,
        origin: version.origin,
        status: version.status,
        sourceFileName: version.sourceFileName,
        definitionsSha256: version.definitionsSha256,
        stale: version.status === 'DRAFT' && version.definitionsSha256 !== current,
        createdAt: version.createdAt.toISOString(),
        createdBy: nameOf(version.createdByUserId),
        editors: (version.editorUserIds ?? []).map((userId) => ({
          userId,
          displayName: names.get(userId) ?? userId,
        })),
        approvedAt: version.approvedAt?.toISOString() ?? null,
        approvedBy: nameOf(version.approvedByUserId),
        approvalReference: version.approvalReference,
        effectiveFrom: version.effectiveFrom?.toISOString().slice(0, 10) ?? null,
      })),
      scales: scales.map((scale) => ({
        scaleId: scale.id,
        code: scale.code,
        name: scale.name,
        levels: scale.levels.map((level) => ({
          levelId: level.id,
          code: level.code,
          label: level.label,
          ordinal: level.ordinal,
        })),
      })),
      categories: categories.map((row) => ({
        categoryId: row.id,
        code: row.code,
        name: row.name,
        kind: row.kind,
        status: row.status,
        competencyCount: row._count.competencies,
      })),
      competencies: competencies.map((row) => ({
        competencyId: row.id,
        code: row.code,
        name: row.name,
        description: row.description,
        status: row.status,
        categoryId: row.categoryId,
        categoryCode: row.category.code,
        kind: row.category.kind,
        scaleCode: row.levelScale.code,
        aliasCount: row._count.aliases,
        targetCount: row._count.expectations,
      })),
      aliases: aliases.map((row) => ({
        aliasId: row.id,
        subject: row.subject,
        alias: row.alias,
        targetCode: row.competency?.code ?? row.category?.code ?? '',
        targetName: row.competency?.name ?? row.category?.name ?? '',
        decision: row.decision,
        note: row.note,
        status: row.status,
      })),
      domains: COMPETENCY_DOMAINS.map((kind) => {
        const inKind = competencies.filter((row) => row.category.kind === kind);
        return {
          kind,
          categoryCount: categories.filter((row) => row.kind === kind).length,
          competencyCount: inKind.length,
          activeCompetencyCount: inKind.filter((row) => row.status === 'ACTIVE').length,
        };
      }),
      recentChanges: changes.map((change) => ({
        subject: change.subject,
        action: change.action,
        changedFields: change.changedFields ?? [],
        label: labelOf(change.subject, change.subjectId),
        actor: names.get(change.actorUserId) ?? change.actorUserId,
        at: change.createdAt.toISOString(),
      })),
    });
  }
  return out;
};

// ---------------------------------------------------------------------------
// Categories

export interface CreateCategoryArgs {
  readonly frameworkId: string;
  readonly code: string;
  readonly name: string;
  readonly kind: string;
}

const categoryValue = (row: { code: string; name: string; kind: string; status: string }) => ({
  code: row.code,
  name: row.name,
  kind: row.kind,
  status: row.status,
});

export const createCompetencyCategory = async (
  deps: CompetencyAdminDeps,
  actor: CompetencyAdminActor,
  args: CreateCategoryArgs,
) => {
  const code = codePart(args.code, 'A category code');
  const name = requiredName(args.name, 'A category name');
  if (!isDomain(args.kind)) {
    throw new CompetencyAdminError('VALIDATION_FAILED', 'Choose one of the listed domains.');
  }
  const kind = args.kind;
  const framework = await deps.prisma.competencyFramework.findUnique({
    where: { id: args.frameworkId },
    select: { id: true, code: true },
  });
  if (framework === null) throw notFound('framework');

  const existing = await deps.prisma.competencyCategory.findMany({
    where: { frameworkId: framework.id },
    select: { code: true, name: true, ordinal: true },
  });
  if (existing.some((row) => row.code === code)) {
    throw new CompetencyAdminError(
      'COMPETENCY_DUPLICATE',
      `A category with the code ${code} already exists in ${framework.code}.`,
    );
  }
  const clash = existing.find((row) => foldLabel(row.name) === foldLabel(name));
  if (clash !== undefined) {
    throw new CompetencyAdminError(
      'COMPETENCY_DUPLICATE',
      `The category ${clash.code} is already called "${clash.name}".`,
    );
  }
  const ordinal = existing.reduce((max, row) => Math.max(max, row.ordinal), 0) + 1;

  return audited(
    deps,
    actor,
    'ADMIN.COMPETENCY.CATEGORY_CREATED',
    async (tx) => {
      const row = await tx.competencyCategory.create({
        data: { frameworkId: framework.id, code, name, kind, ordinal },
      });
      await logChange(tx, {
        frameworkId: framework.id,
        subject: 'CATEGORY',
        subjectId: row.id,
        action: 'CREATED',
        actorUserId: actor.userId,
        changedFields: [],
        previousValue: null,
        newValue: categoryValue(row),
      });
      return row;
    },
    (row) => ({
      entityType: 'CompetencyCategory',
      entityId: row.id,
      entityLabel: `${framework.code} ${row.code} — ${row.name}`,
      detail: { frameworkCode: framework.code, ...categoryValue(row), changedFields: [] },
    }),
  );
};

export interface UpdateCategoryArgs {
  readonly categoryId: string;
  readonly name?: string;
  readonly kind?: string;
  readonly status?: Status;
}

export const updateCompetencyCategory = async (
  deps: CompetencyAdminDeps,
  actor: CompetencyAdminActor,
  args: UpdateCategoryArgs,
) => {
  const current = await deps.prisma.competencyCategory.findUnique({
    where: { id: args.categoryId },
    include: { framework: { select: { code: true } } },
  });
  if (current === null) throw notFound('category');

  const data: Record<string, unknown> = {};
  const changedFields: string[] = [];
  if (args.name !== undefined) {
    const name = requiredName(args.name, 'A category name');
    if (name !== current.name) {
      const others = await deps.prisma.competencyCategory.findMany({
        where: { frameworkId: current.frameworkId, id: { not: current.id } },
        select: { code: true, name: true },
      });
      const clash = others.find((row) => foldLabel(row.name) === foldLabel(name));
      if (clash !== undefined) {
        throw new CompetencyAdminError(
          'COMPETENCY_DUPLICATE',
          `The category ${clash.code} is already called "${clash.name}".`,
        );
      }
      data['name'] = name;
      changedFields.push('name');
    }
  }
  if (args.kind !== undefined && args.kind !== current.kind) {
    if (!isDomain(args.kind)) {
      throw new CompetencyAdminError('VALIDATION_FAILED', 'Choose one of the listed domains.');
    }
    data['kind'] = args.kind;
    changedFields.push('kind');
  }
  if (args.status !== undefined && args.status !== current.status) {
    data['status'] = args.status;
    changedFields.push('status');
  }
  if (changedFields.length === 0) return current;

  return audited(
    deps,
    actor,
    'ADMIN.COMPETENCY.CATEGORY_UPDATED',
    async (tx) => {
      const row = await tx.competencyCategory.update({ where: { id: current.id }, data });
      await logChange(tx, {
        frameworkId: current.frameworkId,
        subject: 'CATEGORY',
        subjectId: row.id,
        action: 'UPDATED',
        actorUserId: actor.userId,
        changedFields,
        previousValue: categoryValue(current),
        newValue: categoryValue(row),
      });
      return row;
    },
    (row) => ({
      entityType: 'CompetencyCategory',
      entityId: row.id,
      entityLabel: `${current.framework.code} ${row.code} — ${row.name}`,
      previousValue: categoryValue(current),
      newValue: categoryValue(row),
      detail: { frameworkCode: current.framework.code, ...categoryValue(row), changedFields },
    }),
  );
};

// ---------------------------------------------------------------------------
// Competencies

export interface CreateCompetencyArgs {
  readonly categoryId: string;
  readonly name: string;
  /** Optional; derived from the name when absent. */
  readonly codeSegment?: string | null;
  readonly levelScaleId: string;
  readonly description?: string | null;
  /** Set when the administrator confirmed a near match is a different competency. */
  readonly confirmDistinct?: boolean;
}

const competencyValue = (row: {
  code: string;
  name: string;
  description: string | null;
  status: string;
}) => ({ code: row.code, name: row.name, description: row.description, status: row.status });

export const createCompetency = async (
  deps: CompetencyAdminDeps,
  actor: CompetencyAdminActor,
  args: CreateCompetencyArgs,
) => {
  const name = requiredName(args.name, 'A competency name');
  const description = text(args.description, 'A description');
  const category = await deps.prisma.competencyCategory.findUnique({
    where: { id: args.categoryId },
    include: { framework: { select: { id: true, code: true } } },
  });
  if (category === null) throw notFound('category');
  if (category.status !== 'ACTIVE') {
    throw new CompetencyAdminError(
      'COMPETENCY_INACTIVE',
      `The category ${category.code} is retired, so it accepts no new competency. Reactivate it first.`,
    );
  }
  const scale = await deps.prisma.competencyLevelScale.findUnique({
    where: { id: args.levelScaleId },
    select: { id: true, frameworkId: true },
  });
  if (scale === null || scale.frameworkId !== category.frameworkId) {
    throw new CompetencyAdminError(
      'VALIDATION_FAILED',
      'Choose a level scale that belongs to the same framework.',
    );
  }
  const segmentInput =
    args.codeSegment === null || args.codeSegment === undefined || args.codeSegment.trim() === ''
      ? deriveCodeSegment(name)
      : args.codeSegment;
  const code = `${category.code}.${codePart(segmentInput, 'A competency code')}`;

  const siblings = await deps.prisma.competency.findMany({
    where: { frameworkId: category.frameworkId },
    select: { code: true, name: true, categoryId: true },
  });
  if (siblings.some((row) => row.code === code)) {
    throw new CompetencyAdminError(
      'COMPETENCY_DUPLICATE',
      `A competency with the code ${code} already exists.`,
    );
  }
  const folded = foldLabel(name);
  const inCategory = siblings.filter((row) => row.categoryId === category.id);
  const same = inCategory.find((row) => foldLabel(row.name) === folded);
  if (same !== undefined) {
    throw new CompetencyAdminError(
      'COMPETENCY_DUPLICATE',
      `${same.code} is already called "${same.name}" in this category.`,
    );
  }
  const near = inCategory.find((row) => isNearMatch(foldLabel(row.name), folded));
  if (near !== undefined && args.confirmDistinct !== true) {
    throw new CompetencyAdminError(
      'COMPETENCY_NEAR_MATCH',
      `"${name}" is very close to ${near.code} ("${near.name}"). If it is a different ` +
        'competency, tick "This is a different competency" and save again; if it is a ' +
        'spelling of the same one, add an alias instead.',
    );
  }

  return audited(
    deps,
    actor,
    'ADMIN.COMPETENCY.COMPETENCY_CREATED',
    async (tx) => {
      const row = await tx.competency.create({
        data: {
          frameworkId: category.frameworkId,
          categoryId: category.id,
          levelScaleId: scale.id,
          code,
          name,
          description,
        },
      });
      await logChange(tx, {
        frameworkId: category.frameworkId,
        subject: 'COMPETENCY',
        subjectId: row.id,
        action: 'CREATED',
        actorUserId: actor.userId,
        changedFields: [],
        previousValue: null,
        newValue: competencyValue(row),
      });
      return row;
    },
    (row) => ({
      entityType: 'Competency',
      entityId: row.id,
      entityLabel: `${category.framework.code} ${row.code} — ${row.name}`,
      detail: {
        frameworkCode: category.framework.code,
        code: row.code,
        name: row.name,
        status: row.status,
        changedFields: [],
      },
    }),
  );
};

export interface UpdateCompetencyArgs {
  readonly competencyId: string;
  readonly name?: string;
  readonly description?: string | null;
  readonly status?: Status;
}

export const updateCompetency = async (
  deps: CompetencyAdminDeps,
  actor: CompetencyAdminActor,
  args: UpdateCompetencyArgs,
) => {
  const current = await deps.prisma.competency.findUnique({
    where: { id: args.competencyId },
    include: { framework: { select: { code: true } } },
  });
  if (current === null) throw notFound('competency');

  const data: Record<string, unknown> = {};
  const changedFields: string[] = [];
  if (args.name !== undefined) {
    const name = requiredName(args.name, 'A competency name');
    if (name !== current.name) {
      const same = await deps.prisma.competency.findMany({
        where: { categoryId: current.categoryId, id: { not: current.id } },
        select: { code: true, name: true },
      });
      const clash = same.find((row) => foldLabel(row.name) === foldLabel(name));
      if (clash !== undefined) {
        throw new CompetencyAdminError(
          'COMPETENCY_DUPLICATE',
          `${clash.code} is already called "${clash.name}" in this category.`,
        );
      }
      data['name'] = name;
      changedFields.push('name');
    }
  }
  if (args.description !== undefined) {
    const description = text(args.description, 'A description');
    if (description !== current.description) {
      data['description'] = description;
      changedFields.push('description');
    }
  }
  if (args.status !== undefined && args.status !== current.status) {
    if (args.status === 'ACTIVE') {
      const category = await deps.prisma.competencyCategory.findUnique({
        where: { id: current.categoryId },
        select: { code: true, status: true },
      });
      if (category?.status !== 'ACTIVE') {
        throw new CompetencyAdminError(
          'COMPETENCY_INACTIVE',
          `Its category ${category?.code ?? ''} is retired. Reactivate the category first.`,
        );
      }
    }
    data['status'] = args.status;
    changedFields.push('status');
  }
  if (changedFields.length === 0) return current;

  return audited(
    deps,
    actor,
    'ADMIN.COMPETENCY.COMPETENCY_UPDATED',
    async (tx) => {
      const row = await tx.competency.update({ where: { id: current.id }, data });
      await logChange(tx, {
        frameworkId: current.frameworkId,
        subject: 'COMPETENCY',
        subjectId: row.id,
        action: 'UPDATED',
        actorUserId: actor.userId,
        changedFields,
        previousValue: competencyValue(current),
        newValue: competencyValue(row),
      });
      return row;
    },
    (row) => ({
      entityType: 'Competency',
      entityId: row.id,
      entityLabel: `${current.framework.code} ${row.code} — ${row.name}`,
      previousValue: competencyValue(current),
      newValue: competencyValue(row),
      detail: {
        frameworkCode: current.framework.code,
        code: row.code,
        name: row.name,
        status: row.status,
        changedFields,
      },
    }),
  );
};

// ---------------------------------------------------------------------------
// Aliases

export interface CreateAliasArgs {
  readonly subject: 'CATEGORY' | 'COMPETENCY';
  /** The category id for a CATEGORY alias, the competency id otherwise. */
  readonly targetId: string;
  readonly alias: string;
  readonly decision: string;
  readonly note?: string | null;
}

const aliasValue = (row: {
  subject: string;
  contextCode: string;
  alias: string;
  decision: string;
  note: string | null;
  status: string;
}) => ({
  subject: row.subject,
  contextCode: row.contextCode,
  alias: row.alias,
  decision: row.decision,
  note: row.note,
  status: row.status,
});

const aliasDetail = (frameworkCode: string, row: Parameters<typeof aliasValue>[0]) => ({
  frameworkCode,
  subject: row.subject,
  contextCode: row.contextCode,
  alias: row.alias,
  decision: row.decision,
  status: row.status,
});

export const createCompetencyAlias = async (
  deps: CompetencyAdminDeps,
  actor: CompetencyAdminActor,
  args: CreateAliasArgs,
) => {
  const alias = requiredName(args.alias, 'An alias');
  const foldedAlias = foldLabel(alias);
  if (foldedAlias.length === 0) {
    throw new CompetencyAdminError(
      'VALIDATION_FAILED',
      'An alias needs at least one letter or digit.',
    );
  }
  if (!isAliasDecision(args.decision)) {
    throw new CompetencyAdminError(
      'VALIDATION_FAILED',
      'Choose one of the listed decisions. UNDECLARED is reserved for the importer.',
    );
  }
  const decision = args.decision;
  const note = text(args.note, 'A note');

  let target: {
    frameworkId: string;
    frameworkCode: string;
    categoryId: string;
    competencyId: string | null;
    contextCode: string;
  };
  if (args.subject === 'CATEGORY') {
    const category = await deps.prisma.competencyCategory.findUnique({
      where: { id: args.targetId },
      include: { framework: { select: { code: true } } },
    });
    if (category === null) throw notFound('category');
    target = {
      frameworkId: category.frameworkId,
      frameworkCode: category.framework.code,
      categoryId: category.id,
      competencyId: null,
      contextCode: '',
    };
  } else {
    const competency = await deps.prisma.competency.findUnique({
      where: { id: args.targetId },
      include: { framework: { select: { code: true } }, category: { select: { code: true } } },
    });
    if (competency === null) throw notFound('competency');
    target = {
      frameworkId: competency.frameworkId,
      frameworkCode: competency.framework.code,
      categoryId: competency.categoryId,
      competencyId: competency.id,
      contextCode: competency.category.code,
    };
  }

  const existing = await deps.prisma.competencyAlias.findUnique({
    where: {
      frameworkId_subject_contextCode_foldedAlias: {
        frameworkId: target.frameworkId,
        subject: args.subject,
        contextCode: target.contextCode,
        foldedAlias,
      },
    },
    select: { alias: true, status: true },
  });
  if (existing !== null) {
    throw new CompetencyAdminError(
      'COMPETENCY_DUPLICATE',
      `The alias "${existing.alias}" already exists here` +
        (existing.status === 'RETIRED' ? ' (deactivated — reactivate it instead).' : '.'),
    );
  }

  return audited(
    deps,
    actor,
    'ADMIN.COMPETENCY.ALIAS_CREATED',
    async (tx) => {
      const row = await tx.competencyAlias.create({
        data: {
          frameworkId: target.frameworkId,
          subject: args.subject,
          contextCode: target.contextCode,
          categoryId: target.categoryId,
          competencyId: target.competencyId,
          alias,
          foldedAlias,
          decision,
          note,
          createdByUserId: actor.userId,
          modifiedByUserId: actor.userId,
        },
      });
      await logChange(tx, {
        frameworkId: target.frameworkId,
        subject: 'ALIAS',
        subjectId: row.id,
        action: 'CREATED',
        actorUserId: actor.userId,
        changedFields: [],
        previousValue: null,
        newValue: aliasValue(row),
      });
      return row;
    },
    (row) => ({
      entityType: 'CompetencyAlias',
      entityId: row.id,
      entityLabel: `${target.frameworkCode} ${row.alias}`,
      detail: { ...aliasDetail(target.frameworkCode, row), changedFields: [] },
    }),
  );
};

export interface UpdateAliasArgs {
  readonly aliasId: string;
  readonly decision?: string;
  readonly note?: string | null;
  readonly status?: Status;
}

export const updateCompetencyAlias = async (
  deps: CompetencyAdminDeps,
  actor: CompetencyAdminActor,
  args: UpdateAliasArgs,
) => {
  const current = await deps.prisma.competencyAlias.findUnique({
    where: { id: args.aliasId },
    include: { framework: { select: { code: true } } },
  });
  if (current === null) throw notFound('alias');

  const data: Record<string, unknown> = { modifiedByUserId: actor.userId };
  const changedFields: string[] = [];
  if (args.decision !== undefined && args.decision !== current.decision) {
    if (!isAliasDecision(args.decision)) {
      throw new CompetencyAdminError(
        'VALIDATION_FAILED',
        'Choose one of the listed decisions. UNDECLARED is reserved for the importer.',
      );
    }
    data['decision'] = args.decision;
    changedFields.push('decision');
  }
  if (args.note !== undefined) {
    const note = text(args.note, 'A note');
    if (note !== current.note) {
      data['note'] = note;
      changedFields.push('note');
    }
  }
  if (args.status !== undefined && args.status !== current.status) {
    data['status'] = args.status;
    changedFields.push('status');
  }
  if (changedFields.length === 0) return current;

  return audited(
    deps,
    actor,
    'ADMIN.COMPETENCY.ALIAS_UPDATED',
    async (tx) => {
      const row = await tx.competencyAlias.update({ where: { id: current.id }, data });
      await logChange(tx, {
        frameworkId: current.frameworkId,
        subject: 'ALIAS',
        subjectId: row.id,
        action: 'UPDATED',
        actorUserId: actor.userId,
        changedFields,
        previousValue: aliasValue(current),
        newValue: aliasValue(row),
      });
      return row;
    },
    (row) => ({
      entityType: 'CompetencyAlias',
      entityId: row.id,
      entityLabel: `${current.framework.code} ${row.alias}`,
      previousValue: aliasValue(current),
      newValue: aliasValue(row),
      detail: { ...aliasDetail(current.framework.code, row), changedFields },
    }),
  );
};

// ---------------------------------------------------------------------------
// Framework versions

export interface CreateVersionArgs {
  readonly frameworkId: string;
  readonly versionLabel: string;
}

export const createFrameworkVersion = async (
  deps: CompetencyAdminDeps,
  actor: CompetencyAdminActor,
  args: CreateVersionArgs,
) => {
  const versionLabel = requiredName(args.versionLabel, 'A version label');
  const framework = await deps.prisma.competencyFramework.findUnique({
    where: { id: args.frameworkId },
    select: { id: true, code: true },
  });
  if (framework === null) throw notFound('framework');

  return audited(
    deps,
    actor,
    'ADMIN.COMPETENCY.VERSION_CREATED',
    async (tx) => {
      const labelled = await tx.competencyFrameworkVersion.findUnique({
        where: { frameworkId_versionLabel: { frameworkId: framework.id, versionLabel } },
        select: { id: true },
      });
      if (labelled !== null) {
        throw new CompetencyAdminError(
          'COMPETENCY_DUPLICATE',
          `${framework.code} already has a version labelled "${versionLabel}".`,
        );
      }
      const snapshot = await snapshotFramework(tx, framework.id);
      const same = await tx.competencyFrameworkVersion.findFirst({
        where: { frameworkId: framework.id, definitionsSha256: snapshot.definitionsSha256 },
        select: { versionLabel: true, status: true },
      });
      if (same !== null) {
        throw new CompetencyAdminError(
          'COMPETENCY_DUPLICATE',
          `Version "${same.versionLabel}" (${same.status}) already captures exactly these ` +
            'definitions. Nothing has changed since, so there is nothing new to version.',
        );
      }
      const editorUserIds = [...new Set([actor.userId, ...snapshot.editorUserIds])];
      return tx.competencyFrameworkVersion.create({
        data: {
          frameworkId: framework.id,
          versionLabel,
          origin: 'ADMINISTRATION',
          sourceFileName: 'Administration snapshot',
          sourceContentSha256: snapshot.definitionsSha256,
          definitionsSha256: snapshot.definitionsSha256,
          importerVersion: 'administration',
          createdByUserId: actor.userId,
          editorUserIds,
        },
      });
    },
    (row) => ({
      entityType: 'CompetencyFrameworkVersion',
      entityId: row.id,
      entityLabel: `${framework.code} ${row.versionLabel}`,
      detail: {
        frameworkCode: framework.code,
        versionLabel: row.versionLabel,
        origin: row.origin,
        definitionsSha256: row.definitionsSha256,
        editorCount: (row.editorUserIds ?? []).length,
        supersededVersionLabel: null,
      },
    }),
  );
};

export interface ApproveVersionArgs {
  readonly versionId: string;
  readonly approvalReference: string;
  readonly effectiveFrom?: string | null;
}

export const approveFrameworkVersion = async (
  deps: CompetencyAdminDeps,
  actor: CompetencyAdminActor,
  args: ApproveVersionArgs,
) => {
  const approvalReference = requiredText(
    args.approvalReference,
    'An approval reference',
    REFERENCE_MIN,
  );
  const effectiveFrom = parseDate(args.effectiveFrom);
  const version = await deps.prisma.competencyFrameworkVersion.findUnique({
    where: { id: args.versionId },
    include: { framework: { select: { code: true } } },
  });
  if (version === null) throw notFound('framework version');
  if (version.status !== 'DRAFT') {
    throw new CompetencyAdminError(
      'STATE_TRANSITION_INVALID',
      `Version ${version.versionLabel} is ${version.status}; only a DRAFT can be approved.`,
    );
  }
  const separation = deps.separation ?? STRICT_COMPETENCY_SEPARATION;
  if (!separation.versionEditorMayApprove) {
    const refusal = separationRefusal({
      approverId: actor.userId,
      createdByUserId: version.createdByUserId,
      editorUserIds: version.editorUserIds ?? [],
      noun: 'version',
    });
    if (refusal !== null) throw new CompetencyAdminError('SEPARATION_OF_DUTIES', refusal);
  }

  let superseded: string | null = null;
  return audited(
    deps,
    actor,
    'ADMIN.COMPETENCY.VERSION_APPROVED',
    async (tx) => {
      // The hash is recomputed HERE, inside the transaction that approves.
      const current = definitionsDigest(await readFrameworkDefinitions(tx, version.frameworkId));
      if (version.definitionsSha256 === null || version.definitionsSha256 !== current) {
        throw new CompetencyAdminError(
          'COMPETENCY_VERSION_STALE',
          `The definitions of ${version.framework.code} have changed since version ` +
            `${version.versionLabel} was drawn up, so approving it would approve something ` +
            'nobody reviewed. Create a new version from the current definitions, and have a ' +
            'different administrator approve that.',
        );
      }
      const previous = await tx.competencyFrameworkVersion.findMany({
        where: { frameworkId: version.frameworkId, status: 'APPROVED' },
        select: { id: true, versionLabel: true },
      });
      for (const row of previous) {
        await tx.competencyFrameworkVersion.update({
          where: { id: row.id },
          data: { status: 'SUPERSEDED' },
        });
      }
      superseded = previous[0]?.versionLabel ?? null;
      return tx.competencyFrameworkVersion.update({
        where: { id: version.id },
        data: {
          status: 'APPROVED',
          approvedAt: deps.clock.now(),
          approvedByUserId: actor.userId,
          approvalReference,
          effectiveFrom,
        },
      });
    },
    (row) => ({
      entityType: 'CompetencyFrameworkVersion',
      entityId: row.id,
      entityLabel: `${version.framework.code} ${row.versionLabel}`,
      previousValue: { status: version.status },
      newValue: { status: row.status, approvalReference: row.approvalReference },
      detail: {
        frameworkCode: version.framework.code,
        versionLabel: row.versionLabel,
        origin: row.origin,
        definitionsSha256: row.definitionsSha256,
        editorCount: (row.editorUserIds ?? []).length,
        supersededVersionLabel: superseded,
      },
    }),
  );
};

// ---------------------------------------------------------------------------
// Role targets -- Role -> Competency Requirements

export interface RoleTargetRow {
  readonly targetId: string;
  readonly status: 'PROPOSED' | 'APPROVED' | 'RETIRED';
  readonly jobRole: { readonly id: string; readonly code: string; readonly name: string };
  readonly competency: {
    readonly id: string;
    readonly code: string;
    readonly name: string;
    readonly status: Status;
  };
  readonly targetLevel: { readonly id: string; readonly code: string; readonly label: string };
  readonly source: string;
  readonly rationale: string | null;
  readonly effectiveFrom: string | null;
  readonly proposedBy: string | null;
  readonly editors: readonly { readonly userId: string; readonly displayName: string }[];
  readonly createdAt: string;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly approvalReference: string | null;
  readonly frameworkVersionLabel: string | null;
  readonly retiredAt: string | null;
  readonly retiredBy: string | null;
}

export interface RoleTargetsView {
  readonly targets: readonly RoleTargetRow[];
  readonly roles: readonly { readonly id: string; readonly code: string; readonly name: string }[];
  readonly competencies: readonly {
    readonly id: string;
    readonly code: string;
    readonly name: string;
    readonly frameworkCode: string;
    readonly levels: readonly {
      readonly id: string;
      readonly code: string;
      readonly label: string;
    }[];
  }[];
  /** Per framework: whether a target on it can be approved today. */
  readonly frameworks: readonly {
    readonly code: string;
    readonly approvedVersionLabel: string | null;
  }[];
}

const targetSelect = {
  id: true,
  status: true,
  source: true,
  rationale: true,
  effectiveFrom: true,
  createdAt: true,
  createdByUserId: true,
  modifiedByUserId: true,
  editorUserIds: true,
  approvedAt: true,
  approvedByUserId: true,
  approvalReference: true,
  retiredAt: true,
  retiredByUserId: true,
  jobRole: { select: { id: true, code: true, name: true } },
  competency: { select: { id: true, code: true, name: true, status: true, frameworkId: true } },
  targetLevel: { select: { id: true, code: true, label: true, scaleId: true } },
  frameworkVersion: { select: { versionLabel: true } },
} as const;

export const readRoleTargets = async (deps: CompetencyAdminDeps): Promise<RoleTargetsView> => {
  const [targets, roles, competencies, frameworks] = await Promise.all([
    deps.prisma.roleCompetencyExpectation.findMany({
      select: targetSelect,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    }),
    deps.prisma.jobRole.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true },
    }),
    deps.prisma.competency.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { code: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        framework: { select: { code: true } },
        levelScale: {
          select: {
            levels: { orderBy: { ordinal: 'asc' }, select: { id: true, code: true, label: true } },
          },
        },
      },
    }),
    deps.prisma.competencyFramework.findMany({
      orderBy: { code: 'asc' },
      select: {
        code: true,
        versions: { where: { status: 'APPROVED' }, select: { versionLabel: true } },
      },
    }),
  ]);
  const names = await displayNames(
    deps,
    targets.flatMap((row) => [
      row.createdByUserId,
      row.approvedByUserId,
      row.retiredByUserId,
      ...(row.editorUserIds ?? []),
    ]),
  );
  const nameOf = (id: string | null): string | null =>
    id === null ? null : (names.get(id) ?? null);
  return {
    targets: targets.map((row) => ({
      targetId: row.id,
      status: row.status,
      jobRole: row.jobRole,
      competency: {
        id: row.competency.id,
        code: row.competency.code,
        name: row.competency.name,
        status: row.competency.status,
      },
      targetLevel: {
        id: row.targetLevel.id,
        code: row.targetLevel.code,
        label: row.targetLevel.label,
      },
      source: row.source,
      rationale: row.rationale,
      effectiveFrom: row.effectiveFrom?.toISOString().slice(0, 10) ?? null,
      proposedBy: nameOf(row.createdByUserId),
      editors: (row.editorUserIds ?? []).map((userId) => ({
        userId,
        displayName: names.get(userId) ?? userId,
      })),
      createdAt: row.createdAt.toISOString(),
      approvedBy: nameOf(row.approvedByUserId),
      approvedAt: row.approvedAt?.toISOString() ?? null,
      approvalReference: row.approvalReference,
      frameworkVersionLabel: row.frameworkVersion?.versionLabel ?? null,
      retiredAt: row.retiredAt?.toISOString() ?? null,
      retiredBy: nameOf(row.retiredByUserId),
    })),
    roles,
    competencies: competencies.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      frameworkCode: row.framework.code,
      levels: row.levelScale.levels,
    })),
    frameworks: frameworks.map((row) => ({
      code: row.code,
      approvedVersionLabel: row.versions[0]?.versionLabel ?? null,
    })),
  };
};

const targetDetail = (
  row: {
    status: string;
    jobRole: { code: string };
    competency: { code: string };
    targetLevel: { code: string };
    frameworkVersion: { versionLabel: string } | null;
  },
  changedFields: readonly string[],
) => ({
  jobRoleCode: row.jobRole.code,
  competencyCode: row.competency.code,
  targetLevelCode: row.targetLevel.code,
  status: row.status,
  frameworkVersionLabel: row.frameworkVersion?.versionLabel ?? null,
  changedFields: [...changedFields],
});

const loadTarget = async (db: TransactionClient | CompetencyAdminDeps['prisma'], id: string) => {
  const row = await (db as TransactionClient).roleCompetencyExpectation.findUnique({
    where: { id },
    select: targetSelect,
  });
  if (row === null) throw notFound('role target');
  return row;
};

export interface ProposeTargetArgs {
  readonly jobRoleId: string;
  readonly competencyId: string;
  readonly targetLevelId: string;
  /** Where the requirement comes from. Required: the platform invents none. */
  readonly source: string;
  readonly rationale?: string | null;
  readonly effectiveFrom?: string | null;
}

const checkLevelOnScale = async (
  db: CompetencyAdminDeps['prisma'],
  competency: { levelScaleId: string; code: string },
  targetLevelId: string,
): Promise<void> => {
  const level = await db.competencyLevel.findUnique({
    where: { id: targetLevelId },
    select: { scaleId: true },
  });
  if (level === null || level.scaleId !== competency.levelScaleId) {
    throw new CompetencyAdminError(
      'VALIDATION_FAILED',
      `Choose a level on the scale ${competency.code} is measured on.`,
    );
  }
};

export const proposeRoleTarget = async (
  deps: CompetencyAdminDeps,
  actor: CompetencyAdminActor,
  args: ProposeTargetArgs,
) => {
  const source = requiredText(args.source, 'A source for the requirement', REFERENCE_MIN);
  const rationale = text(args.rationale, 'A rationale');
  const effectiveFrom = parseDate(args.effectiveFrom);
  const role = await deps.prisma.jobRole.findUnique({
    where: { id: args.jobRoleId },
    select: { id: true, code: true, isActive: true },
  });
  if (role === null) throw notFound('role');
  if (!role.isActive) {
    throw new CompetencyAdminError(
      'TAXONOMY_INACTIVE',
      `The role ${role.code} is deactivated, so it takes no new requirement.`,
    );
  }
  const competency = await deps.prisma.competency.findUnique({
    where: { id: args.competencyId },
    select: { id: true, code: true, status: true, levelScaleId: true },
  });
  if (competency === null) throw notFound('competency');
  if (competency.status !== 'ACTIVE') {
    throw new CompetencyAdminError(
      'COMPETENCY_INACTIVE',
      `${competency.code} is retired, so no requirement can be based on it.`,
    );
  }
  await checkLevelOnScale(deps.prisma, competency, args.targetLevelId);
  const open = await deps.prisma.roleCompetencyExpectation.findFirst({
    where: { jobRoleId: role.id, competencyId: competency.id, status: 'PROPOSED' },
    select: { id: true },
  });
  if (open !== null) {
    throw new CompetencyAdminError(
      'COMPETENCY_DUPLICATE',
      `${role.code} already has a proposed requirement for ${competency.code}. Edit that ` +
        'proposal instead of proposing a second.',
    );
  }

  return audited(
    deps,
    actor,
    'ADMIN.COMPETENCY.TARGET_PROPOSED',
    async (tx) => {
      const created = await tx.roleCompetencyExpectation.create({
        data: {
          jobRoleId: role.id,
          competencyId: competency.id,
          targetLevelId: args.targetLevelId,
          source,
          rationale,
          effectiveFrom,
          createdByUserId: actor.userId,
          modifiedByUserId: actor.userId,
          editorUserIds: [actor.userId],
        },
        select: { id: true },
      });
      return loadTarget(tx, created.id);
    },
    (row) => ({
      entityType: 'RoleCompetencyExpectation',
      entityId: row.id,
      entityLabel: `${row.jobRole.code} → ${row.competency.code} @ ${row.targetLevel.code}`,
      detail: targetDetail(row, []),
    }),
  );
};

export interface UpdateTargetArgs {
  readonly targetId: string;
  readonly targetLevelId?: string;
  readonly source?: string;
  readonly rationale?: string | null;
  readonly effectiveFrom?: string | null;
}

export const updateRoleTarget = async (
  deps: CompetencyAdminDeps,
  actor: CompetencyAdminActor,
  args: UpdateTargetArgs,
) => {
  const current = await loadTarget(deps.prisma, args.targetId);
  if (current.status !== 'PROPOSED') {
    throw new CompetencyAdminError(
      'STATE_TRANSITION_INVALID',
      `This requirement is ${current.status}. An approved requirement is never edited: propose a ` +
        'revision, and approving it retires this one.',
    );
  }
  const data: Record<string, unknown> = {};
  const changedFields: string[] = [];
  if (args.targetLevelId !== undefined && args.targetLevelId !== current.targetLevel.id) {
    const competency = await deps.prisma.competency.findUnique({
      where: { id: current.competency.id },
      select: { code: true, levelScaleId: true },
    });
    if (competency === null) throw notFound('competency');
    await checkLevelOnScale(deps.prisma, competency, args.targetLevelId);
    data['targetLevelId'] = args.targetLevelId;
    changedFields.push('targetLevel');
  }
  if (args.source !== undefined) {
    const source = requiredText(args.source, 'A source for the requirement', REFERENCE_MIN);
    if (source !== current.source) {
      data['source'] = source;
      changedFields.push('source');
    }
  }
  if (args.rationale !== undefined) {
    const rationale = text(args.rationale, 'A rationale');
    if (rationale !== current.rationale) {
      data['rationale'] = rationale;
      changedFields.push('rationale');
    }
  }
  if (args.effectiveFrom !== undefined) {
    const effectiveFrom = parseDate(args.effectiveFrom);
    if ((effectiveFrom?.getTime() ?? null) !== (current.effectiveFrom?.getTime() ?? null)) {
      data['effectiveFrom'] = effectiveFrom;
      changedFields.push('effectiveFrom');
    }
  }
  if (changedFields.length === 0) return current;

  return audited(
    deps,
    actor,
    'ADMIN.COMPETENCY.TARGET_UPDATED',
    async (tx) => {
      await tx.roleCompetencyExpectation.update({
        where: { id: current.id },
        data: {
          ...data,
          modifiedByUserId: actor.userId,
          editorUserIds: [...new Set([...(current.editorUserIds ?? []), actor.userId])],
          version: { increment: 1 },
        },
      });
      return loadTarget(tx, current.id);
    },
    (row) => ({
      entityType: 'RoleCompetencyExpectation',
      entityId: row.id,
      entityLabel: `${row.jobRole.code} → ${row.competency.code} @ ${row.targetLevel.code}`,
      previousValue: {
        targetLevel: current.targetLevel.code,
        source: current.source,
        effectiveFrom: current.effectiveFrom?.toISOString().slice(0, 10) ?? null,
      },
      newValue: {
        targetLevel: row.targetLevel.code,
        source: row.source,
        effectiveFrom: row.effectiveFrom?.toISOString().slice(0, 10) ?? null,
      },
      detail: targetDetail(row, changedFields),
    }),
  );
};

export interface ApproveTargetArgs {
  readonly targetId: string;
  readonly approvalReference: string;
}

export const approveRoleTarget = async (
  deps: CompetencyAdminDeps,
  actor: CompetencyAdminActor,
  args: ApproveTargetArgs,
) => {
  const approvalReference = requiredText(
    args.approvalReference,
    'An approval reference',
    REFERENCE_MIN,
  );
  const current = await loadTarget(deps.prisma, args.targetId);
  if (current.status !== 'PROPOSED') {
    throw new CompetencyAdminError(
      'STATE_TRANSITION_INVALID',
      `This requirement is ${current.status}; only a proposal can be approved.`,
    );
  }
  const separation = deps.separation ?? STRICT_COMPETENCY_SEPARATION;
  if (!separation.targetEditorMayApprove) {
    const refusal = separationRefusal({
      approverId: actor.userId,
      createdByUserId: current.createdByUserId,
      modifiedByUserId: current.modifiedByUserId,
      editorUserIds: current.editorUserIds ?? [],
      noun: 'requirement',
    });
    if (refusal !== null) throw new CompetencyAdminError('SEPARATION_OF_DUTIES', refusal);
  }
  if (current.competency.status !== 'ACTIVE') {
    throw new CompetencyAdminError(
      'COMPETENCY_INACTIVE',
      `${current.competency.code} is retired, so a requirement on it cannot be approved.`,
    );
  }
  const approved = await deps.prisma.competencyFrameworkVersion.findFirst({
    where: { frameworkId: current.competency.frameworkId, status: 'APPROVED' },
    select: { id: true, versionLabel: true },
  });
  if (approved === null) {
    throw new CompetencyAdminError(
      'COMPETENCY_FRAMEWORK_NOT_APPROVED',
      'The competency framework has no approved version yet, so no requirement can be approved ' +
        'against it. A draft framework may be catalogued, but it is not a basis for a target ' +
        '(COMPETENCY_MODEL.md §2.2). Approve a framework version first.',
    );
  }

  let replaced: string | null = null;
  return audited(
    deps,
    actor,
    'ADMIN.COMPETENCY.TARGET_APPROVED',
    async (tx) => {
      const previous = await tx.roleCompetencyExpectation.findFirst({
        where: {
          jobRoleId: current.jobRole.id,
          competencyId: current.competency.id,
          status: 'APPROVED',
        },
        select: { id: true },
      });
      if (previous !== null) {
        await tx.roleCompetencyExpectation.update({
          where: { id: previous.id },
          data: { status: 'RETIRED', retiredAt: deps.clock.now(), retiredByUserId: actor.userId },
        });
        replaced = previous.id;
      }
      await tx.roleCompetencyExpectation.update({
        where: { id: current.id },
        data: {
          status: 'APPROVED',
          approvedAt: deps.clock.now(),
          approvedByUserId: actor.userId,
          approvalReference,
          frameworkVersionId: approved.id,
        },
      });
      return loadTarget(tx, current.id);
    },
    (row) => ({
      entityType: 'RoleCompetencyExpectation',
      entityId: row.id,
      entityLabel: `${row.jobRole.code} → ${row.competency.code} @ ${row.targetLevel.code}`,
      previousValue: { status: current.status },
      newValue: { status: row.status, replacedTargetId: replaced },
      detail: targetDetail(row, []),
    }),
  );
};

export const retireRoleTarget = async (
  deps: CompetencyAdminDeps,
  actor: CompetencyAdminActor,
  args: { readonly targetId: string },
) => {
  const current = await loadTarget(deps.prisma, args.targetId);
  if (current.status === 'RETIRED') {
    throw new CompetencyAdminError(
      'STATE_TRANSITION_INVALID',
      'This requirement is already retired.',
    );
  }
  return audited(
    deps,
    actor,
    'ADMIN.COMPETENCY.TARGET_RETIRED',
    async (tx) => {
      await tx.roleCompetencyExpectation.update({
        where: { id: current.id },
        data: { status: 'RETIRED', retiredAt: deps.clock.now(), retiredByUserId: actor.userId },
      });
      return loadTarget(tx, current.id);
    },
    (row) => ({
      entityType: 'RoleCompetencyExpectation',
      entityId: row.id,
      entityLabel: `${row.jobRole.code} → ${row.competency.code} @ ${row.targetLevel.code}`,
      previousValue: { status: current.status },
      newValue: { status: row.status },
      detail: targetDetail(row, []),
    }),
  );
};
