// Components for the approved design assets that are served as files.
//
// Three of them, one per rendering need, because the pack's files differ in a
// way that matters:
//
//   KnowzyNavIcon      single-colour, drawn with `currentColor`
//   KnowzyIllustration multi-colour, decorative
//   KnowzyBackdrop     multi-colour, decorative, sits behind content
//
// Each takes a NAME from the typed registry, never a path (integration spec
// §8): a path argument would accept any string, and the mapping from meaning
// to file belongs in one place.
//
// None of them is interactive, and none replaces a control. An asset here may
// decorate a button; the button is still a `<button>` (spec §18).

import type { CSSProperties } from 'react';
import {
  BACKDROPS,
  ILLUSTRATIONS,
  NAV_ICONS,
  assetUrl,
  type BackdropName,
  type IllustrationName,
  type NavIconName,
} from '../assets/manifest.js';

/**
 * An approved navigation icon, coloured by its surroundings.
 *
 * Rendered as a CSS **mask** rather than an `<img>`. The reason is the asset:
 * these files are drawn with `fill="currentColor"`, and an `<img>` has no
 * colour context to inherit — it would render them black, which is wrong on
 * the navy header and wrong for an active navigation item. A mask paints the
 * shape with `background-color: currentColor`, so one file serves the
 * inactive, active, hover and disabled states and the colour stays a token.
 *
 * `aria-hidden` always: every icon in this product sits beside its own text
 * label, so announcing it would repeat the label (spec §19).
 */
export const KnowzyNavIcon = ({
  name,
  className = 'size-5',
}: {
  readonly name: NavIconName;
  readonly className?: string;
}) => {
  const url = `url(${assetUrl(NAV_ICONS[name])})`;
  const style: CSSProperties = {
    WebkitMaskImage: url,
    maskImage: url,
    WebkitMaskRepeat: 'no-repeat',
    maskRepeat: 'no-repeat',
    WebkitMaskPosition: 'center',
    maskPosition: 'center',
    WebkitMaskSize: 'contain',
    maskSize: 'contain',
    backgroundColor: 'currentColor',
  };

  return <span aria-hidden="true" className={`inline-block shrink-0 ${className}`} style={style} />;
};

/**
 * An approved illustration, for an empty or zero state.
 *
 * Decorative by default and therefore `alt=""`: the state it decorates always
 * carries a heading and a sentence, so the illustration adds no information
 * (spec §18, §19). A caller that genuinely needs it announced passes `label`,
 * which is the only way to give it a name — there is no way to render one of
 * these with a misleading name by accident.
 */
export const KnowzyIllustration = ({
  name,
  label,
  className = 'size-24',
}: {
  readonly name: IllustrationName;
  readonly label?: string;
  readonly className?: string;
}) => (
  <img
    src={assetUrl(ILLUSTRATIONS[name])}
    alt={label ?? ''}
    {...(label === undefined ? { role: 'presentation' as const } : {})}
    className={className}
    // Intrinsic size: the pack draws these on a 256 square, and declaring it
    // stops the layout shifting while the file loads.
    width={256}
    height={256}
    loading="lazy"
    decoding="async"
  />
);

/**
 * Decorative artwork behind a page hero.
 *
 * Always `alt=""`, with no option to label it: a backdrop that carried
 * information would be information available only to sighted users.
 */
export const KnowzyBackdrop = ({
  name,
  className = '',
}: {
  readonly name: BackdropName;
  readonly className?: string;
}) => (
  <img
    src={assetUrl(BACKDROPS[name])}
    alt=""
    role="presentation"
    className={className}
    loading="lazy"
    decoding="async"
  />
);
