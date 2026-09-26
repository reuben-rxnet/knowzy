'use client';

// Identity switching from the header, on every page.
//
// It used to live in a card at the bottom of the home page, which meant
// changing identity required navigating away from whatever you were looking at
// and then navigating back. Since which identity is in force changes what
// every screen will let you do -- and a refusal is the most common reason to
// want to switch -- the control belongs where the identity is displayed.
//
// A CLIENT COMPONENT, after a first attempt that was not. The first version was
// a bare `<details>`/`<summary>`, chosen so the menu needed no JavaScript at
// all. It produced a real hydration error:
//
//   "A tree hydrated but some attributes of the server rendered HTML didn't
//    match the client properties" ... <details className="relative" -open="">
//
// `open` is DOM state on a native element, owned by the browser rather than by
// React. Leave the menu open, navigate, and React reconciles server HTML with
// no `open` against a live node that has it. There is no way to keep that
// element's state out of React's way while React is rendering it, and
// suppressing the warning would have kept the two other faults it revealed:
// the menu stayed open across a navigation, and stayed open after a switch it
// had just performed.
//
// So `open` is state now, and closing is handled properly: on select, on
// Escape, and on a click outside. That is what a menu is, and it is worth the
// two kilobytes.
//
// Two things did NOT change:
//
//   * THE COOKIE STAYS httpOnly. The switch is a server action; the browser
//     never reads or writes the subject, nothing on the page can forge one,
//     and the API re-resolves roles and scope from the database regardless of
//     what the cookie says (invariant 8).
//   * IT SAYS WHAT IT IS. The menu repeats the §34 disclosure -- these are
//     selected personas, not authenticated employees -- because a switcher in
//     a profile menu is exactly where somebody would otherwise assume they had
//     logged in as somebody.

import { useEffect, useRef, useState } from 'react';
import { t } from '../copy';
import { switchSubject } from '../app/actions';

/**
 * The identities, PASSED IN rather than imported.
 *
 * `lib/identity` reads the subject cookie, so it imports `next/headers` -- and
 * a client component that imports that module fails to build with "You're
 * importing a component that needs next/headers". The list is plain data; the
 * layout is a server component and already has it, so it hands it over. The
 * shape is declared here rather than imported as a type for the same reason:
 * one import of that module from a client component is one too many.
 */
export interface IdentityOption {
  readonly upn: string;
  readonly label: string;
  readonly can: string;
}

export const IdentityMenu = ({
  current,
  isLocalDevelopmentIdentity,
  subjects,
}: {
  readonly current: IdentityOption;
  readonly subjects: readonly IdentityOption[];
  readonly isLocalDevelopmentIdentity: boolean;
}): React.JSX.Element => {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointerDown = (event: MouseEvent): void => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open]);

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex h-target cursor-pointer items-center gap-1.5 rounded-lg px-3 text-base font-semibold text-white/80 ring-1 ring-inset ring-white/15 hover:bg-white/10 hover:text-white"
      >
        {t('shell.change')}
        <span aria-hidden="true" className="text-2xs">
          ▾
        </span>
      </button>

      {/* Anchored right so it cannot overflow at the header's own edge, and one
          above the header's z-index so the sticky bar does not clip it. */}
      {open ? (
        <div
          className="absolute right-0 top-[calc(100%+0.5rem)] w-[min(26rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-line bg-brand-surface text-ink shadow-overlay"
          style={{ zIndex: 'calc(var(--z-header) + 1)' }}
        >
          <div className="border-b border-line bg-surface-sunken px-4 py-3">
            <p className="text-2xs font-bold uppercase tracking-wider text-ink-subtle">
              {t('shell.actingAs')}
            </p>
            <p className="mt-0.5 text-base font-semibold text-brand-navy-text">{current.label}</p>
            <p className="text-2xs text-ink-muted">{current.can}</p>
          </div>

          {/* The action closes the menu as well as submitting. A menu still
              open over the page it just changed is a menu that looks stuck. */}
          <form action={switchSubject} onSubmit={() => setOpen(false)}>
            <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto">
              {subjects.map((option) => {
                const isCurrent = option.upn === current.upn;
                return (
                  <li key={option.upn}>
                    <button
                      type="submit"
                      name="subject"
                      value={option.upn}
                      // The identity in force is still a button rather than a
                      // disabled row: re-selecting it is harmless, and
                      // disabling it would remove the row a keyboard user
                      // lands on to confirm which one is active.
                      {...(isCurrent ? { 'aria-current': true as const } : {})}
                      className={`flex w-full flex-col gap-0.5 px-4 py-3 text-left hover:bg-surface-hover ${
                        isCurrent ? 'bg-surface-sunken' : ''
                      }`}
                    >
                      <span className="flex flex-wrap items-center gap-2 text-md font-semibold text-ink">
                        {option.label}
                        {isCurrent ? (
                          <span className="rounded-sm bg-brand-green/15 px-1.5 py-0.5 text-2xs font-bold uppercase tracking-wider text-ink">
                            {t('identity.inForce')}
                          </span>
                        ) : null}
                      </span>
                      <span className="text-2xs text-ink-muted">{option.can}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </form>

          {isLocalDevelopmentIdentity ? (
            <p className="border-t border-line bg-surface-sunken px-4 py-3 text-2xs text-ink-muted">
              {t('identity.menuNote')}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
