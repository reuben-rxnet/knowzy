// Form controls.
//
// Native elements, styled. No combobox, no custom select, no masked input:
// every one of these has to work with a keyboard, a screen reader, and a form
// POST, and a native control does all three without being reimplemented.
//
// §28 lists "Search and Filter Controls"; these are the inputs behind them and
// behind the generation, review, and publish forms. The legacy stylesheet used
// to paint the bare elements, which is why a converted page needs these — the
// page that leaves `.legacy-page` behind leaves that paint behind too.
//
// Each control takes an `id` and each label points at it. That is not a
// nicety: a select whose label is not associated is announced as "combo box"
// with no name.

import type { ChangeEventHandler, ReactNode } from 'react';

const controlBase =
  'w-full rounded-md border border-line bg-brand-surface px-3 py-2 text-base text-ink shadow-none transition-colors duration-(--duration-fast) hover:border-line-strong focus:border-brand-blue disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-subtle';

export const FieldLabel = ({
  htmlFor,
  children,
  hint,
}: {
  readonly htmlFor: string;
  readonly children: ReactNode;
  readonly hint?: ReactNode;
}) => (
  <span className="flex flex-col gap-1">
    <label htmlFor={htmlFor} className="text-base font-semibold text-brand-navy-text">
      {children}
    </label>
    {hint === undefined ? null : <span className="text-sm text-ink-muted">{hint}</span>}
  </span>
);

/**
 * A label, its control, and an optional hint, as one block.
 *
 * The hint goes BELOW the control (2026-10-23). Above it, a field with a hint
 * pushed its control lower than a neighbour without one, so the inputs of a
 * row did not line up. Label, control, help text is the usual order and keeps
 * every control in a row on one line.
 */
export const Field = ({
  id,
  label,
  hint,
  children,
  className = '',
}: {
  readonly id: string;
  readonly label: ReactNode;
  readonly hint?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}) => (
  <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
    <FieldLabel htmlFor={id}>{label}</FieldLabel>
    {children}
    {hint === undefined ? null : (
      <span id={`${id}-hint`} className="text-sm text-ink-muted">
        {hint}
      </span>
    )}
  </div>
);

export const Select = ({
  id,
  name,
  children,
  defaultValue,
  value,
  onChange,
  disabled = false,
  required = false,
}: {
  readonly id: string;
  readonly name: string;
  readonly children: ReactNode;
  readonly defaultValue?: string;
  readonly value?: string;
  readonly onChange?: ChangeEventHandler<HTMLSelectElement>;
  readonly disabled?: boolean;
  /** With a disabled empty first option, makes a choice compulsory. */
  readonly required?: boolean;
}) => (
  <select
    id={id}
    name={name}
    disabled={disabled}
    required={required}
    {...(defaultValue === undefined ? {} : { defaultValue })}
    {...(value === undefined ? {} : { value })}
    {...(onChange === undefined ? {} : { onChange })}
    className={`${controlBase} min-h-target`}
  >
    {children}
  </select>
);

/**
 * A single-line text control.
 *
 * The prop list is an ALLOW-LIST rather than `...rest`, so every attribute a
 * form can set is one somebody chose to expose. Four were added on 2026-09-26
 * for the provider configuration form, and each earns its place:
 *
 *   `url`          a real input type, with the browser's own validation and
 *                  the right mobile keyboard. A URL field typed as `text` asks
 *                  every form to re-implement that.
 *   `step`         a decimal field (a sampling temperature) is unusable
 *                  without it: the default step of 1 rejects 0.2.
 *   `maxLength`    the server's own limit, enforced where it can be seen
 *                  rather than only in a refusal.
 *   `autoComplete` the ONLY way to tell a browser not to offer to save, and
 *                  not to fill, a credential-shaped field.
 *   `date`         (2026-10-07, competency administration) an effective date,
 *                  with the browser's own picker and a YYYY-MM-DD value.
 */
