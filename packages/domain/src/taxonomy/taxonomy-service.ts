// Taxonomy administration — domains and topics.
//
// WHY THIS IS A WRITE PATH AT ALL, and why it took until now: the platform
// shipped with one seeded domain and one seeded topic, and no way to add a
// second. Every imported question bank therefore landed under whatever the
// seed happened to contain, which is how a VisionStar question came to be
// filed under Support Operations / Escalation and Billing.
//
// The constraint that shapes every rule below: **a domain code is permanent
// once a question has published under it.** The published QuestionID is
// `KNZ-{DOMAIN_CODE}-{YYYY}-{SEQ}` (workflows.md §4.3) and those identifiers
// live in the SharePoint Question Bank, outside this platform's reach. Renaming
// a code would orphan them. So:
//
//   - the DISPLAY NAME is freely editable, forever;
//   - the CODE is editable only while nothing references the domain at all,
//     which exists so a typo caught in the first minute is fixable;
//   - once anything references it, the code is refused with the reason.
//
// Deactivation, not deletion. A domain or topic with questions cannot be
// removed without destroying lineage, and lineage is the point of the product.
// `isActive: false` removes it from every selection surface and leaves every
// existing reference intact.

import {
  createAuditWriter,
  transactWithAudit,
  type AuditWriter,
  type PrismaClient,
  type TransactionClient,
} from '@knowzy/database';
import type { Clock } from '@knowzy/observability';
import type { ErrorCode } from '@knowzy/shared-types';

export interface TaxonomyActor {
  readonly userId: string;
  readonly displayName: string;
  readonly roles: readonly string[];
  readonly correlationId: string;
  readonly requestId: string;
}

export interface TaxonomyDeps {
  readonly prisma: PrismaClient;
  readonly clock: Clock;
  readonly auditWriter?: AuditWriter;
}

/**
 * A refusal carrying the code the API should return.
 *
 * The service owns the decision and the wording; the route translates neither.
 * A validation message written at the boundary drifts from the rule it
 * describes, and this one has to name a specific value to be useful.
 */
export class TaxonomyError extends Error {
  constructor(
    readonly code: ErrorCode,
    detail: string,
  ) {
    super(detail);
    this.name = 'TaxonomyError';
  }
}

// ---------------------------------------------------------------------------
// Normalization — pure, and tested without a database

/** Length bounds. A code goes in a QuestionID, so it stays short. */
export const DOMAIN_CODE_MIN = 2;
export const DOMAIN_CODE_MAX = 40;
export const DISPLAY_NAME_MIN = 2;
export const DISPLAY_NAME_MAX = 120;
export const DESCRIPTION_MAX = 2_000;

/**
 * The one legal shape for a domain code: `A-Z`, `0-9` and `_`.
 *
 * Upper-cased rather than rejected for case, because `support_ops` and
 * `SUPPORT_OPS` are the same code to everyone except a string comparison, and
 * a code that differs only in case would produce two indistinguishable
 * QuestionID prefixes.
 */
export const normalizeDomainCode = (input: string): string => {
  const code = input
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  if (!/^[A-Z0-9_]+$/.test(code)) {
    throw new TaxonomyError(
      'VALIDATION_FAILED',
      'A domain code may contain only letters, digits and underscores. ' +
        'It appears in every published question id, so it cannot carry punctuation or spaces.',
    );
  }
  if (code.length < DOMAIN_CODE_MIN || code.length > DOMAIN_CODE_MAX) {
    throw new TaxonomyError(
      'VALIDATION_FAILED',
      `A domain code must be between ${DOMAIN_CODE_MIN} and ${DOMAIN_CODE_MAX} characters.`,
    );
  }
  return code;
};

export const normalizeDisplayName = (input: string, what: string): string => {
  const name = input.trim().replace(/\s+/g, ' ');
  if (name.length < DISPLAY_NAME_MIN || name.length > DISPLAY_NAME_MAX) {
    throw new TaxonomyError(
      'VALIDATION_FAILED',
      `A ${what} name must be between ${DISPLAY_NAME_MIN} and ${DISPLAY_NAME_MAX} characters.`,
    );
  }
  return name;
};

export const normalizeDescription = (input: string | null | undefined): string | null => {
  if (input === null || input === undefined) return null;
  const text = input.trim();
  if (text.length === 0) return null;
  if (text.length > DESCRIPTION_MAX) {
    throw new TaxonomyError(
      'VALIDATION_FAILED',
      `A description may be at most ${DESCRIPTION_MAX} characters.`,
    );
  }
  return text;
};

