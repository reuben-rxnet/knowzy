// AI Document Studio M3 -- the reads behind the Studio's screens
// (docs/competencies/AI_DOCUMENT_STUDIO_ARCHITECTURE.md §11.1, §11.5, §11.8).
//
// Every read reports the provider honestly: `live` is false for the test
// preparer, so a screen labels its output "Test preparation — not AI" and
// never "AI". Change marking is computed here on every read, by one rule, so
// an AI version and a person's edit are marked the same way.

import type { PrismaClient } from '@knowzy/database';
import {
  parsePreparedMarkdown,
  TEST_PREPARATION_PROVIDER,
  type PreparedDocumentExport,
  type PreparedVersionState,
} from '@knowzy/shared-types';
import { markChanges, type MarkedNode, type PreparationWarning } from './checks.js';
import { DocumentPreparationError } from './preparation-service.js';
import { findStudioSourceIds } from './studio-sources.js';
import { readOriginalText, type OriginalSection } from './original-text.js';

const displayNames = async (
  prisma: PrismaClient,
  ids: readonly (string | null)[],
): Promise<Map<string, string>> => {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
  if (wanted.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: wanted } },
    select: { id: true, displayName: true },
  });
  return new Map(users.map((user) => [user.id, user.displayName]));
};

const iso = (date: Date | null): string | null => date?.toISOString() ?? null;

export const isLiveProvider = (providerId: string): boolean =>
  providerId !== TEST_PREPARATION_PROVIDER;

export interface PreparedDocumentRow {
  readonly preparedDocumentId: string;
  readonly title: string;
  readonly originalName: string;
  readonly originalSourceName: string;
  readonly uploaded: boolean;
  readonly latestVersion: {
    readonly versionNumber: number;
    readonly state: PreparedVersionState;
  } | null;
  readonly readyVersionNumber: number | null;
  readonly needsRevalidation: boolean;
  readonly updatedAt: string;
}

