import { useEffect, useRef, type ReactNode } from 'react';
import { escapeIsClaimed } from './escapeLayer';

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
 * The control a dialog should open ON: what it is asking for, if it asks for
 * anything. Falling back to the first focusable element put the caret on the
 * × button of every dialog with a form in it.
 *
 * A tickbox is not what a dialog asks for — it is an option ON something the
 * dialog shows. Counting them here opened the Review & Submit and Review &
 * Approve dialogs focused on a "Compare with" checkbox under the chart, which
 * the browser then scrolled into view: the forecast the dialog exists to show
 * was above the fold before it had been looked at once. Worse the further you
 * zoom in, which is exactly when it is least recoverable.
 */
const FIRST_FIELD =
  'textarea:not([disabled]), input:not([disabled]):not([type="checkbox"]):not([type="radio"]), select:not([disabled])';

/**
 * Open dialogs, innermost last.
 *
 * Dialogs stack — a forecast preview opens a commentary request over itself,
 * and a confirm can open over either. Escape and the focus trap belong to the
 * TOP one only: every open dialog listening on the document meant one Escape
 * closed the whole stack, and each trap fought the others for focus.
 */
const stack: symbol[] = [];

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
  const id = useRef(Symbol('modal'));
  /**
   * The latest close handler, read at event time rather than captured.
   *
   * Call sites pass an inline arrow (`onClose={() => setCell(null)}`), so a
   * dependency on it re-ran this effect on EVERY render. Each re-run tore the
   * dialog down and set it back up, which moved focus to the first control —
   * the × button — after every single keystroke in a text box, and typing a
   * space or Enter there then closed the dialog.
   */
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const self = id.current;
    stack.push(self);
    restoreFocusTo.current = document.activeElement;
    // Open on whatever the dialog is asking for, so it can be answered
    // without reaching for the mouse first.
    const field = dialogRef.current?.querySelector<HTMLElement>(FIRST_FIELD);
    (field ?? dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE))?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      // Only the dialog on top of the stack answers the keyboard.
      if (stack[stack.length - 1] !== self) return;
      if (e.key === 'Escape') {
        // Something transient is open over this dialog and owns the key —
        // pass it on rather than swallowing it. See `pushEscapeLayer`.
        if (escapeIsClaimed()) return;
        e.stopPropagation();
        closeRef.current();
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
      const at = stack.lastIndexOf(self);
      if (at >= 0) stack.splice(at, 1);
      // Hand focus back to whatever opened the dialog.
      (restoreFocusTo.current as HTMLElement | null)?.focus?.();
    };
  }, [open]);

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
        {/* A dialog whose content IS the choice has nothing to put down here,
            and an empty footer is a ruled-off strip of blank at the bottom of
            it. Rendered only when there is something in it. */}
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>
  );
}
