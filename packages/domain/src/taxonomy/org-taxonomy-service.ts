// Departments and roles — the organizational axes a question is filed under.
//
// Requested directly: "each question can be mapped to Department, Role, Domain,
// Topic". So these are managed the same way domains and topics are, on the same
// screen, with the same rules — because two catalogues on one screen that
// behave differently is worse than one catalogue with a quirk.
//
// What is shared with the domain service, deliberately:
//
//   * the SAME code normalizer, so `support-rxnet` and `Support RXNET` are one
//     code (`SUPPORT_RXNET`) rather than two departments that look identical in
//     a dropdown;
//   * codes are UNIQUE and refused on collision, naming the collision;
//   * a code is editable only while NOTHING references it, then refused with
//     TAXONOMY_CODE_IMMUTABLE — a department code is copied into the published
//     record and is what a year of reports grouped by, so changing it would
//     silently restate history. The DISPLAY NAME stays editable forever;
//   * NOTHING IS EVER DELETED. Deactivation removes it from every selection
//     surface and leaves existing filings intact;
//   * every write is audited, and an update carries previous and new value.
//
// What is NOT shared: a role does not belong to a department. The reference
// dashboard lists Intern, Developer and Senior Developer beside Support-NG and
// Development-RXNET, which is an organization using both axes independently.
// Forcing a hierarchy would make every role of one department unusable by
// another, and the first request would be to undo it.

import { transactWithAudit, type TransactionClient } from '@knowzy/database';
import {
  normalizeDescription,
  normalizeDisplayName,
  normalizeDomainCode,
  taxonomyActorFields,
  taxonomyWriter,
  TaxonomyError,
  type TaxonomyActor,
  type TaxonomyDeps,
} from './taxonomy-service.js';

/** The two catalogues this module manages. */
export type OrgCatalogue = 'DEPARTMENT' | 'ROLE';

export interface OrgRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly isActive: boolean;
  /** Draft questions filed under it. */
  readonly questionCount: number;
  /** Published questions filed under it — the ones a report groups. */
  readonly publishedQuestionCount: number;
  readonly generationJobCount: number;
  /**
   * True once anything references it, which is when the code stops being
   * editable. Surfaced so the screen can render the field as permanent WITH
   * the counts that locked it, rather than letting somebody type into a field
   * that will be refused on submit.
   */
  readonly codeLocked: boolean;
}

interface CatalogueClient {
  findUnique(args: unknown): Promise<unknown>;
  findMany(args: unknown): Promise<unknown[]>;
  create(args: unknown): Promise<unknown>;
  update(args: unknown): Promise<unknown>;
}

/** The delegate, the audit vocabulary and the words a refusal uses. */
interface CatalogueShape {
  readonly entityType: 'Department' | 'JobRole';
  readonly noun: string;
  readonly createdAction: 'ADMIN.TAXONOMY.DEPARTMENT_CREATED' | 'ADMIN.TAXONOMY.ROLE_CREATED';
  readonly updatedAction: 'ADMIN.TAXONOMY.DEPARTMENT_UPDATED' | 'ADMIN.TAXONOMY.ROLE_UPDATED';
}

const SHAPES: Readonly<Record<OrgCatalogue, CatalogueShape>> = {
  DEPARTMENT: {
    entityType: 'Department',
    noun: 'department',
    createdAction: 'ADMIN.TAXONOMY.DEPARTMENT_CREATED',
    updatedAction: 'ADMIN.TAXONOMY.DEPARTMENT_UPDATED',
  },
  ROLE: {
    entityType: 'JobRole',
    noun: 'role',
    createdAction: 'ADMIN.TAXONOMY.ROLE_CREATED',
    updatedAction: 'ADMIN.TAXONOMY.ROLE_UPDATED',
  },
};

const delegateOf = (deps: TaxonomyDeps, catalogue: OrgCatalogue): CatalogueClient =>
  catalogue === 'DEPARTMENT'
    ? (deps.prisma as unknown as { department: CatalogueClient }).department
    : (deps.prisma as unknown as { jobRole: CatalogueClient }).jobRole;

const txDelegateOf = (tx: TransactionClient, catalogue: OrgCatalogue): CatalogueClient =>
  catalogue === 'DEPARTMENT'
    ? (tx as unknown as { department: CatalogueClient }).department
    : (tx as unknown as { jobRole: CatalogueClient }).jobRole;

const SELECT = {
  id: true,
  code: true,
  name: true,
  description: true,
  isActive: true,
  _count: { select: { questions: true, publishedQuestions: true, generationJobs: true } },
} as const;

