// No screen may state a metric this platform does not record.
//
// The UI briefs forbid trend indicators, coverage scores, activity feeds,
// executive metrics, streaks, learning hours, badges earned, recommendations
// and course hierarchies — because no field, table or read model behind any of
// them exists. `CLAUDE.md` names three of these as things "a redesign will be
// tempted to do and must not", which is an accurate prediction: a mockup shows
// them, so every pass over these screens is under pressure to add them.
//
// Comments in a page component saying "no deltas here, deliberately" are worth
// nothing against that pressure. This is the same rule as a build gate.
//
// WHAT IT CHECKS, and why these two rules and not a word blacklist:
//
//   1. A COMPARISON PHRASE is forbidden outright. "vs last month",
//      "month over month", "+12% from" — no honest sentence phrases itself
//      that way, so any occurrence is a fabricated trend.
//
//   2. A FORBIDDEN CONCEPT is forbidden only when the string also carries a
//      `{placeholder}`. That is the precise discriminator between the two
//      cases, which a blacklist cannot tell apart:
//
//        "This release keeps no badges, points, streaks or levels."   allowed
//        "{count} badges earned"                                      fails
//
//      Naming a concept in order to say the platform does not record it is
//      exactly the honest empty state the brief asks for. Interpolating a
//      value for it is the fabrication.
//
// Content rule C1 puts EVERY user-visible string in `copy.ts`, which is what
// makes scanning those two files sufficient: a component cannot smuggle a
// label past this check without failing the C1 gate instead.
//
// ONE NARROW EXCEPTION, since decision R-1 (2026-09-27). Coverage history is
// now recorded — `reporting.coverage_snapshot`, one row per UTC day — and a
// flow's previous window is counted from dated rows, so a previous-period
// comparison CAN be measured. The premise of rule 1 ("no KPI history is stored
// anywhere") is no longer true for the reporting dashboard, and pretending it
// was would mean phrasing a real comparison in synonyms to get past a regex,
// which is this test being gamed rather than obeyed.
//
// So comparison phrasing is allowed under the `rep.cmp` prefix ONLY, and only
// on three conditions this file checks: the keys are rendered by ONE component
// (`KpiComparison.tsx`) and referenced nowhere else; that component prints a
// movement only for a comparison whose status is AVAILABLE; and it prints
// "Not Yet Available" otherwise. Everywhere else rule 1 stands unchanged.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');

const COPY = {
  'authoring-web': join(REPO_ROOT, 'apps', 'authoring-web', 'src', 'copy.ts'),
  'live-web': join(REPO_ROOT, 'apps', 'live-web', 'src', 'copy.ts'),
} as const;

/**
 * A comparison against an unrecorded past. No KPI history is stored anywhere
 * (capability matrix §5.1), so a delta could only ever be invented.
 */
const COMPARISONS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: 'vs a previous period', pattern: /\bvs\.?\s+(last|previous|prior)\b/i },
  { name: 'since a previous period', pattern: /\bsince\s+(last|the\s+last)\s+\w+/i },
  { name: 'month over month', pattern: /\b(month|week|quarter|year)[-\s]?(over|on)[-\s]?\1\b/i },
  { name: 'a signed percentage change', pattern: /[+−-]\s?\{?\w*\}?\s?%\s+(from|vs|on)\b/i },
  { name: 'a trend direction', pattern: /\btrending\s+(up|down)\b/i },
  { name: 'an up/down movement', pattern: /\b(up|down)\s+\{?\w+\}?\s?%/i },
  { name: 'a compared-to phrase', pattern: /\bcompared\s+(to|with)\s+(last|previous|prior)\b/i },
];

/**
 * Concepts with no backing field anywhere in the schema. Interpolating a value
 * for one of these is fabricating it.
 *
 * `course` and `learning path` are here because learner specification §7.2
 * forbids reinterpreting an assessment as either in order to fill a screen.
 */
const CONCEPTS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: 'learning streak', pattern: /\bstreaks?\b/i },
  { name: 'learning hours', pattern: /\b(learning|study)\s+(hours|minutes|time)\b/i },
  { name: 'badges earned', pattern: /\bbadges?\b/i },
  { name: 'certificates', pattern: /\bcertificates?\b/i },
  { name: 'points or XP', pattern: /\b(points|xp)\b/i },
  { name: 'a course', pattern: /\bcourses?\b/i },
  { name: 'a learning path', pattern: /\blearning\s+paths?\b/i },
  { name: 'a recommendation', pattern: /\brecommend(ed|ation|ations)?\b/i },
  { name: 'enrolment', pattern: /\benrol(l)?(ed|ment|ments)?\b/i },
  { name: 'a content-health or coverage score', pattern: /\b(content\s+health|health\s+score)\b/i },
  { name: 'an activity feed', pattern: /\bactivity\s+feed\b/i },
];

/**
 * Every single- or double-quoted string literal in a copy module, with the
 * line it sits on.
 *
 * Deliberately crude: it over-collects rather than under-collects, because a
 * check that quietly skipped a string would be the one failure mode that makes
 * this test worse than no test.
 */
