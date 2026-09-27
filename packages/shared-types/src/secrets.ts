// The secret reference contract — P-5, the Secret Resolution Layer.
//
// A REFERENCE names a secret; it is never the secret. Two sources exist:
//
//   LOCAL_SECURE_STORE  `localstore://{name}` — an encrypted file on the
//                       machine running the API, for the local environment
//                       only. Refused outside it.
//   AZURE_KEY_VAULT     `keyvault://{vault}/secrets/{name}` — declared and
//                       validated; no Key Vault client exists in this build,
//                       so a resolution reports UNAVAILABLE with that reason.
//
// This file is SHAPES ONLY: no crypto, no file access, no process state, so a
// web bundle may import it. The resolver lives in @knowzy/configuration.

export const SECRET_SOURCES = ['LOCAL_SECURE_STORE', 'AZURE_KEY_VAULT'] as const;
export type SecretSource = (typeof SECRET_SOURCES)[number];

export const LOCAL_STORE_REFERENCE = /^localstore:\/\/([a-z0-9][a-z0-9-]{0,62})$/;
export const KEY_VAULT_REFERENCE = /^keyvault:\/\/([a-z0-9-]+)\/secrets\/([A-Za-z0-9-]+)$/;

export interface ParsedSecretReference {
  readonly source: SecretSource;
  /** The secret's name within its source. Not a secret. */
  readonly name: string;
  /** Key Vault only. */
  readonly vault: string | null;
}

/** Null for anything that is not a reference — including a pasted key. */
export const parseSecretReference = (value: string): ParsedSecretReference | null => {
  const local = LOCAL_STORE_REFERENCE.exec(value);
  if (local !== null) return { source: 'LOCAL_SECURE_STORE', name: local[1] ?? '', vault: null };
  const vault = KEY_VAULT_REFERENCE.exec(value);
  if (vault !== null) {
    return { source: 'AZURE_KEY_VAULT', name: vault[2] ?? '', vault: vault[1] ?? null };
  }
  return null;
};

/**
 * The outcome of one resolution, WITHOUT the value.
 *
 *   RESOLVED            the secret exists and was read
 *   NOT_FOUND           the source is reachable and has no such secret
 *   SOURCE_UNAVAILABLE  the source cannot be read here (no store, no client)
 *   SOURCE_FORBIDDEN    the source is not permitted in this environment
 *   INVALID_REFERENCE   the string is not a reference at all
 */
export const SECRET_RESOLUTION_STATUSES = [
  'RESOLVED',
  'NOT_FOUND',
  'SOURCE_UNAVAILABLE',
  'SOURCE_FORBIDDEN',
  'INVALID_REFERENCE',
] as const;
export type SecretResolutionStatus = (typeof SECRET_RESOLUTION_STATUSES)[number];

/**
 * A secret that has been read, and can only be READ ON PURPOSE.
 *
 * The one method a caller needs to put it in an Authorization header is
 * `reveal()`. Everything that turns a value into text by accident — a
 * template literal, `JSON.stringify`, `console.log`, `util.inspect`, an error
 * message — sees `[redacted]`. Declared here so a provider client can accept
 * one without depending on the package that creates it.
 */
export interface RevealableSecret {
  reveal(): string;
  toString(): string;
  toJSON(): string;
}

/** A source's state, for the screen. Never a secret, never a name list. */
export interface SecretSourceHealth {
  readonly source: SecretSource;
  /** Configured for this environment at all. */
  readonly configured: boolean;
  /** Readable right now. */
  readonly reachable: boolean;
  /** How many secrets the source holds, where it can say. Never their names. */
  readonly secretCount: number | null;
  readonly detail: string;
}