interface RawRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  _count: { questions: number; publishedQuestions: number; generationJobs: number };
}

const toRow = (raw: RawRow): OrgRow => ({
  id: raw.id,
  code: raw.code,
  name: raw.name,
  description: raw.description,
  isActive: raw.isActive,
  questionCount: raw._count.questions,
  publishedQuestionCount: raw._count.publishedQuestions,
  generationJobCount: raw._count.generationJobs,
  codeLocked:
    raw._count.questions > 0 || raw._count.publishedQuestions > 0 || raw._count.generationJobs > 0,
});

export interface ReadOrgQuery {
  readonly query?: string | undefined;
  readonly active?: boolean | undefined;
}

export const readOrgCatalogue = async (
  deps: TaxonomyDeps,
  catalogue: OrgCatalogue,
  query: ReadOrgQuery = {},
): Promise<readonly OrgRow[]> => {
  const text = (query.query ?? '').trim();
  const rows = (await delegateOf(deps, catalogue).findMany({
    where: {
      ...(query.active === undefined ? {} : { isActive: query.active }),
      ...(text.length === 0
        ? {}
        : {
            OR: [
              { code: { contains: text.toUpperCase() } },
              { name: { contains: text, mode: 'insensitive' } },
            ],
          }),
    },
    select: SELECT,
    orderBy: { code: 'asc' },
  })) as RawRow[];
  return rows.map(toRow);
};

export interface CreateOrgArgs {
  readonly code: string;
  readonly name: string;
  readonly description?: string | null;
  readonly isActive?: boolean;
}

export const createOrgEntry = async (
  deps: TaxonomyDeps,
  actor: TaxonomyActor,
  catalogue: OrgCatalogue,
  args: CreateOrgArgs,
): Promise<OrgRow> => {
  const shape = SHAPES[catalogue];
  const code = normalizeDomainCode(args.code);
  const name = normalizeDisplayName(args.name, shape.noun);
  const description = normalizeDescription(args.description);

  // Checked before the insert so the refusal names the collision, and again by
  // the unique index so a concurrent create cannot slip past the check.
  const existing = await delegateOf(deps, catalogue).findUnique({
    where: { code },
    select: { id: true, isActive: true },
  });
  if (existing !== null) {
    throw new TaxonomyError(
      'TAXONOMY_DUPLICATE',
      `A ${shape.noun} with the code ${code} already exists. A code identifies a ${shape.noun} ` +
        'permanently, so a second one cannot take it. Reactivate the existing entry, or choose ' +
        'another code.',
    );
  }

  const created = (await transactWithAudit({
    prisma: deps.prisma,
    auditWriter: taxonomyWriter(deps),
    action: shape.createdAction,
    work: async (tx: TransactionClient) =>
      txDelegateOf(tx, catalogue).create({
        data: {
          code,
          name,
          description,
          isActive: args.isActive ?? true,
          createdByUserId: actor.userId,
          modifiedByUserId: actor.userId,
        },
        select: SELECT,
      }),
    audit: (entry) => ({
      ...taxonomyActorFields(actor),
      actorType: 'USER' as const,
      action: shape.createdAction,
      outcome: 'SUCCESS' as const,
      entityType: shape.entityType,
      entityId: (entry as RawRow).id,
      entityLabel: `${(entry as RawRow).code} — ${(entry as RawRow).name}`,
      detail: {
        code: (entry as RawRow).code,
        name: (entry as RawRow).name,
        isActive: (entry as RawRow).isActive,
      },
    }),
  })) as RawRow;

  return toRow(created);
};

export interface UpdateOrgArgs {
  readonly id: string;
  readonly name?: string;
  readonly description?: string | null;
  readonly isActive?: boolean;
  /**
   * Accepted ONLY while nothing references the entry. Present-and-unchanged is
   * not an error, so a form may post the field it rendered.
   */
  readonly code?: string;
}

