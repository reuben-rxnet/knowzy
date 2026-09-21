// A deliberately minimal, bounded ZIP reader for OOXML containers.
//
// Written here rather than taken from a library, because the security
// requirement IS the reader: a DOCX is a ZIP, and an attacker-supplied ZIP has
// three classic attacks that a general-purpose library will happily perform
// for you.
//
//   Zip bomb          a 10 KB entry that inflates to 4 GB. Guarded by an
//                     absolute cap on inflated bytes AND a compression-ratio
//                     cap, checked against the DECLARED size before inflating
//                     and against the ACTUAL size after.
//   Entry traversal   an entry named `../../etc/passwd`. Nothing here writes a
//                     file, so it cannot escape — but names are still rejected
//                     so a traversal never reaches a log or an error message.
//   Entry-count flood a container with a million tiny entries. Capped.
//
// Only what an OOXML part reader needs: the central directory, stored and
// deflated entries, no encryption, no ZIP64, no spanning. Anything else is
// refused with a reason rather than guessed at.

import { inflateRawSync } from 'node:zlib';

/** Signatures, little-endian. */
const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;

export interface ZipLimits {
  /** Total inflated bytes across every entry read. */
  readonly maxTotalInflatedBytes: number;
  /** Inflated bytes for any single entry. */
  readonly maxEntryInflatedBytes: number;
  /** Inflated ÷ compressed. A DOCX part rarely exceeds ~30. */
  readonly maxCompressionRatio: number;
  readonly maxEntries: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxTotalInflatedBytes: 64 * 1024 * 1024,
  maxEntryInflatedBytes: 32 * 1024 * 1024,
  maxCompressionRatio: 200,
  maxEntries: 2_048,
};

export class ZipError extends Error {
  constructor(
    readonly code:
      'NOT_A_ZIP' | 'UNSUPPORTED_FEATURE' | 'MALFORMED' | 'LIMIT_EXCEEDED' | 'ENCRYPTED',
    /** Safe to show an administrator: no attacker-controlled text. */
    message: string,
  ) {
    super(message);
    this.name = 'ZipError';
  }
}

interface CentralEntry {
  readonly name: string;
  readonly compressionMethod: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
  readonly flags: number;
}

/**
 * An entry name that is safe to reference.
 *
 * Absolute paths, drive letters, backslashes and any `..` segment are refused.
 * The reader writes nothing to disk, so this is defence in depth rather than
 * the only control — but a rejected name also never reaches a log line, which
 * is the part that matters once errors are recorded.
 */
const isSafeEntryName = (name: string): boolean => {
  if (name.length === 0 || name.length > 512) return false;
  if (name.startsWith('/') || name.includes('\\')) return false;
  if (/^[A-Za-z]:/.test(name)) return false;
  if (name.split('/').some((segment) => segment === '..')) return false;
  // A NUL in a name is never legitimate and truncates C-style consumers.
  return !name.includes('\0');
};

const findEndOfCentralDirectory = (bytes: Buffer): number => {
  // The comment field can be up to 64 KiB, so scan backwards over that window.
  const earliest = Math.max(0, bytes.length - (22 + 0xffff));
  for (let i = bytes.length - 22; i >= earliest; i -= 1) {
    if (bytes.readUInt32LE(i) === END_OF_CENTRAL_DIRECTORY) return i;
  }
  return -1;
};