const literals = (source: string): readonly { readonly text: string; readonly line: number }[] => {
  const found: { text: string; line: number }[] = [];
  source.split('\n').forEach((line, index) => {
    if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) return;
    for (const match of line.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)) {
      const text = match[1] ?? match[2] ?? '';
      if (text !== '') found.push({ text, line: index + 1 });
    }
  });
  return found;
};

const hasPlaceholder = (text: string): boolean => /\{[a-zA-Z]\w*\}/.test(text);

/** The one prefix whose strings may state a comparison. See the header. */
const COMPARISON_PREFIX = 'rep.cmp';
const COMPARISON_COMPONENT = join(
  REPO_ROOT,
  'apps',
  'authoring-web',
  'src',
  'components',
  'KpiComparison.tsx',
);

/**
 * The copy key each literal belongs to.
 *
 * A key sits on its own line (`'rep.x': 'value'` or `'rep.x':` with the value
 * on the next line), so the key in force is the last one seen. Keys are
 * themselves literals and are skipped as values.
 */
const keyed = (
  source: string,
): readonly { readonly key: string | null; readonly text: string; readonly line: number }[] => {
  const out: { key: string | null; text: string; line: number }[] = [];
  let key: string | null = null;
  source.split('\n').forEach((line, index) => {
    const declared = /^\s*'([a-z]+\.[A-Za-z0-9]+)'\s*:/.exec(line);
    if (declared !== null) key = declared[1] ?? null;
    if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) return;
    for (const match of line.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)) {
      const text = match[1] ?? match[2] ?? '';
      if (text === '' || text === key) continue;
      out.push({ key, text, line: index + 1 });
    }
  });
  return out;
};

describe('no fabricated metrics reach a screen', () => {
  for (const [app, path] of Object.entries(COPY)) {
    const strings = literals(readFileSync(path, 'utf8'));

    it(`${app}: collects the copy to scan`, () => {
      // Guards the scanner itself. If the literal extractor silently broke,
      // every check below would pass on an empty list.
      expect(strings.length).toBeGreaterThan(100);
    });

    it(`${app}: states no comparison against an unrecorded period`, () => {
      const offences = keyed(readFileSync(path, 'utf8'))
        // The one exception: measured comparisons, rendered by one component.
        .filter(({ key }) => key === null || !key.startsWith(COMPARISON_PREFIX))
        .flatMap(({ text, line }) =>
          COMPARISONS.filter((rule) => rule.pattern.test(text)).map(
            (rule) => `${path}:${line} states ${rule.name}: ${JSON.stringify(text)}`,
          ),
        );
      expect(offences).toEqual([]);
    });

    it(`${app}: interpolates no value for a concept the platform does not record`, () => {
      const offences = strings
        .filter(({ text }) => hasPlaceholder(text))
        .flatMap(({ text, line }) =>
          CONCEPTS.filter((rule) => rule.pattern.test(text)).map(
            (rule) => `${path}:${line} renders a value for ${rule.name}: ${JSON.stringify(text)}`,
          ),
        );
      expect(offences).toEqual([]);
    });
  }
});

describe('the one place a comparison may be stated', () => {
  const component = readFileSync(COMPARISON_COMPONENT, 'utf8');
  const copyKeys = [
    ...readFileSync(COPY['authoring-web'], 'utf8').matchAll(/^\s*'(rep\.cmp[A-Za-z0-9]+)'\s*:/gm),
  ].map((match) => match[1] as string);

  it('exists, so the exception is not vacuous', () => {
    expect(copyKeys.length).toBeGreaterThan(3);
  });

  it('is rendered by KpiComparison.tsx and referenced by NO other file', () => {
    const src = join(REPO_ROOT, 'apps', 'authoring-web', 'src');
    const files = readdirSync(src, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
      .map((entry) => join(entry.parentPath, entry.name))
      .filter((file) => file !== COPY['authoring-web'] && file !== COMPARISON_COMPONENT);
    const offenders = files.filter((file) =>
      copyKeys.some((key) => readFileSync(file, 'utf8').includes(`'${key}'`)),
    );
    expect(offenders).toEqual([]);
    for (const key of copyKeys) expect(component, `${key} is unused`).toContain(`'${key}'`);
  });

  it('prints a movement ONLY for a measured comparison, and "Not Yet Available" otherwise', () => {
    // The guard is the first branch of the component, and the movement keys
    // appear only after it. Moving the guard below them fails this.
    const guard = component.indexOf("data.comparisonStatus !== 'AVAILABLE'");
    expect(guard).toBeGreaterThan(-1);
    for (const key of ['rep.cmpVsSnapshot', 'rep.cmpVsPreviousWindow', 'rep.cmpPoints']) {
      expect(component.indexOf(`'${key}'`)).toBeGreaterThan(guard);
    }
    expect(component).toContain("t('rep.cmpNotYet')");
  });
});
