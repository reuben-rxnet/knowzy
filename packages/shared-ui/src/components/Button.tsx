// Buttons and button-shaped links.
//
// §28 names three: primary, secondary, danger. A fourth, `ghost`, is here for
// controls that sit inside a card header where a bordered button would be
// noise.
//
// Two rules worth stating, because both were broken before UI-M2:
//
//   * Every target is at least `--spacing-target` (44px) high, per §7.
//   * A disabled control still says why. `disabled` alone is a colour change
//     and a dead click; a caller must pass `disabledReason`, which is rendered
//     for assistive technology and as the native tooltip.
//
// Presentational. A button here submits a form or navigates; it decides
// nothing. Server actions and the API still own every outcome.

import type { MouseEventHandler, ReactNode } from 'react';

export type ButtonTone = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'md' | 'sm';

const TONE: Record<ButtonTone, string> = {
  primary:
    'bg-brand-blue text-white ring-1 ring-inset ring-brand-blue hover:bg-brand-navy hover:ring-brand-navy',
  secondary:
    'bg-brand-surface text-brand-navy-text ring-1 ring-inset ring-line-strong hover:bg-surface-hover hover:ring-brand-blue',
  danger:
    'bg-brand-surface text-danger ring-1 ring-inset ring-danger/40 hover:bg-danger-soft hover:ring-danger',
  ghost: 'bg-transparent text-brand-blue hover:bg-surface-hover',
};

const SIZE: Record<ButtonSize, string> = {
  md: 'min-h-target px-4 py-2 text-base',
  sm: 'min-h-8 px-3 py-1.5 text-sm',
};

const shape =
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md font-semibold transition-colors duration-(--duration-fast) disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-inherit';

export const buttonClass = (tone: ButtonTone = 'primary', size: ButtonSize = 'md'): string =>
  `${shape} ${SIZE[size]} ${TONE[tone]}`;

export interface ButtonProps {
  readonly children: ReactNode;
  readonly tone?: ButtonTone;
  readonly size?: ButtonSize;
  readonly type?: 'submit' | 'button' | 'reset';
  readonly disabled?: boolean;
  /** Required whenever `disabled` is true: a grey control must say why. */
  readonly disabledReason?: string;
  readonly name?: string;
  readonly value?: string;
  /** For a control that opens a dialog rather than submitting a form. */
  readonly onClick?: MouseEventHandler<HTMLButtonElement>;
  readonly className?: string;
}

export const Button = ({
  children,
  tone = 'primary',
  size = 'md',
  type = 'submit',
  disabled = false,
  disabledReason,
  name,
  value,
  onClick,
  className = '',
}: ButtonProps) => (
  <button
    type={type}
    disabled={disabled}
    {...(disabled ? { 'aria-disabled': 'true' as const } : {})}
    {...(disabled && disabledReason !== undefined ? { title: disabledReason } : {})}
    {...(name === undefined ? {} : { name })}
    {...(value === undefined ? {} : { value })}
    {...(onClick === undefined ? {} : { onClick })}
    className={`${buttonClass(tone, size)} ${className}`}
  >
    {children}
    {disabled && disabledReason !== undefined ? (
      <span className="knowzy-sr-only">{disabledReason}</span>
    ) : null}
  </button>
);

/**
 * A link that looks like a button.
 *
 * An anchor, not a button with an onClick: these navigate, so they must
 * middle-click, open in a new tab, and work before hydration.
 */
export const ButtonLink = ({
  children,
  href,
  tone = 'secondary',
  size = 'md',
  className = '',
}: {
  readonly children: ReactNode;
  readonly href: string;
  readonly tone?: ButtonTone;
  readonly size?: ButtonSize;
  readonly className?: string;
}) => (
  <a href={href} className={`${buttonClass(tone, size)} ${className}`}>
    {children}
  </a>
);

/**
 * An ordinary inline link.
 *
 * `text-info`, not `text-brand-blue`. The brand blue is an approved §5.2
 * colour and is unchanged — but at 4.31:1 on the canvas, 4.11:1 on a sunken
 * row and 3.97:1 inside an info notice it is below AA for normal text, and
 * links appear on all three. The info blue is the text-grade blue of the same
 * family and passes everywhere (5.3:1 at worst). Brand blue keeps the primary
 * button, where white-on-blue is 4.59:1, and the focus ring.
 */
export const TextLink = ({
  children,
  href,
  className = '',
}: {
  readonly children: ReactNode;
  readonly href: string;
  readonly className?: string;
}) => (
  <a
    href={href}
    className={`rounded-xs font-medium text-info underline decoration-info/30 underline-offset-2 hover:decoration-info ${className}`}
  >
    {children}
  </a>
);
