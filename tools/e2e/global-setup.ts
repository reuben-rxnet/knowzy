// The suite runs against the FULL Document Studio (AI_DOCUMENT_STUDIO_ARCHITECTURE.md §12).
//
// Simple mode hides most of the authoring sidebar, and the specs were written
// against the full portal. The mode is platform state, so it is recorded here,
// set to FULL for the run, and put back by global-teardown.ts. The Simple-mode
// spec switches to SIMPLE itself and restores FULL when it finishes.
//
// An INTERRUPTED run never reaches its teardown and leaves the portal in FULL
// (2026-10-23: the owner opened the Studio to the old screens). Its note is
// still on disk, so the next run keeps the mode that note recorded rather than
// recording FULL as "what was there before".

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { modeFile, readMode, writeMode } from './studio-mode';

export default async function globalSetup(): Promise<void> {
  const leftover = (await readFile(modeFile, 'utf8').catch(() => '')).trim();
  const before = leftover === 'SIMPLE' || leftover === 'FULL' ? leftover : await readMode();
  await mkdir(dirname(modeFile), { recursive: true });
  await writeFile(modeFile, before, 'utf8');
  if ((await readMode()) !== 'FULL') await writeMode('FULL');
}
