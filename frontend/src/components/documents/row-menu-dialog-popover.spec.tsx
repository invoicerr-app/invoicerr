import { useState } from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { DatePicker } from "@/components/date-picker"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useSuppressCloseAutoFocus } from "@/hooks/use-suppress-close-auto-focus"

/**
 * Reproduces GitHub issue #451, defect 1: `@radix-ui/react-focus-scope`'s own unmount cleanup
 * restores focus to a dismissed layer's trigger from a DEFERRED `setTimeout(..., 0)` (see that
 * package's `focus-scope.tsx`) — one macrotask AFTER the layer that triggered it (here, the row's
 * "more" menu) has already closed. A popover opened INSIDE that window (a date picker inside the
 * dialog a menu entry just opened) gets dismissed on focus-outside the moment that deferred restore
 * lands: it moves DOM focus to the row menu's own trigger button, which sits OUTSIDE the popover,
 * and the popover's own `DismissableLayer` reads that as "focus left the popover" and dismisses it.
 *
 * Two jsdom gaps this test works around, proven against the installed packages (not guessed):
 *  - jsdom has no `PointerEvent` at all, and Radix's `DropdownMenuTrigger` opens on `pointerdown`,
 *    not `click` — a minimal polyfill is installed below.
 *  - `screen.findByTestId` (used to locate the DIALOG's own content) polls on a macrotask timer,
 *    so `await`ing one AFTER the menu item is clicked would let the menu's own deferred restore
 *    fire FIRST — silently "fixing" the very race this test exists to catch. Every query on the
 *    critical path below is therefore a SYNCHRONOUS `getByTestId`/`queryByTestId` (React's own
 *    `act()`-flushed re-render already put the dialog and its fields in the DOM by the time
 *    `fireEvent.click` returns), so nothing here awaits anything until the test explicitly wants
 *    the deferred restore's own macrotask to run.
 *
 * The assertion targets the MECHANISM, not jsdom's downstream DOM-dismiss behaviour: whether
 * `document.activeElement` becomes the row menu's own trigger once the deferred restore fires — the
 * exact fact the issue's own trace names ("100ms focusin BUTTON[data-cy=document-row-menu-<id>]").
 * A real browser's `DismissableLayer` then reads that focus-outside move and dismisses the calendar
 * (the "141ms popover gone" the issue also records, and what the fix ultimately prevents in
 * production); jsdom's focus/blur plumbing does not reliably reproduce that SECOND, downstream step
 * even once the trigger IS wrongly refocused (proven empirically against the installed Radix
 * packages: forcing the restore to fire here does not, on its own, unmount the calendar in this
 * environment) — so asserting on the calendar's presence alone would pass even unfixed, a false
 * green. Asserting on WHERE focus lands is what the fix actually controls either way. */
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number
    pointerType: string
    isPrimary: boolean
    constructor(type: string, props: PointerEventInit = {}) {
      super(type, props)
      this.pointerId = props.pointerId ?? 1
      this.pointerType = props.pointerType ?? "mouse"
      this.isPrimary = props.isPrimary ?? true
    }
  }
  vi.stubGlobal("PointerEvent", PointerEventPolyfill)
})

function RowMenuHarness() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const { suppressNextRestore, onCloseAutoFocus } = useSuppressCloseAutoFocus()

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" data-cy="row-menu-trigger">
            Row menu
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent onCloseAutoFocus={onCloseAutoFocus}>
          <DropdownMenuItem
            data-cy="open-dialog-item"
            onSelect={() => {
              suppressNextRestore()
              setDialogOpen(true)
            }}
          >
            Open dialog
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {dialogOpen && (
        <Dialog open onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogTitle>A dialog</DialogTitle>
            <DatePicker value={null} onChange={() => {}} data-cy="dialog-date-input" />
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

/** Opens the row menu the same way a real click does — focused first, so its content's own
 *  FocusScope captures the trigger as `previouslyFocusedElement`, exactly what the deferred restore
 *  later targets. Radix's `DropdownMenuTrigger` opens on `pointerdown`, not `click`. */
function openRowMenu() {
  const trigger = screen.getByTestId("row-menu-trigger")
  trigger.focus()
  fireEvent.pointerDown(trigger, { button: 0 })
  fireEvent.click(trigger)
}

/** Runs the microtask queue empty without crossing a macrotask boundary — long enough for a
 *  same-tick React state update to settle, never long enough for a `setTimeout(...,0)` to fire. */
async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
}

describe("<DropdownMenuContent> — a popover opened by a menu entry's own dialog survives the menu's deferred focus restore", () => {
  it("never yanks focus back to the row menu's own trigger once a calendar is open inside the dialog it opened", async () => {
    render(<RowMenuHarness />)

    openRowMenu()
    fireEvent.click(screen.getByTestId("open-dialog-item"))
    await flushMicrotasks()

    // The dialog mounted synchronously (`setDialogOpen(true)`, flushed by `fireEvent`'s own `act()`)
    // — open the date picker inside it BEFORE the menu's deferred restore has had a macrotask to
    // run in.
    fireEvent.click(screen.getByTestId("dialog-date-input"))
    expect(screen.getByTestId("date-picker-today")).toBeInTheDocument()
    const rowMenuTrigger = screen.getByTestId("row-menu-trigger")
    expect(document.activeElement).not.toBe(rowMenuTrigger)

    // Let the menu's own FocusScope unmount cleanup's `setTimeout(...,0)` actually fire.
    await new Promise((resolve) => setTimeout(resolve, 0))

    // The deferred restore must never have moved focus to the row menu's own trigger — the exact
    // fact that, in a real browser, is what gets the calendar's own `DismissableLayer` to read
    // "focus left the popover" and dismiss it.
    expect(document.activeElement).not.toBe(rowMenuTrigger)
    expect(screen.getByTestId("date-picker-today")).toBeInTheDocument()
  })

  it("still returns focus to the row menu's own trigger on a PLAIN close (Escape) — no keyboard regression", async () => {
    render(<RowMenuHarness />)

    openRowMenu()
    fireEvent.keyDown(screen.getByTestId("open-dialog-item"), { key: "Escape" })

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(document.activeElement).toBe(screen.getByTestId("row-menu-trigger"))
  })
})
