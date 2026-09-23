// Source workflow administration — create, edit, pause, resume, archive, paths.
//
// WHY THIS DID NOT EXIST UNTIL NOW: sources were seed-only. `source.manage`
// has been a permission key with nothing behind it since Phase 2, exactly as
// `taxonomy.manage` was until 2026-09-22. The Sync Manager's central action is
// "New Workflow", so the gap had to close before the screen could be honest.
//
// Three rules shape everything below.
//
// **1. Lineage is never deleted.** A source with documents, questions,
// assessments or sync history cannot be hard-deleted, because every published
// question cites its source document and a published QuestionID has left this
// platform. Such a source is ARCHIVED: invisible to selection, intact for
// lineage. A hard delete is permitted only for a source nothing references,
// which is the mistyped-registration case.
//
// **2. A local path is validated against configured roots, server-side.** The
// browser never browses the server's filesystem. A FILE_REPOSITORY source
// names a root, and that root must sit inside an allow-list the deployment
// declares -- otherwise "register a source" is a directory-traversal primitive
// with a form in front of it.
//
// **3. Only adapters that are actually registered may be offered.** Choosing
// SHAREPOINT today would create a source that can never synchronize, and the
// failure would surface as a connection error rather than as the truth, which
// is that the adapter has not been written.

import {
  createAuditWriter,
  transactWithAudit,
  type AuditWriter,
  type PrismaClient,
  type TransactionClient,
} from '@knowzy/database';
import type { Clock } from '@knowzy/observability';
import type { ErrorCode } from '@knowzy/shared-types';
import { requireSchedule, scheduleOf, type SyncSchedule } from './schedule.js';

export interface SourceActor {
  readonly userId: string;
  readonly displayName: string;
  readonly roles: readonly string[];
  readonly correlationId: string;
  readonly requestId: string;
}

export interface SourceAdminDeps {
  readonly prisma: PrismaClient;
  readonly clock: Clock;
  readonly auditWriter?: AuditWriter;
  /**
   * Absolute directories a FILE_REPOSITORY source may read, from deployment
   * configuration. EMPTY MEANS NONE: a deployment that declares no root
   * cannot register a local source, which is the safe default rather than an
   * inconvenience.
   */
  readonly allowedLocalRoots: readonly string[];
  /** Adapter kinds this environment can actually run. */
  readonly registeredSourceTypes: readonly string[];
}

export class SourceAdminError extends Error {
  constructor(
    readonly code: ErrorCode,
    detail: string,
  ) {
    super(detail);
    this.name = 'SourceAdminError';
  }
}

// ---------------------------------------------------------------------------
// Path validation — pure, and tested without a filesystem

/** Slashes normalized, trailing separators dropped, case folded on Windows. */
const canonical = (path: string): string => {
  const unified = path.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? unified.toLowerCase() : unified;
};

/**
 * Whether `candidate` is inside `root`, as paths rather than as strings.
 *
 * The string form of this check is the classic mistake: `startsWith('/data')`
 * accepts `/database-secrets`. Comparing segment-wise refuses it.
 */
export const isWithinRoot = (candidate: string, root: string): boolean => {
  const c = canonical(candidate).split('/').filter(Boolean);
  const r = canonical(root).split('/').filter(Boolean);
  if (r.length === 0 || c.length < r.length) return false;
  return r.every((segment, index) => c[index] === segment);
};

/**
 * Validates an operator-supplied local root.
 *
 * Refuses traversal, refuses a relative path, and refuses anything outside the
 * declared roots -- each with its own message, because "invalid path" tells an
 * operator nothing about which rule they met.
 */