export const TextInput = ({
  id,
  name,
  type = 'text',
  defaultValue,
  min,
  max,
  step,
  maxLength,
  autoComplete,
  required = false,
  placeholder,
  onChange,
}: {
  readonly id: string;
  readonly name: string;
  readonly type?: 'text' | 'number' | 'url' | 'date';
  readonly defaultValue?: string | number;
  readonly min?: number;
  readonly max?: number;
  /** A number field's increment. `0.1` for a value like a temperature. */
  readonly step?: number | string;
  readonly maxLength?: number;
  /** `off` for anything credential-shaped, so no browser offers to store it. */
  readonly autoComplete?: 'off' | 'on';
  readonly required?: boolean;
  readonly placeholder?: string;
  /** For a client form that mirrors the value (e.g. a summary). Stays uncontrolled. */
  readonly onChange?: ChangeEventHandler<HTMLInputElement>;
}) => (
  <input
    id={id}
    name={name}
    type={type}
    {...(onChange === undefined ? {} : { onChange })}
    required={required}
    {...(defaultValue === undefined ? {} : { defaultValue })}
    {...(min === undefined ? {} : { min })}
    {...(max === undefined ? {} : { max })}
    {...(step === undefined ? {} : { step })}
    {...(maxLength === undefined ? {} : { maxLength })}
    {...(autoComplete === undefined ? {} : { autoComplete })}
    {...(placeholder === undefined ? {} : { placeholder })}
    className={`${controlBase} min-h-target`}
  />
);

export const Textarea = ({
  id,
  name,
  rows = 4,
  required = false,
  defaultValue,
  placeholder,
}: {
  readonly id: string;
  readonly name: string;
  readonly rows?: number;
  readonly required?: boolean;
  readonly defaultValue?: string;
  readonly placeholder?: string;
}) => (
  <textarea
    id={id}
    name={name}
    rows={rows}
    required={required}
    {...(defaultValue === undefined ? {} : { defaultValue })}
    {...(placeholder === undefined ? {} : { placeholder })}
    className={controlBase}
  />
);

/**
 * A checkbox with its label as one target.
 *
 * The whole row is the label, so the clickable area is the row rather than a
 * 13px box (§7's 44px minimum), and `description` gives the secondary line
 * these lists need — a document's container and section count.
 */
export const CheckboxRow = ({
  name,
  value,
  children,
  description,
  defaultChecked = false,
  disabled = false,
}: {
  readonly name: string;
  readonly value: string;
  readonly children: ReactNode;
  readonly description?: ReactNode;
  readonly defaultChecked?: boolean;
  readonly disabled?: boolean;
}) => (
  <label
    className={`flex min-h-target cursor-pointer items-start gap-3 rounded-md px-3 py-2.5 transition-colors duration-(--duration-fast) hover:bg-surface-hover has-checked:bg-info-soft ${
      disabled ? 'cursor-not-allowed opacity-60' : ''
    }`}
  >
    <input
      type="checkbox"
      name={name}
      value={value}
      defaultChecked={defaultChecked}
      disabled={disabled}
      className="mt-0.5 size-4 shrink-0 accent-brand-blue"
    />
    <span className="min-w-0 flex-1">
      <span className="block text-base text-ink">{children}</span>
      {description === undefined ? null : (
        <span className="mt-0.5 block text-sm text-ink-subtle">{description}</span>
      )}
    </span>
  </label>
);

/** A radio with its label as one target — the same contract as CheckboxRow. */
export const RadioRow = ({
  name,
  value,
  children,
  description,
  defaultChecked = false,
}: {
  readonly name: string;
  readonly value: string;
  readonly children: ReactNode;
  readonly description?: ReactNode;
  readonly defaultChecked?: boolean;
}) => (
  <label className="flex min-h-target cursor-pointer items-start gap-3 rounded-md px-3 py-2.5 transition-colors duration-(--duration-fast) hover:bg-surface-hover has-checked:bg-info-soft">
    <input
      type="radio"
      name={name}
      value={value}
      defaultChecked={defaultChecked}
      className="mt-0.5 size-4 shrink-0 accent-brand-blue"
    />
    <span className="min-w-0 flex-1">
      <span className="block text-base text-ink">{children}</span>
      {description === undefined ? null : (
        <span className="mt-0.5 block text-sm text-ink-subtle">{description}</span>
      )}
    </span>
  </label>
);

/** A group of related controls, named by its legend. */
export const Fieldset = ({
  legend,
  hint,
  children,
  className = '',
}: {
  readonly legend: ReactNode;
  readonly hint?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}) => (
  <fieldset className={`flex min-w-0 flex-col gap-2 ${className}`}>
    <legend className="mb-1 text-base font-semibold text-brand-navy-text">{legend}</legend>
    {hint === undefined ? null : <p className="-mt-1 mb-1 text-sm text-ink-muted">{hint}</p>}
    {children}
  </fieldset>
);
