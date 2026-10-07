// The design system is a shared contract, so the parts of it that must not
// drift are asserted rather than trusted.
//
// Three things these tests protect:
//
//   1. The brand palette. §5.2 names seven exact hex values. A tidy-up that
//      nudged one would be invisible in review and wrong on every screen.
//   2. The rule that colour lives in exactly one file. A component that hard
//      codes `#00B388` works today and breaks the next theme.
//   3. Navigation honesty. Only IMPLEMENTED and PARTIALLY_IMPLEMENTED
//      destinations may be links — anything else would be a dead link, which
//      the learner specification §5.2 forbids by name.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { statusTone } from './components/Badge.js';
import { AUTHORING_NAV, LEARNER_NAV } from './components/Shells.js';
import { activeNavLabel, isActivePath, type NavItem } from './components/SideNav.js';

const SRC = join(import.meta.dirname, '.');
const tokens = readFileSync(join(SRC, 'tokens.css'), 'utf8');

describe('brand tokens', () => {
  it('declares the seven §5.2 brand colours exactly', () => {
    // Verbatim from KNOWZY_UI_SOURCE_OF_TRUTH.md §5.2. If the specification
    // changes, this list changes with it — and only then.
    const palette: Readonly<Record<string, string>> = {
      '--color-brand-navy': '#001e62',
      '--color-brand-green': '#00b388',
      '--color-brand-navy-text': '#08245c',
      '--color-brand-blue': '#146ef5',
      '--color-brand-ai': '#6b4eff',
      '--color-brand-canvas': '#f5f8fc',
      '--color-brand-surface': '#ffffff',
    };

    for (const [token, value] of Object.entries(palette)) {
      expect(tokens.toLowerCase()).toContain(`${token}: ${value}`);
    }
  });

  it('defines the interaction-target and header dimensions the shell relies on', () => {
    // §7 requires a 44px minimum target and §8.1 a ~72px header. Both are
    // tokens so a component cannot quietly shrink them.
    expect(tokens).toContain('--spacing-target: 2.75rem');
    expect(tokens).toContain('--spacing-header: 5rem');
  });

  it('honours prefers-reduced-motion', () => {
    expect(tokens).toContain('prefers-reduced-motion: reduce');
  });

  it('keeps a visible focus indicator in the base layer', () => {
    expect(tokens).toContain(':focus-visible');
  });
});