export const requireAllowedLocalRoot = (input: string, allowedRoots: readonly string[]): string => {
  const path = input.trim();
  if (path.length === 0) {
    throw new SourceAdminError('VALIDATION_FAILED', 'A file-repository source needs a root path.');
  }
  if (path.includes('..')) {
    throw new SourceAdminError(
      'VALIDATION_FAILED',
      'A root path may not contain "..". Name the directory itself.',
    );
  }
  if (path.includes('\0')) {
    throw new SourceAdminError('VALIDATION_FAILED', 'A root path may not contain a null byte.');
  }
  const absolute = /^([a-zA-Z]:[\\/]|\/)/.test(path);
  if (!absolute) {
    throw new SourceAdminError(
      'VALIDATION_FAILED',
      'A root path must be absolute. A relative path resolves against whatever ' +
        'directory the service happens to be running in.',
    );
  }
  if (allowedRoots.length === 0) {
    throw new SourceAdminError(
      'SOURCE_NOT_CONFIGURED',
      'This environment declares no allowed source roots, so a file-repository source ' +
        'cannot be registered. Set sources.allowedLocalRoots first.',
    );
  }
  if (!allowedRoots.some((root) => isWithinRoot(path, root))) {
    throw new SourceAdminError(
      'SOURCE_FORBIDDEN',
      `That path is outside every allowed root (${allowedRoots.join(', ')}). ` +
        'The allow-list is deployment configuration, not something a form may widen.',
    );
  }
  return path;
};

/**
 * The one legal form of a folder path, as the DATABASE defines it.
 *
 * Migration 0003 carries `knowledge_source_path_normalized_check`: a path must
 * start with `/`, must not contain `..`, and must not end with `/` unless it
 * IS `/`. Writing `SOPs/2026` or `''` violates it, and the failure arrives as
 * a raw constraint violation rather than as anything an operator could act on
 * -- which is how the first version of this code failed.
 *
 * So the normalization lives here, next to the rule it satisfies, and `/` is
 * the container root: "everything under this container".
 */
export const normalizeFolderPath = (input: string | null | undefined): string => {
  const raw = (input ?? '').trim().replace(/\\/g, '/');
  if (raw.includes('..')) {
    throw new SourceAdminError(
      'VALIDATION_FAILED',
      'A folder path may not contain "..". Name the folder itself.',
    );
  }
  const segments = raw.split('/').filter((segment) => segment.length > 0 && segment !== '.');
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
};

// ---------------------------------------------------------------------------
// Writes

const writer = (deps: SourceAdminDeps): AuditWriter =>
  deps.auditWriter ?? createAuditWriter({ clock: deps.clock });

const actorFields = (actor: SourceActor) => ({
  actorUserId: actor.userId,
  actorDisplayName: actor.displayName,
  actorRoles: [...actor.roles],
  correlationId: actor.correlationId,
  requestId: actor.requestId,
  portal: 'AUTHORING' as const,
});

export interface CreateSourceArgs {
  readonly name: string;
  readonly description?: string | null;
  readonly sourceType: string;
  readonly localRoot?: string;
  readonly usableForGeneration?: boolean;
  readonly schedule?: unknown;
  readonly isActive?: boolean;
}

export interface SourceRow {
  readonly sourceId: string;
  readonly name: string;
  readonly sourceType: string;
  readonly isActive: boolean;
  readonly archivedAt: string | null;
  readonly schedule: SyncSchedule;
}

const rowOf = (source: {
  id: string;
  name: string;
  sourceType: string;
  isActive: boolean;
  archivedAt: Date | null;
  syncSchedule: unknown;
}): SourceRow => ({
  sourceId: source.id,
  name: source.name,
  sourceType: source.sourceType,
  isActive: source.isActive,
  archivedAt: source.archivedAt?.toISOString() ?? null,
  schedule: scheduleOf(source.syncSchedule),
});