export const updateOrgEntry = async (
  deps: TaxonomyDeps,
  actor: TaxonomyActor,
  catalogue: OrgCatalogue,
  args: UpdateOrgArgs,
): Promise<OrgRow> => {
  const shape = SHAPES[catalogue];
  const current = (await delegateOf(deps, catalogue).findUnique({
    where: { id: args.id },
    select: SELECT,
  })) as RawRow | null;
  if (current === null) {
    throw new TaxonomyError('NOT_FOUND', `No ${shape.noun} with that id exists.`);
  }

  const before = toRow(current);
  const changedFields: string[] = [];
  const data: Record<string, unknown> = { modifiedByUserId: actor.userId };

  if (args.code !== undefined) {
    const code = normalizeDomainCode(args.code);
    if (code !== current.code) {
      if (before.codeLocked) {
        throw new TaxonomyError(
          'TAXONOMY_CODE_IMMUTABLE',
          `The code ${current.code} can no longer be changed: ${before.questionCount} draft ` +
            `question(s), ${before.publishedQuestionCount} published question(s) and ` +
            `${before.generationJobCount} generation job(s) reference this ${shape.noun}. The ` +
            'code is copied into the published record and is what past reports grouped by, so ' +
            'changing it would restate history. The display name is still editable.',
        );
      }
      const clash = await delegateOf(deps, catalogue).findUnique({
        where: { code },
        select: { id: true },
      });
      if (clash !== null) {
        throw new TaxonomyError(
          'TAXONOMY_DUPLICATE',
          `Another ${shape.noun} already uses the code ${code}.`,
        );
      }
      data['code'] = code;
      changedFields.push('code');
    }
  }

  if (args.name !== undefined) {
    const name = normalizeDisplayName(args.name, shape.noun);
    if (name !== current.name) {
      data['name'] = name;
      changedFields.push('name');
    }
  }

  if (args.description !== undefined) {
    const description = normalizeDescription(args.description);
    if (description !== current.description) {
      data['description'] = description;
      changedFields.push('description');
    }
  }

  if (args.isActive !== undefined && args.isActive !== current.isActive) {
    data['isActive'] = args.isActive;
    changedFields.push('isActive');
  }

  // Nothing changed. Returning the row rather than writing an audit event with
  // an empty diff: an audit trail full of "nothing happened" is a trail nobody
  // reads.
  if (changedFields.length === 0) return before;

  const updated = (await transactWithAudit({
    prisma: deps.prisma,
    auditWriter: taxonomyWriter(deps),
    action: shape.updatedAction,
    work: async (tx: TransactionClient) =>
      txDelegateOf(tx, catalogue).update({
        where: { id: args.id },
        data: { ...data, version: { increment: 1 } },
        select: SELECT,
      }),
    audit: (entry) => ({
      ...taxonomyActorFields(actor),
      actorType: 'USER' as const,
      action: shape.updatedAction,
      outcome: 'SUCCESS' as const,
      entityType: shape.entityType,
      entityId: (entry as RawRow).id,
      entityLabel: `${(entry as RawRow).code} — ${(entry as RawRow).name}`,
      previousValue: {
        code: current.code,
        name: current.name,
        description: current.description,
        isActive: current.isActive,
      },
      newValue: {
        code: (entry as RawRow).code,
        name: (entry as RawRow).name,
        description: (entry as RawRow).description,
        isActive: (entry as RawRow).isActive,
      },
      detail: {
        code: (entry as RawRow).code,
        name: (entry as RawRow).name,
        isActive: (entry as RawRow).isActive,
        changedFields,
      },
    }),
  })) as RawRow;

  return toRow(updated);
};

/**
 * Resolve a department and a role for filing a question.
 *
 * Both are OPTIONAL — a question may carry neither, because thousands already
 * do. But an id that is supplied must exist and be ACTIVE: filing new questions
 * under a department somebody deactivated last week is exactly the drift
 * deactivation exists to prevent, and a silent null would hide it.
 */
export const resolveOrgFiling = async (
  deps: TaxonomyDeps,
  args: { readonly departmentId?: string | null; readonly jobRoleId?: string | null },
): Promise<{ readonly departmentId: string | null; readonly jobRoleId: string | null }> => {
  const check = async (
    catalogue: OrgCatalogue,
    id: string | null | undefined,
  ): Promise<string | null> => {
    if (id === null || id === undefined || id.length === 0) return null;
    const row = (await delegateOf(deps, catalogue).findUnique({
      where: { id },
      select: { id: true, code: true, isActive: true },
    })) as { id: string; code: string; isActive: boolean } | null;
    const shape = SHAPES[catalogue];
    if (row === null) {
      throw new TaxonomyError('NOT_FOUND', `No ${shape.noun} with that id exists.`);
    }
    if (!row.isActive) {
      throw new TaxonomyError(
        'TAXONOMY_INACTIVE',
        `The ${shape.noun} ${row.code} is deactivated, so new questions cannot be filed under ` +
          'it. Reactivate it, or choose another.',
      );
    }
    return row.id;
  };

  return {
    departmentId: await check('DEPARTMENT', args.departmentId),
    jobRoleId: await check('ROLE', args.jobRoleId),
  };
};