export const listPreparedDocuments = async (
  prisma: PrismaClient,
): Promise<PreparedDocumentRow[]> => {
  const rows = await prisma.preparedDocument.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 200,
    select: {
      id: true,
      title: true,
      updatedAt: true,
      original: {
        select: {
          name: true,
          source: { select: { name: true } },
          studioUpload: { select: { originalFileName: true } },
        },
      },
      versions: {
        orderBy: { versionNumber: 'desc' },
        select: { versionNumber: true, state: true },
      },
    },
  });
  return rows.map((row) => {
    const latest = row.versions[0] ?? null;
    return {
      preparedDocumentId: row.id,
      title: row.title,
      originalName: row.original.studioUpload?.originalFileName ?? row.original.name,
      originalSourceName: row.original.source.name,
      uploaded: row.original.studioUpload !== null,
      latestVersion:
        latest === null ? null : { versionNumber: latest.versionNumber, state: latest.state },
      readyVersionNumber:
        row.versions.find((version) => version.state === 'READY_FOR_QUESTION_GENERATION')
          ?.versionNumber ?? null,
      needsRevalidation: row.versions.some((version) => version.state === 'REVALIDATION_REQUIRED'),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
};

export interface PreparedVersionSummary {
  readonly versionId: string;
  readonly versionNumber: number;
  readonly state: PreparedVersionState;
  readonly origin: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly live: boolean;
  readonly promptVersion: string;
  readonly preparedAt: string;
  readonly preparedBy: string | null;
  readonly editedAt: string | null;
  readonly editedBy: string | null;
  readonly addedAt: string | null;
  readonly addedBy: string | null;
  readonly originalVersionCounter: number;
  readonly originalContentHash: string;
  readonly contentSha256: string;
  readonly repositoryDocumentId: string | null;
  readonly revalidationReason: string | null;
  readonly supersededAt: string | null;
}

export interface PreparedDocumentDetail {
  readonly preparedDocumentId: string;
  readonly title: string;
  readonly original: {
    readonly documentId: string;
    readonly name: string;
    readonly sourceName: string;
    readonly versionCounter: number;
    readonly contentHash: string | null;
    readonly status: string;
    readonly uploaded: boolean;
    readonly scanStatus: string | null;
    /** The original section by section, WITH its headings, as a person reads it. */
    readonly sections: readonly OriginalSection[];
  };
  readonly versions: readonly PreparedVersionSummary[];
  /** The version shown: the open draft, else the newest. */
  readonly current:
    | (PreparedVersionSummary & {
        readonly content: string;
        readonly marked: readonly MarkedNode[];
        readonly warnings: readonly PreparationWarning[];
        readonly aiContentAvailable: boolean;
      })
    | null;
  readonly repositorySourceId: string | null;
  readonly runs: readonly {
    readonly runId: string;
    readonly providerId: string;
    readonly modelId: string;
    readonly live: boolean;
    readonly status: string;
    readonly outcomeReason: string | null;
    readonly startedAt: string;
    readonly finishedAt: string | null;
    readonly inputTokens: number | null;
    readonly outputTokens: number | null;
    readonly requestedBy: string | null;
  }[];
}

export const preparedDocumentDetail = async (
  prisma: PrismaClient,
  args: {
    readonly preparedDocumentId: string;
    readonly versionId?: string;
    readonly storageRoot: string | null;
  },
): Promise<PreparedDocumentDetail> => {
  const row = await prisma.preparedDocument.findUnique({
    where: { id: args.preparedDocumentId },
    select: {
      id: true,
      title: true,
      original: {
        select: {
          id: true,
          name: true,
          localVersionCounter: true,
          contentHash: true,
          status: true,
          extractedText: true,
          source: { select: { name: true } },
          studioUpload: { select: { originalFileName: true, scanStatus: true } },
        },
      },
      versions: { orderBy: { versionNumber: 'desc' } },
      runs: { orderBy: { startedAt: 'desc' }, take: 50 },
    },
  });
  if (row === null)
    throw new DocumentPreparationError('NOT_FOUND', 'No prepared document with that id exists.');
  const names = await displayNames(prisma, [
    ...row.versions.flatMap((version) => [
      version.preparedByUserId,
      version.editedByUserId,
      version.addedByUserId,
    ]),
    ...row.runs.map((run) => run.requestedByUserId),
  ]);
  const name = (id: string | null): string | null => (id === null ? null : (names.get(id) ?? null));

  const summaries: PreparedVersionSummary[] = row.versions.map((version) => ({
    versionId: version.id,
    versionNumber: version.versionNumber,
    state: version.state,
    origin: version.origin,
    providerId: version.providerId,
    modelId: version.modelId,
    live: isLiveProvider(version.providerId),
    promptVersion: version.promptVersion,
    preparedAt: version.preparedAt.toISOString(),
    preparedBy: name(version.preparedByUserId),
    editedAt: iso(version.editedAt),
    editedBy: name(version.editedByUserId),
    addedAt: iso(version.addedAt),
    addedBy: name(version.addedByUserId),
    originalVersionCounter: version.originalVersionCounter,
    originalContentHash: version.originalContentHash,
    contentSha256: version.contentSha256,
    repositoryDocumentId: version.repositoryDocumentId,
    revalidationReason: version.revalidationReason,
    supersededAt: iso(version.supersededAt),
  }));
  const chosen =
    (args.versionId === undefined
      ? undefined
      : row.versions.find((version) => version.id === args.versionId)) ??
    row.versions.find((version) => version.state === 'DRAFT') ??
    row.versions[0];
  const originalText = await readOriginalText(prisma, {
    documentId: row.original.id,
    versionCounter: row.original.localVersionCounter,
    extractedText: row.original.extractedText ?? '',
  });
  const text = originalText.comparisonText;
  const current =
    chosen === undefined
      ? null
      : {
          ...(summaries.find(
            (summary) => summary.versionId === chosen.id,
          ) as PreparedVersionSummary),
          content: chosen.content,
          marked: markChanges(text, parsePreparedMarkdown(chosen.content)),
          warnings: (Array.isArray(chosen.checks)
            ? chosen.checks
            : []) as unknown as PreparationWarning[],
          aiContentAvailable: chosen.preparationRunId !== null,
        };
  const studio = await findStudioSourceIds(prisma, args.storageRoot);
  return {
    preparedDocumentId: row.id,
    title: row.title,
    original: {
      documentId: row.original.id,
      name: row.original.studioUpload?.originalFileName ?? row.original.name,
      sourceName: row.original.source.name,
      versionCounter: row.original.localVersionCounter,
      contentHash: row.original.contentHash,
      status: row.original.status,
      uploaded: row.original.studioUpload !== null,
      scanStatus: row.original.studioUpload?.scanStatus ?? null,
      sections: originalText.sections,
    },
    versions: summaries,
    current,
    repositorySourceId: studio.prepared,
    runs: row.runs.map((run) => ({
      runId: run.id,
      providerId: run.providerId,
      modelId: run.modelId,
      live: isLiveProvider(run.providerId),
      status: run.status,
      outcomeReason: run.outcomeReason,
      startedAt: run.startedAt.toISOString(),
      finishedAt: iso(run.finishedAt),
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      requestedBy: name(run.requestedByUserId),
    })),
  };
};

export interface StudioHistoryEvent {
  readonly at: string;
  readonly preparedDocumentId: string;
  readonly title: string;
  readonly kind: 'PREPARATION' | 'VERSION';
  readonly label: string;
  readonly status: string;
  readonly providerId: string;
  readonly live: boolean;
  readonly versionNumber: number | null;
  readonly by: string | null;
  readonly detail: string | null;
}

/** The History view: preparation attempts and version changes, newest first. */
export const studioHistory = async (prisma: PrismaClient): Promise<StudioHistoryEvent[]> => {
  const [runs, versions] = await Promise.all([
    prisma.documentPreparationRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 100,
      select: {
        startedAt: true,
        status: true,
        providerId: true,
        outcomeReason: true,
        requestedByUserId: true,
        preparedDocument: { select: { id: true, title: true } },
      },
    }),
    prisma.preparedDocumentVersion.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 100,
      select: {
        updatedAt: true,
        state: true,
        versionNumber: true,
        providerId: true,
        addedByUserId: true,
        editedByUserId: true,
        preparedByUserId: true,
        revalidationReason: true,
        preparedDocument: { select: { id: true, title: true } },
      },
    }),
  ]);
  const names = await displayNames(prisma, [
    ...runs.map((run) => run.requestedByUserId),
    ...versions.flatMap((version) => [
      version.addedByUserId ?? version.editedByUserId ?? version.preparedByUserId,
    ]),
  ]);
  const events: StudioHistoryEvent[] = [
    ...runs.map((run) => ({
      at: run.startedAt.toISOString(),
      preparedDocumentId: run.preparedDocument.id,
      title: run.preparedDocument.title,
      kind: 'PREPARATION' as const,
      label: 'Prepare for question generation',
      status: run.status,
      providerId: run.providerId,
      live: isLiveProvider(run.providerId),
      versionNumber: null,
      by: names.get(run.requestedByUserId) ?? null,
      detail: run.outcomeReason,
    })),
    ...versions.map((version) => ({
      at: version.updatedAt.toISOString(),
      preparedDocumentId: version.preparedDocument.id,
      title: version.preparedDocument.title,
      kind: 'VERSION' as const,
      label: `Version ${version.versionNumber}`,
      status: version.state,
      providerId: version.providerId,
      live: isLiveProvider(version.providerId),
      versionNumber: version.versionNumber,
      by:
        names.get(version.addedByUserId ?? version.editedByUserId ?? version.preparedByUserId) ??
        null,
      detail: version.revalidationReason,
    })),
  ];
  return events.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 150);
};