/**
 * The topic's stable key within its domain.
 *
 * `Topic` is uniquely indexed on `[domainId, slug]`, so the slug — not the
 * display name — is what makes two topics the same topic. Deriving it here
 * means "SAP Integration", "sap integration" and "SAP  Integration" all
 * collide, which is the intent: they are one topic typed three ways.
 */
export const topicSlug = (name: string): string => {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length === 0) {
    throw new TaxonomyError(
      'VALIDATION_FAILED',
      'A topic name must contain at least one letter or digit.',
    );
  }
  return slug;
};

// ---------------------------------------------------------------------------
// Reads

export interface DomainRow {
  readonly domainId: string;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly isActive: boolean;
  readonly requireSmeSignoff: boolean;
  readonly topicCount: number;
  readonly activeTopicCount: number;
  readonly questionCount: number;
  readonly publishedQuestionCount: number;
  /** False only while NOTHING references the domain. See the header. */
  readonly codeLocked: boolean;
  readonly version: number;
}

export interface TopicRow {
  readonly topicId: string;
  readonly domainId: string;
  readonly domainCode: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly isActive: boolean;
  readonly questionCount: number;
  readonly version: number;
}

export interface TaxonomyQuery {
  /** Case-insensitive match on a domain code, domain name or topic name. */
  readonly query?: string;
  /** Undefined means both. */
  readonly active?: boolean;
  /** Restricts the topic list to one domain. */
  readonly domainId?: string;
}

/**
 * The administration read: everything, including what is deactivated.
 *
 * Deliberately NOT the same read as `GET /authoring/taxonomy`, which serves
 * selection and therefore hides everything inactive. An administrator who
 * cannot see a deactivated domain cannot reactivate it, and would create a
 * second one with a colliding code instead.
 */
export const readTaxonomy = async (
  deps: TaxonomyDeps,
  query: TaxonomyQuery = {},
): Promise<{ readonly domains: readonly DomainRow[]; readonly topics: readonly TopicRow[] }> => {
  const text = query.query?.trim() ?? '';
  const activeFilter = query.active === undefined ? {} : { isActive: query.active };

  const domains = await deps.prisma.domain.findMany({
    where: {
      ...activeFilter,
      ...(text.length === 0
        ? {}
        : {
            OR: [
              { code: { contains: text, mode: 'insensitive' as const } },
              { name: { contains: text, mode: 'insensitive' as const } },
              { topics: { some: { name: { contains: text, mode: 'insensitive' as const } } } },
            ],
          }),
    },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    include: {
      _count: { select: { topics: true, questions: true, assessments: true, questionSets: true } },
      topics: { select: { id: true, isActive: true } },
      questions: { select: { id: true }, where: { status: 'PUBLISHED' }, take: 1 },
    },
  });

  // The counts a lock depends on, read per domain rather than inferred: a
  // domain with a draft question is already referenced, even though nothing is
  // published yet, and the draft's lineage cites the domain.
  const rows: DomainRow[] = [];
  for (const domain of domains) {
    const publishedQuestionCount = await deps.prisma.draftQuestion.count({
      where: { domainId: domain.id, status: 'PUBLISHED' },
    });
    rows.push({
      domainId: domain.id,
      code: domain.code,
      name: domain.name,
      description: domain.description,
      isActive: domain.isActive,
      requireSmeSignoff: domain.requireSmeSignoff,
      topicCount: domain._count.topics,
      activeTopicCount: domain.topics.filter((topic) => topic.isActive).length,
      questionCount: domain._count.questions,
      publishedQuestionCount,
      codeLocked:
        domain._count.questions > 0 ||
        domain._count.assessments > 0 ||
        domain._count.questionSets > 0,
      version: domain.version,
    });
  }

  const topics = await deps.prisma.topic.findMany({
    where: {
      ...activeFilter,
      ...(query.domainId === undefined ? {} : { domainId: query.domainId }),
      ...(text.length === 0
        ? {}
        : {
            OR: [
              { name: { contains: text, mode: 'insensitive' as const } },
              { domain: { code: { contains: text, mode: 'insensitive' as const } } },
              { domain: { name: { contains: text, mode: 'insensitive' as const } } },
            ],
          }),
    },
    orderBy: [{ domain: { name: 'asc' } }, { isActive: 'desc' }, { name: 'asc' }],
    include: {
      domain: { select: { id: true, code: true } },
      _count: { select: { questions: true } },
    },
  });

  return {
    domains: rows,
    topics: topics.map((topic) => ({
      topicId: topic.id,
      domainId: topic.domainId,
      domainCode: topic.domain.code,
      name: topic.name,
      slug: topic.slug,
      description: topic.description,
      isActive: topic.isActive,
      questionCount: topic._count.questions,
      version: topic.version,
    })),
  };
};

