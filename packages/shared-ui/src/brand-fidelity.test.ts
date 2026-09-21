// The brand components still match the approved files.
//
// `Brand.tsx` reproduces four approved SVGs as JSX, which is the only way to
// keep `currentColor` working and the wordmark's green `ZY` intact (the file
// itself explains why). The cost of transcribing artwork is that it can drift
// from its source, so this asserts it has not: every viewBox, path, stroke
// width and fill in the components is checked against the approved pack.
//
// "Do not modify the approved brand assets" is a rule worth nothing unless
// something verifies it, and a human reading a diff of path data verifies
// nothing.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PACK = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'design',
  'approved',
  'knowzy_design_elements_asset_pack',
  'branding',
);

const component = readFileSync(join(import.meta.dirname, 'components', 'Brand.tsx'), 'utf8');

const approved = (file: string): string => readFileSync(join(PACK, file), 'utf8');

/** Every `d=`, `viewBox=`, `stroke=`, `fill=` and numeric attribute value. */
const attributes = (svg: string, name: string): string[] =>
  [...svg.matchAll(new RegExp(`${name}="([^"]+)"`, 'g'))].map((match) => match[1] ?? '');

describe('EssilorLuxotticaLogo matches essilorluxottica_logo.svg', () => {
  const source = approved('essilorluxottica_logo.svg');

  it('keeps the approved viewBox and font metrics', () => {
    for (const value of [
      ...attributes(source, 'viewBox'),
      ...attributes(source, 'font-size'),
      ...attributes(source, 'font-weight'),
      ...attributes(source, 'x'),
      ...attributes(source, 'y'),
    ]) {
      expect(component, `logo lost ${value}`).toContain(value);
    }
  });

  it('is still drawn with currentColor rather than a hard-coded colour', () => {
    expect(source).toContain('currentColor');
    expect(component).toContain('EssilorLuxottica');
  });
});

describe('KnowzyWordmark matches knowzy_wordmark.svg', () => {
  const source = approved('knowzy_wordmark.svg');

  it('keeps the approved viewBox, sizes and the green ZY', () => {
    expect(component).toContain('0 0 420 100');
    for (const value of attributes(source, 'font-size')) {
      expect(component, `wordmark lost font-size ${value}`).toContain(value);
    }
    // §5.1's green ZY, and the rest taking the surface's colour.
    expect(source).toContain('#00B388');
    expect(component).toContain('#00B388');
    expect(source).toContain('currentColor');
    expect(component).toContain('fill="currentColor"');
  });

  it('keeps the approved tagline, character for character', () => {
    expect(component).toContain('Knowledge Today. Brighter Tomorrow.');
    expect(source).toContain('Knowledge Today. Brighter Tomorrow.');
  });
});

describe('KnowzyMark matches knowzy_icon.svg', () => {
  const source = approved('knowzy_icon.svg');

  it('keeps every path, stroke and fill of the approved tile', () => {
    for (const value of [
      ...attributes(source, 'viewBox'),
      ...attributes(source, 'd'),
      ...attributes(source, 'stroke-width'),
      ...attributes(source, 'rx'),
      ...attributes(source, 'width'),
    ]) {
      expect(component, `tile lost ${value}`).toContain(value);
    }
    for (const colour of ['#001E62', '#00B388', '#fff']) {
      expect(component, `tile lost ${colour}`).toContain(colour);
    }
  });

  it('is the same artwork as the favicon that is served', () => {
    // The pack ships them as separate files; if they ever diverge, the tab
    // icon and the in-app mark would stop being the same mark.
    expect(approved('favicon.svg')).toEqual(source);
  });
});
