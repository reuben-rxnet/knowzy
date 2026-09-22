// Mapping the taxonomy names inside an imported file onto real taxonomy.
//
// THE RULE THIS FILE EXISTS TO ENFORCE: an import never creates taxonomy.
//
// A question-bank spreadsheet carries its own Domain and Topic columns, written
// by hand. "VisionStar", "Vision Star", "VissionStar" and an empty cell are all
// things a real file contains. If an import created what it did not find, the
// fourth of those becomes a permanent domain code -- and a domain code cannot
// be taken back once a question has published under it, because the code is
// inside the published QuestionID.
//
// So an unrecognised name is a QUESTION PUT TO THE IMPORTER, not a row to
// invent. This module answers "what did the file name, and what does the
// platform already have that matches" and nothing else: no writes, no database,
// no I/O. That is what makes it testable against the exact strings a customer
// file contains.

export interface TaxonomyCatalogueDomain {
  readonly domainId: string;
  readonly code: string;
  readonly name: string;
  readonly topics: readonly { readonly topicId: string; readonly name: string }[];
}

/** What the file said, per question. Either may be absent. */
export interface DetectedTaxonomy {
  readonly domainName: string | null;
  readonly topicName: string | null;
}

/** An importer's explicit decision about one detected pair. */
export interface TaxonomyMappingChoice {
  readonly domainName: string | null;
  readonly topicName: string | null;
  readonly domainId: string;
  readonly topicId: string;
}

export type MappingStatus = 'MATCHED' | 'MAPPED' | 'FALLBACK' | 'UNMATCHED';

export interface TaxonomyResolution {
  readonly domainName: string | null;
  readonly topicName: string | null;
  readonly questionCount: number;
  readonly status: MappingStatus;
  /** Null exactly when the status is UNMATCHED. */
  readonly domainId: string | null;
  readonly topicId: string | null;
  /** Why, in words a person can act on. */
  readonly detail: string;
}

export interface ResolveArgs {
  readonly detected: readonly DetectedTaxonomy[];
  readonly catalogue: readonly TaxonomyCatalogueDomain[];
  readonly mappings?: readonly TaxonomyMappingChoice[];
  /**
   * The domain and topic chosen on the screen. Used for a question whose file
   * says NOTHING -- not as a silent substitute for a name that was written and
   * not recognised. Filing "VissionStar" under the selected domain because a
   * dropdown happened to be set would be the same mistake as creating it.
   */
  readonly fallback: { readonly domainId: string; readonly topicId: string };
}

export interface ResolveResult {
  readonly resolutions: readonly TaxonomyResolution[];
  /** Resolutions still needing a decision. Import refuses while this is non-empty. */
  readonly unmatched: readonly TaxonomyResolution[];
}

/** Case, spacing and separators are noise; the identity of a name is not. */
const fold = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ');

const keyOf = (detected: DetectedTaxonomy): string =>
  `${fold(detected.domainName ?? '')}\u0000${fold(detected.topicName ?? '')}`;

/**
 * Resolves every distinct (domain, topic) pair the file named.
 *
 * Order of precedence, most explicit first:
 *
 *   1. An importer's `mappings` entry            -> MAPPED
 *   2. An exact fold-match on code or name        -> MATCHED
 *   3. The file named nothing at all              -> FALLBACK
 *   4. Anything else                              -> UNMATCHED
 *
 * A domain that matches while its topic does not is still UNMATCHED: filing a
 * question under the right domain and the wrong topic is not an improvement on
 * refusing, because topic is what a learner's gap report is grouped by.
 */
export const resolveImportTaxonomy = (args: ResolveArgs): ResolveResult => {
  const byKey = new Map<string, { detected: DetectedTaxonomy; count: number }>();
  for (const detected of args.detected) {
    const key = keyOf(detected);
    const existing = byKey.get(key);
    if (existing === undefined) byKey.set(key, { detected, count: 1 });
    else existing.count += 1;
  }

  const mappings = new Map<string, TaxonomyMappingChoice>();
  for (const mapping of args.mappings ?? []) {
    mappings.set(keyOf({ domainName: mapping.domainName, topicName: mapping.topicName }), mapping);
  }

  const resolutions: TaxonomyResolution[] = [];

  for (const [key, { detected, count }] of byKey) {
    const chosen = mappings.get(key);
    if (chosen !== undefined) {
      resolutions.push({
        domainName: detected.domainName,
        topicName: detected.topicName,
        questionCount: count,
        status: 'MAPPED',
        domainId: chosen.domainId,
        topicId: chosen.topicId,
        detail: 'Mapped by the importer.',
      });
      continue;
    }

    const namedNothing = (detected.domainName ?? '') === '' && (detected.topicName ?? '') === '';
    if (namedNothing) {
      resolutions.push({
        domainName: detected.domainName,
        topicName: detected.topicName,
        questionCount: count,
        status: 'FALLBACK',
        domainId: args.fallback.domainId,
        topicId: args.fallback.topicId,
        detail: 'The file names no domain or topic, so the selection on this screen is used.',
      });
      continue;
    }

    const domain =
      detected.domainName === null
        ? undefined
        : args.catalogue.find(
            (candidate) =>
              fold(candidate.code) === fold(detected.domainName ?? '') ||
              fold(candidate.name) === fold(detected.domainName ?? ''),
          );

    if (domain === undefined) {
      resolutions.push({
        domainName: detected.domainName,
        topicName: detected.topicName,
        questionCount: count,
        status: 'UNMATCHED',
        domainId: null,
        topicId: null,
        detail:
          `No domain matches "${detected.domainName ?? ''}". Choose an existing domain and ` +
          'topic for these questions, or create the domain in Administration first. ' +
          'An import never creates taxonomy.',
      });
      continue;
    }

    const topic =
      detected.topicName === null
        ? undefined
        : domain.topics.find(
            (candidate) => fold(candidate.name) === fold(detected.topicName ?? ''),
          );

    if (topic === undefined) {
      resolutions.push({
        domainName: detected.domainName,
        topicName: detected.topicName,
        questionCount: count,
        status: 'UNMATCHED',
        domainId: domain.domainId,
        topicId: null,
        detail:
          `The domain ${domain.code} matches, but it has no topic "${detected.topicName ?? ''}". ` +
          'Choose a topic, or create it in Administration first.',
      });
      continue;
    }

    resolutions.push({
      domainName: detected.domainName,
      topicName: detected.topicName,
      questionCount: count,
      status: 'MATCHED',
      domainId: domain.domainId,
      topicId: topic.topicId,
      detail: `Matched ${domain.code} / ${topic.name}.`,
    });
  }

  return {
    resolutions,
    // A resolution with no topic is unusable even when its domain resolved.
    unmatched: resolutions.filter(
      (resolution) => resolution.status === 'UNMATCHED' || resolution.topicId === null,
    ),
  };
};

/**
 * The per-question lookup the import service uses.
 *
 * Returns null for a pair that did not resolve, so the caller cannot
 * accidentally file the question somewhere plausible.
 */
export const taxonomyResolver = (
  result: ResolveResult,
): ((detected: DetectedTaxonomy) => { domainId: string; topicId: string } | null) => {
  const index = new Map<string, { domainId: string; topicId: string }>();
  for (const resolution of result.resolutions) {
    if (resolution.domainId === null || resolution.topicId === null) continue;
    index.set(keyOf({ domainName: resolution.domainName, topicName: resolution.topicName }), {
      domainId: resolution.domainId,
      topicId: resolution.topicId,
    });
  }
  return (detected) => index.get(keyOf(detected)) ?? null;
};
