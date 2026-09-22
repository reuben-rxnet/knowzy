// Coverage reporting, PILOT-T2.
//
// Prints the five section states separately, because a single coverage
// percentage cannot distinguish them and the attempt to make it do so is what
// produced a 94.8% figure on a corpus whose true coverage was 2.6%:
//
//   assessable   long enough and not curated out. The denominator.
//   attempted    has been in at least one generation job's scope
//   generated    a question cites it. This, over assessable, IS coverage
//   refused      a run reported nothing testable. A fact about the run
//   unresolved   assessable, no question, no refusal — including never tried
//
// Run: npx tsx scripts/coverage-report.ts

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// count() arrives as BigInt through the raw client, so every arithmetic use
// below normalizes first rather than discovering it at the division.
interface RawRow {
  readonly scope: string;
  readonly assessable: bigint;
  readonly attempted: bigint;
  readonly generated: bigint;
  readonly refused: bigint;
  readonly unresolved: bigint;
  readonly never_attempted: bigint;
}

interface Row {
  readonly scope: string;
  readonly assessable: number;
  readonly attempted: number;
  readonly generated: number;
  readonly refused: number;
  readonly unresolved: number;
  readonly never_attempted: number;
}

const toRow = (r: RawRow): Row => ({
  scope: r.scope,
  assessable: Number(r.assessable),
  attempted: Number(r.attempted),
  generated: Number(r.generated),
  refused: Number(r.refused),
  unresolved: Number(r.unresolved),
  never_attempted: Number(r.never_attempted),
});

const pct = (part: number, whole: number): string =>
  whole === 0 ? '—' : `${((part / whole) * 100).toFixed(1)}%`;

const table = (title: string, rows: readonly Row[]): void => {
  console.log(`\n${title}`);
  console.log('-'.repeat(title.length));
  if (rows.length === 0) {
    console.log('(nothing)');
    return;
  }
  const width = Math.max(...rows.map((r) => r.scope.length), 8);
  console.log(
    [
      'scope'.padEnd(width),
      'assess'.padStart(7),
      'attempt'.padStart(8),
      'gener'.padStart(6),
      'refuse'.padStart(7),
      'unres'.padStart(6),
      'coverage'.padStart(9),
    ].join(' '),
  );
  for (const r of rows) {
    console.log(
      [
        r.scope.padEnd(width),
        String(r.assessable).padStart(7),
        String(r.attempted).padStart(8),
        String(r.generated).padStart(6),
        String(r.refused).padStart(7),
        String(r.unresolved).padStart(6),
        pct(r.generated, r.assessable).padStart(9),
      ].join(' '),
    );
  }
};

const ACCOUNTING = `
  count(*) FILTER (WHERE s.is_assessable) AS assessable,
  count(*) FILTER (WHERE s.is_assessable AND s.generation_attempt_count > 0) AS attempted,
  count(*) FILTER (WHERE s.is_assessable AND s.coverage_status = 'COVERED') AS generated,
  count(*) FILTER (
    WHERE s.is_assessable
      AND s.coverage_status <> 'COVERED'
      AND s.last_generation_outcome = 'REFUSED'
  ) AS refused,
  count(*) FILTER (
    WHERE s.is_assessable
      AND s.coverage_status <> 'COVERED'
      AND s.last_generation_outcome <> 'REFUSED'
  ) AS unresolved,
  count(*) FILTER (
    WHERE s.is_assessable AND s.generation_attempt_count = 0
  ) AS never_attempted
`;

const run = async (): Promise<void> => {
  const bySource = (
    await prisma.$queryRawUnsafe<RawRow[]>(`
    SELECT ks.name AS scope, ${ACCOUNTING}
    FROM document_section s
    JOIN knowledge_document d ON d.id = s.document_id
    JOIN knowledge_source ks ON ks.id = d.source_id
    GROUP BY ks.name
    ORDER BY ks.name
  `)
  ).map(toRow);

  const byDocument = (
    await prisma.$queryRawUnsafe<RawRow[]>(`
    SELECT d.name AS scope, ${ACCOUNTING}
    FROM document_section s
    JOIN knowledge_document d ON d.id = s.document_id
    GROUP BY d.name
    HAVING count(*) FILTER (WHERE s.is_assessable) > 0
    ORDER BY 4 DESC, 2 DESC
    LIMIT 15
  `)
  ).map(toRow);

  table('By knowledge source', bySource);
  table('By document (top 15 by generated, then assessable)', byDocument);

  // Section-key health. The collision this release removed is the kind of
  // thing that returns quietly, so it is reported every time rather than
  // checked once.
  const [collisions] = await prisma.$queryRaw<{ colliding_keys: bigint }[]>`
    SELECT count(*)::bigint AS colliding_keys
    FROM (
      SELECT section_key
      FROM document_section
      GROUP BY section_key
      HAVING count(DISTINCT document_id) > 1
    ) x`;
  const [keys] = await prisma.$queryRaw<{ total: bigint; scoped: bigint }[]>`
    SELECT count(*)::bigint AS total,
           count(section_key_v1)::bigint AS scoped
    FROM document_section`;

  console.log('\nSection keys');
  console.log('------------');
  console.log(`sections:                 ${keys?.total ?? 0}`);
  console.log(`carrying a v1 key:        ${keys?.scoped ?? 0}`);
  console.log(`keys shared by 2+ docs:   ${collisions?.colliding_keys ?? 0}  (must be 0)`);

  await prisma.$disconnect();
  if ((collisions?.colliding_keys ?? 0n) > 0n) process.exitCode = 1;
};

void run();
