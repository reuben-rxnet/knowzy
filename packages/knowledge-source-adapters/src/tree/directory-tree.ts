// Reading a directory tree as a knowledge corpus.
//
// Extracted from the mock adapter's fixture reader so the real
// FILE_REPOSITORY adapter shares the parts that were already proven — stable
// forward-slashed identifiers, lazy content reads, sidecar parsing — without
// BEING the mock adapter. That distinction is load-bearing:
// `packages/configuration/src/startup.ts` fails check `MOCK_ISOLATION`
// outside `local` when `mockAdaptersRegistered()` is true, so re-pointing the
// mock at a real directory would make every deployed environment refuse to
// start, which is exactly what that check is for.
//
// What this module adds beyond the fixture reader, because a real mirror is
// not a curated fixture set:
//
//   root containment    every resolved path is re-checked to be inside the
//                       configured root AFTER normalization, so a `..` segment
//                       or an absurd name cannot escape.
//   symlink refusal     a symbolic link or junction is skipped, not followed.
//                       A link in a synced folder can point anywhere on the
//                       workstation, which would turn a knowledge source into
//                       an arbitrary file reader.
//   placeholder         a OneDrive Files On-Demand placeholder lists at its
//   detection           real size with no local bytes. Reading one blocks on a
//                       network fetch or fails; it is reported, not read.
//   artifact exclusion  sync-client and Office lock files are not documents.

import {
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  type Dirent,
  type Stats,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, resolve, sep } from 'node:path';

export const SIDECAR_SUFFIX = '.meta.json';

export type AccessOutcome = 'ALLOWED' | 'DENIED' | 'UNKNOWN';

export interface TreeAccessMap {
  readonly default?: AccessOutcome;
  /** Per-principal overrides, keyed by user principal name or object id. */
  readonly principals?: Readonly<Record<string, AccessOutcome>>;
  readonly summary?: string;
}

/**
 * The `{file}.meta.json` sidecar.
 *
 * The same shape the mock reads, deliberately: the discovery work that records
 * a SharePoint document's column values and permission state produces exactly
 * this, so a discovery output IS the metadata input.
 */
export interface TreeSidecar {
  readonly sourceVersion?: string;
  readonly sourceCreatedAt?: string;
  readonly sourceModifiedAt?: string;
  readonly mimeType?: string;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly access?: TreeAccessMap;
}

export interface TreeDocument {
  readonly sourceDocumentId: string;
  /** Always forward-slashed and relative to the root, so ids match on Windows. */
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
  readonly access: TreeAccessMap;
  /** True when the file has no local bytes (Files On-Demand placeholder). */
  readonly isPlaceholder: boolean;
  /** Absolute path on disk. OPERATIONAL ONLY — never published (§4). */
  readonly absolutePath: string;
}

export interface TreeSkip {
  readonly relativePath: string;
  readonly reason:
    'SYMLINK' | 'ARTIFACT' | 'SIDECAR' | 'UNREADABLE' | 'OUTSIDE_ROOT' | 'UNSUPPORTED_TYPE';
}

export interface DirectoryTree {
  readonly rootPath: string;
  /** Deterministically ordered by `relativePath`. */
  readonly documents: readonly TreeDocument[];
  /** Everything deliberately not treated as a document, with the reason. */
  readonly skipped: readonly TreeSkip[];
}

export class TreeRootError extends Error {
  constructor(
    readonly code: 'ROOT_MISSING' | 'ROOT_NOT_A_DIRECTORY' | 'ROOT_UNREADABLE',
    message: string,
  ) {
    super(message);
    this.name = 'TreeRootError';
  }
}

/**
 * Sync-client and Office artifacts that are not documents.
 *
 * `desktop.ini` earns its place: the OneDrive client writes one into synced
 * folders, and it is a readable `.ini` text file, so without this it would
 * extract SUCCESSFULLY and produce a nonsense section — which is worse than
 * failing, because nothing would draw attention to it.
 */
const ARTIFACT_NAMES = new Set(['desktop.ini', '.ds_store', 'thumbs.db', 'icon\r']);
const ARTIFACT_PREFIXES = ['~$', '._'];
const ARTIFACT_EXTENSIONS = new Set(['tmp', 'lnk', 'url', 'partial', 'crdownload']);