export const createSource = async (
  deps: SourceAdminDeps,
  actor: SourceActor,
  args: CreateSourceArgs,
): Promise<SourceRow> => {
  const name = args.name.trim().replace(/\s+/g, ' ');
  if (name.length < 3 || name.length > 200) {
    throw new SourceAdminError(
      'VALIDATION_FAILED',
      'A source name must be between 3 and 200 characters.',
    );
  }
  if (!deps.registeredSourceTypes.includes(args.sourceType)) {
    throw new SourceAdminError(
      'SOURCE_TYPE_NOT_AVAILABLE',
      `${args.sourceType} has no registered adapter in this environment. Available: ` +
        `${deps.registeredSourceTypes.join(', ')}. A source of an unregistered type could ` +
        'never synchronize, and the failure would look like a connection problem rather ' +
        'than a missing adapter.',
    );
  }

  const duplicate = await deps.prisma.knowledgeSource.findFirst({
    where: { name },
    select: { id: true },
  });
  if (duplicate !== null) {
    throw new SourceAdminError(
      'SOURCE_VALIDATION_FAILED',
      `A source named "${name}" already exists. Two sources with one name make every ` +
        'audit row ambiguous.',
    );
  }

  const schedule = requireSchedule(args.schedule ?? { mode: 'MANUAL', timezone: 'UTC' });

  // The connection shape is per adapter. FILE_REPOSITORY is the only kind an
  // operator can register today, and its root is validated above.
  let connection: Record<string, string | number | boolean | string[]> = { authMethod: 'NONE' };
  if (args.sourceType === 'FILE_REPOSITORY') {
    const root = requireAllowedLocalRoot(args.localRoot ?? '', deps.allowedLocalRoots);
    connection = {
      isActive: true,
      localRoot: root,
      provenance: 'MANAGED_UPLOAD',
      maxFileBytes: 33_554_432,
      excludePatterns: [],
      includePatterns: [],
      sidecarsEnabled: false,
      partialSyncFloor: 0.8,
      rootFromEnvironment: false,
      supportedExtensions: [],
    };
  }

  const created = await transactWithAudit({
    prisma: deps.prisma,
    auditWriter: writer(deps),
    action: 'ADMIN.SOURCE.CREATED',
    work: async (tx: TransactionClient) =>
      tx.knowledgeSource.create({
        data: {
          name,
          description: args.description?.trim() ?? null,
          sourceType: args.sourceType as never,
          connection: connection as never,
          restrictions: {},
          usableForGeneration: args.usableForGeneration ?? true,
          // The only two values the enum has. A local repository has no
          // per-user delegation to honour, so it is app-only, and Test
          // Connection says plainly that access is enforced by Knowzy.
          permissionMode: 'APP_ONLY_SITES_SELECTED',
          connectionStatus: 'UNTESTED',
          syncSchedule: schedule,
          // Inactive until tested, deliberately: the seed does the same, and an
          // untested source that is already live invites a first sync nobody
          // asked for.
          isActive: args.isActive ?? false,
          ownerUserId: actor.userId,
          createdByUserId: actor.userId,
          modifiedByUserId: actor.userId,
        },
        select: {
          id: true,
          name: true,
          sourceType: true,
          isActive: true,
          archivedAt: true,
          syncSchedule: true,
        },
      }),
    audit: (source) => ({
      ...actorFields(actor),
      action: 'ADMIN.SOURCE.CREATED' as const,
      outcome: 'SUCCESS' as const,
      entityType: 'KnowledgeSource',
      entityId: source.id,
      entityLabel: source.name,
      sourceId: source.id,
      detail: {
        sourceType: source.sourceType,
        scheduleMode: schedule.mode,
        isActive: source.isActive,
      },
    }),
  });

  return rowOf(created);
};

export interface UpdateSourceArgs {
  readonly sourceId: string;
  readonly name?: string;
  readonly description?: string | null;
  readonly usableForGeneration?: boolean;
  readonly schedule?: unknown;
}

