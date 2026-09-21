// Copies the approved design assets into each application's public folder.
//
// `design/approved/knowzy_design_elements_asset_pack/` is immutable reference
// material (CLAUDE.md), and Next will not serve a file from outside an
// application's own `public`. Nor can one application read the other's — they
// are separate deployables (ADR-001). So the approved files are copied, which
// is strategy 1 of the three the integration specification offers (§6): a
// build-time synchronization from the approved source into both public
// folders, with a generated consistency check.
//
// The check is `packages/testing/contracts/design-assets.test.ts`, and it is
// the point of doing it this way: it asserts every served asset exists in both
// applications and is byte-identical to its source, so a missing or edited
// copy fails `npm run verify` instead of rendering an empty box in a demo.
//
//   npm run assets:sync            copy, reporting what changed
//   npm run assets:sync -- --check report drift and exit non-zero
//
// The `--check` mode is what CI would run if this ever needs to be a gate on
// its own; today the contract test covers it.

import { copyFileSync, mkdirSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { SERVED_ASSETS } from '@knowzy/shared-ui/assets';

const REPO_ROOT = join(import.meta.dirname, '..');
const SOURCE = join(REPO_ROOT, 'design', 'approved', 'knowzy_design_elements_asset_pack');
const APPS = ['authoring-web', 'live-web'] as const;
const DESTINATION = join('public', 'assets', 'knowzy');

const check = process.argv.includes('--check');

const destinationRoot = (app: string): string => join(REPO_ROOT, 'apps', app, DESTINATION);

let copied = 0;
let identical = 0;
let removed = 0;
const problems: string[] = [];

for (const app of APPS) {
  const root = destinationRoot(app);

  for (const asset of SERVED_ASSETS) {
    const from = join(SOURCE, asset);
    const to = join(root, asset);

    if (!existsSync(from)) {
      problems.push(`missing from the approved pack: ${asset}`);
      continue;
    }

    const source = readFileSync(from);
    const current = existsSync(to) ? readFileSync(to) : null;

    if (current !== null && current.equals(source)) {
      identical += 1;
      continue;
    }

    if (check) {
      problems.push(`${app}: ${asset} ${current === null ? 'is missing' : 'differs from source'}`);
      continue;
    }

    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    copied += 1;
    console.log(`  copied  ${app}/${DESTINATION}/${asset}`);
  }

  // A file that is no longer in the manifest is removed, so the served set
  // cannot drift into holding assets nothing references.
  if (existsSync(root)) {
    const served = new Set(SERVED_ASSETS);
    const walk = (directory: string): string[] =>
      readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? walk(path) : [path];
      });

    for (const path of walk(root)) {
      const asset = relative(root, path).split('\\').join('/');
      if (served.has(asset)) continue;
      if (check) {
        problems.push(`${app}: ${asset} is served but not in the manifest`);
        continue;
      }
      rmSync(path);
      removed += 1;
      console.log(`  removed ${app}/${DESTINATION}/${asset} (not in the manifest)`);
    }
  }
}

console.log(
  `\n${SERVED_ASSETS.length} asset(s) per app · ${identical} already identical · ${copied} copied · ${removed} removed`,
);

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

console.log(check ? 'in sync with the approved pack' : 'synchronized');
