// Local relative path → canonical SharePoint URL.
//
// This is the smallest module in the adapter and the one that decides whether
// the transitional path is a stepping stone or a throwaway.
//
// `KnowledgeDocument.sourceUrl` is NON-NULLABLE and flows through
// `BankItemWrite.sourceUrl` into the published Question Bank record, which is
// authoritative for published content and long-lived. So a local path reaching
// it would:
//
//   1. break traceability permanently — `C:\Users\someone\OneDrive - Org\...`
//      opens nothing for a reviewer, an auditor, or anyone in two years; and
//   2. write a username and a machine layout into a SharePoint list that
//      nobody is going to rewrite.
//
// The local path is OPERATIONAL CONFIGURATION. The canonical URL is PROVENANCE.
// Those are different things and this module is the boundary between them.

/** Thrown at configuration time, so a bad base cannot reach a document record. */
export class WebUrlConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebUrlConfigurationError';
  }
}

/** Shapes that must never appear in a provenance field. */
const LOCAL_PATH_PATTERNS: readonly RegExp[] = [
  /^[A-Za-z]:[\\/]/, //      C:\ or C:/
  /^\\\\/, //                UNC \\server\share
  /^file:\/\//i, //          file:// URL
  /^\/(?:home|Users|mnt|media|var|tmp)\//, // POSIX user or mount paths
  /OneDrive[ -]/i, //        a synced OneDrive folder name
];

/**
 * True when a string looks like a local filesystem path rather than a URL.
 *
 * Exported so the assertion can be applied as a TEST over everything the
 * adapter emits, not just here. A universal claim — "no local path is ever
 * published" — is only worth what checks it.
 */
export const looksLikeLocalPath = (value: string): boolean =>
  LOCAL_PATH_PATTERNS.some((pattern) => pattern.test(value));

/**
 * Validates and normalizes a configured canonical base URL.
 *
 * Refuses a sharing URL. The business supplies links of the form
 * `.../:f:/r/sites/...?d=...&csf=1&web=1&e=...`, which carry a sharing TOKEN
 * in the query string. Persisting one would put a credential-shaped secret
 * into every document record and into the published bank — and the token
 * expires, so the provenance would rot as well as leak. The clean canonical
 * folder URL is required instead.
 */
export const normalizeWebUrlBase = (base: string): string => {
  const trimmed = base.trim();
  if (trimmed.length === 0) {
    throw new WebUrlConfigurationError('The canonical SharePoint URL base is empty.');
  }
  if (!/^https:\/\//i.test(trimmed)) {
    throw new WebUrlConfigurationError(
      'The canonical SharePoint URL base must be an https:// URL.',
    );
  }
  if (looksLikeLocalPath(trimmed)) {
    throw new WebUrlConfigurationError(
      'The canonical SharePoint URL base looks like a local path. It must be the web URL.',
    );
  }
  if (trimmed.includes('?')) {
    throw new WebUrlConfigurationError(
      'The canonical SharePoint URL base must not carry a query string. ' +
        'A sharing link contains a sharing token; use the clean folder URL instead.',
    );
  }
  if (/\/:[a-z]:\//i.test(trimmed)) {
    throw new WebUrlConfigurationError(
      'That is a SharePoint sharing link, not a canonical folder URL. ' +
        'Use the plain site-relative folder address instead: the tenant host, then ' +
        '/sites/{site}/{library}/{folder}, with no query string.',
    );
  }
  return trimmed.replace(/\/+$/, '');
};

/**
 * Builds the canonical URL for one document.
 *
 * Each path segment is percent-encoded individually, so a space becomes `%20`
 * and a `/` separator is preserved. `encodeURIComponent` on the whole path
 * would escape the separators and produce a single broken segment.
 */
export const canonicalDocumentUrl = (webUrlBase: string, relativePath: string): string => {
  const base = webUrlBase.replace(/\/+$/, '');
  const encoded = relativePath
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return encoded.length === 0 ? base : `${base}/${encoded}`;
};

/**
 * The provisional URL for a source with no real web location.
 *
 * A managed upload directory has no SharePoint URL, so it gets an explicit
 * non-resolving scheme — visibly provisional, and never a local path. The mock
 * adapter uses the same convention (`mock://`) for the same reason.
 */
export const provisionalDocumentUrl = (sourceKey: string, relativePath: string): string =>
  `knowzy-upload://${encodeURIComponent(sourceKey)}/${relativePath
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`;
