// The approved brand marks.
//
// **Canonical source, as of the design-asset integration:**
//
//   design/approved/knowzy_design_elements_asset_pack/branding/
//     essilorluxottica_logo.svg
//     knowzy_wordmark.svg
//     knowzy_icon.svg
//     favicon.svg
//
// These replace the earlier `assets/branding/*` copies, which are superseded:
// the pack's logo and wordmark are drawn with `currentColor`, where the old
// wordmark hard-coded white. That single difference is why the pack wins —
// the old mark could only ever sit on a dark header, and this one works on
// any surface.
//
// Each component reproduces its file EXACTLY: same viewBox, same geometry,
// same fills, same font metrics. `contrast.test.ts` asserts the colours and
// `brand-fidelity.test.ts` asserts the geometry against the approved files, so
// "do not modify the approved assets" is checked rather than promised. A
// component takes a `className` for size only.
//
// Why these four are inlined rather than served from `public/` like the rest
// of the pack: each needs a colour context an `<img>` cannot provide.
//
//   * The logo is entirely `currentColor` — as an `<img>` it renders black,
//     which is invisible on the navy header. Hard-coding white instead would
//     be recolouring an approved asset.
//   * The wordmark mixes `currentColor` (KNOW, tagline) with a literal green
//     (`ZY`). A CSS mask — how the navigation icons are handled — would
//     flatten both to one colour and lose the green `ZY` that §5.1 requires.
//   * The tile carries its own navy, white and green, and is small enough that
//     a request for it in the shell every page renders is not worth paying.
//
// The favicon IS served from `public/assets/knowzy/branding/favicon.svg`,
// through Next's metadata convention, because that is what a favicon is.

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
    viewBox="0 0 620 90"
    role="img"
    aria-label="EssilorLuxottica"
    className={className}
    focusable="false"
  >
    <text
      x="4"
      y="70"
      fontFamily="Arial,Helvetica,sans-serif"
      fontSize="62"
      fontWeight="600"
      fill="currentColor"
    >
      EssilorLuxottica
    </text>
  </svg>
);

/**
 * The KNOWZY product mark — the tile from `knowzy_icon.svg`, which is the same
 * artwork as the favicon.
 *
 * The only drawn artwork in the approved set: a navy tile, the K in white, and
 * three green bars. It carries its own colours, so it sits on a dark or a
 * light surface without treatment.
 *
 * `aria-hidden` by default, because wherever it appears the product is already
 * named in text beside it and two identical labels would be announced twice.
 */
export const KnowzyMark = ({
  className = '',
  labelled = false,
}: BrandMarkProps & { readonly labelled?: boolean }) => (
  <svg
    viewBox="0 0 256 256"
    className={className}
    focusable="false"
    {...(labelled ? { role: 'img', 'aria-label': 'KNOWZY' } : { 'aria-hidden': 'true' as const })}
  >
    <rect x="18" y="18" width="220" height="220" rx="48" fill="#001E62" />
    <path
      d="M62 64v128M62 128h58M120 64L65 128l62 64"
      fill="none"
      stroke="#fff"
      strokeWidth="24"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M150 66h52M150 128h42M150 190h52"
      fill="none"
      stroke="#00B388"
      strokeWidth="24"
      strokeLinecap="round"
    />
  </svg>
);

/**
 * The KNOWZY product wordmark, with the green `ZY` §5.1 requires.
 *
 * The approved file fills `KNOW` and the tagline with `currentColor` and `ZY`
 * with the brand green, so unlike the mark it replaces this one adapts to its
 * surface: white on the navy header, navy on a white one.
 *
 * `withTagline` renders the approved second line. It is part of the same file,
 * at the proportion the file sets — the tagline is deliberately not scaled
 * independently of the wordmark.
 */
export const KnowzyWordmark = ({
  className = '',
  withTagline = false,
}: BrandMarkProps & { readonly withTagline?: boolean }) => (
  <svg
    viewBox={withTagline ? '0 0 420 100' : '0 0 420 78'}
    role="img"
    aria-label={withTagline ? 'KNOWZY — Knowledge Today. Brighter Tomorrow.' : 'KNOWZY'}
    className={className}
    focusable="false"
  >
    <text
      x="4"
      y="70"
      fontFamily="Arial,Helvetica,sans-serif"
      fontSize="68"
      fontWeight="700"
      fill="currentColor"
    >
      KNOW
      <tspan fill="#00B388">ZY</tspan>
    </text>
    {withTagline ? (
      <text x="7" y="88" fontFamily="Arial,Helvetica,sans-serif" fontSize="12" fill="currentColor">
        Knowledge Today. Brighter Tomorrow.
      </text>
    ) : null}
  </svg>
);

/** The approved tagline as text, for footers and heroes. */
export const KNOWZY_TAGLINE = 'Knowledge Today. Brighter Tomorrow.' as const;