export const updateSource = async (
  deps: SourceAdminDeps,
  actor: SourceActor,
  args: UpdateSourceArgs,
): Promise<SourceRow> => {
  const current = await deps.prisma.knowledgeSource.findUnique({
    where: { id: args.sourceId },
    select: {
      id: true,
      name: true,
      description: true,
      usableForGeneration: true,
      syncSchedule: true,
      archivedAt: true,
    },
  });
  if (current === null) {
    throw new SourceAdminError('NOT_FOUND', 'No source with that id exists.');
  }
  if (current.archivedAt !== null) {
    throw new SourceAdminError(
      'SOURCE_VALIDATION_FAILED',
      'An archived source cannot be edited. Its configuration is kept as it was when it ' +
        'was archived, because published questions still cite documents it indexed.',
    );
  }

  const changedFields: string[] = [];
  const data: Record<string, unknown> = { modifiedByUserId: actor.userId };
  let scheduleChanged: SyncSchedule | null = null;

  if (args.name !== undefined) {
    const name = args.name.trim().replace(/\s+/g, ' ');
    if (name.length < 3 || name.length > 200) {
      throw new SourceAdminError(
        'VALIDATION_FAILED',
        'A source name must be between 3 and 200 characters.',
      );
    }
    if (name !== current.name) {
      const clash = await deps.prisma.knowledgeSource.findFirst({
        where: { name, id: { not: current.id } },
        select: { id: true },
      });
      if (clash !== null) {
        throw new SourceAdminError(
          'SOURCE_VALIDATION_FAILED',
          `A source named "${name}" already exists.`,
        );
      }
      data['name'] = name;
      changedFields.push('name');
    }
  }

  if (args.description !== undefined) {
    const description = args.description === null ? null : args.description.trim();
    if ((description ?? null) !== current.description) {
      data['description'] = description === '' ? null : description;
      changedFields.push('description');
    }
  }

  if (
    args.usableForGeneration !== undefined &&
    args.usableForGeneration !== current.usableForGeneration
  ) {
    data['usableForGeneration'] = args.usableForGeneration;
    changedFields.push('usableForGeneration');
  }

  if (args.schedule !== undefined) {
    const schedule = requireSchedule(args.schedule);
    const before = scheduleOf(current.syncSchedule);
    if (JSON.stringify(schedule) !== JSON.stringify(before)) {
      data['syncSchedule'] = schedule;
      changedFields.push('syncSchedule');
      scheduleChanged = schedule;
    }
  }

  if (changedFields.length === 0) {
    throw new SourceAdminError('VALIDATION_FAILED', 'Nothing was changed.');
  }

  const updated = await transactWithAudit({
    prisma: deps.prisma,
    auditWriter: writer(deps),
    action: 'ADMIN.SOURCE.UPDATED',
    work: async (tx: TransactionClient) =>
      tx.knowledgeSource.update({
        where: { id: current.id },
        data,
        select: {
          id: true,
          name: true,
          sourceType: true,
          isActive: true,
          archivedAt: true,
          syncSchedule: true,
        },
      }),
    audit: (source) => ({
      ...actorFields(actor),
      action: 'ADMIN.SOURCE.UPDATED' as const,
      outcome: 'SUCCESS' as const,
      entityType: 'KnowledgeSource',
      entityId: source.id,
      entityLabel: source.name,
      sourceId: source.id,
      previousValue: {
        name: current.name,
        description: current.description,
        usableForGeneration: current.usableForGeneration,
        schedule: scheduleOf(current.syncSchedule),
      },
      newValue: { ...data, modifiedByUserId: undefined },
      detail: {
        changedFields,
        // The schedule is called out separately, because a schedule change is
        // the one edit that alters what the platform does while nobody is
        // watching.
        ...(scheduleChanged === null
          ? {}
          : { scheduleMode: scheduleChanged.mode, timezone: scheduleChanged.timezone }),
      },
    }),
  });

  return rowOf(updated);
};

/**
 * Pause or resume, as its own operation.
 *
 * Separate from `updateSource` because it is the action an operator takes most
 * often, it needs no other decision, and it gets its OWN audit action —
 * `ADMIN.SOURCE.ACTIVATED` / `DEACTIVATED` — so a reader scanning seven years
 * of audit can find "who paused this and when" without parsing a field list.
 */
