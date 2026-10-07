// The definitions hash a framework version is approved against (COMPETENCY-M2).
//
// docs/competencies/COMPETENCY_ADMINISTRATION.md §4: a version is a SNAPSHOT,
// and an approval covers exactly one snapshot. That only holds if the same
// definitions always produce the same hash and any change to them produces a
// different one -- so the serialization is canonical: every list sorted by
// code, every object written with a fixed key order, status included (a
// retired competency is a different framework from an active one).
//
// Pure, and tested without a database.

import { createHash } from 'node:crypto';

export interface DigestScale {
  readonly code: string;
  readonly name: string;
  readonly levels: readonly {
    readonly code: string;
    readonly label: string;
    readonly ordinal: number;
  }[];
}

export interface DigestCategory {
  readonly code: string;
  readonly name: string;
  readonly kind: string;
  readonly ordinal: number;
  readonly status: string;
}

export interface DigestCompetency {
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly categoryCode: string;
  readonly scaleCode: string;
  readonly status: string;
}

export interface DigestAlias {
  readonly subject: string;
  readonly contextCode: string;
  readonly foldedAlias: string;
  readonly alias: string;
  /** The category code for a CATEGORY alias, the competency code otherwise. */
  readonly targetCode: string;
  readonly decision: string;
  readonly status: string;
}

export interface FrameworkDefinitions {
  readonly frameworkCode: string;
  readonly scales: readonly DigestScale[];
  readonly categories: readonly DigestCategory[];
  readonly competencies: readonly DigestCompetency[];
  readonly aliases: readonly DigestAlias[];
}

const byKey =
  <T>(key: (value: T) => string) =>
  (a: T, b: T): number => {
    const left = key(a);
    const right = key(b);
    return left < right ? -1 : left > right ? 1 : 0;
  };

/** The canonical form, exposed so a test can show what the hash covers. */
export const canonicalDefinitions = (definitions: FrameworkDefinitions): string =>
  JSON.stringify([
    definitions.frameworkCode,
    [...definitions.scales]
      .sort(byKey((scale) => scale.code))
      .map((scale) => [
        scale.code,
        scale.name,
        [...scale.levels]
          .sort((a, b) => a.ordinal - b.ordinal)
          .map((level) => [level.code, level.label, level.ordinal]),
      ]),
    [...definitions.categories]
      .sort(byKey((category) => category.code))
      .map((category) => [
        category.code,
        category.name,
        category.kind,
        category.ordinal,
        category.status,
      ]),
    [...definitions.competencies]
      .sort(byKey((competency) => competency.code))
      .map((competency) => [
        competency.code,
        competency.name,
        competency.description,
        competency.categoryCode,
        competency.scaleCode,
        competency.status,
      ]),
    [...definitions.aliases]
      .sort(
        byKey((alias) => `${alias.subject}\u0000${alias.contextCode}\u0000${alias.foldedAlias}`),
      )
      .map((alias) => [
        alias.subject,
        alias.contextCode,
        alias.foldedAlias,
        alias.alias,
        alias.targetCode,
        alias.decision,
        alias.status,
      ]),
  ]);

export const definitionsDigest = (definitions: FrameworkDefinitions): string =>
  createHash('sha256').update(canonicalDefinitions(definitions), 'utf8').digest('hex');

/**
 * Separation of duties (decision A3): may `approverId` approve something that
 * `createdBy` created and `editors` edited? Returns the reason it may not, or
 * null. The database CHECK enforces the same rule; this exists so the refusal
 * has words before the write is attempted.
 */
export const separationRefusal = (args: {
  readonly approverId: string;
  readonly createdByUserId: string | null;
  readonly modifiedByUserId?: string | null;
  readonly editorUserIds: readonly string[];
  readonly noun: string;
}): string | null => {
  if (args.createdByUserId !== null && args.createdByUserId === args.approverId) {
    return (
      `You created this ${args.noun}, so you may not approve it. Approval is separated from ` +
      'editing: a different KNOWZY Administrator has to approve it.'
    );
  }
  if (
    (args.modifiedByUserId ?? null) === args.approverId ||
    args.editorUserIds.includes(args.approverId)
  ) {
    return (
      `You edited this ${args.noun}, so you may not approve it. Approval is separated from ` +
      'editing: a different KNOWZY Administrator has to approve it.'
    );
  }
  return null;
};
