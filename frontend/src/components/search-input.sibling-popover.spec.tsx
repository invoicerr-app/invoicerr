import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { DatePicker } from "@/components/date-picker"
import SearchSelect from "@/components/search-input"

/**
 * GitHub issue #451, defect 2 — root-caused here, NOT as "the client-aware descriptor refetch
 * rebuilds every field node" (the e2e comment's own diagnosis, in
 * `e2e/cypress/e2e/43-correction-routes.cy.ts`): `field.key`-keyed reconciliation already keeps an
 * unchanged field's own node (and a sibling popover's `open` state) across a re-render regardless of
 * whether the descriptor OBJECT handed down is a new identity — proven directly against
 * `<DocumentFormFields>`/`<DocumentCreateDialog>` with a real `QueryClient` in
 * `use-document-form.spec.tsx` and `document-create-dialog.descriptor-refetch.spec.tsx`, both of
 * which keep the popover open across exactly that swap.
 *
 * The REAL mechanism is identical in kind to defect 1: `SearchSelect`'s own `PopoverContent`
 * restores focus via `@radix-ui/react-focus-scope`'s own deferred `setTimeout(...,0)` unmount
 * cleanup (see that package's own `focus-scope.tsx`). Left unguarded (origin/dev), that restore
 * always fires unconditionally — pick a client, then open a SIBLING field's date picker before the
 * deferred restore lands, and it steals focus back to the client trigger, which the calendar's own
 * `DismissableLayer` reads as "focus left the popover" and dismisses.
 *
 * The FIRST fix for this (the commit under test's own parent) went the other way and broke keyboard
 * accessibility: it suppressed the restore unconditionally on every option pick, so picking an
 * option with nothing else ever opened afterwards stranded a keyboard user on `<body>` — see the
 * second test below, which is RED against that code (current at the time this file was written) and
 * GREEN once `lib/close-auto-focus-guard.ts`'s "don't steal, don't just suppress" guard lands.
 *
 * The first test is RED against origin/dev (before either fix — plain, unguarded Radix restore) and
 * GREEN with the guard.
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

describe("<SearchSelect> — close-autofocus guard (issue #451)", () => {
  it("race: does not steal focus back from a date picker opened right after an option is picked", async () => {
    render(<Harness />)

    const trigger = clientTriggerButton()
    trigger.focus()
    fireEvent.click(trigger)
    fireEvent.click(await screen.findByText("Acme"))

    // Open the sibling date picker BEFORE the reference field's own deferred restore has had a
    // macrotask to run in — the second layer is now where the user's focus actually is.
    fireEvent.click(screen.getByTestId("date-input"))
    expect(screen.getByTestId("date-picker-today")).toBeInTheDocument()

    // Let the deferred restore actually fire.
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(document.activeElement).not.toBe(trigger)
    expect(screen.getByTestId("date-picker-today")).toBeInTheDocument()
  })

  it("a11y: picking an option with the keyboard, nothing else opened, returns focus to the trigger", async () => {
    render(<Harness />)

    const trigger = clientTriggerButton()
    trigger.focus()
    fireEvent.click(trigger)
    // Enter on a focused option button fires a `click` in a real browser — nothing else is opened
    // afterwards, so the restore must run and land back on the trigger.
    const option = await screen.findByText("Acme")
    fireEvent.keyDown(option, { key: "Enter" })
    fireEvent.click(option)

    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(document.activeElement).toBe(trigger)
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