export const setSourceActive = async (
  deps: SourceAdminDeps,
  actor: SourceActor,
  args: { readonly sourceId: string; readonly isActive: boolean },
): Promise<SourceRow> => {
  const current = await deps.prisma.knowledgeSource.findUnique({
    where: { id: args.sourceId },
    select: { id: true, name: true, isActive: true, archivedAt: true, connectionStatus: true },
  });
  if (current === null) {
    throw new SourceAdminError('NOT_FOUND', 'No source with that id exists.');
  }
  if (current.archivedAt !== null) {
    throw new SourceAdminError(
      'SOURCE_VALIDATION_FAILED',
      'An archived source cannot be resumed. Archiving is the end of a source’s working ' +
        'life, not a deeper pause.',
    );
  }
  if (current.isActive === args.isActive) {
    throw new SourceAdminError(
      'VALIDATION_FAILED',
      args.isActive ? 'That source is already active.' : 'That source is already paused.',
    );
  }

  const action = args.isActive
    ? ('ADMIN.SOURCE.ACTIVATED' as const)
    : ('ADMIN.SOURCE.DEACTIVATED' as const);

  const updated = await transactWithAudit({
    prisma: deps.prisma,
    auditWriter: writer(deps),
    action,
    work: async (tx: TransactionClient) =>
      tx.knowledgeSource.update({
        where: { id: current.id },
        data: { isActive: args.isActive, modifiedByUserId: actor.userId },
        select: {
          id: true,
          name: true,
          sourceType: true,
          isActive: true,
          archivedAt: true,
          syncSchedule: true,
        },
      }),
    audit: (source) => ({
      ...actorFields(actor),
      action,
      outcome: 'SUCCESS' as const,
      entityType: 'KnowledgeSource',
      entityId: source.id,
      entityLabel: source.name,
      sourceId: source.id,
      detail: { isActive: source.isActive, connectionStatus: current.connectionStatus },
    }),
  });

  return rowOf(updated);
};

export interface LineageCounts {
  readonly documents: number;
  readonly generationJobs: number;
  readonly draftQuestions: number;
  readonly publishedQuestions: number;
  readonly syncRuns: number;
  readonly preflights: number;
}

/** Everything that would be orphaned by a hard delete. */
export const lineageOf = async (
  deps: SourceAdminDeps,
  sourceId: string,
): Promise<LineageCounts> => {
  const [documents, generationJobs, draftQuestions, publishedQuestions, syncRuns, preflights] =
    await Promise.all([
      deps.prisma.knowledgeDocument.count({ where: { sourceId } }),
      deps.prisma.generationJob.count({ where: { sourceId } }),
      deps.prisma.draftQuestion.count({ where: { sourceId } }),
      deps.prisma.draftQuestion.count({ where: { sourceId, status: 'PUBLISHED' } }),
      deps.prisma.knowledgeSourceSync.count({ where: { sourceId } }),
      deps.prisma.generationPreflight.count({ where: { sourceId } }),
    ]);
  return { documents, generationJobs, draftQuestions, publishedQuestions, syncRuns, preflights };
};

export const hasLineage = (counts: LineageCounts): boolean =>
  counts.documents > 0 ||
  counts.generationJobs > 0 ||
  counts.draftQuestions > 0 ||
  counts.publishedQuestions > 0 ||
  counts.syncRuns > 0 ||
  counts.preflights > 0;

/**
 * Archives a source, or hard-deletes one that nothing references.
 *
 * `intent: 'DELETE'` on a source WITH lineage is refused rather than silently
 * downgraded to an archive. An operator who asked to delete and was given an
 * archive would believe the data is gone.
 */
