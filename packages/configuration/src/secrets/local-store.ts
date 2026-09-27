// LOCAL_SECURE_STORE — an encrypted file of secrets, for the local environment.
//
// WHY A FILE AND NOT AN ENVIRONMENT VARIABLE. An environment variable holding a
// key is printed by `docker inspect`, inherited by every child process, and
// one `env` in a support session away from a screenshot. The platform's rule
// since M1 is that configuration carries REFERENCES (`*_REF`); this store is
// what a `localstore://` reference names.
//
// THE SHAPE, and what each part is for:
//
//   {dir}/store.key    32 random bytes, base64. Created by `npm run secrets --
//                      init`, mode 0600 where the OS honours it.
//   {dir}/store.json   { version, keyFingerprint, secrets: { name: entry } }
//                      where each entry is AES-256-GCM: a fresh 12-byte IV,
//                      the ciphertext and the auth tag. The name is the AAD, so
//                      an entry copied under another name fails to decrypt
//                      rather than silently becoming a different secret.
//
// The key sits beside the store, so this is not protection from somebody who
// already has the directory. It is protection from the ways a secret actually
// leaks on a developer machine: a grep, a backup of the repository, a file
// attached to a ticket, a commit. `.secrets/` is in .gitignore AND
// .dockerignore, because `COPY . .` in an image build would otherwise ship it.
//
// LOCAL ONLY. The resolver refuses this source outside `KNOWZY_ENV=local`, the
// same fence the stub identity issuer has. A deployed environment reads Key
// Vault.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SecretSourceHealth } from '@knowzy/shared-types';
import { SecretValue } from './secret-value.js';

const STORE_FILE = 'store.json';
const KEY_FILE = 'store.key';
const STORE_VERSION = 1;

