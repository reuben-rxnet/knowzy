// AI Document Studio M3 -- the checks an uploaded file passes BEFORE anything
// stores it (docs/competencies/AI_DOCUMENT_STUDIO_ARCHITECTURE.md §11.2).
//
// Pure: bytes and a name in, a decision out. The API runs this BEFORE anything
// is written, so a file refused here never reaches the disk; the extraction
// control runs in the synchronization that follows, and a file it cannot read
// is removed (preparation-service.ts). Each refusal names the CONTROL that
// refused it, because a test per control is how "each control has a test that
// fails when it is removed" is kept true.
//
// It lives in the domain because it is policy -- what the platform accepts --
// and it reads only a ZIP's central directory (entry NAMES), with its own
// small reader: B3 keeps the domain away from the extraction package, and
// nothing here needs to inflate a byte.
//
// What this cannot see: active content inside a compressed PDF object stream,
// or a payload hidden in an image. That is what the malware-scanning extension
// point is for, and until a scanner exists every upload records NOT_SCANNED.

import { createHash } from 'node:crypto';

/**
 * The entry names of a ZIP held in memory, from its central directory, or
 * null when the bytes are not a well-formed ZIP. Nothing is inflated.
 */
export const zipEntryNames = (bytes: Uint8Array): string[] | null => {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) return null;
  // The end-of-central-directory record is within the last 64 KiB + 22 bytes.
  const floor = Math.max(0, buffer.length - 65_557);
  let end = -1;
  for (let i = buffer.length - 22; i >= floor; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  const count = buffer.readUInt16LE(end + 10);
  const size = buffer.readUInt32LE(end + 12);
  let cursor = buffer.readUInt32LE(end + 16);
  if (count > 10_000 || cursor + size > buffer.length) return null;
  const names: string[] = [];
  for (let entry = 0; entry < count; entry += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) return null;
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    if (cursor + 46 + nameLength > buffer.length) return null;
    names.push(buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return names;
};

export const UPLOAD_MAX_BYTES = 8 * 1024 * 1024;
export const UPLOAD_EXTENSIONS = ['docx', 'pdf', 'pptx', 'md', 'txt'] as const;
export type UploadExtension = (typeof UPLOAD_EXTENSIONS)[number];

export type UploadControl = 'NAME' | 'SIZE' | 'EXTENSION' | 'SIGNATURE' | 'ACTIVE_CONTENT';

export type UploadInspection =
  | {
      readonly ok: true;
      readonly extension: UploadExtension;
      readonly sha256: string;
      readonly sizeBytes: number;
    }
  | { readonly ok: false; readonly control: UploadControl; readonly reason: string };

const refuse = (control: UploadControl, reason: string): UploadInspection => ({
  ok: false,
  control,
  reason,
});

const startsWith = (bytes: Uint8Array, prefix: readonly number[]): boolean =>
  prefix.every((byte, index) => bytes[index] === byte);

const EXECUTABLE_HEADERS: readonly (readonly [string, readonly number[]])[] = [
  ['a Windows executable', [0x4d, 0x5a]],
  ['a Linux executable', [0x7f, 0x45, 0x4c, 0x46]],
  ['a script', [0x23, 0x21]],
  ['a Mach-O executable', [0xcf, 0xfa, 0xed, 0xfe]],
];

const ZIP_REQUIRED: Readonly<Partial<Record<UploadExtension, string>>> = {
  docx: 'word/document.xml',
  pptx: 'ppt/presentation.xml',
};

const PDF_ACTIVE = /\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia)(?![A-Za-z])/;

/** The user's file name is a label. It may not carry control characters or a path. */
const nameProblem = (fileName: string): string | null => {
  if (fileName.length === 0 || fileName.length > 200) {
    return 'The file name must be between 1 and 200 characters.';
  }
  for (const char of fileName) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 32 || code === 127) return 'The file name contains a control character.';
  }
  if (/[\\/]/.test(fileName)) return 'The file name contains a path separator.';
  return null;
};

export const extensionOf = (fileName: string): string => {
  const match = /\.([A-Za-z0-9]{1,10})$/.exec(fileName);
  return (match?.[1] ?? '').toLowerCase();
};

export const inspectUpload = (input: {
  readonly fileName: string;
  readonly bytes: Uint8Array;
}): UploadInspection => {
  const { fileName, bytes } = input;
  const badName = nameProblem(fileName);
  if (badName !== null) return refuse('NAME', badName);

  if (bytes.length === 0) return refuse('SIZE', 'The file is empty.');
  if (bytes.length > UPLOAD_MAX_BYTES) {
    return refuse(
      'SIZE',
      `The file is ${(bytes.length / 1_048_576).toFixed(1)} MB; the limit is ${UPLOAD_MAX_BYTES / 1_048_576} MB.`,
    );
  }

  const extension = extensionOf(fileName);
  if (!(UPLOAD_EXTENSIONS as readonly string[]).includes(extension)) {
    return refuse(
      'EXTENSION',
      `.${extension || '(none)'} files are not accepted. Accepted: ${UPLOAD_EXTENSIONS.map((e) => `.${e}`).join(', ')}.`,
    );
  }
  const type = extension as UploadExtension;

  for (const [label, header] of EXECUTABLE_HEADERS) {
    if (startsWith(bytes, header)) {
      return refuse('ACTIVE_CONTENT', `The file is ${label}, not a document.`);
    }
  }

  if (type === 'pdf') {
    if (!startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
      return refuse('SIGNATURE', 'The file is named .pdf but is not a PDF.');
    }
    if (PDF_ACTIVE.test(Buffer.from(bytes).toString('latin1'))) {
      return refuse(
        'ACTIVE_CONTENT',
        'The PDF contains scripts, launch actions, embedded files or rich media.',
      );
    }
  } else if (type === 'docx' || type === 'pptx') {
    const names = zipEntryNames(bytes);
    if (names === null) {
      return refuse(
        'SIGNATURE',
        `The file is named .${type} but is not a valid ${type.toUpperCase()} file.`,
      );
    }
    const required = ZIP_REQUIRED[type] ?? '';
    if (!names.includes(required) || !names.includes('[Content_Types].xml')) {
      return refuse(
        'SIGNATURE',
        `The file is named .${type} but is not a ${type.toUpperCase()} document.`,
      );
    }
    // A macro-enabled package carries its macro project as a part: refused by name.
    if (names.some((name) => /vbaProject\.bin$|vbaData\.xml$/i.test(name))) {
      return refuse('ACTIVE_CONTENT', 'The document contains macros.');
    }
    if (names.some((name) => /\/embeddings\/.*\.(bin|exe|dll|js|vbs|bat|cmd|ps1)$/i.test(name))) {
      return refuse('ACTIVE_CONTENT', 'The document contains an embedded program or object.');
    }
  } else {
    if (bytes.includes(0)) {
      return refuse('SIGNATURE', 'The file is named as text but contains binary data.');
    }
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return refuse('SIGNATURE', 'The text file is not valid UTF-8.');
    }
  }

  return {
    ok: true,
    extension: type,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.length,
  };
};
