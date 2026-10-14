// AI Document Studio M3 -- the Studio's two SYSTEM sources
// (docs/competencies/AI_DOCUMENT_STUDIO_ARCHITECTURE.md §11.2, §11.8).
//
//   AI Document Studio — Originals      uploaded originals; NOT usable for
//                                        generation (a person prepares them first)
//   Assessment-prepared documents        prepared versions added to the
//                                        repository; usable for generation
//
// Both are ordinary FILE_REPOSITORY sources under the deployment's Studio
// storage root, created on first use through the same `createSource` path an
// administrator uses -- so they are synchronized, sectioned, versioned and
// verified exactly as every other document is. That is the whole design: an
// uploaded file and a prepared version enter the platform on the existing
// rails, never a second set.
//
// A source is FOUND by its root path, never by its name: a name is editable on
// the Sources screen, the root is not.

import type { PrismaClient } from '@knowzy/database';
import type { Clock } from '@knowzy/observability';
import { addSourcePath, createSource, type SourceActor } from '../sync/source-administration.js';

export const STUDIO_ORIGINALS = {
  name: 'AI Document Studio — Originals',
  folder: 'originals',
  container: 'Uploaded',
  usableForGeneration: false,
} as const;

export const STUDIO_PREPARED = {
  name: 'Assessment-prepared documents',
  folder: 'prepared',
  container: 'Prepared',
  usableForGeneration: true,
} as const;

type StudioSourceSpec = typeof STUDIO_ORIGINALS | typeof STUDIO_PREPARED;

/** The Studio's file system, implemented by the API. Every path is server-made. */
export interface StudioStorage {
  /** Absolute, from DOCUMENT_STUDIO_STORAGE_DIR. */
  readonly root: string;
  /** Writes once; refuses to overwrite. */
  writeOriginal(storedName: string, bytes: Uint8Array): Promise<void>;
  removeOriginal(storedName: string): Promise<void>;
  writePrepared(fileName: string, text: string): Promise<void>;
}

/** Test connection and synchronize, through MCP as every other sync does. */
export interface StudioSync {
  testConnection(sourceId: string): Promise<void>;
  synchronize(sourceId: string): Promise<void>;
}

export const sourceRoot = (root: string, spec: StudioSourceSpec): string =>
  `${root.replace(/\/+$/, '')}/${spec.folder}`;

export const studioFilePath = (root: string, spec: StudioSourceSpec, fileName: string): string =>
  `${sourceRoot(root, spec)}/${spec.container}/${fileName}`;

/** Ids of the Studio's sources that exist, for excluding them from "choose a document". */
export const findStudioSourceIds = async (
  prisma: PrismaClient,
  root: string | null,
): Promise<{ originals: string | null; prepared: string | null }> => {
  const byRoot = async (spec: StudioSourceSpec): Promise<string | null> => {
    if (root === null) {
      const named = await prisma.knowledgeSource.findFirst({
        where: { name: spec.name, archivedAt: null },
        select: { id: true },
      });
      return named?.id ?? null;
    }
    const row = await prisma.knowledgeSource.findFirst({
      where: {
        archivedAt: null,
        connection: { path: ['localRoot'], equals: sourceRoot(root, spec) },
      },
      select: { id: true },
    });
    return row?.id ?? null;
  };
  return { originals: await byRoot(STUDIO_ORIGINALS), prepared: await byRoot(STUDIO_PREPARED) };
};

/** Finds or creates one Studio source, active and tested, with its one path. */
export const ensureStudioSource = async (args: {
  readonly prisma: PrismaClient;
  readonly clock: Clock;
  readonly actor: SourceActor;
  readonly storage: StudioStorage;
  readonly sync: StudioSync;
  readonly spec: StudioSourceSpec;
}): Promise<string> => {
  const existing = await findStudioSourceIds(args.prisma, args.storage.root);
  const found = args.spec === STUDIO_ORIGINALS ? existing.originals : existing.prepared;
  if (found !== null) return found;

  const root = sourceRoot(args.storage.root, args.spec);
  const deps = {
    prisma: args.prisma,
    clock: args.clock,
    // The Studio's own root, and only it: this is not an operator choosing a
    // path, and the operator allow-list is not widened by it.
    allowedLocalRoots: [root],
    registeredSourceTypes: ['FILE_REPOSITORY'],
  };
  // Source names are unique platform-wide. A second storage root (another
  // deployment slot, or a test) is named by its root rather than refused.
  const taken = await args.prisma.knowledgeSource.findFirst({
    where: { name: args.spec.name },
    select: { id: true },
  });
  const created = await createSource(deps, args.actor, {
    name: taken === null ? args.spec.name : `${args.spec.name} (${root})`.slice(0, 200),
    description:
      args.spec === STUDIO_ORIGINALS
        ? 'Managed by the AI Document Studio: uploaded original documents, kept unchanged.'
        : 'Managed by the AI Document Studio: assessment-prepared documents added to the Question Generation Repository.',
    sourceType: 'FILE_REPOSITORY',
    localRoot: root,
    usableForGeneration: args.spec.usableForGeneration,
    isActive: true,
  });
  await addSourcePath(deps, args.actor, {
    sourceId: created.sourceId,
    containerName: args.spec.container,
    folderPath: '/',
  });
  await args.sync.testConnection(created.sourceId);
  return created.sourceId;
};
