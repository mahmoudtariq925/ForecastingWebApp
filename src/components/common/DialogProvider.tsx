import { useCallback, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Modal } from './Modal';
import { DialogContext, type DialogApi, type NotifyOptions } from './dialogContext';

// ============================================================================
// In-app dialogs. Replaces the browser's native alert()/confirm(), which
// render as unstyled OS chrome ("<site> says…") and block the whole page.
// Purely local React state — no network or backend involved. The API is
// promise-based so call sites read almost identically to the originals:
//
//   if (!(await confirm({ message: 'Remove user?' }))) return;
//   await notify({ message: 'Draft saved.' });
// ============================================================================

type Pending =
  | { kind: 'confirm'; options: Parameters<DialogApi['confirm']>[0] }
  | { kind: 'notify'; options: NotifyOptions };

const TONE_TITLES: Record<NonNullable<NotifyOptions['tone']>, string> = {
  info: 'Notice',
  error: 'Something went wrong',
  success: 'Done',
};

/** Hosts the single dialog instance and exposes the promise-based API. */
export function DialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  // Resolver for the dialog currently on screen.
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const settle = useCallback((value: boolean) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setPending(null);
    resolve?.(value);
  }, []);

  const api = useMemo<DialogApi>(
    () => ({
      confirm: (options) =>
        new Promise<boolean>((resolve) => {
          resolveRef.current = resolve;
          setPending({ kind: 'confirm', options });
        }),
      notify: (options) =>
        new Promise<void>((resolve) => {
          resolveRef.current = () => resolve();
          setPending({ kind: 'notify', options });
        }),
    }),
    [],
  );

  const isConfirm = pending?.kind === 'confirm';
  const tone = pending?.kind === 'notify' ? (pending.options.tone ?? 'info') : 'info';
  const title = pending
    ? (pending.options.title ??
      (pending.kind === 'confirm' ? 'Please confirm' : TONE_TITLES[tone]))
    : '';

  return (
    <DialogContext.Provider value={api}>
      {children}
      <Modal
        open={pending !== null}
        title={title}
        onClose={() => settle(false)}
        footer={
          isConfirm ? (
            <>
              <button className="btn btn-ghost" onClick={() => settle(false)}>
                {pending.options.cancelLabel ?? 'Cancel'}
              </button>
              <button
                className={`btn ${pending.options.danger ? 'btn-danger' : 'btn-primary'}`}
                onClick={() => settle(true)}
                autoFocus
              >
                {pending.options.confirmLabel ?? 'Confirm'}
              </button>
            </>
          ) : (
            <button className="btn btn-primary" onClick={() => settle(true)} autoFocus>
              {(pending?.kind === 'notify' && pending.options.closeLabel) || 'OK'}
            </button>
          )
        }
      >
        <div
          className={`dialog-message${tone === 'error' && !isConfirm ? ' error' : ''}`}
          // Notifications are announced; a confirm is already announced by the
          // dialog role, and doubling up makes screen readers read it twice.
          role={isConfirm ? undefined : 'status'}
          aria-live={isConfirm ? undefined : 'polite'}
        >
          {pending?.options.message}
        </div>
      </Modal>
    </DialogContext.Provider>
  );
}
