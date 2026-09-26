// `copy.ts` has no duplicate keys, and the failure says WHICH.
//
// This exists because the file has been duplicated three times by
// non-idempotent edits, and TypeScript's own answer -- four hundred lines of
// "TS1117: An object literal cannot have multiple properties with the same
// name", one per offending line, with no key names -- is technically a failure
// and practically unreadable. The first time it happened it took a manual
// binary search through 900 lines to find the boundary.
//
// It parses the SOURCE rather than importing the module, because an object
// literal with a duplicate key is not a runtime error in JavaScript: the last
// one silently wins, and `Object.keys` would report no duplicate at all. The
// defect lives in the text.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(__dirname, '..', 'src', 'copy.ts'), 'utf8');

/** A key entry: two spaces, a quoted dotted key, a colon. */
const KEY = /^ {2}'([a-zA-Z0-9._]+)':/gm;

describe('copy.ts', () => {
  it('declares every key exactly once', () => {
    const counts = new Map<string, number>();
    for (const match of source.matchAll(KEY)) {
      const key = match[1] ?? '';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const duplicates = [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([key, count]) => `${key} (${count}x)`);

    expect(duplicates, 'duplicate copy keys — the LAST one silently wins').toEqual([]);
  });

  it('has enough keys to be the real file', () => {
    // A guard against the opposite failure: a de-duplication pass that removed
    // too much would leave a file that passes the test above and breaks every
    // screen. 500 is well below the real count and well above an accident.
    expect([...source.matchAll(KEY)].length).toBeGreaterThan(500);
  });
});