// ---------------------------------------------------------------------------
// Writes

export const taxonomyWriter = (deps: TaxonomyDeps): AuditWriter =>
  deps.auditWriter ?? createAuditWriter({ clock: deps.clock });

export const taxonomyActorFields = (actor: TaxonomyActor) => ({
  actorUserId: actor.userId,
  actorDisplayName: actor.displayName,
  actorRoles: [...actor.roles],
  correlationId: actor.correlationId,
  requestId: actor.requestId,
  portal: 'AUTHORING' as const,
});

export interface CreateDomainArgs {
  readonly code: string;
  readonly name: string;
  readonly description?: string | null;
  readonly requireSmeSignoff?: boolean;
  readonly isActive?: boolean;
}

export const createDomain = async (
  deps: TaxonomyDeps,
  actor: TaxonomyActor,
  args: CreateDomainArgs,
): Promise<DomainRow> => {
  const code = normalizeDomainCode(args.code);
  const name = normalizeDisplayName(args.name, 'domain');
  const description = normalizeDescription(args.description);

  // Checked before the insert so the refusal names the collision, and again by
  // the unique index so a concurrent create cannot slip past the check.
  const existing = await deps.prisma.domain.findUnique({ where: { code }, select: { id: true } });
  if (existing !== null) {
    throw new TaxonomyError(
      'TAXONOMY_DUPLICATE',
      `A domain with the code ${code} already exists. A code identifies a domain forever, ` +
        'so a second one cannot take it. Reactivate the existing domain, or choose another code.',
    );
  }

  const created = await transactWithAudit({
    prisma: deps.prisma,
    auditWriter: taxonomyWriter(deps),
    action: 'ADMIN.TAXONOMY.DOMAIN_CREATED',
    work: async (tx: TransactionClient) =>
      tx.domain.create({
        data: {
          code,
          name,
          description,
          isActive: args.isActive ?? true,
          requireSmeSignoff: args.requireSmeSignoff ?? false,
          createdByUserId: actor.userId,
          modifiedByUserId: actor.userId,
        },
        select: { id: true, code: true, name: true, isActive: true, version: true },
      }),
    audit: (domain) => ({
      ...taxonomyActorFields(actor),
      action: 'ADMIN.TAXONOMY.DOMAIN_CREATED' as const,
      outcome: 'SUCCESS' as const,
      entityType: 'Domain',
      entityId: domain.id,
      entityLabel: `${domain.code} — ${domain.name}`,
      detail: { code: domain.code, name: domain.name, isActive: domain.isActive },
    }),
  });

  const read = await readTaxonomy(deps, { query: created.code });
  const row = read.domains.find((candidate) => candidate.domainId === created.id);
  if (row === undefined) throw new TaxonomyError('NOT_FOUND', 'The domain was not readable back.');
  return row;
};

export interface UpdateDomainArgs {
  readonly domainId: string;
  readonly name?: string;
  readonly description?: string | null;
  readonly isActive?: boolean;
  readonly requireSmeSignoff?: boolean;
  /**
   * Accepted ONLY while nothing references the domain. Present-and-unchanged is
   * not an error, so a form may post the field it rendered.
   */
  readonly code?: string;
}