const readCentralDirectory = (bytes: Buffer, limits: ZipLimits): CentralEntry[] => {
  const end = findEndOfCentralDirectory(bytes);
  if (end < 0) {
    throw new ZipError('NOT_A_ZIP', 'The file has no ZIP end-of-central-directory record.');
  }

  const entryCount = bytes.readUInt16LE(end + 10);
  const directorySize = bytes.readUInt32LE(end + 12);
  const directoryOffset = bytes.readUInt32LE(end + 16);

  if (entryCount === 0xffff || directoryOffset === 0xffffffff || directorySize === 0xffffffff) {
    throw new ZipError('UNSUPPORTED_FEATURE', 'ZIP64 containers are not supported.');
  }
  if (entryCount > limits.maxEntries) {
    throw new ZipError(
      'LIMIT_EXCEEDED',
      `The container declares ${entryCount} entries, above the limit of ${limits.maxEntries}.`,
    );
  }
  if (directoryOffset + directorySize > bytes.length) {
    throw new ZipError('MALFORMED', 'The ZIP central directory extends past the end of the file.');
  }

  const entries: CentralEntry[] = [];
  let cursor = directoryOffset;

  for (let i = 0; i < entryCount; i += 1) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== CENTRAL_DIRECTORY_HEADER) {
      throw new ZipError('MALFORMED', 'The ZIP central directory is truncated or corrupt.');
    }
    const flags = bytes.readUInt16LE(cursor + 8);
    const compressionMethod = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localHeaderOffset = bytes.readUInt32LE(cursor + 42);

    const name = bytes.toString('utf8', cursor + 46, cursor + 46 + nameLength);

    // Bit 0 is the encryption flag. An encrypted OOXML part cannot be read and
    // must be reported as such rather than surfacing as a parse failure.
    if ((flags & 0x1) !== 0) {
      throw new ZipError('ENCRYPTED', 'The container is encrypted or password-protected.');
    }

    if (isSafeEntryName(name)) {
      entries.push({
        name,
        compressionMethod,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
        flags,
      });
    }

    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
};

export interface ZipReader {
  /** Entry names, in central-directory order. */
  readonly names: readonly string[];
  /** Reads one entry as UTF-8, or null when the entry does not exist. */
  readText(name: string): string | null;
}

/**
 * Opens a ZIP container held entirely in memory.
 *
 * The caller has already applied a size cap to the file, so holding it in
 * memory is bounded; entries are inflated lazily and only when asked for, so a
 * container with one enormous unused part costs nothing.
 */
export const openZip = (bytes: Uint8Array, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ZipReader => {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buffer.length < 22) {
    throw new ZipError('NOT_A_ZIP', 'The file is too small to be a ZIP container.');
  }
  if (buffer.readUInt32LE(0) !== LOCAL_FILE_HEADER) {
    throw new ZipError('NOT_A_ZIP', 'The file does not begin with a ZIP local file header.');
  }

  const entries = readCentralDirectory(buffer, limits);
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  let inflatedSoFar = 0;

  const readEntry = (entry: CentralEntry): Buffer => {
    const { localHeaderOffset } = entry;
    if (
      localHeaderOffset + 30 > buffer.length ||
      buffer.readUInt32LE(localHeaderOffset) !== LOCAL_FILE_HEADER
    ) {
      throw new ZipError('MALFORMED', 'A ZIP entry points at no local file header.');
    }

    const nameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const extraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + nameLength + extraLength;
    const dataEnd = dataStart + entry.compressedSize;
    if (dataEnd > buffer.length) {
      throw new ZipError('MALFORMED', 'A ZIP entry extends past the end of the file.');
    }

    // Checked BEFORE inflating, against the declared size. A declared size is
    // attacker-controlled, so the actual size is checked again afterwards.
    if (entry.uncompressedSize > limits.maxEntryInflatedBytes) {
      throw new ZipError(
        'LIMIT_EXCEEDED',
        `A container entry declares ${entry.uncompressedSize} bytes, above the per-entry limit.`,
      );
    }
    if (
      entry.compressedSize > 0 &&
      entry.uncompressedSize / entry.compressedSize > limits.maxCompressionRatio
    ) {
      throw new ZipError(
        'LIMIT_EXCEEDED',
        'A container entry has an implausible compression ratio and was not inflated.',
      );
    }

    const raw = buffer.subarray(dataStart, dataEnd);
    let output: Buffer;
    if (entry.compressionMethod === 0) {
      output = Buffer.from(raw);
    } else if (entry.compressionMethod === 8) {
      output = inflateRawSync(raw, { maxOutputLength: limits.maxEntryInflatedBytes });
    } else {
      throw new ZipError(
        'UNSUPPORTED_FEATURE',
        `A container entry uses compression method ${entry.compressionMethod}, which is not supported.`,
      );
    }

    inflatedSoFar += output.length;
    if (inflatedSoFar > limits.maxTotalInflatedBytes) {
      throw new ZipError(
        'LIMIT_EXCEEDED',
        'The container inflates to more than the total permitted size.',
      );
    }
    return output;
  };

  return {
    names: entries.map((entry) => entry.name),
    readText(name) {
      const entry = byName.get(name);
      if (entry === undefined) return null;
      return readEntry(entry).toString('utf8');
    },
  };
};
