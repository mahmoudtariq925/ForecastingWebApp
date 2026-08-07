import { useEffect, useRef, type ReactNode } from 'react';

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
  /** `wide` for dialogs holding a form with several sections side by side;
   *  `xl` for dialogs presenting a whole forecast grid. */
  size?: 'default' | 'wide' | 'xl';
}

/** Elements a keyboard user can land on inside the dialog. */
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Overlay modal matching the prototype's `.modal-overlay` markup.
 *
 * Carries the dialog semantics a screen reader needs (`role="dialog"`,
 * `aria-modal`, a labelled title), closes on Escape, and keeps Tab inside
 * the dialog while it is open — previously focus wandered into the page
 * behind it and nothing announced that a dialog had appeared.
 */
export function Modal({ open, title, onClose, children, footer, size = 'default' }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusTo = useRef<Element | null>(null);
  const titleId = useRef(`modal-${Math.abs(title.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7))}`);

  useEffect(() => {
    if (!open) return;
    restoreFocusTo.current = document.activeElement;
    // Focus the first control so keyboard users start inside the dialog.
    const first = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = [...(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      if (items.length === 0) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      // Hand focus back to whatever opened the dialog.
      (restoreFocusTo.current as HTMLElement | null)?.focus?.();
    };
  }, [open, onClose]);

  return (
    <div
      className={`modal-overlay${open ? ' show' : ''}`}
      onClick={onClose}
      // Hidden from assistive tech entirely while closed, so its buttons
      // aren't reachable behind the page.
      aria-hidden={!open}
    >
      <div
        className={`modal${size === 'wide' ? ' modal-wide' : ''}${size === 'xl' ? ' modal-xl' : ''}`}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId.current}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3 id={titleId.current}>{title}</h3>
          <button className="close-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        <div className="modal-footer">{footer}</div>
      </div>
    </div>
  );
}
