// The approved brand marks.
//
// These mirror the approved files, which remain the master copies:
//
//   assets/branding/essilorluxottica-logo.svg.svg
//   assets/branding/knowzy-wordmark.svg.svg
//   assets/branding/favicon.ico.svg   (also served from each app's public/)
//
// Every one is reproduced verbatim — same viewBox, same geometry, same fills,
// same letter-spacing. Nothing here recolours, stretches, crops, or redraws an
// asset: §5 permits approved assets only, and a mark that has been "improved"
// in code is no longer the approved mark. The components take a `className`
// for SIZE, and the SVG's own `preserveAspectRatio` default keeps the aspect
// ratio whatever height it is given.
//
// They are inline SVG rather than `<img>` for two reasons, one of them
// necessary: the EssilorLuxottica mark is drawn with `currentColor`, which an
// `<img>` cannot inherit — it would render black on the navy header, and
// hard-coding white instead would be recolouring the asset. Honouring
// `currentColor` is following the asset, not overriding it. Inlining also
// avoids two requests in a shell that every page renders.
//
// If official artwork replaces those files, it replaces these components and
// nothing else.

export interface BrandMarkProps {
  readonly className?: string;
}

/**
 * The EssilorLuxottica corporate wordmark.
 *
 * `fill="currentColor"` from the approved file is preserved, so the mark takes
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
 * The KNOWZY product mark — the tile from `favicon.ico.svg`.
 *
 * The only piece of drawn artwork in the approved set: a navy tile, the K in
 * white, and three green bars. UI-M3 brought it into the header, where it does
 * what a typeset wordmark cannot — it reads as a product at a glance, and it
 * is the same mark as the browser tab.
 *
 * It carries its own navy background, so it sits on a dark header without any
 * treatment; `aria-hidden` by default because the wordmark beside it already
 * names the product, and two identical labels would be read twice.
 */
export const KnowzyMark = ({
  className = '',
  labelled = false,
}: BrandMarkProps & { readonly labelled?: boolean }) => (
  <svg
    viewBox="0 0 128 128"
    className={className}
    focusable="false"
    {...(labelled ? { role: 'img', 'aria-label': 'KNOWZY' } : { 'aria-hidden': 'true' as const })}
  >
    <rect width="128" height="128" rx="28" fill="#001E62" />
    <path
      d="M28 35v58M28 64h29M57 35L30 64l31 29"
      fill="none"
      stroke="#FFFFFF"
      strokeWidth="12"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M72 36h28M72 64h24M72 92h28"
      fill="none"
      stroke="#00B388"
      strokeWidth="12"
      strokeLinecap="round"
    />
  </svg>
);

/**
 * The KNOWZY product wordmark, with the green `ZY` §5.1 requires.
 *
 * The approved file fills `KNOW` white and the tagline `#DCE8FF`, so the
 * wordmark is drawn FOR A DARK BACKGROUND. That is not a limitation to work
 * around — the header is navy — but it is the reason this mark is not placed on
 * a light surface anywhere.
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
