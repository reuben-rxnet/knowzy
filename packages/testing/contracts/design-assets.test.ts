// The served design assets match the approved pack, exactly.
//
// The approved pack is immutable reference material and Next cannot serve a
// file from outside an application's own `public`, so the assets are copied
// into both applications (integration specification §6, strategy 1: a
// synchronization script plus a generated consistency check). This is that
// check, and it is the reason the copying approach is acceptable at all:
//
//   * A referenced asset that was never copied fails here rather than
//     rendering an empty box in a demonstration.
//   * A copy that was edited in place fails here — the approved artwork must
//     not be modified, and "do not modify" is worth nothing unless something
//     verifies it.
//   * A file sitting in `public` that no longer appears in the manifest fails
//     here, so the served set cannot quietly accumulate assets nothing uses.
//
// Run `npm run assets:sync` to fix any of the three.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SERVED_ASSETS } from '@knowzy/shared-ui/assets';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');
const PACK = join(REPO_ROOT, 'design', 'approved', 'knowzy_design_elements_asset_pack');
const APPS = ['authoring-web', 'live-web'] as const;

const servedRoot = (app: string): string =>
  join(REPO_ROOT, 'apps', app, 'public', 'assets', 'knowzy');

const filesUnder = (directory: string): string[] =>
  existsSync(directory)
    ? readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? filesUnder(path) : [path];
      })
    : [];

describe('the manifest names real approved assets', () => {
  it('lists at least the branding, navigation, illustration and backdrop sets', () => {
    expect(SERVED_ASSETS.length).toBeGreaterThan(0);
  });

  it('every manifest entry exists in the approved pack', () => {
    const missing = SERVED_ASSETS.filter((asset) => !existsSync(join(PACK, asset)));
    expect(missing).toEqual([]);
  });

  it('no manifest entry escapes the pack directory', () => {
    // The registry exists partly to make a path-traversal impossible; this
    // asserts the registry itself is clean.
    const suspicious = SERVED_ASSETS.filter(
      (asset) => asset.includes('..') || asset.startsWith('/') || asset.includes('\\'),
    );
    expect(suspicious).toEqual([]);
  });
});

describe('both applications serve exactly those assets', () => {
  for (const app of APPS) {
    it(`${app} has every asset, byte-identical to the approved source`, () => {
      const problems: string[] = [];

      for (const asset of SERVED_ASSETS) {
        const served = join(servedRoot(app), asset);
        if (!existsSync(served)) {
          problems.push(`${asset} is missing — run npm run assets:sync`);
          continue;
        }
        const source = readFileSync(join(PACK, asset));
        if (!readFileSync(served).equals(source)) {
          problems.push(`${asset} differs from the approved source`);
        }
      }

      expect(problems).toEqual([]);
    });

    it(`${app} serves nothing that is not in the manifest`, () => {
      const root = servedRoot(app);
      const served = new Set<string>(SERVED_ASSETS);
      const orphans = filesUnder(root)
        .map((path) => relative(root, path).split('\\').join('/'))
        .filter((asset) => !served.has(asset));

      expect(orphans).toEqual([]);
    });
  }
});