interface StoredEntry {
  readonly iv: string;
  readonly tag: string;
  readonly ciphertext: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface StoreFile {
  readonly version: number;
  readonly keyFingerprint: string;
  readonly secrets: Record<string, StoredEntry>;
}

export class LocalStoreError extends Error {
  constructor(
    readonly code: 'NO_STORE' | 'NO_KEY' | 'KEY_MISMATCH' | 'CORRUPT' | 'INVALID_NAME',
    message: string,
  ) {
    super(message);
    this.name = 'LocalStoreError';
  }
}

const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;

const fingerprintOf = (key: Buffer): string =>
  createHash('sha256').update(key).digest('hex').slice(0, 16);

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

export interface LocalSecureStore {
  readonly directory: string;
  /** Null when the secret does not exist. Throws only when the store itself cannot be read. */
  get(name: string): Promise<SecretValue | null>;
  health(): Promise<SecretSourceHealth>;
}

export interface LocalSecureStoreAdmin extends LocalSecureStore {
  /** Creates the key and an empty store. Refuses to replace an existing key. */
  init(): Promise<{ created: boolean; keyFingerprint: string }>;
  set(name: string, value: string): Promise<{ created: boolean }>;
  remove(name: string): Promise<boolean>;
  /** Names only, for the CLI. The API never calls this. */
  names(): Promise<readonly string[]>;
}

export const createLocalSecureStore = (directory: string): LocalSecureStoreAdmin => {
  const storePath = join(directory, STORE_FILE);
  const keyPath = join(directory, KEY_FILE);

  const readKey = async (): Promise<Buffer> => {
    if (!(await exists(keyPath))) {
      throw new LocalStoreError(
        'NO_KEY',
        'The local secure store has no key. Run `npm run secrets -- init`.',
      );
    }
    const key = Buffer.from((await readFile(keyPath, 'utf8')).trim(), 'base64');
    if (key.length !== 32) throw new LocalStoreError('CORRUPT', 'The store key is not 32 bytes.');
    return key;
  };

  const readStore = async (key: Buffer): Promise<StoreFile> => {
    if (!(await exists(storePath))) {
      throw new LocalStoreError(
        'NO_STORE',
        'The local secure store does not exist. Run `npm run secrets -- init`.',
      );
    }
    let parsed: StoreFile;
    try {
      parsed = JSON.parse(await readFile(storePath, 'utf8')) as StoreFile;
    } catch {
      throw new LocalStoreError('CORRUPT', 'The store file is not valid JSON.');
    }
    if (parsed.version !== STORE_VERSION || typeof parsed.secrets !== 'object') {
      throw new LocalStoreError('CORRUPT', 'The store file has an unknown shape.');
    }
    // A store written under a different key would decrypt nothing and say so
    // one entry at a time. Checked once, with the reason.
    if (parsed.keyFingerprint !== fingerprintOf(key)) {
      throw new LocalStoreError('KEY_MISMATCH', 'The store was written with a different key.');
    }
    return parsed;
  };

  /** Atomic: write a sibling, then rename over the original. */
  const writeStore = async (file: StoreFile): Promise<void> => {
    const temporary = `${storePath}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, storePath);
  };

  const encrypt = (key: Buffer, name: string, value: string) => {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(name, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return {
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  };

  const decrypt = (key: Buffer, name: string, entry: StoredEntry): string => {
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(entry.iv, 'base64'));
      decipher.setAAD(Buffer.from(name, 'utf8'));
      decipher.setAuthTag(Buffer.from(entry.tag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(entry.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      // Never the underlying message: an OpenSSL error string is harmless,
      // but a habit of echoing crypto errors is how a future one is not.
      throw new LocalStoreError('CORRUPT', `The entry "${name}" could not be decrypted.`);
    }
  };

  const assertName = (name: string): void => {
    if (!NAME.test(name)) {
      throw new LocalStoreError(
        'INVALID_NAME',
        'A secret name is lower-case letters, digits and hyphens, starting with a letter or digit.',
      );
    }
  };

  return {
    directory,

    async get(name) {
      assertName(name);
      const key = await readKey();
      const store = await readStore(key);
      const entry = store.secrets[name];
      return entry === undefined ? null : new SecretValue(decrypt(key, name, entry));
    },

    async health() {
      try {
        const key = await readKey();
        const store = await readStore(key);
        return {
          source: 'LOCAL_SECURE_STORE',
          configured: true,
          reachable: true,
          secretCount: Object.keys(store.secrets).length,
          detail: 'The local secure store is readable and its key matches.',
        };
      } catch (error) {
        const code = error instanceof LocalStoreError ? error.code : 'CORRUPT';
        return {
          source: 'LOCAL_SECURE_STORE',
          configured: code !== 'NO_KEY' && code !== 'NO_STORE',
          reachable: false,
          secretCount: null,
          detail: error instanceof LocalStoreError ? error.message : 'The store could not be read.',
        };
      }
    },

    async init() {
      await mkdir(directory, { recursive: true });
      if (await exists(keyPath)) {
        const key = await readKey();
        if (!(await exists(storePath))) {
          await writeStore({
            version: STORE_VERSION,
            keyFingerprint: fingerprintOf(key),
            secrets: {},
          });
        }
        return { created: false, keyFingerprint: fingerprintOf(key) };
      }
      const key = randomBytes(32);
      await writeFile(keyPath, `${key.toString('base64')}\n`, { mode: 0o600 });
      try {
        await chmod(keyPath, 0o600);
      } catch {
        /* Windows ignores POSIX modes; the directory is gitignored either way. */
      }
      await writeStore({ version: STORE_VERSION, keyFingerprint: fingerprintOf(key), secrets: {} });
      return { created: true, keyFingerprint: fingerprintOf(key) };
    },

    async set(name, value) {
      assertName(name);
      if (value.length === 0)
        throw new LocalStoreError('INVALID_NAME', 'An empty secret is not stored.');
      const key = await readKey();
      const store = await readStore(key);
      const now = new Date().toISOString();
      const previous = store.secrets[name];
      await writeStore({
        ...store,
        secrets: {
          ...store.secrets,
          [name]: {
            ...encrypt(key, name, value),
            createdAt: previous?.createdAt ?? now,
            updatedAt: now,
          },
        },
      });
      return { created: previous === undefined };
    },

    async remove(name) {
      assertName(name);
      const key = await readKey();
      const store = await readStore(key);
      if (store.secrets[name] === undefined) return false;
      const { [name]: _removed, ...rest } = store.secrets;
      await writeStore({ ...store, secrets: rest });
      return true;
    },

    async names() {
      const key = await readKey();
      return Object.keys((await readStore(key)).secrets).sort();
    },
  };
};