describe('components hold no literal colour', () => {
  it('every hex colour lives in tokens.css', () => {
    const componentDir = join(SRC, 'components');
    const offenders: string[] = [];

    for (const file of readdirSync(componentDir)) {
      if (!file.endsWith('.tsx')) continue;
      const source = readFileSync(join(componentDir, file), 'utf8');

      for (const [lineNumber, line] of source.split('\n').entries()) {
        // Brand.tsx mirrors the approved SVG artwork, whose fills are part of
        // the asset rather than of the theme. Every other file must reference
        // a token-derived utility.
        if (file === 'Brand.tsx') continue;
        if (/#[0-9a-fA-F]{3,8}\b/.test(line)) {
          offenders.push(`${file}:${lineNumber + 1} ${line.trim()}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe('navigation cannot create a dead link', () => {
  const linkable = new Set(['IMPLEMENTED', 'PARTIALLY_IMPLEMENTED']);

  const assertHonest = (items: readonly NavItem[]) => {
    for (const item of items) {
      if (item.href === undefined) {
        // An item without a destination must not claim to be available.
        expect(linkable.has(item.status), `${item.label} has no href`).toBe(false);
      } else if (item.preview === true) {
        // A preview links to a labelled preview page and must KEEP an
        // unreleased status: marking it IMPLEMENTED would drop the chip and let
        // the preview pass for the real thing.
        expect(linkable.has(item.status), `${item.label} is a preview`).toBe(false);
      } else {
        // An item with a destination must be one the release actually serves.
        expect(linkable.has(item.status), `${item.label} has an href`).toBe(true);
      }
    }
  };

  it('holds for the authoring sidebar', () => {
    assertHonest(AUTHORING_NAV);
    // §9 lists ten destinations; this build adds Publish, Import Questions
    // and (Slice 2) AI Document Studio, all real routes today, so thirteen
    // entries is correct and not a miscount.
    expect(AUTHORING_NAV).toHaveLength(13);
  });

  it('holds for the learner sidebar', () => {
    assertHonest(LEARNER_NAV);
    // Learner §5.2 lists exactly eight.
    expect(LEARNER_NAV).toHaveLength(8);
  });

  it('explains every partially implemented destination', () => {
    for (const item of [...AUTHORING_NAV, ...LEARNER_NAV]) {
      if (item.status === 'PARTIALLY_IMPLEMENTED') {
        // A link that goes somewhere other than its own page has to say so, or
        // it reads as a bug.
        expect(item.note, `${item.label} needs a note`).toBeTruthy();
      }
    }
  });
});

describe('status vocabulary', () => {
  it('maps the platform’s own status strings onto tones', () => {
    expect(statusTone('PUBLISHED')).toBe('success');
    expect(statusTone('SUBMITTED_FOR_APPROVAL')).toBe('info');
    expect(statusTone('CHANGES_REQUESTED')).toBe('warning');
    expect(statusTone('REJECTED')).toBe('danger');
    expect(statusTone('RETIRED')).toBe('neutral');
  });

  it('falls back to neutral rather than guessing', () => {
    expect(statusTone('SOMETHING_NEW')).toBe('neutral');
  });
});

describe('active path matching', () => {
  it('matches the root exactly', () => {
    expect(isActivePath('/', '/')).toBe(true);
    expect(isActivePath('/sources', '/')).toBe(false);
  });

  it('keeps a parent selected on its detail routes', () => {
    expect(isActivePath('/review/01a0-abc', '/review')).toBe(true);
  });

  it('holds a queue of a route apart from the route itself', () => {
    // Approvals is `/review?queue=approval`. On plain `/review` it is not the
    // page the user is on; with that queue open, it is.
    expect(isActivePath('/review', '/review?queue=approval')).toBe(false);
    expect(isActivePath('/review?queue=approval', '/review?queue=approval')).toBe(true);
    expect(isActivePath('/review?queue=author', '/review?queue=approval')).toBe(false);
    // A plain destination still matches whatever query happens to be present.
    expect(isActivePath('/review?queue=approval', '/review')).toBe(true);
  });

  it('does not match a route that merely shares a prefix', () => {
    expect(isActivePath('/sources-archive', '/sources')).toBe(false);
  });
});

describe('exactly one navigation item is ever active', () => {
  // Two highlighted items would claim the user is in two places at once, and
  // would put two aria-current="page" items in one list. Several entries do
  // legitimately share a route while a capability still lives there.
  const bothNavs: ReadonlyArray<readonly [string, readonly NavItem[]]> = [
    ['authoring', AUTHORING_NAV],
    ['learner', LEARNER_NAV],
  ];

  const everyLocation = (items: readonly NavItem[]): readonly string[] => [
    '/',
    ...items.flatMap((item) => (item.href === undefined ? [] : [item.href])),
    '/review/01a0-abc',
    '/sources/01a0-abc',
    '/sessions/01a0-abc',
    '/results/01a0-abc',
    '/assessments/01a0-abc',
  ];

  for (const [portal, items] of bothNavs) {
    it(`never highlights two ${portal} destinations`, () => {
      for (const location of everyLocation(items)) {
        const label = activeNavLabel(items, location);
        const matching = items.filter(
          (item) => item.href !== undefined && isActivePath(location, item.href),
        );
        // Whenever anything matches, exactly one label comes back, and it is
        // one of the matches.
        if (matching.length > 0) {
          expect(label, location).toBeDefined();
          expect(
            matching.map((item) => item.label),
            location,
          ).toContain(label);
        } else {
          expect(label, location).toBeUndefined();
        }
      }
    });
  }

  it('prefers the queue over the route it is a queue of', () => {
    expect(activeNavLabel(AUTHORING_NAV, '/review?queue=approval')).toBe('Approvals');
    expect(activeNavLabel(AUTHORING_NAV, '/review')).toBe('Review Queue');
    expect(activeNavLabel(AUTHORING_NAV, '/review/01a0-abc')).toBe('Review Queue');
  });

  it('gives a route to the destination that is the page, not to an alias on it', () => {
    // Question Bank and Assessments both point at /publish in this release,
    // and both are earlier in the sidebar than Publish itself. The page is
    // Publish, so Publish is what is highlighted.
    expect(activeNavLabel(AUTHORING_NAV, '/publish')).toBe('Publish');
  });

  it('gives the learner root to Home, not to the alias on it', () => {
    // Assessments points at `/` in this release because that is where the list
    // lives; Home is still the destination the learner is on.
    expect(activeNavLabel(LEARNER_NAV, '/')).toBe('Home');
  });

  it('highlights a preview page as its own destination, and only the six asked for', () => {
    expect(activeNavLabel(LEARNER_NAV, '/my-learnings')).toBe('My Learnings');
    expect(activeNavLabel(LEARNER_NAV, '/discover')).toBe('Discover');
    expect(activeNavLabel(LEARNER_NAV, '/badges')).toBe('Badges');
    expect(activeNavLabel(LEARNER_NAV, '/knowledge-library')).toBe('Knowledge Library');
    expect(activeNavLabel(LEARNER_NAV, '/my-progress')).toBe('My Progress');
    expect(activeNavLabel(LEARNER_NAV, '/help')).toBe('Help & Support');
    expect(LEARNER_NAV.filter((item) => item.preview === true).map((item) => item.label)).toEqual([
      'My Learnings',
      'Discover',
      'Badges',
      'Knowledge Library',
      'My Progress',
      'Help & Support',
    ]);
    // The learner audit (LIVE-PREVIEW-M2): every learner destination opens
    // something — a working screen or a labelled preview. None is a dead entry.
    expect(LEARNER_NAV.every((item) => item.href !== undefined)).toBe(true);
    // No authoring destination is a preview: every one of them is real.
    expect(AUTHORING_NAV.some((item) => item.preview === true)).toBe(false);
  });

  it('highlights nothing on a route no destination owns', () => {
    // `/badges` USED to be the learner example; LIVE-PREVIEW-M2 made it a
    // preview, so the example moved to a route no learner entry owns.
    expect(activeNavLabel(LEARNER_NAV, '/certificates')).toBeUndefined();
    // `/reports` USED to be the example here, because the rail entry had no
    // href. Phase 10 R1 gave it one, so the example moved to a route that is
    // still genuinely unowned rather than the assertion being deleted.
    expect(activeNavLabel(AUTHORING_NAV, '/certificates')).toBeUndefined();
  });

  it('gives /reports to Reports, now that the entry is a link', () => {
    expect(activeNavLabel(AUTHORING_NAV, '/reports')).toBe('Reports');
    // And a report inside the section keeps the section highlighted, which is
    // what the tab strip beneath it relies on.
    expect(activeNavLabel(AUTHORING_NAV, '/reports/filing')).toBe('Reports');
  });
});