const isArtifact = (name: string): boolean => {
  const lower = name.toLowerCase();
  if (ARTIFACT_NAMES.has(lower)) return true;
  if (ARTIFACT_PREFIXES.some((prefix) => lower.startsWith(prefix))) return true;
  const dot = lower.lastIndexOf('.');
  return dot !== -1 && ARTIFACT_EXTENSIONS.has(lower.slice(dot + 1));
};

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  txt: 'text/plain',
  md: 'text/markdown',
  html: 'text/html',
  htm: 'text/html',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
};

/**
 * A stable identifier for a document within a source.
 *
 * Derived from the relative path, so it is identical on Windows and Linux and
 * survives a re-clone. It is a hash rather than the path itself because the
 * id appears in URLs and audit rows, and a path can contain anything.
 */
export const treeDocumentId = (relativePath: string): string =>
  createHash('sha256').update(relativePath, 'utf8').digest('hex').slice(0, 32);

/** Reads and validates a sidecar, returning an empty one when absent or bad. */
const readSidecar = (absolutePath: string): TreeSidecar => {
  try {
    const raw = readFileSync(`${absolutePath}${SIDECAR_SUFFIX}`, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as TreeSidecar) : {};
  } catch {
    // A missing sidecar is the normal case, and a malformed one must not take
    // the document with it: metadata is then declared absent rather than
    // invented, which is the honest outcome.
    return {};
  }
};

/**
 * Best-effort detection of a Files On-Demand placeholder — a file that lists at
 * its real size while its bytes are not local.
 *
 * ADVISORY ONLY, and POSIX-only, for a reason that cost a debugging round:
 * `Stats.blocks` is NOT POPULATED ON WINDOWS. It is `0` for every file, so a
 * `blocks === 0` test there marks the entire corpus as placeholders — which
 * denied every document and made the adapter serve nothing.
 *
 * So this returns `false` on Windows rather than guessing, and a placeholder
 * is instead detected where it actually manifests: the read fails, and
 * `extractContent` reports that with an actionable reason. Denying access on a
 * heuristic would be worse than the problem it detects.
 */
const looksLikePlaceholder = (stats: Stats): boolean => {
  if (process.platform === 'win32') return false;
  return stats.size > 0 && typeof stats.blocks === 'number' && stats.blocks === 0;
};

/** Forward slashes always, so ids and URLs match across platforms. */
const toPosix = (value: string): string => value.split(sep).join('/');

interface WalkContext {
  readonly rootReal: string;
  readonly documents: TreeDocument[];
  readonly skipped: TreeSkip[];
  readonly supportedExtensions: ReadonlySet<string>;
  readonly baseDate: Date;
}

const walk = (context: WalkContext, absoluteDir: string, relativeDir: string): void => {
  let entries: Dirent[];
  try {
    entries = readdirSync(absoluteDir, { withFileTypes: true }) as Dirent[];
  } catch {
    context.skipped.push({ relativePath: relativeDir, reason: 'UNREADABLE' });
    return;
  }

  // Sorted by name so the walk — and therefore every id, ordinal and
  // checkpoint — is deterministic across platforms and filesystems.
  const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  for (const entry of sorted) {
    const relativePath = relativeDir === '' ? entry.name : `${relativeDir}/${entry.name}`;
    const absolutePath = join(absoluteDir, entry.name);

    // A link is skipped, never followed. Following one would let a link in a
    // synced folder point at anything on the workstation.
    if (entry.isSymbolicLink()) {
      context.skipped.push({ relativePath, reason: 'SYMLINK' });
      continue;
    }

    // Containment re-checked after resolution, so a path that normalizes out
    // of the root is refused even if it arrived through a legitimate listing.
    let realPath: string;
    try {
      realPath = realpathSync(absolutePath);
    } catch {
      context.skipped.push({ relativePath, reason: 'UNREADABLE' });
      continue;
    }
    const withinRoot =
      realPath === context.rootReal || realPath.startsWith(`${context.rootReal}${sep}`);
    if (!withinRoot) {
      context.skipped.push({ relativePath, reason: 'OUTSIDE_ROOT' });
      continue;
    }

    if (entry.isDirectory()) {
      walk(context, absolutePath, relativePath);
      continue;
    }
    if (!entry.isFile()) {
      context.skipped.push({ relativePath, reason: 'UNREADABLE' });
      continue;
    }

    if (entry.name.toLowerCase().endsWith(SIDECAR_SUFFIX)) {
      context.skipped.push({ relativePath, reason: 'SIDECAR' });
      continue;
    }
    if (isArtifact(entry.name)) {
      context.skipped.push({ relativePath, reason: 'ARTIFACT' });
      continue;
    }

    const fileType = extensionOf(entry.name);
    if (!context.supportedExtensions.has(fileType)) {
      context.skipped.push({ relativePath, reason: 'UNSUPPORTED_TYPE' });
      continue;
    }

    let stats: Stats;
    try {
      stats = statSync(absolutePath);
    } catch {
      context.skipped.push({ relativePath, reason: 'UNREADABLE' });
      continue;
    }

    const sidecar = readSidecar(absolutePath);
    const segments = relativePath.split('/');
    const containerId = segments.length > 1 ? (segments[0] as string) : '';
    const folderPath = segments.slice(containerId === '' ? 0 : 1, -1).join('/');

    context.documents.push({
      sourceDocumentId: treeDocumentId(relativePath),
      relativePath,
      name: entry.name,
      containerId,
      folderPath,
      fileType,
      sizeBytes: stats.size,
      // No native version label exists. The sidecar may supply one; otherwise
      // change detection relies on the content hash alone, which is why the
      // adapter declares `supportsVersionLabels: false`.
      sourceVersion: sidecar.sourceVersion ?? '',
      sourceCreatedAt:
        sidecar.sourceCreatedAt === undefined
          ? (stats.birthtime ?? context.baseDate)
          : new Date(sidecar.sourceCreatedAt),
      sourceModifiedAt:
        sidecar.sourceModifiedAt === undefined ? stats.mtime : new Date(sidecar.sourceModifiedAt),
      mimeType: sidecar.mimeType ?? MIME_BY_EXTENSION[fileType] ?? 'application/octet-stream',
      metadata: sidecar.metadata ?? {},
      access: sidecar.access ?? {},
      isPlaceholder: looksLikePlaceholder(stats),
      absolutePath,
    });
  }
};

