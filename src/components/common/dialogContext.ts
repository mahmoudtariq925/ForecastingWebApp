import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

// ============================================================================
// Contract for the in-app dialogs that replace the browser's native
// alert()/confirm(). Everything is local React state — no network, no
// backend. Kept separate from the provider component so the module exports
// only hooks/types (React Fast Refresh requires component-only modules).
// ============================================================================

export interface ConfirmOptions {
  title?: string;
  message: ReactNode;
  /** Label for the confirming action. */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Renders the confirm button in the destructive style. */
  danger?: boolean;
}

export interface NotifyOptions {
  title?: string;
  message: ReactNode;
  /** Styles the dialog as an error / success report. */
  tone?: 'info' | 'error' | 'success';
  closeLabel?: string;
}

export interface DialogApi {
  /** Resolves true when the user confirms, false when they cancel. */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** Resolves once the user dismisses the message. */
  notify: (options: NotifyOptions) => Promise<void>;
}

export const DialogContext = createContext<DialogApi | null>(null);

/** Access the in-app dialogs. Must be used under <DialogProvider>. */
export function useDialog(): DialogApi {
  const api = useContext(DialogContext);
  if (!api) throw new Error('useDialog must be used within a DialogProvider');
  return api;
}
