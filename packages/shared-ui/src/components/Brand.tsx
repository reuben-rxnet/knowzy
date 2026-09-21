// The approved brand marks.
//
// These mirror the approved files, which remain the master copies:
//
//   assets/branding/essilorluxottica-logo.svg.svg
//   assets/branding/knowzy-wordmark.svg.svg
//   assets/branding/favicon.ico.svg   (served from each app's public/)
//
// They are inline SVG rather than `<img>` for two reasons: the EssilorLuxottica
// mark is drawn with `currentColor`, so it must inherit the header's colour
// rather than be baked to one; and inlining avoids two requests in the shell
// that every page renders. If the official artwork replaces those files, it
// replaces these two components and nothing else.
//
// §5: approved assets only. Do not distort, recolour beyond the approved
// palette, or substitute an unofficial variant.

export interface BrandMarkProps {
  readonly className?: string;
}

/**
 * The EssilorLuxottica corporate wordmark.
 *
 * `fill="currentColor"` in the approved file is preserved, so the mark takes
 * the colour of its container — white on the navy header, navy on white.
 */
export const EssilorLuxotticaLogo = ({ className = '' }: BrandMarkProps) => (
  <svg
    viewBox="0 0 760 110"
    role="img"
    aria-label="EssilorLuxottica"
    className={className}
    focusable="false"
  >
    <text
      x="0"
      y="78"
      fontFamily="Arial, Helvetica, sans-serif"
      fontSize="72"
      fontWeight="600"
      letterSpacing="-2.2"
      fill="currentColor"
    >
      EssilorLuxottica
    </text>
  </svg>
);

/**
 * The KNOWZY product wordmark, with the green `ZY` §5.1 requires.
 *
 * `withTagline` renders the approved second line; the shell drops it below
 * large viewports rather than shrinking it into illegibility.
 */
export const KnowzyWordmark = ({
  className = '',
  withTagline = false,
}: BrandMarkProps & { readonly withTagline?: boolean }) => (
  <svg
    viewBox={withTagline ? '0 0 520 150' : '0 0 520 100'}
    role="img"
    aria-label={withTagline ? 'KNOWZY — Knowledge Today. Brighter Tomorrow.' : 'KNOWZY'}
    className={className}
    focusable="false"
  >
    <text
      x="0"
      y="82"
      fontFamily="Arial, Helvetica, sans-serif"
      fontSize="82"
      fontWeight="700"
      letterSpacing="-3"
      fill="#FFFFFF"
    >
      KNOW
      <tspan fill="#00B388">ZY</tspan>
    </text>
    {withTagline ? (
      <text
        x="3"
        y="119"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="20"
        fontWeight="500"
        letterSpacing=".2"
        fill="#DCE8FF"
      >
        Knowledge Today. Brighter Tomorrow.
      </text>
    ) : null}
  </svg>
);

/** The approved tagline as text, for footers and heroes. */
export const KNOWZY_TAGLINE = 'Knowledge Today. Brighter Tomorrow.' as const;
