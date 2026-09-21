// An unconverted page must opt in to the legacy stylesheet.
//
// UI-M2 moved `legacy.css` from an ancestor scope (`#main`) to an opt-in class
// (`.legacy-page`), because a converted page still renders inside `#main` and
// `#main button` outranks the utility classes on a shared Button.
//
// The cost of an opt-in is that forgetting it is silent: the page renders with
// no styling at all rather than failing. That happened — the quiz page has two
// `<article>` roots, one per branch, and only the first was marked. The result
// looked like a stylesheet had been deleted.
//
// So: while `legacy.css` still has rules, every `<article>` root in this app
// carries the class. When the last page is converted the file goes, and this
// suite goes with it.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP_DIR = join(import.meta.dirname, '..', 'src', 'app');
const LEGACY_CSS = join(APP_DIR, 'legacy.css');

const pageFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return pageFiles(path);
    return entry.name === 'page.tsx' ? [path] : [];
  });

describe('the legacy stylesheet is opted into, not inherited', () => {
  it('is scoped to a class rather than an ancestor', () => {
    if (!existsSync(LEGACY_CSS)) return; // fully converted: nothing to scope
    const css = readFileSync(LEGACY_CSS, 'utf8');
    expect(css).toContain('.legacy-page {');
    // `#main` would reach converted pages too, and outrank their utilities.
    expect(css).not.toContain('#main {');
  });

  it('is named on every article root of every page that still needs it', () => {
    if (!existsSync(LEGACY_CSS)) return;

    const offenders: string[] = [];
    for (const file of pageFiles(APP_DIR)) {
      const source = readFileSync(file, 'utf8');
      // A page is either converted (no <article> at all) or unconverted, in
      // which case EVERY branch's root must opt in. A bare `<article>` is the
      // mistake this catches.
      for (const [index, line] of source.split('\n').entries()) {
        if (/<article(\s*>|\s+(?!className="legacy-page")[^>]*>)/.test(line)) {
          offenders.push(`${file.replace(APP_DIR, '')}:${index + 1} ${line.trim()}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