export const updateDomain = async (
  deps: TaxonomyDeps,
  actor: TaxonomyActor,
  args: UpdateDomainArgs,
): Promise<DomainRow> => {
  const current = await deps.prisma.domain.findUnique({
    where: { id: args.domainId },
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
      isActive: true,
      requireSmeSignoff: true,
      _count: { select: { questions: true, assessments: true, questionSets: true } },
    },
  });
  if (current === null) {
    throw new TaxonomyError('NOT_FOUND', 'No domain with that id exists.');
  }

  const changedFields: string[] = [];
  const data: Record<string, unknown> = { modifiedByUserId: actor.userId };

  if (args.code !== undefined) {
    const code = normalizeDomainCode(args.code);
    if (code !== current.code) {
      const referenced =
        current._count.questions > 0 ||
        current._count.assessments > 0 ||
        current._count.questionSets > 0;
      if (referenced) {
        throw new TaxonomyError(
          'TAXONOMY_CODE_IMMUTABLE',
          `The code ${current.code} can no longer be changed: ${current._count.questions} ` +
            `question(s), ${current._count.assessments} assessment(s) and ` +
            `${current._count.questionSets} question set(s) reference this domain, and a ` +
            'published question id carries the code permanently. The display name is still ' +
            'editable.',
        );
      }
      const clash = await deps.prisma.domain.findUnique({ where: { code }, select: { id: true } });
      if (clash !== null) {
        throw new TaxonomyError(
          'TAXONOMY_DUPLICATE',
          `A domain with the code ${code} already exists.`,
        );
      }
      data['code'] = code;
      changedFields.push('code');
    }
  }

  if (args.name !== undefined) {
    const name = normalizeDisplayName(args.name, 'domain');
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

  if (
    args.requireSmeSignoff !== undefined &&
    args.requireSmeSignoff !== current.requireSmeSignoff
  ) {
    data['requireSmeSignoff'] = args.requireSmeSignoff;
    changedFields.push('requireSmeSignoff');
  }

  if (changedFields.length === 0) {
    throw new TaxonomyError('VALIDATION_FAILED', 'Nothing was changed.');
  }

  await transactWithAudit({
    prisma: deps.prisma,
    auditWriter: taxonomyWriter(deps),
    action: 'ADMIN.TAXONOMY.DOMAIN_UPDATED',
    work: async (tx: TransactionClient) =>
      tx.domain.update({
        where: { id: current.id },
        data,
        select: { id: true, code: true, name: true, isActive: true },
      }),
    audit: (domain) => ({
      ...taxonomyActorFields(actor),
      action: 'ADMIN.TAXONOMY.DOMAIN_UPDATED' as const,
      outcome: 'SUCCESS' as const,
      entityType: 'Domain',
      entityId: domain.id,
      entityLabel: `${domain.code} — ${domain.name}`,
      // H2: DOMAIN_UPDATED is a declared value-diff action, so the before and
      // after belong in the columns built for them rather than only in detail.
      previousValue: {
        code: current.code,
        name: current.name,
        description: current.description,
        isActive: current.isActive,
        requireSmeSignoff: current.requireSmeSignoff,
      },
      newValue: { ...data, modifiedByUserId: undefined },
      // `changedFields` is what makes this row readable years later: the row
      // itself cannot say whether a deactivation or a rename happened.
      detail: {
        code: domain.code,
        name: domain.name,
        isActive: domain.isActive,
        changedFields,
      },
    }),
  });

  const read = await readTaxonomy(deps, {});
  const row = read.domains.find((candidate) => candidate.domainId === current.id);
  if (row === undefined) throw new TaxonomyError('NOT_FOUND', 'The domain was not readable back.');
  return row;
};

export interface CreateTopicArgs {
  readonly domainId: string;
  readonly name: string;
  readonly description?: string | null;
  readonly isActive?: boolean;
}

export const createTopic = async (
  deps: TaxonomyDeps,
  actor: TaxonomyActor,
  args: CreateTopicArgs,
): Promise<TopicRow> => {
  const name = normalizeDisplayName(args.name, 'topic');
  const slug = topicSlug(name);
  const description = normalizeDescription(args.description);

  const domain = await deps.prisma.domain.findUnique({
    where: { id: args.domainId },
    select: { id: true, code: true, isActive: true },
  });
  if (domain === null) {
    throw new TaxonomyError(
      'NOT_FOUND',
      'No domain with that id exists. A topic belongs to exactly one domain.',
    );
  }
  if (!domain.isActive) {
    throw new TaxonomyError(
      'VALIDATION_FAILED',
      `The domain ${domain.code} is deactivated. Reactivate it before adding a topic, ` +
        'otherwise the topic could never be selected.',
    );
  }

  const clash = await deps.prisma.topic.findFirst({
    where: { domainId: domain.id, slug },
    select: { id: true, name: true, isActive: true },
  });
  if (clash !== null) {
    throw new TaxonomyError(
      'TAXONOMY_DUPLICATE',
      `The topic "${clash.name}" already exists in ${domain.code}` +
        (clash.isActive ? '.' : ', deactivated. Reactivate it rather than creating a second.'),
    );
  }

  const created = await transactWithAudit({
    prisma: deps.prisma,
    auditWriter: taxonomyWriter(deps),
    action: 'ADMIN.TAXONOMY.TOPIC_CREATED',
    work: async (tx: TransactionClient) =>
      tx.topic.create({
        data: {
          domainId: domain.id,
          name,
          slug,
          description,
          isActive: args.isActive ?? true,
          createdByUserId: actor.userId,
          modifiedByUserId: actor.userId,
        },
        select: { id: true, name: true, slug: true, isActive: true },
      }),
    audit: (topic) => ({
      ...taxonomyActorFields(actor),
      action: 'ADMIN.TAXONOMY.TOPIC_CREATED' as const,
      outcome: 'SUCCESS' as const,
      entityType: 'Topic',
      entityId: topic.id,
      entityLabel: `${domain.code} / ${topic.name}`,
      detail: {
        name: topic.name,
        slug: topic.slug,
        domainCode: domain.code,
        isActive: topic.isActive,
      },
    }),
  });

  const read = await readTaxonomy(deps, { domainId: domain.id });
  const row = read.topics.find((candidate) => candidate.topicId === created.id);
  if (row === undefined) throw new TaxonomyError('NOT_FOUND', 'The topic was not readable back.');
  return row;
};

