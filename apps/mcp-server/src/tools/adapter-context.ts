// Builds an AdapterContext from platform state.
//
// T2 is enforced here rather than in each tool: the caller names a SOURCE, and
// every location identifier — container, folder path, included file types — is
// read from the KnowledgeSourcePath rows the administrator configured. A tool
// argument can therefore never point the adapter at a location nobody
// configured, which is what makes "sources are data, not code" safe.

import type { SourceType } from '@knowzy/shared-types';
import type { AdapterContext, KnowledgeSourcePathConfig } from '@knowzy/knowledge-source-adapters';
import type { AuthorizationEnvelope } from './envelope.js';
import type { SourceRow, ToolDeps } from './deps.js';

export class SourceNotFoundError extends Error {
  readonly code = 'SOURCE_NOT_FOUND';
  constructor(sourceId: string) {
    super(`No active knowledge source with id ${sourceId} is visible to you.`);
    this.name = 'SourceNotFoundError';
  }
}

export class SourceAccessDeniedError extends Error {
  readonly code = 'FORBIDDEN';
  constructor(sourceId: string, reason: string) {
    super(`Access to knowledge source ${sourceId} is denied: ${reason}`);
    this.name = 'SourceAccessDeniedError';
  }
}

/**
 * Applies the envelope's source scope.
 *
 * DENY is evaluated first and is absolute, matching `permitsSource` in
 * @knowzy/shared-types: an explicit deny cannot be overridden by an allow list
 * that happens to include the same source.
 */
export const assertSourcePermitted = (envelope: AuthorizationEnvelope, sourceId: string): void => {
  if (envelope.dataScope.denySourceIds.includes(sourceId)) {
    throw new SourceAccessDeniedError(sourceId, 'the source is explicitly denied for this user');
  }
  const allowList = envelope.dataScope.sourceIds;
  // An empty allow list means unrestricted on this dimension, not "none".
  if (allowList.length > 0 && !allowList.includes(sourceId)) {
    throw new SourceAccessDeniedError(sourceId, "the source is outside this user's source scope");
  }
};

export interface LoadedSource {
  readonly row: SourceRow;
  readonly paths: readonly KnowledgeSourcePathConfig[];
  readonly pathIdByKey: ReadonlyMap<string, string>;
}

/** Normalizes a stored folder path into the adapter's vocabulary. */
const toAdapterFolderPath = (stored: string): string =>
  stored
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
    .join('/');

export const loadSource = async (
  deps: ToolDeps,
  envelope: AuthorizationEnvelope,
  sourceId: string,
): Promise<LoadedSource> => {
  assertSourcePermitted(envelope, sourceId);

  const source = await deps.prisma.knowledgeSource.findFirst({
    where: { id: sourceId, archivedAt: null },
    include: { paths: { where: { isActive: true }, orderBy: { containerId: 'asc' } } },
  });
  if (!source) throw new SourceNotFoundError(sourceId);

  const pathIdByKey = new Map<string, string>();
  const paths: KnowledgeSourcePathConfig[] = source.paths.map((path) => {
    const folderPath = toAdapterFolderPath(path.folderPath);
    pathIdByKey.set(`${path.containerId}::${folderPath}`, path.id);
    return {
      containerId: path.containerId,
      folderPath,
      recursive: true,
      includeFileTypes: path.includedFileTypes,
    };
  });

  return {
    row: {
      id: source.id,
      name: source.name,
      sourceType: source.sourceType,
      connection: source.connection,
      permissionMode: source.permissionMode,
      usableForGeneration: source.usableForGeneration,
      isActive: source.isActive,
    },
    paths,
    pathIdByKey,
  };
};

/**
 * Picks the configured path a discovered document belongs to.
 *
 * A document is always attributed to the most specific configured path that
 * contains it, so a document under `SOPs/Billing` is attributed to that path
 * rather than to a broader `SOPs` entry that also matches.
 */
export const attributePath = (
  loaded: LoadedSource,
  containerId: string,
  folderPath: string,
): string | undefined => {
  const candidates = [...loaded.pathIdByKey.entries()]
    .map(([key, id]) => {
      const [container = '', folder = ''] = key.split('::');
      return { id, container, folder };
    })
    .filter((candidate) => candidate.container === containerId)
    .filter(
      (candidate) =>
        candidate.folder.length === 0 ||
        folderPath === candidate.folder ||
        folderPath.startsWith(`${candidate.folder}/`),
    )
    .sort((a, b) => b.folder.length - a.folder.length);

  return candidates[0]?.id;
};

export interface BuildContextArgs {
  readonly deps: ToolDeps;
  readonly envelope: AuthorizationEnvelope;
  readonly source: LoadedSource;
  readonly signal: AbortSignal;
  /** Narrows the context to one configured path, for a scoped browse. */
  readonly onlyPaths?: readonly KnowledgeSourcePathConfig[];
}

export const buildAdapterContext = (args: BuildContextArgs): AdapterContext => {
  const { deps, envelope, source } = args;
  const permissionMode =
    source.row.permissionMode === 'DELEGATED_OBO' ? 'DELEGATED_OBO' : 'APP_ONLY_SITES_SELECTED';

  return {
    source: {
      knowledgeSourceId: source.row.id,
      // The mock adapter keys its fixture tree by sourceKey. The source NAME is
      // administrator-visible and stable, and using it keeps the fixture
      // mapping out of the connection blob where a secret reference lives.
      sourceKey: readSourceKey(source.row),
      displayName: source.row.name,
      sourceType: source.row.sourceType as SourceType,
      connection: asRecord(source.row.connection),
    },
    paths: args.onlyPaths ?? source.paths,
    credential: {
      kind: 'broker',
      // Phase 7 replaces this with the real broker. Rejecting is the right
      // placeholder: an adapter that needs a credential must fail loudly here
      // rather than receive an empty string and produce a confusing 401.
      resolve: () =>
        Promise.reject(
          new Error('The credential broker is implemented with the SharePoint adapter (Phase 7).'),
        ),
    },
    permissionMode,
    ...(permissionMode === 'DELEGATED_OBO'
      ? { onBehalfOf: { principalId: envelope.subject.entraObjectId } }
      : {}),
    correlationId: envelope.correlationId,
    limits: deps.limits,
    clock: deps.clock,
    signal: args.signal,
  };
};

const asRecord = (value: unknown): Readonly<Record<string, unknown>> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export const readSourceKey = (row: SourceRow): string => {
  const connection = asRecord(row.connection);
  const key = connection['sourceKey'];
  return typeof key === 'string' && key.length > 0 ? key : row.name;
};
