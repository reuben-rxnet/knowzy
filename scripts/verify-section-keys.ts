// Verifies that migration 0004's SQL derivation and scopeSectionKey() agree.
// Two implementations of one expression in two languages is exactly how a
// migration silently stops matching the code, so this is checked rather than
// assumed.
import { PrismaClient } from '@prisma/client';
import { scopeSectionKey } from '@knowzy/content-extraction';

const prisma = new PrismaClient();

const run = async (): Promise<void> => {
  const rows = await prisma.$queryRaw<
    { section_key_v1: string; source_document_id: string; section_key: string }[]
  >`SELECT s.section_key_v1, d.source_document_id, s.section_key
      FROM document_section s
      JOIN knowledge_document d ON d.id = s.document_id`;

  let ok = 0;
  const bad: string[] = [];
  for (const row of rows) {
    const expected = scopeSectionKey(row.section_key_v1.trim(), row.source_document_id);
    if (expected === row.section_key.trim()) ok += 1;
    else bad.push(`${row.section_key_v1.trim()} + ${row.source_document_id}`);
  }

  console.log(`rows checked: ${rows.length}`);
  console.log(`TS derivation matches SQL: ${ok}`);
  console.log(`mismatched: ${bad.length}`);
  for (const b of bad.slice(0, 5)) console.log(`  ${b}`);
  await prisma.$disconnect();
  if (bad.length > 0) process.exitCode = 1;
};

void run();
