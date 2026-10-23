// Puts the Document Studio mode back as global-setup.ts found it.

import { readFile, rm } from 'node:fs/promises';
import { modeFile, writeMode } from './studio-mode';

export default async function globalTeardown(): Promise<void> {
  const before = (await readFile(modeFile, 'utf8').catch(() => '')).trim();
  if (before === 'SIMPLE' || before === 'FULL') await writeMode(before);
  await rm(modeFile, { force: true });
}
