// ============================================================================
// WHO OWNS THE ESCAPE KEY
//
// A dialog answers Escape in the CAPTURE phase on the document — which runs
// before the event reaches whatever is focused, and before any bubble-phase
// listener however deeply nested — and then stops it. That is right when the
// dialog is the innermost thing on screen, and wrong the moment something
// opens over it: Escape with a dropdown open inside a dialog closed the
// DIALOG and took the dropdown down with it, so the one thing the user was
// looking at was the one thing the key could not reach.
//
// Anything transient registers here while it is open. A dialog then declines
// the key — without swallowing it — and the popover's own handler, further
// along the chain, gets it. One Escape closes the dropdown, the next closes
// the dialog: the order they were opened in, reversed.
//
// A counter rather than a stack, because nothing here needs to know WHICH
// popover is open, only whether one is. A dialog's question is "is this key
// mine?", and any open popover answers no.
//
// Its own module rather than a second export from `Modal.tsx`: the two sides
// of this are a dialog and a dropdown, neither of which owns the rule, and a
// component file that also exports a function loses fast refresh.
// ============================================================================

let popovers = 0;

/**
 * Claim Escape for a transient layer. Call the returned function to release —
 * from an effect's cleanup, so it runs however the layer closes.
 */
export function pushEscapeLayer(): () => void {
  popovers += 1;
  let released = false;
  return () => {
    // Releasing twice would take the counter below zero and hand Escape back
    // to a dialog while a later popover still wanted it.
    if (released) return;
    released = true;
    popovers -= 1;
  };
}

/** Is a transient layer holding the key? Dialogs check this before acting. */
export function escapeIsClaimed(): boolean {
  return popovers > 0;
}
