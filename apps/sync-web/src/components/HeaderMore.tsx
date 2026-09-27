'use client';

// The Sync Manager header on a phone.
//
// The approved design has no navigation rail (one operational dashboard), so
// there is nothing to put in a drawer. What a phone DID get wrong was the
// header: environment, identity and three disabled controls wrapped onto two
// extra rows above every screen. Below `sm` they collapse behind one
// disclosure button; from `sm` up they are shown inline exactly as before.
//
// A disclosure, not a menu: the contents are status text and disabled
// buttons, so `aria-expanded` on a button that shows and hides a region is
// the honest pattern, and Escape closes it.

import { useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export const HeaderMore = ({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) => {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <div
      className="flex w-full flex-col gap-3 sm:w-auto"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-target w-fit items-center gap-1.5 self-end rounded-md px-3 text-sm font-semibold text-brand-navy-text ring-1 ring-inset ring-line sm:hidden"
      >
        {label}
        <ChevronDown
          aria-hidden="true"
          className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      <div
        id={id}
        className={`${open ? 'flex' : 'hidden'} flex-wrap items-center gap-3 text-2xs text-ink-muted sm:flex sm:gap-4`}
      >
        {children}
      </div>
    </div>
  );
};