export interface UpdateTopicArgs {
  readonly topicId: string;
  readonly name?: string;
  readonly description?: string | null;
  readonly isActive?: boolean;
}

export const updateTopic = async (
  deps: TaxonomyDeps,
  actor: TaxonomyActor,
  args: UpdateTopicArgs,
): Promise<TopicRow> => {
  const current = await deps.prisma.topic.findUnique({
    where: { id: args.topicId },
    select: {
      id: true,
      domainId: true,
      name: true,
      slug: true,
      description: true,
      isActive: true,
      domain: { select: { code: true } },
    },
  });
  if (current === null) {
    throw new TaxonomyError('NOT_FOUND', 'No topic with that id exists.');
  }

  const changedFields: string[] = [];
  const data: Record<string, unknown> = { modifiedByUserId: actor.userId };
  let renamed = false;

  if (args.name !== undefined) {
    const name = normalizeDisplayName(args.name, 'topic');
    if (name !== current.name) {
      const slug = topicSlug(name);
      if (slug !== current.slug) {
        const clash = await deps.prisma.topic.findFirst({
          where: { domainId: current.domainId, slug, id: { not: current.id } },
          select: { name: true },
        });
        if (clash !== null) {
          throw new TaxonomyError(
            'TAXONOMY_DUPLICATE',
            `"${clash.name}" already occupies that name in ${current.domain.code}.`,
          );
        }
        data['slug'] = slug;
        changedFields.push('slug');
      }
      data['name'] = name;
      changedFields.push('name');
      renamed = true;
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

  if (changedFields.length === 0) {
    throw new TaxonomyError('VALIDATION_FAILED', 'Nothing was changed.');
  }

  // A rename gets TOPIC_RENAMED and everything else TOPIC_UPDATED, because the
  // previous name is the one fact a reader cannot recover from the row: the
  // topic no longer holds it anywhere.
  const action = renamed
    ? ('ADMIN.TAXONOMY.TOPIC_RENAMED' as const)
    : ('ADMIN.TAXONOMY.TOPIC_UPDATED' as const);

  await transactWithAudit({
    prisma: deps.prisma,
    auditWriter: taxonomyWriter(deps),
    action,
    work: async (tx: TransactionClient) =>
      tx.topic.update({
        where: { id: current.id },
        data,
        select: { id: true, name: true, slug: true, isActive: true },
      }),
    audit: (topic) => ({
      ...taxonomyActorFields(actor),
      action,
      outcome: 'SUCCESS' as const,
      entityType: 'Topic',
      entityId: topic.id,
      entityLabel: `${current.domain.code} / ${topic.name}`,
      // H2 again: both topic update actions are declared value-diff actions.
      previousValue: {
        name: current.name,
        slug: current.slug,
        description: current.description,
        isActive: current.isActive,
      },
      newValue: { ...data, modifiedByUserId: undefined },
      detail: renamed
        ? {
            name: topic.name,
            slug: topic.slug,
            domainCode: current.domain.code,
            previousName: current.name,
          }
        : {
            name: topic.name,
            slug: topic.slug,
            domainCode: current.domain.code,
            isActive: topic.isActive,
            changedFields,
          },
    }),
  });

  const read = await readTaxonomy(deps, { domainId: current.domainId });
  const row = read.topics.find((candidate) => candidate.topicId === current.id);
  if (row === undefined) throw new TaxonomyError('NOT_FOUND', 'The topic was not readable back.');
  return row;
};
