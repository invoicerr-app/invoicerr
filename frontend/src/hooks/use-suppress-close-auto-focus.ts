import { useRef } from "react"

/**
 * GitHub issue #451 — `@radix-ui/react-focus-scope`'s own unmount cleanup restores focus to a
 * dismissed layer's trigger from its own DEFERRED `setTimeout(..., 0)` (see the installed
 * `focus-scope.tsx`'s `AUTOFOCUS_ON_UNMOUNT` effect), which only runs once the content's own exit
 * animation finishes — so "the layer was dismissed" is two deferred steps past "the layer is gone".
 * A DIFFERENT popover opened INSIDE that window — a date picker inside the dialog a menu entry just
 * opened (defect 1), or a sibling field's own picker opened right after a reference field's picker
 * closed (defect 2 — traced live: picking a client, then opening the next field's date picker
 * immediately, race-loses to this SAME mechanism; nothing about the client-aware descriptor
 * refetch is load-bearing here, `field.key`-keyed reconciliation already keeps every field's own
 * node across a re-render regardless of the descriptor object's identity) — gets dismissed the
 * moment the deferred restore lands: it moves DOM focus to the FIRST layer's own trigger, a button
 * sitting OUTSIDE the second popover, and that popover's own `DismissableLayer` reads that as
 * "focus left the popover" and dismisses it out from under the user.
 *
 * The fix is `onCloseAutoFocus` on the closing layer's own content (`DropdownMenuContent`,
 * `PopoverContent`, …): every Radix layer built on `@radix-ui/react-menu` or `-popover` wires that
 * prop straight into `FocusScope`'s `onUnmountAutoFocus`, and `FocusScope`'s own restore is gated on
 * `!unmountEvent.defaultPrevented` — so calling `event.preventDefault()` there stops the restore
 * from running AT ALL, for that one close.
 *
 * Suppressing it UNCONDITIONALLY would be wrong: a plain Escape/outside-click close still needs to
 * return focus to the trigger for a keyboard user (that's the ONLY way a keyboard user gets back to
 * a sane position once a transient layer closes). So this only ever suppresses the ONE close that
 * is about to hand off to something else the user is about to interact with:
 * `suppressNextRestore()` arms it, synchronously, from inside the SAME handler that triggers that
 * hand-off (a menu entry's `onSelect` that opens a dialog, or a picker's own "option chosen" close)
 * — nothing else ever sets it — and `onCloseAutoFocus` consumes (and clears) that arm-once flag on
 * the very next close, whichever mechanism triggers it.
 */
export function useSuppressCloseAutoFocus() {
  const suppressRef = useRef(false)

  /** Call from the handler that is ABOUT to close this layer for a reason that hands off to
   *  something else the user will interact with (opens a dialog, moves on to a sibling field) —
   *  never unconditionally, and never from a plain Escape/outside-click close. */
  function suppressNextRestore() {
    suppressRef.current = true
  }

  /** Wire directly to the closing layer's own `onCloseAutoFocus`. */
  function onCloseAutoFocus(event: Event) {
    if (!suppressRef.current) return
    suppressRef.current = false
    event.preventDefault()
  }

  return { suppressNextRestore, onCloseAutoFocus }
}
