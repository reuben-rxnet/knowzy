// XLSX extraction correction — impact analysis (XLSX-INTEGRITY-M1).
// docs/migrations/XLSX_EXTRACTION_CORRECTION.md §4.
//
//   npx tsx scripts/xlsx-extraction-impact.ts --root <host dir> [--root <dir> ...] [--json <out.json>]
//
// READ-ONLY. For every synchronized XLSX knowledge document it:
//
//   1. finds the source file by name under the given roots (the containers see
//      /corpus; this runs on the host, so the host path is supplied);
//   2. re-extracts it with the CURRENT extractor, through the same
//      extractContent call and the same documentScope the adapter uses;
//   3. compares the recomputed content hash and section keys with what the
//      database holds, and counts the drafts, published questions and evidence
//      spans that reference the document or any section whose content changed.
//
// It prints hashes, counts and section keys -- never extracted text, which for
// a spreadsheet can be a row of anything. It writes nothing to the database.

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { extractContent } from '@knowzy/content-extraction';

interface Options {
  readonly roots: readonly string[];
  readonly json: string | null;
}

const parse = (argv: readonly string[]): Options => {
  const roots: string[] = [];
  let json: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--root' && argv[index + 1] !== undefined)
      roots.push(argv[++index] as string);
    else if (argv[index] === '--json' && argv[index + 1] !== undefined)
      json = argv[++index] as string;
  }
  if (roots.length === 0) {
    console.error(
      'usage: npx tsx scripts/xlsx-extraction-impact.ts --root <dir> [--root <dir>] [--json <out>]',
    );
    process.exit(64);
  }
  return { roots, json };
};

/** Every file under `root` named `name`, case-insensitively. */
const findByName = (root: string, name: string): string[] => {
  const found: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry);
      let isDirectory = false;
      try {
        isDirectory = statSync(path).isDirectory();
      } catch {
        continue;
      }
      if (isDirectory) walk(path);
      else if (entry.toLowerCase() === name.toLowerCase()) found.push(path);
    }
  };
  walk(root);
  return found;
};

export interface DocumentImpact {
  readonly documentId: string;
  readonly name: string;
  readonly source: string;
  readonly status: string;
  readonly storedContentHash: string | null;
  readonly storedSectionCount: number;
  readonly file: 'FOUND' | 'NOT_FOUND' | 'AMBIGUOUS';
  readonly recomputedContentHash: string | null;
  readonly recomputedSectionCount: number | null;
  readonly textChanged: boolean | null;
  readonly sectionsAdded: readonly string[];
  readonly sectionsRemoved: readonly string[];
  readonly sectionsContentChanged: readonly string[];
  readonly draftsReferencingDocument: number;
  readonly publishedReferencingDocument: number;
  readonly draftsInChangedSections: number;
  readonly publishedInChangedSections: number;
  readonly evidenceSpansAtRisk: number;
}