/** "Choose an existing synchronized document": extracted, active, not the Studio's own. */
export const preparationCandidates = async (
  prisma: PrismaClient,
  args: { readonly storageRoot: string | null; readonly query?: string },
): Promise<
  {
    readonly documentId: string;
    readonly name: string;
    readonly sourceName: string;
    readonly preparedDocumentId: string | null;
  }[]
> => {
  const studio = await findStudioSourceIds(prisma, args.storageRoot);
  const excluded = [studio.originals, studio.prepared].filter((id): id is string => id !== null);
  const query = args.query?.trim() ?? '';
  const rows = await prisma.knowledgeDocument.findMany({
    where: {
      status: 'ACTIVE',
      extractionStatus: 'EXTRACTED',
      ...(excluded.length === 0 ? {} : { sourceId: { notIn: excluded } }),
      ...(query.length === 0 ? {} : { name: { contains: query, mode: 'insensitive' as const } }),
      source: { archivedAt: null },
    },
    orderBy: [{ name: 'asc' }],
    take: 200,
    select: {
      id: true,
      name: true,
      source: { select: { name: true } },
      preparedFrom: { select: { id: true } },
    },
  });
  return rows.map((row) => ({
    documentId: row.id,
    name: row.name,
    sourceName: row.source.name,
    preparedDocumentId: row.preparedFrom?.id ?? null,
  }));
};

