'use client';

// Drawer and Modal — the only two components in this package that hold state.
//
// Everything else stays server-renderable so that adopting the design system
// does not turn a page into a client tree. These two cannot: a dialog has to
// trap focus, close on Escape, and put focus back where it came from, and §7
// requires all three.
//
// Focus handling here is deliberate rather than delegated to a library: the
// repository has no dialog dependency, and the behaviour is small enough to
// own and to read.

import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Shared dialog behaviour: Escape closes, Tab cycles inside, focus returns to
 * whatever opened it, and the page behind cannot scroll.
 */
const useDialogBehaviour = (open: boolean, onClose: () => void) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || panelRef.current === null) return;

      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (element) => element.offsetParent !== null,
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) return;

      // Wrap at both ends, so focus cannot escape into the page behind.
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;

    restoreTo.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus the panel itself rather than its first control: a screen reader
    // then reads the dialog's name before its contents.
    panelRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      restoreTo.current?.focus();
    };
  }, [open]);

  return { panelRef, onKeyDown };
};

export interface DrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  /** §30: a detail panel becomes a drawer below 1440px; `wide` suits tables. */
  readonly width?: 'default' | 'wide';
}

/**
 * The right-side detail drawer.
 *
 * The pattern the mockups use for every master/detail screen, and what §30
 * says a side panel collapses into on a narrower viewport.
 */
export const Drawer = ({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'default',
}: DrawerProps) => {
  const { panelRef, onKeyDown } = useDialogBehaviour(open, onClose);
  if (!open) return null;

  return (
    <div className="fixed inset-0" style={{ zIndex: 'var(--z-drawer)' }} onKeyDown={onKeyDown}>
      <button
        type="button"
        aria-label="Close panel"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-brand-navy/30"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`absolute inset-y-0 right-0 flex w-full flex-col bg-brand-surface shadow-overlay ${
          width === 'wide' ? 'sm:max-w-4xl' : 'sm:max-w-(--spacing-drawer)'
        }`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-brand-navy-text">{title}</h2>
            {description === undefined ? null : (
              <p className="mt-1 text-sm text-ink-muted">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-target shrink-0 place-items-center rounded-md text-ink-muted hover:bg-surface-hover hover:text-ink"
          >
            <X aria-hidden="true" className="size-5" />
            <span className="knowzy-sr-only">Close</span>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer === undefined ? null : (
          <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-surface-sunken px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

export interface ModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly description?: string;
  readonly children?: ReactNode;
  readonly footer?: ReactNode;
  /**
   * `danger` for a destructive confirmation — retirement, rejection. The tone
   * is a border and a heading colour, never the only signal: the footer still
   * spells out what the action does.
   */
  readonly tone?: 'default' | 'danger';
}

export const Modal = ({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  tone = 'default',
}: ModalProps) => {
  const { panelRef, onKeyDown } = useDialogBehaviour(open, onClose);
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 grid place-items-center p-4"
      style={{ zIndex: 'var(--z-modal)' }}
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-brand-navy/40"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        // `max-h` plus a scrolling body, because a dialog TALLER than the
        // viewport put its own buttons out of reach. Found by a browser test
        // on the Sync Manager's workflow wizard at 1280x720: the element was
        // "visible, enabled and stable" and still un-clickable, because it was
        // below the fold of a panel that could not scroll. A confirmation
        // dialog whose Confirm button cannot be reached is worse than no
        // dialog.
        className={`relative flex max-h-[90dvh] w-full max-w-lg flex-col rounded-lg bg-brand-surface shadow-overlay ${
          tone === 'danger' ? 'border-t-4 border-danger' : ''
        }`}
      >
        <div className="px-5 pt-5">
          <h2
            className={`text-lg font-semibold ${
              tone === 'danger' ? 'text-danger' : 'text-brand-navy-text'
            }`}
          >
            {title}
          </h2>
          {description === undefined ? null : (
            <p className="mt-1 text-sm text-ink-muted">{description}</p>
          )}
        </div>
        {children === undefined ? null : (
          // The BODY scrolls, not the whole panel: the title stays put and the
          // footer stays reachable, which is what makes a long form usable on
          // a short screen.
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        )}
        <div className="flex flex-wrap justify-end gap-2 px-5 pb-5 pt-2">
          {footer ?? (
            <button
              type="button"
              onClick={onClose}
              className="h-target rounded-md border border-line px-4 text-base font-semibold text-ink hover:bg-surface-hover"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
