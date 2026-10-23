'use client';

// A dropdown whose options carry a check mark: several may be ticked (with
// "Select all" at the top) or, with `single`, exactly one. Built on a
// disclosure button and real checkbox/radio inputs, so a keyboard, a screen
// reader and a form all see ordinary controls:
//
//   * the trigger is a button with aria-expanded and aria-controls, and its
//     label is the field's label plus a summary of what is chosen;
//   * the panel holds labelled inputs, reached by Tab, toggled by Space;
//   * Escape closes and returns focus to the trigger; a click outside closes;
//   * the chosen values are submitted as hidden inputs named `name`, so the
//     server action reads them with formData.getAll(name).

import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface CheckOption {
  readonly value: string;
  readonly label: string;
  /** Shown at the end of the row, e.g. a count. */
  readonly hint?: string;
}

export const CheckDropdown = ({
  id,
  label,
  name,
  options,
  selected,
  onChange,
  single = false,
  selectAllLabel,
  summary,
}: {
  readonly id: string;
  readonly label: string;
  readonly name: string;
  readonly options: readonly CheckOption[];
  readonly selected: readonly string[];
  readonly onChange: (next: readonly string[]) => void;
  readonly single?: boolean;
  /** Multi-select only: the "Select all" row's label. */
  readonly selectAllLabel?: string;
  /** What the closed trigger says. */
  readonly summary: string;
}) => {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const allChosen = options.length > 0 && options.every((o) => selected.includes(o.value));
  const someChosen = !allChosen && options.some((o) => selected.includes(o.value));
  const selectAll = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selectAll.current !== null) selectAll.current.indeterminate = someChosen;
  }, [someChosen, open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (root.current !== null && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);

  const toggle = (value: string) => {
    if (single) {
      onChange([value]);
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };

  return (
    <div
      ref={root}
      className="relative flex flex-col gap-1.5"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      {/* The same type as FieldLabel, so a dropdown lines up with the fields beside it. */}
      <span id={`${id}-label`} className="text-base font-semibold text-brand-navy-text">
        {label}
      </span>
      {selected.map((value) => (
        <input key={value} type="hidden" name={name} value={value} />
      ))}
      <button
        ref={trigger}
        id={id}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={panelId}
        aria-labelledby={`${id}-label ${id}`}
        onClick={() => setOpen((value) => !value)}
        // The shared control's shape (Field.tsx controlBase), so it lines up with
        // the inputs beside it.
        className={`flex min-h-target w-full items-center justify-between gap-2 rounded-md border bg-brand-surface px-3 py-2 text-left text-base text-ink transition-colors hover:border-line-strong ${
          open ? 'border-brand-blue' : 'border-line'
        }`}
      >
        <span className="truncate">{summary}</span>
        <ChevronDown
          aria-hidden="true"
          className={`size-4 shrink-0 text-ink-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open ? (
        <div
          id={panelId}
          role="group"
          aria-labelledby={`${id}-label`}
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-md border border-line bg-brand-surface py-1 shadow-lg"
        >
          {!single && selectAllLabel !== undefined && options.length > 1 ? (
            <label className="flex cursor-pointer items-center gap-3 border-b border-line px-3 py-2 text-sm font-semibold text-brand-navy-text hover:bg-surface-hover">
              <input
                ref={selectAll}
                type="checkbox"
                checked={allChosen}
                onChange={() => onChange(allChosen ? [] : options.map((o) => o.value))}
                className="size-4 accent-brand-blue"
              />
              {selectAllLabel}
            </label>
          ) : null}
          {options.map((option) => {
            const ticked = selected.includes(option.value);
            return (
              <label
                key={option.value}
                className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-surface-hover ${
                  ticked ? 'text-brand-navy-text' : 'text-ink'
                }`}
              >
                <span className="flex items-center gap-3">
                  {single ? (
                    <>
                      <input
                        type="radio"
                        name={`${id}-choice`}
                        checked={ticked}
                        onChange={() => toggle(option.value)}
                        className="knowzy-sr-only"
                      />
                      <Check
                        aria-hidden="true"
                        className={`size-4 ${ticked ? 'text-brand-blue' : 'text-transparent'}`}
                      />
                    </>
                  ) : (
                    <input
                      type="checkbox"
                      checked={ticked}
                      onChange={() => toggle(option.value)}
                      className="size-4 accent-brand-blue"
                    />
                  )}
                  <span className={ticked ? 'font-medium' : ''}>{option.label}</span>
                </span>
                {option.hint === undefined ? null : (
                  <span className="shrink-0 text-2xs text-ink-muted">{option.hint}</span>
                )}
              </label>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};
