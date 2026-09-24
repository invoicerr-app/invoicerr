import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { DatePicker } from "@/components/date-picker"
import SearchSelect from "@/components/search-input"

/**
 * Reproduces GitHub issue #451, defect 2 — root-caused here, NOT as "the client-aware descriptor
 * refetch rebuilds every field node" (the e2e comment's own diagnosis, in
 * `e2e/cypress/e2e/43-correction-routes.cy.ts`): `field.key`-keyed reconciliation already keeps an
 * unchanged field's own node (and a sibling popover's `open` state) across a re-render regardless of
 * whether the descriptor OBJECT handed down is a new identity — proven directly against
 * `<DocumentFormFields>`/`<DocumentCreateDialog>` with a real `QueryClient` in
 * `use-document-form.spec.tsx` and `document-create-dialog.descriptor-refetch.spec.tsx`, both of
 * which keep the popover open across exactly that swap.
 *
 * The REAL mechanism is identical in kind to defect 1: `SearchSelect`'s own `PopoverContent` never
 * sets `onCloseAutoFocus`, so `@radix-ui/react-focus-scope`'s own default kicks in unconditionally
 * on EVERY close — a DEFERRED `setTimeout(...,0)` (see that package's own `focus-scope.tsx`) that
 * restores focus to whatever was focused before this popover opened (the reference field's own
 * trigger button). Pick a client, then open a SIBLING field's date picker before that deferred
 * restore fires, and it lands on the client trigger — OUTSIDE the calendar — which the calendar's
 * own `DismissableLayer` reads as "focus left the popover" and dismisses it. Empirically verified
 * (temporary debug harness, not kept): the calendar is present right after opening and gone one
 * macrotask later, entirely independent of any descriptor refetch.
 */
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

function Harness() {
  return (
    <>
      <SearchSelect
        options={[{ value: "c1", label: "Acme" }]}
        value=""
        onValueChange={() => {}}
        data-cy="client-input"
      />
      <DatePicker value={null} onChange={() => {}} data-cy="date-input" />
    </>
  )
}

/** SearchSelect puts its `data-cy` on the wrapping `<div>` (own header), never the Radix trigger
 *  button itself — the button is what actually opens the popover. */
function clientTriggerButton() {
  return screen.getByTestId("client-input").querySelector("button") as HTMLButtonElement
}

describe("<SearchSelect> — a sibling field's popover survives this one's own deferred close-autofocus restore", () => {
  it("does not steal focus back from a date picker opened right after an option is picked", async () => {
    render(<Harness />)

    const trigger = clientTriggerButton()
    trigger.focus()
    fireEvent.click(trigger)
    fireEvent.click(await screen.findByText("Acme"))

    // Open the sibling date picker BEFORE the reference field's own deferred restore has had a
    // macrotask to run in.
    fireEvent.click(screen.getByTestId("date-input"))
    expect(screen.getByTestId("date-picker-today")).toBeInTheDocument()

    // Let the deferred restore actually fire.
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(document.activeElement).not.toBe(trigger)
    expect(screen.getByTestId("date-picker-today")).toBeInTheDocument()
  })

  it("still returns focus to its own trigger on a plain Escape close — no keyboard regression", async () => {
    render(<Harness />)

    const trigger = clientTriggerButton()
    trigger.focus()
    fireEvent.click(trigger)
    fireEvent.keyDown(await screen.findByText("Acme"), { key: "Escape" })

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(document.activeElement).toBe(trigger)
  })
})