export const retireSource = async (
  deps: SourceAdminDeps,
  actor: SourceActor,
  args: { readonly sourceId: string; readonly intent: 'ARCHIVE' | 'DELETE' },
): Promise<{ readonly outcome: 'ARCHIVED' | 'DELETED'; readonly lineage: LineageCounts }> => {
  const current = await deps.prisma.knowledgeSource.findUnique({
    where: { id: args.sourceId },
    select: { id: true, name: true, archivedAt: true, sourceType: true },
  });
  if (current === null) {
    throw new SourceAdminError('NOT_FOUND', 'No source with that id exists.');
  }

  const lineage = await lineageOf(deps, current.id);

  if (args.intent === 'DELETE' && hasLineage(lineage)) {
    throw new SourceAdminError(
      'SOURCE_HAS_LINEAGE',
      `This source cannot be deleted: ${lineage.documents} document(s), ` +
        `${lineage.draftQuestions} question(s) (${lineage.publishedQuestions} published), ` +
        `${lineage.generationJobs} generation job(s) and ${lineage.syncRuns} sync run(s) ` +
        'reference it. A published question cites its source document, and its QuestionID ' +
        'has already left this platform. Archive it instead — that removes it from every ' +
        'selection surface and keeps the lineage intact.',
    );
  }

  if (args.intent === 'DELETE') {
    await transactWithAudit({
      prisma: deps.prisma,
      auditWriter: writer(deps),
      action: 'ADMIN.SOURCE.DELETED',
      work: async (tx: TransactionClient) => {
        await tx.knowledgeSourcePath.deleteMany({ where: { sourceId: current.id } });
        return tx.knowledgeSource.delete({
          where: { id: current.id },
          select: { id: true, name: true, sourceType: true },
        });
      },
      audit: (source) => ({
        ...actorFields(actor),
        action: 'ADMIN.SOURCE.DELETED' as const,
        outcome: 'SUCCESS' as const,
        entityType: 'KnowledgeSource',
        entityId: source.id,
        entityLabel: source.name,
        // The audit row OUTLIVES the source it describes, which is the point:
        // the row is the only remaining evidence the source ever existed.
        detail: { sourceType: source.sourceType, hadLineage: false },
      }),
    });
    return { outcome: 'DELETED', lineage };
  }

  if (current.archivedAt !== null) {
    throw new SourceAdminError('VALIDATION_FAILED', 'That source is already archived.');
  }

  await transactWithAudit({
    prisma: deps.prisma,
    auditWriter: writer(deps),
    action: 'ADMIN.SOURCE.ARCHIVED',
    work: async (tx: TransactionClient) =>
      tx.knowledgeSource.update({
        where: { id: current.id },
        data: {
          archivedAt: deps.clock.now(),
          isActive: false,
          // A schedule on an archived source would keep firing, so it is
          // stood down here rather than checked for everywhere later.
          syncSchedule: { mode: 'MANUAL', timezone: 'UTC' },
          modifiedByUserId: actor.userId,
        },
        select: { id: true, name: true, sourceType: true },
      }),
    audit: (source) => ({
      ...actorFields(actor),
      action: 'ADMIN.SOURCE.ARCHIVED' as const,
      outcome: 'SUCCESS' as const,
      entityType: 'KnowledgeSource',
      entityId: source.id,
      entityLabel: source.name,
      sourceId: source.id,
      detail: {
        sourceType: source.sourceType,
        documents: lineage.documents,
        draftQuestions: lineage.draftQuestions,
        publishedQuestions: lineage.publishedQuestions,
      },
    }),
  });

  return { outcome: 'ARCHIVED', lineage };
};

export interface PathArgs {
  readonly sourceId: string;
  readonly containerName: string;
  readonly folderPath?: string | null;
  readonly isActive?: boolean;
}

