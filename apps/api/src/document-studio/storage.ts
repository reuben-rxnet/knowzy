// AI Document Studio M3 -- where uploads and prepared documents are written
// (docs/competencies/AI_DOCUMENT_STUDIO_ARCHITECTURE.md §11.2).
//
// The only file-system writer in the API, and it writes only server-made
// names into two folders under DOCUMENT_STUDIO_STORAGE_DIR:
//
//   * a name must match a fixed pattern (a UUID and an allowed extension for
//     an original; the repository naming rule for a prepared file), so no
//     user-typed character reaches a path;
//   * the resolved path is checked to lie inside the root SEGMENT BY SEGMENT
//     (`isWithinRoot`, the source administration rule), after resolution;
//   * an original is written with `wx` -- once, never overwritten -- because
//     the original is never modified (§11.2).

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { posix } from 'node:path';
import {
  isWithinRoot,
  STUDIO_ORIGINALS,
  STUDIO_PREPARED,
  studioFilePath,
  type StudioStorage,
} from '@knowzy/domain';

const ORIGINAL_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(docx|pdf|pptx|md|txt)$/;
const PREPARED_NAME =
  /^[\p{L}\p{N} _.()-]{1,200} - Assessment-prepared v\d{1,6} \([0-9a-f]{8}\)\.md$/u;

export class StudioStorageError extends Error {
  override readonly name = 'StudioStorageError';
}

const inside = (root: string, path: string): string => {
  const resolved = posix.normalize(path);
  if (!isWithinRoot(resolved, root)) {
    throw new StudioStorageError('A Studio file path resolved outside the Studio storage root.');
  }
  return resolved;
};

export const createStudioStorage = (root: string): StudioStorage => {
  const normalizedRoot = posix.normalize(root).replace(/\/+$/, '');
  return {
    root: normalizedRoot,
    async writeOriginal(storedName, bytes) {
      if (!ORIGINAL_NAME.test(storedName)) {
        throw new StudioStorageError('An original file name must be server-generated.');
      }
      const path = inside(
        normalizedRoot,
        studioFilePath(normalizedRoot, STUDIO_ORIGINALS, storedName),
      );
      await mkdir(posix.dirname(path), { recursive: true });
      await writeFile(path, bytes, { flag: 'wx' });
    },
    async removeOriginal(storedName) {
      if (!ORIGINAL_NAME.test(storedName)) return;
      const path = inside(
        normalizedRoot,
        studioFilePath(normalizedRoot, STUDIO_ORIGINALS, storedName),
      );
      await rm(path, { force: true });
    },
    async writePrepared(fileName, text) {
      if (!PREPARED_NAME.test(fileName)) {
        throw new StudioStorageError(
          'A prepared file name must follow the repository naming rule.',
        );
      }
      const path = inside(
        normalizedRoot,
        studioFilePath(normalizedRoot, STUDIO_PREPARED, fileName),
      );
      await mkdir(posix.dirname(path), { recursive: true });
      // A version's file is its text; a repeated add is refused before this.
      await writeFile(path, text, { encoding: 'utf8', flag: 'wx' });
    },
  };
};