/**
 * §11.8: what a question generated from a prepared document says about its
 * source. Null when the question's source document is not a prepared version.
 */
export const preparedLineageFor = async (
  prisma: PrismaClient,
  args: { readonly sourceId: string; readonly sourceDocumentId: string },
): Promise<{
  readonly preparedDocumentId: string;
  readonly versionNumber: number;
  readonly state: PreparedVersionState;
  readonly title: string;
  readonly originalDocumentId: string;
  readonly originalName: string;
  readonly originalVersionCounter: number;
  readonly providerId: string;
  readonly live: boolean;
} | null> => {
  const document = await prisma.knowledgeDocument.findUnique({
    where: {
      sourceId_sourceDocumentId: {
        sourceId: args.sourceId,
        sourceDocumentId: args.sourceDocumentId,
      },
    },
    select: {
      preparedRepository: {
        select: {
          versionNumber: true,
          state: true,
          originalVersionCounter: true,
          providerId: true,
          preparedDocument: { select: { id: true, title: true } },
          original: {
            select: { id: true, name: true, studioUpload: { select: { originalFileName: true } } },
          },
        },
      },
    },
  });
  const version = document?.preparedRepository ?? null;
  if (version === null) return null;
  return {
    preparedDocumentId: version.preparedDocument.id,
    versionNumber: version.versionNumber,
    state: version.state,
    title: version.preparedDocument.title,
    originalDocumentId: version.original.id,
    originalName: version.original.studioUpload?.originalFileName ?? version.original.name,
    originalVersionCounter: version.originalVersionCounter,
    providerId: version.providerId,
    live: isLiveProvider(version.providerId),
  };
};

/** What a download needs, read once. */
export const preparedExportFor = async (
  prisma: PrismaClient,
  versionId: string,
): Promise<{
  readonly export: PreparedDocumentExport;
  readonly preparedDocumentId: string;
  readonly versionNumber: number;
}> => {
  const version = await prisma.preparedDocumentVersion.findUnique({
    where: { id: versionId },
    select: {
      versionNumber: true,
      content: true,
      providerId: true,
      modelId: true,
      preparedAt: true,
      originalVersionCounter: true,
      preparedDocument: { select: { id: true, title: true } },
      original: { select: { name: true, studioUpload: { select: { originalFileName: true } } } },
    },
  });
  if (version === null)
    throw new DocumentPreparationError('NOT_FOUND', 'No prepared version with that id exists.');
  const originalName = version.original.studioUpload?.originalFileName ?? version.original.name;
  return {
    preparedDocumentId: version.preparedDocument.id,
    versionNumber: version.versionNumber,
    export: {
      title: `${version.preparedDocument.title} — Assessment-prepared document`,
      originalName,
      originalVersion: String(version.originalVersionCounter),
      preparedVersion: version.versionNumber,
      preparedBy: isLiveProvider(version.providerId)
        ? `${version.providerId} (${version.modelId})`
        : 'Test preparation — not AI',
      preparedAt: `${version.preparedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
      nodes: parsePreparedMarkdown(version.content),
    },
  };
};
