// Contrast is computed from the tokens, not claimed in a comment.
//
// UI-M1 wrote contrast ratios into `tokens.css` and `design-tokens.md` by
// hand. One of them was wrong: `ink-subtle` was documented at 4.6:1 and is
// 4.38:1 on white and 3.93:1 on the sunken surface — below AA for normal text,
// on a token used for every caption in both portals. Four more pairs were also
// below the line, including a badge whose own label failed against its own
// background.
//
// So the claim is now a test. Every pair asserted here is one the design
// system actually renders, and the values come out of `tokens.css`, so a
// "tidy-up" of a hex cannot quietly break AA again.
//
// WCAG 2.2 AA: 4.5:1 normal text, 3:1 large text (>=18.66px bold or >=24px)
// and non-text state indicators (1.4.11).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const tokens = readFileSync(join(import.meta.dirname, 'tokens.css'), 'utf8');

/** Reads a hex token straight out of the stylesheet. */
const token = (name: string): string => {
  const match = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(tokens);
  if (match?.[1] === undefined) throw new Error(`token --color-${name} not found`);
  return match[1];
};

const channel = (value: number): number => {
  const srgb = value / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
};

const luminance = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((offset) => channel(parseInt(hex.slice(offset, offset + 2), 16)));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
};

const ratio = (foreground: string, background: string): number => {
  const a = luminance(foreground);
  const b = luminance(background);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
};

/** Composites a translucent foreground onto an opaque background. */
const over = (foreground: string, background: string, alpha: number): string => {
  const mix = [1, 3, 5].map((offset) => {
    const f = parseInt(foreground.slice(offset, offset + 2), 16);
    const b = parseInt(background.slice(offset, offset + 2), 16);
    return Math.round(f * alpha + b * (1 - alpha));
  });
  return `#${mix.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
};

const WHITE = '#ffffff';

describe('text meets AA on every surface it is rendered on', () => {
  // The three page surfaces a caption can land on. The sunken column is the
  // one that caught the bug: a stat-tile label or a hovered table row.
  const SURFACES = [
    ['white', WHITE],
    ['canvas', token('brand-canvas')],
    ['sunken', token('surface-sunken')],
    ['hover', token('surface-hover')],
  ] as const;

  const TEXT_TOKENS = ['ink', 'ink-muted', 'ink-subtle', 'brand-navy-text'] as const;

  for (const name of TEXT_TOKENS) {
    it(`${name} is at least 4.5:1 on every page surface`, () => {
      for (const [surfaceName, surface] of SURFACES) {
        const value = ratio(token(name), surface);
        expect(value, `${name} on ${surfaceName} is ${value.toFixed(2)}:1`).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    });
  }

  it('a badge label meets AA against its own soft background', () => {
    // The failure that made this suite necessary: success was 4.07:1 on
    // success-soft, so the badge's own word failed against the badge.
    for (const name of ['success', 'info', 'ai', 'warning', 'danger', 'neutral'] as const) {
      const value = ratio(token(name), token(`${name}-soft`));
      expect(value, `${name} on ${name}-soft is ${value.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('a link meets AA on every surface a link appears on', () => {
    // `info` is the text-grade blue. Brand blue is approved and unchanged, and
    // is deliberately NOT used for small text: it is 3.97:1 on info-soft.
    for (const surface of [
      WHITE,
      token('brand-canvas'),
      token('surface-sunken'),
      token('info-soft'),
    ]) {
      expect(ratio(token('info'), surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('white on the primary button meets AA', () => {
    expect(ratio(WHITE, token('brand-blue'))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the navy header', () => {
  const navy = token('brand-navy');

  it('carries white text and the translucent variants the header uses', () => {
    expect(ratio(WHITE, navy)).toBeGreaterThanOrEqual(4.5);
    // The opacities in AppHeader: role line, placeholder, Copilot label.
    for (const alpha of [0.7, 0.55, 0.5]) {
      const value = ratio(over(WHITE, navy, alpha), navy);
      expect(value, `white/${alpha * 100} on navy is ${value.toFixed(2)}:1`).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  it('is where the bright brand green is legible', () => {
    // 5.7:1 on navy — which is why the green rule and the wordmark's ZY live
    // on the header and nowhere on a light surface.
    expect(ratio(token('brand-green'), navy)).toBeGreaterThanOrEqual(3);
  });
});

describe('non-text indicators meet 1.4.11', () => {
  it('uses a green that is visible on white for state', () => {
    // The active nav border and the active tab underline. Bright brand green
    // is 2.69:1 here, which is why they use the success green instead.
    expect(ratio(token('success'), WHITE)).toBeGreaterThanOrEqual(3);
    expect(ratio(token('success'), token('surface-sunken'))).toBeGreaterThanOrEqual(3);
  });

  it('keeps meter fills distinguishable from their track', () => {
    for (const name of ['success', 'info', 'warning', 'danger'] as const) {
      expect(ratio(token(name), token('surface-sunken'))).toBeGreaterThanOrEqual(3);
    }
  });

  it('white on a green chip is legible', () => {
    // The completed workflow stage. Brand green would be 2.69:1.
    expect(ratio(WHITE, token('success'))).toBeGreaterThanOrEqual(4.5);
  });
});
