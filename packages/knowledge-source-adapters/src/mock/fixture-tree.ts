// Reads a fixture directory tree deterministically.
//
// knowledge-source-adapters.md §6 and fixtures/README.md make determinism a
// rule, not an aspiration: `sourceDocumentId` is sha256(relativePath), and
// timestamps come from a `{file}.meta.json` sidecar or a fixed base date —
// NEVER from the filesystem. A checkout changes mtimes, so a filesystem
// timestamp would make change detection fire spuriously on a fresh clone and
// would make CI disagree with a developer's machine about document identity.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix, sep } from 'node:path';

/** Used for any fixture without a sidecar, so IDs and dates never vary. */
export const FIXTURE_BASE_DATE = new Date('2025-01-01T00:00:00.000Z');

const SIDECAR_SUFFIX = '.meta.json';

export interface FixtureAccessMap {
  readonly default?: 'ALLOWED' | 'DENIED' | 'UNKNOWN';
  /** Per-principal overrides, keyed by user principal name or object id. */
  readonly principals?: Readonly<Record<string, 'ALLOWED' | 'DENIED' | 'UNKNOWN'>>;
  readonly summary?: string;
}

export interface FixtureSidecar {
  readonly sourceVersion?: string;
  readonly sourceCreatedAt?: string;
  readonly sourceModifiedAt?: string;
  readonly mimeType?: string;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly access?: FixtureAccessMap;
}

export interface FixtureDocument {
  readonly sourceDocumentId: string;
  /** Always forward-slashed, relative to the source root, so IDs match on Windows. */
  readonly relativePath: string;
  readonly name: string;
  readonly containerId: string;
  /** '' at a container root. */
  readonly folderPath: string;
  readonly fileType: string;
  readonly sizeBytes: number;
  readonly sourceVersion: string;
  readonly sourceCreatedAt: Date;
  readonly sourceModifiedAt: Date;
  readonly mimeType: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly access: FixtureAccessMap;
  /** Absolute path on disk. Content is read lazily, on extraction. */
  readonly absolutePath: string;
}

export interface FixtureTree {
  readonly sourceKey: string;
  readonly rootPath: string;
  readonly containers: readonly { containerId: string; itemCount: number }[];
  readonly documents: readonly FixtureDocument[];
}

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain',
  html: 'text/html',
  htm: 'text/html',
};

export const fixtureDocumentId = (relativePath: string): string =>
  createHash('sha256').update(relativePath, 'utf8').digest('hex');

const readSidecar = (absolutePath: string): FixtureSidecar => {
  try {
    const raw = readFileSync(`${absolutePath}${SIDECAR_SUFFIX}`, 'utf8');
    return JSON.parse(raw) as FixtureSidecar;
  } catch {
    // A missing sidecar is the normal case, not an error: it means "use the
    // defaults", which keeps a fixture set that only needs content small.
    return {};
  }
};

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
};

/**
 * Walks the tree, sorted, so the document order is identical everywhere.
 *
 * `readdirSync` order is filesystem-dependent; sorting is what makes the
 * ordinal of a document stable, and the ordinal is visible to users.
 */
const walk = (rootPath: string, relative: string, out: string[]): void => {
  const absolute = relative.length === 0 ? rootPath : join(rootPath, relative.split('/').join(sep));
  const entries = readdirSync(absolute, { withFileTypes: true })
    .map((entry) => entry)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  for (const entry of entries) {
    const childRelative = relative.length === 0 ? entry.name : posix.join(relative, entry.name);
    if (entry.isDirectory()) {
      walk(rootPath, childRelative, out);
      continue;
    }
    if (entry.name.startsWith('.')) continue;
    if (entry.name.endsWith(SIDECAR_SUFFIX)) continue;
    out.push(childRelative);
  }
};

export const loadFixtureTree = (fixtureRoot: string, sourceKey: string): FixtureTree => {
  const rootPath = join(fixtureRoot, sourceKey);
  const relativePaths: string[] = [];
  walk(rootPath, '', relativePaths);

  const documents: FixtureDocument[] = relativePaths.map((relativePath) => {
    const absolutePath = join(rootPath, relativePath.split('/').join(sep));
    const sidecar = readSidecar(absolutePath);
    const segments = relativePath.split('/');
    const name = segments[segments.length - 1] ?? relativePath;
    const containerId = segments.length > 1 ? (segments[0] ?? '') : '';
    const folderPath = segments.slice(1, -1).join('/');
    const fileType = extensionOf(name);

    return {
      sourceDocumentId: fixtureDocumentId(relativePath),
      relativePath,
      name,
      containerId,
      folderPath,
      fileType,
      // The byte size on disk is deterministic because the content is committed.
      sizeBytes: statSync(absolutePath).size,
      sourceVersion: sidecar.sourceVersion ?? '1.0',
      sourceCreatedAt: sidecar.sourceCreatedAt
        ? new Date(sidecar.sourceCreatedAt)
        : FIXTURE_BASE_DATE,
      sourceModifiedAt: sidecar.sourceModifiedAt
        ? new Date(sidecar.sourceModifiedAt)
        : FIXTURE_BASE_DATE,
      mimeType: sidecar.mimeType ?? MIME_BY_EXTENSION[fileType] ?? 'application/octet-stream',
      metadata: sidecar.metadata ?? {},
      access: sidecar.access ?? { default: 'ALLOWED' },
      absolutePath,
    };
  });

  const counts = new Map<string, number>();
  for (const document of documents) {
    counts.set(document.containerId, (counts.get(document.containerId) ?? 0) + 1);
  }

  return {
    sourceKey,
    rootPath,
    containers: [...counts.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([containerId, itemCount]) => ({ containerId, itemCount })),
    documents,
  };
};

export const readFixtureContent = (document: FixtureDocument): string =>
  readFileSync(document.absolutePath, 'utf8');