const run = async (): Promise<void> => {
  const options = parse(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    const documents = await prisma.knowledgeDocument.findMany({
      where: { fileType: { in: ['xlsx', 'XLSX'] } },
      select: {
        id: true,
        name: true,
        status: true,
        sourceDocumentId: true,
        contentHash: true,
        source: { select: { name: true } },
        sections: { select: { sectionKey: true, sectionKeyV1: true, sectionContentHash: true } },
      },
      orderBy: { name: 'asc' },
    });

    const impacts: DocumentImpact[] = [];
    for (const document of documents) {
      const stored = new Map(
        document.sections.map((s) => [s.sectionKey.trim(), s.sectionContentHash.trim()]),
      );
      const matches = options.roots.flatMap((root) => findByName(root, document.name));

      let recomputedContentHash: string | null = null;
      let recomputed: Map<string, string> | null = null;
      if (matches.length === 1) {
        const bytes = new Uint8Array(readFileSync(matches[0] as string));
        const result = await extractContent(
          { fileName: document.name, content: bytes, sizeBytes: bytes.length },
          { documentScope: document.sourceDocumentId },
        );
        recomputedContentHash = result.contentHash;
        recomputed = new Map(result.sections.map((s) => [s.sectionKey, s.sectionContentHash]));
      }

      const added =
        recomputed === null ? [] : [...recomputed.keys()].filter((key) => !stored.has(key));
      const removed =
        recomputed === null ? [] : [...stored.keys()].filter((key) => !recomputed.has(key));
      const changed =
        recomputed === null
          ? []
          : [...stored.keys()].filter(
              (key) => recomputed.has(key) && recomputed.get(key) !== stored.get(key),
            );
      // A question citing a section that disappears or whose content changed
      // is the one whose evidence may no longer verify.
      const atRiskKeys = [...removed, ...changed];
      const atRiskV1 = document.sections
        .filter((s) => atRiskKeys.includes(s.sectionKey.trim()) && s.sectionKeyV1 !== null)
        .map((s) => (s.sectionKeyV1 as string).trim());
      const keyFilter = { in: [...atRiskKeys, ...atRiskV1] };

      const draftsReferencingDocument = await prisma.draftQuestion.count({
        where: { sourceDocumentId: document.sourceDocumentId },
      });
      const publishedReferencingDocument = await prisma.publishedQuestionReference.count({
        where: { sourceDocumentId: document.sourceDocumentId },
      });
      const draftsInChangedSections =
        atRiskKeys.length === 0
          ? 0
          : await prisma.draftQuestion.count({ where: { sectionKey: keyFilter } });
      const publishedInChangedSections =
        atRiskKeys.length === 0
          ? 0
          : await prisma.publishedQuestionReference.count({ where: { sectionKey: keyFilter } });
      const evidenceSpansAtRisk =
        atRiskKeys.length === 0
          ? 0
          : await prisma.draftQuestion.count({
              where: { sectionKey: keyFilter, evidenceStartOffset: { not: null } },
            });

      impacts.push({
        documentId: document.id,
        name: document.name,
        source: document.source.name,
        status: document.status,
        storedContentHash: document.contentHash?.trim() ?? null,
        storedSectionCount: document.sections.length,
        file: matches.length === 1 ? 'FOUND' : matches.length === 0 ? 'NOT_FOUND' : 'AMBIGUOUS',
        recomputedContentHash,
        recomputedSectionCount: recomputed?.size ?? null,
        textChanged:
          recomputedContentHash === null
            ? null
            : recomputedContentHash !== (document.contentHash?.trim() ?? null),
        sectionsAdded: added,
        sectionsRemoved: removed,
        sectionsContentChanged: changed,
        draftsReferencingDocument,
        publishedReferencingDocument,
        draftsInChangedSections,
        publishedInChangedSections,
        evidenceSpansAtRisk,
      });
    }

    for (const impact of impacts) {
      console.log(`\n${impact.name}  (${impact.source}, ${impact.status})`);
      console.log(`  document id ............ ${impact.documentId}`);
      console.log(`  source file ............ ${impact.file}`);
      console.log(`  stored content hash .... ${impact.storedContentHash ?? '(none)'}`);
      console.log(
        `  recomputed hash ........ ${impact.recomputedContentHash ?? '(not recomputed)'}`,
      );
      console.log(
        `  text changed ........... ${impact.textChanged === null ? 'UNKNOWN' : impact.textChanged ? 'YES' : 'no'}`,
      );
      console.log(
        `  sections stored / new .. ${impact.storedSectionCount} / ${impact.recomputedSectionCount ?? '?'}`,
      );
      console.log(
        `  sections added/removed/changed ${impact.sectionsAdded.length}/${impact.sectionsRemoved.length}/${impact.sectionsContentChanged.length}`,
      );
      console.log(`  drafts on document ..... ${impact.draftsReferencingDocument}`);
      console.log(`  published on document .. ${impact.publishedReferencingDocument}`);
      console.log(
        `  drafts / published in changed sections ${impact.draftsInChangedSections} / ${impact.publishedInChangedSections}`,
      );
      console.log(`  evidence spans at risk . ${impact.evidenceSpansAtRisk}`);
    }
    console.log(`\n${impacts.length} synchronized XLSX document(s).`);
    if (options.json !== null)
      writeFileSync(options.json, `${JSON.stringify(impacts, null, 2)}\n`, 'utf8');
  } finally {
    await prisma.$disconnect();
  }
};

void run();