/** Adds a path to scan. The unit a sync iterates. */
export const addSourcePath = async (
  deps: SourceAdminDeps,
  actor: SourceActor,
  args: PathArgs,
): Promise<{ readonly pathId: string }> => {
  const source = await deps.prisma.knowledgeSource.findUnique({
    where: { id: args.sourceId },
    select: { id: true, name: true, archivedAt: true },
  });
  if (source === null) throw new SourceAdminError('NOT_FOUND', 'No source with that id exists.');
  if (source.archivedAt !== null) {
    throw new SourceAdminError(
      'SOURCE_VALIDATION_FAILED',
      'An archived source cannot gain a new path.',
    );
  }

  const containerName = args.containerName.trim();
  if (containerName.length === 0) {
    throw new SourceAdminError(
      'VALIDATION_FAILED',
      'A path needs a container name — the library or top-level folder to scan.',
    );
  }
  const folderPath = normalizeFolderPath(args.folderPath);

  const created = await transactWithAudit({
    prisma: deps.prisma,
    auditWriter: writer(deps),
    action: 'ADMIN.SOURCE.PATH_MODIFIED',
    work: async (tx: TransactionClient) =>
      tx.knowledgeSourcePath.create({
        data: {
          sourceId: source.id,
          // `containerId` is the ADAPTER's identifier for the container. A
          // file-repository adapter identifies a container by its own name,
          // and the caller does not get to invent one: a mismatched id makes
          // the path match nothing and the sync report an empty scan.
          containerId: containerName,
          containerName,
          folderPath,
          isActive: args.isActive ?? true,
          createdByUserId: actor.userId,
        },
        select: { id: true, containerName: true, folderPath: true },
      }),
    audit: (path) => ({
      ...actorFields(actor),
      action: 'ADMIN.SOURCE.PATH_MODIFIED' as const,
      outcome: 'SUCCESS' as const,
      entityType: 'KnowledgeSourcePath',
      entityId: path.id,
      entityLabel: `${source.name} / ${path.containerName}`,
      sourceId: source.id,
      detail: { change: 'ADDED', containerName: path.containerName, folderPath: path.folderPath },
    }),
  });

  return { pathId: created.id };
};

/** Activates, deactivates, or removes a path. */
export const modifySourcePath = async (
  deps: SourceAdminDeps,
  actor: SourceActor,
  args: {
    readonly pathId: string;
    readonly change: 'ACTIVATED' | 'DEACTIVATED' | 'REMOVED';
  },
): Promise<void> => {
  const path = await deps.prisma.knowledgeSourcePath.findUnique({
    where: { id: args.pathId },
    select: {
      id: true,
      containerName: true,
      folderPath: true,
      sourceId: true,
      source: { select: { name: true, archivedAt: true } },
    },
  });
  if (path === null) throw new SourceAdminError('NOT_FOUND', 'No path with that id exists.');
  if (path.source.archivedAt !== null) {
    throw new SourceAdminError(
      'SOURCE_VALIDATION_FAILED',
      'The paths of an archived source are kept as they were.',
    );
  }

  if (args.change === 'REMOVED') {
    const documents = await deps.prisma.knowledgeDocument.count({ where: { pathId: path.id } });
    if (documents > 0) {
      throw new SourceAdminError(
        'SOURCE_HAS_LINEAGE',
        `${documents} indexed document(s) came from this path. Deactivate it instead — ` +
          'removing it would orphan documents that questions may cite.',
      );
    }
  }

  await transactWithAudit({
    prisma: deps.prisma,
    auditWriter: writer(deps),
    action: 'ADMIN.SOURCE.PATH_MODIFIED',
    work: async (tx: TransactionClient) => {
      if (args.change === 'REMOVED') {
        return tx.knowledgeSourcePath.delete({ where: { id: path.id }, select: { id: true } });
      }
      return tx.knowledgeSourcePath.update({
        where: { id: path.id },
        data: { isActive: args.change === 'ACTIVATED' },
        select: { id: true },
      });
    },
    audit: () => ({
      ...actorFields(actor),
      action: 'ADMIN.SOURCE.PATH_MODIFIED' as const,
      outcome: 'SUCCESS' as const,
      entityType: 'KnowledgeSourcePath',
      entityId: path.id,
      entityLabel: `${path.source.name} / ${path.containerName}`,
      sourceId: path.sourceId,
      detail: {
        change: args.change,
        containerName: path.containerName,
        folderPath: path.folderPath,
      },
    }),
  });
};
