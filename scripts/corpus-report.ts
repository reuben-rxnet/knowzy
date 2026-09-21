// Measures a file-repository corpus and prints the Document Register rows.
//
// Used to populate `RealWorldPilot/CorpusManifest.md` from files that ACTUALLY
// EXIST in a configured root — never by hand, and never invented. Run it
// against the fixture mirror, or against a real synchronized root once one is
// available:
//
//   npx tsx scripts/corpus-report.ts fixtures/pilot-mirror
//   npx tsx scripts/corpus-report.ts "$PILOT_MIRROR_ROOT"
//
// It prints RELATIVE paths only. The root is operational configuration and is
// deliberately absent from the output, so a register populated from this
// output cannot carry a username, a drive letter or a machine name.

import { readFileSync } from 'node:fs';
import { extractContent, SUPPORTED_EXTENSIONS } from '@knowzy/content-extraction';
import { loadDirectoryTree, treeDocumentId } from '@knowzy/knowledge-source-adapters';

const TEXT_EXTENSIONS = new Set(['txt', 'text', 'md', 'markdown', 'html', 'htm', 'aspx']);

const main = async (root: string): Promise<number> => {
  const tree = loadDirectoryTree({
    rootPath: root,
    supportedExtensions: [...SUPPORTED_EXTENSIONS],
  });

  const rows: string[] = [];
  const counts = { extracted: 0, empty: 0, failed: 0, unsupported: 0, other: 0 };
  let sections = 0;
  let assessable = 0;

  for (const document of tree.documents) {
    const bytes = new Uint8Array(readFileSync(document.absolutePath));
    const isText = TEXT_EXTENSIONS.has(document.fileType);
    const result = await extractContent({
      fileName: document.name,
      content: isText ? Buffer.from(bytes).toString('utf8') : bytes,
      sizeBytes: document.sizeBytes,
    });

    if (result.status === 'EXTRACTED') counts.extracted += 1;
    else if (result.status === 'EMPTY') counts.empty += 1;
    else if (result.status === 'FAILED') counts.failed += 1;
    else if (result.status === 'UNSUPPORTED') counts.unsupported += 1;
    else counts.other += 1;

    sections += result.sections.length;
    assessable += result.sections.filter((section) => section.isAssessable).length;

    rows.push(
      [
        '',
        `\`${treeDocumentId(document.relativePath).slice(0, 12)}\``,
        `\`${document.relativePath}\``,
        document.name,
        document.fileType.toUpperCase(),
        'Not yet assigned',
        'Not yet assigned',
        // A document the source declares inaccessible is listed so the register
        // is complete, and marked so nobody reads it as available.
        document.access.default === 'DENIED' ? 'EXCLUDED (declared not accessible)' : 'INCLUDED',
        result.contentHash === null ? 'Not measured' : `\`${result.contentHash.slice(0, 12)}\``,
        document.sourceVersion === '' ? 'None declared' : document.sourceVersion,
        result.status,
        String(result.sections.length),
        'Not yet executed',
        '0',
        '0',
        '0',
        document.sourceModifiedAt.toISOString().slice(0, 10),
        'Not yet executed',
        result.status === 'EXTRACTED'
          ? `${result.sections.filter((s) => s.isAssessable).length} assessable`
          : (result.reason ?? ''),
        '',
      ].join(' | '),
    );
  }

  console.log('## Document Register rows\n');
  console.log(rows.join('\n'));

  console.log('\n## Measured totals\n');
  console.log(`documents discovered:        ${tree.documents.length + tree.skipped.length}`);
  console.log(`documents included:          ${tree.documents.length}`);
  console.log(`documents excluded:          ${tree.skipped.length}`);
  console.log(`extracted:                   ${counts.extracted}`);
  console.log(`empty content:               ${counts.empty}`);
  console.log(`extraction failures:         ${counts.failed + counts.unsupported + counts.other}`);
  console.log(`sections generated:          ${sections}`);
  console.log(`assessable sections:         ${assessable}`);

  console.log('\n## Exclusions by reason\n');
  const byReason = new Map<string, number>();
  for (const skip of tree.skipped) {
    byReason.set(skip.reason, (byReason.get(skip.reason) ?? 0) + 1);
  }
  for (const [reason, count] of [...byReason.entries()].sort()) {
    console.log(`${reason.padEnd(18)} ${count}`);
  }

  console.log('\n## Format distribution\n');
  const byType = new Map<string, number>();
  for (const document of tree.documents) {
    byType.set(document.fileType, (byType.get(document.fileType) ?? 0) + 1);
  }
  for (const skip of tree.skipped) {
    if (skip.reason !== 'UNSUPPORTED_TYPE') continue;
    const dot = skip.relativePath.lastIndexOf('.');
    const extension = dot === -1 ? '(none)' : skip.relativePath.slice(dot + 1).toLowerCase();
    byType.set(`${extension} (no extractor)`, (byType.get(`${extension} (no extractor)`) ?? 0) + 1);
  }
  for (const [type, count] of [...byType.entries()].sort()) {
    console.log(`${type.padEnd(22)} ${count}`);
  }

  return 0;
};

const root = process.argv[2];
if (root === undefined) {
  console.error('usage: tsx scripts/corpus-report.ts <root>');
  process.exit(2);
} else {
  // Not top-level await: this script is transformed to CJS by tsx.
  void main(root).then((code) => process.exit(code));
}