export interface LoadTreeOptions {
  readonly rootPath: string;
  /** Extensions with a registered extractor. Anything else is skipped. */
  readonly supportedExtensions: readonly string[];
  /** Used when the filesystem reports no creation time. */
  readonly baseDate?: Date;
}

export const loadDirectoryTree = (options: LoadTreeOptions): DirectoryTree => {
  const rootPath = resolve(options.rootPath);

  let rootReal: string;
  try {
    const stats = statSync(rootPath);
    if (!stats.isDirectory()) {
      throw new TreeRootError(
        'ROOT_NOT_A_DIRECTORY',
        'The configured synchronized root is not a directory.',
      );
    }
    rootReal = realpathSync(rootPath);
  } catch (error) {
    if (error instanceof TreeRootError) throw error;
    throw new TreeRootError(
      'ROOT_MISSING',
      'The configured synchronized root does not exist or cannot be read. ' +
        'Check that the folder is synchronized and available on this machine.',
    );
  }

  const context: WalkContext = {
    rootReal,
    documents: [],
    skipped: [],
    supportedExtensions: new Set(options.supportedExtensions.map((e) => e.toLowerCase())),
    baseDate: options.baseDate ?? new Date('2025-01-01T00:00:00.000Z'),
  };

  walk(context, rootReal, '');

  return {
    rootPath: rootReal,
    documents: [...context.documents].sort((a, b) =>
      a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0,
    ),
    skipped: context.skipped,
  };
};

/**
 * Reads a document's bytes, refusing anything outside the root.
 *
 * The containment check is repeated here rather than trusted from the walk,
 * because this function takes an absolute path and a caller could in principle
 * pass one that never came from a walk.
 */
export const readTreeBytes = (
  tree: DirectoryTree,
  document: TreeDocument,
  maxBytes: number,
): Uint8Array => {
  const resolved = resolve(document.absolutePath);
  const rel = relative(tree.rootPath, resolved);
  if (rel === '' || rel.startsWith('..') || toPosix(rel).startsWith('../')) {
    throw new TreeRootError('ROOT_UNREADABLE', 'The document path resolves outside the root.');
  }
  const stats = statSync(resolved);
  if (stats.size > maxBytes) {
    // Checked before reading, so an oversized file is never held in memory.
    throw new TreeRootError(
      'ROOT_UNREADABLE',
      `The document is ${stats.size} bytes, above the ${maxBytes}-byte limit.`,
    );
  }
  return new Uint8Array(readFileSync(resolved));
};

/** SHA-256 of the file's bytes. The only reliable change signal here. */
export const hashTreeBytes = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');
