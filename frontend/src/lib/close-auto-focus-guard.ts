/**
 * GitHub issue #451 — shared close-autofocus guard for every Radix menu/popover layer in this app.
 *
 * Traced mechanism (confirmed against the installed `@radix-ui/react-focus-scope` source,
 * `node_modules/@radix-ui/react-focus-scope/dist/index.mjs`, `AUTOFOCUS_ON_UNMOUNT` effect):
 * `FocusScope`'s unmount cleanup dispatches the `focusScope.autoFocusOnUnmount` event (which every
 * Radix layer built on `@radix-ui/react-menu`, `-popover` or `-select` wires straight into its own
 * `onCloseAutoFocus` prop) from a DEFERRED `setTimeout(..., 0)` scheduled at unmount — one macrotask
 * after React has already removed the layer's content from the DOM (the callback fires once the
 * content's own exit animation finishes). `container.dispatchEvent(...)` still runs synchronously
 * against that (now-detached) node, and restore-to-previously-focused-element is gated on
 * `!event.defaultPrevented`.
 *
 * At the instant this deferred callback fires there are exactly two cases, checked directly (not
 * assumed) for every closing path this app exercises — a menu item with an exit animation, a
 * SearchSelect content with none, an Escape close, and an outside click on a focusable element:
 *
 *  - Nothing has claimed focus since the layer's node left the DOM: removing a focused node moves
 *    focus to `document.body` SYNCHRONOUSLY (browser behaviour, well before this deferred callback
 *    runs), so `document.activeElement` is `document.body` right here. This is the ordinary case —
 *    Escape, outside click, or an option pick with nothing else opened — and the restore MUST run:
 *    it is the only way a keyboard user gets back to a sane position once a transient layer closes.
 *    (The previous fix for #451 got exactly this wrong: it suppressed the restore unconditionally
 *    on every dialog/picker-opening menu entry, including the common case where nothing else ever
 *    grabs focus — e.g. picking a SearchSelect option with no dialog involved — which stranded
 *    keyboard-only users on `<body>`, an outright accessibility regression.)
 *  - Something else already grabbed focus in the meantime: a dialog's own `FocusScope` mount-autofocus
 *    (its mount effect runs synchronously, in the same tick the dialog's content mounts — well before
 *    this closing layer's deferred macrotask), or a second popover's trigger/content the user opened
 *    right after this one closed. `document.activeElement` is then a real, still-connected element
 *    that is NOT `document.body`. Restoring here would rip focus away from wherever the user already
 *    moved to — the actual #451 defect: a date picker opened inside a menu-triggered dialog, or a
 *    sibling field's popover opened right after this one closed, has its own `DismissableLayer` read
 *    that as "focus left the layer" and dismiss it out from under the user.
 *
 * So the rule is "don't STEAL focus", never "don't restore focus": inspect `document.activeElement`
 * at the moment this fires and only `preventDefault()` the restore when it is a connected element
 * other than `document.body` — i.e. only when restoring would yank focus away from something the
 * user has already moved to. Composed with any caller-provided `onCloseAutoFocus` first (called
 * before this check runs; if the caller already called `preventDefault()`, this is a no-op).
 */
export function guardCloseAutoFocus(event: Event, callerOnCloseAutoFocus?: (event: Event) => void) {
  callerOnCloseAutoFocus?.(event)
  if (event.defaultPrevented) return
  const active = document.activeElement
  if (active && active !== document.body && active.isConnected) {
    event.preventDefault()
  }
}
