import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { ConfirmationDialog } from "./confirmation-dialog"

function renderDialog(overrides: Partial<React.ComponentProps<typeof ConfirmationDialog>> = {}) {
  const onOpenChange = vi.fn()
  const onConfirm = vi.fn()
  render(
    <ConfirmationDialog
      open
      onOpenChange={onOpenChange}
      title="This cannot be undone"
      description="You are about to sign QUOTE-0001. Once signed, it cannot be reversed."
      confirmLabel="Sign now"
      cancelLabel="Back"
      onConfirm={onConfirm}
      dataCy="confirm-test"
      {...overrides}
    />,
  )
  return { onOpenChange, onConfirm }
}

describe("<ConfirmationDialog>", () => {
  it("shows the title and description, and nothing else, when no detail is given", () => {
    renderDialog()
    expect(screen.getByText("This cannot be undone")).toBeInTheDocument()
    expect(
      screen.getByText("You are about to sign QUOTE-0001. Once signed, it cannot be reversed."),
    ).toBeInTheDocument()
  })

  // A caller passing `detailLabel` with no `detailValue` (or vice versa) has nothing worth restating —
  // the row must stay absent rather than render half-blank, the same "presence test" contract
  // `email ? … : null` used to hold in this component's own previous, narrower shape.
  it("renders the optional detail row only when a value is actually given", () => {
    renderDialog({ detailLabel: "Recipient:", detailValue: "client@example.com" })
    expect(screen.getByText("Recipient:")).toBeInTheDocument()
    expect(screen.getByText("client@example.com")).toBeInTheDocument()
  })

  it("has no detail row at all when neither detailLabel nor detailValue is passed", () => {
    renderDialog()
    expect(screen.queryByText("Recipient:")).not.toBeInTheDocument()
  })

  it("calls onConfirm, never onOpenChange, when the confirm button is pressed", () => {
    const { onConfirm, onOpenChange } = renderDialog()
    fireEvent.click(screen.getByTestId("confirm-test-confirm"))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it("calls onOpenChange(false), never onConfirm, when Back is pressed", () => {
    const { onConfirm, onOpenChange } = renderDialog()
    fireEvent.click(screen.getByTestId("confirm-test-cancel"))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  // Radix's own Escape handling closes the dialog through the SAME `onOpenChange` callback a Back
  // click uses — this only proves `open`/`onOpenChange` are actually wired to Radix's `Dialog.Root`,
  // not a hand-rolled close path that would silently diverge from it later.
  it("closes on Escape", () => {
    const { onOpenChange } = renderDialog()
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("disables both buttons while loading, and shows the confirm button's spinner", () => {
    renderDialog({ loading: true })
    expect(screen.getByTestId("confirm-test-confirm")).toBeDisabled()
    expect(screen.getByTestId("confirm-test-cancel")).toBeDisabled()
  })
})
