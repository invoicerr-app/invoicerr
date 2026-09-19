import { zodResolver } from "@hookform/resolvers/zod"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { type FieldValues, useForm, type UseFormReturn } from "react-hook-form"
import { describe, expect, it, vi } from "vitest"
import { z } from "zod"

import {
  initStepper,
  isLastStep,
  type SteppedDialogStep,
  SteppedDialog,
  stepperAdvance,
  stepperJumpTo,
  stepperRetreat,
  stepStatus,
} from "./stepped-dialog"

/**
 * ---- Pure navigation state — no dialog mounted at all -------------------------------------------
 * Exactly the rules the owner asked for: validation blocks forward movement (proved on the
 * component below, since these pure functions never look at validity themselves — that's
 * `SteppedDialog#handleContinue`'s job), backward movement is unconditional, and a step stays
 * clickable once reached even after stepping away from it.
 */
describe("stepper navigation — pure", () => {
  it("advance moves forward by one and raises maxReached, never past the last index", () => {
    let s = initStepper()
    expect(s).toEqual({ index: 0, maxReached: 0 })
    s = stepperAdvance(s, 3)
    expect(s).toEqual({ index: 1, maxReached: 1 })
    s = stepperAdvance(s, 3)
    expect(s).toEqual({ index: 2, maxReached: 2 })
    // Already on the last step (index 2 of 3) — advancing again stays put.
    s = stepperAdvance(s, 3)
    expect(s).toEqual({ index: 2, maxReached: 2 })
  })

  it("retreat always succeeds, regardless of anything — 'retour libre'", () => {
    const s = stepperRetreat({ index: 2, maxReached: 2 })
    expect(s).toEqual({ index: 1, maxReached: 2 })
    // maxReached is untouched by going back — the later step stays reachable.
    expect(stepperRetreat({ index: 0, maxReached: 2 })).toEqual({ index: 0, maxReached: 2 })
  })

  it("jumpTo only lands on a step already reached — clicking ahead of maxReached is a no-op", () => {
    const s = { index: 0, maxReached: 2 }
    expect(stepperJumpTo(s, 2)).toEqual({ index: 2, maxReached: 2 })
    expect(stepperJumpTo(s, 3)).toBe(s)
    expect(stepperJumpTo(s, -1)).toBe(s)
    expect(stepperJumpTo(s, 0)).toBe(s) // already there
  })

  it("stepStatus: done up to maxReached, current at index, upcoming past maxReached", () => {
    const s = { index: 1, maxReached: 2 }
    expect(stepStatus(s, 0)).toBe("done")
    expect(stepStatus(s, 1)).toBe("current")
    expect(stepStatus(s, 2)).toBe("done") // reached earlier, even though we're back on step 1
    expect(stepStatus(s, 3)).toBe("upcoming")
  })

  it("isLastStep", () => {
    expect(isLastStep({ index: 2, maxReached: 2 }, 3)).toBe(true)
    expect(isLastStep({ index: 1, maxReached: 2 }, 3)).toBe(false)
  })
})

/** A 3-step harness: step "a" has one required field, step "b" has none, step "c" is the recap. */
function Harness({
  onSubmit,
  initialMaxReached,
}: {
  onSubmit: (v: Record<string, unknown>) => void
  initialMaxReached?: number
}) {
  const schema = z.object({ name: z.string().min(1, "Required") })
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { name: "" } })

  const steps: SteppedDialogStep[] = [
    {
      id: "a",
      label: "First",
      fields: ["name"],
      render: () => (
        <div>
          <input aria-label="name" {...form.register("name")} />
          {form.formState.errors.name && <p>{String(form.formState.errors.name.message)}</p>}
        </div>
      ),
    },
    { id: "b", label: "Second", fields: [], render: () => <p>step b content</p> },
    { id: "c", label: "Third", fields: [], render: () => <p>step c content</p> },
  ]

  return (
    <SteppedDialog
      steps={steps}
      // The real callers (document-create-dialog.tsx) hand a DYNAMICALLY-shaped form (built from a
      // descriptor at runtime), which `UseFormReturn<FieldValues>` already fits; this harness's own
      // schema is concrete for readability, so the cast below is a TEST-ONLY stand-in for that
      // dynamism, not something a real caller needs.
      form={form as unknown as UseFormReturn<FieldValues>}
      onSubmit={(v) => onSubmit(v)}
      submitLabel="Save draft"
      open
      onOpenChange={() => {}}
      title="Harness dialog"
      dataCy="harness"
      initialMaxReached={initialMaxReached}
    />
  )
}

/** A harness whose step COUNT can change between renders — reproduces steps.length shifting while
 *  the dialog stays open, the way a GOVERNMENT client re-fetches B2G fields mid-session
 *  (document-create-dialog.tsx / use-document-form.ts). */
function GrowingHarness({ extraStep }: { extraStep: boolean }) {
  const schema = z.object({ name: z.string().min(1, "Required") })
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { name: "" } })

  const steps: SteppedDialogStep[] = [
    {
      id: "a",
      label: "First",
      fields: ["name"],
      render: () => <input aria-label="name" {...form.register("name")} />,
    },
    { id: "b", label: "Second", fields: [], render: () => <p>step b content</p> },
  ]
  if (extraStep) {
    steps.push({ id: "c", label: "Third", fields: [], render: () => <p>step c content</p> })
  }

  return (
    <SteppedDialog
      steps={steps}
      form={form as unknown as UseFormReturn<FieldValues>}
      onSubmit={() => {}}
      submitLabel="Save draft"
      open
      onOpenChange={() => {}}
      title="Growing harness dialog"
      dataCy="grow"
    />
  )
}

describe("<SteppedDialog> — behavior", () => {
  it("blocks Continue on an invalid current step, and shows the error under the field", async () => {
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)

    fireEvent.click(screen.getByTestId("harness-continue"))
    expect(await screen.findByText("Required")).toBeInTheDocument()
    // Still on step "a" — step b's content never mounted.
    expect(screen.queryByText("step b content")).not.toBeInTheDocument()
  })

  it("advances once the current step is valid, and the previous step's field unmounts", async () => {
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)

    fireEvent.change(screen.getByLabelText("name"), { target: { value: "Léa" } })
    fireEvent.click(screen.getByTestId("harness-continue"))

    expect(await screen.findByText("step b content")).toBeInTheDocument()
    expect(screen.queryByLabelText("name")).not.toBeInTheDocument()
  })

  it("Back always works, with no validation — free backward movement", async () => {
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)

    fireEvent.change(screen.getByLabelText("name"), { target: { value: "Léa" } })
    fireEvent.click(screen.getByTestId("harness-continue"))
    await screen.findByText("step b content")

    fireEvent.click(screen.getByTestId("harness-back"))
    expect(await screen.findByLabelText("name")).toHaveValue("Léa")
  })

  it("the last step's primary button reads the caller's submitLabel and calls onSubmit", async () => {
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)

    fireEvent.change(screen.getByLabelText("name"), { target: { value: "Léa" } })
    fireEvent.click(screen.getByTestId("harness-continue")) // a -> b
    await screen.findByText("step b content")
    fireEvent.click(screen.getByTestId("harness-continue")) // b -> c (no fields to validate)
    const submitBtn = await screen.findByTestId("harness-submit")
    expect(submitBtn).toHaveTextContent("Save draft")

    fireEvent.click(submitBtn)
    // `onSubmit` now fires only after the full-form `form.trigger()` gate resolves (see the
    // "re-validates the WHOLE form" spec below) — no longer synchronous with the click.
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: "Léa" })))
  })

  it("a step chip for an upcoming step is disabled; a done step's chip jumps back to it", async () => {
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)

    // Step "c" ahead of maxReached — its chip is present (desktop header) but disabled.
    expect(screen.getByTestId("harness-step-c")).toBeDisabled()

    fireEvent.change(screen.getByLabelText("name"), { target: { value: "Léa" } })
    fireEvent.click(screen.getByTestId("harness-continue")) // a -> b
    await screen.findByText("step b content")

    // Step "a" is now DONE — clickable, and clicking it jumps straight back.
    expect(screen.getByTestId("harness-step-a")).not.toBeDisabled()
    fireEvent.click(screen.getByTestId("harness-step-a"))
    expect(await screen.findByLabelText("name")).toBeInTheDocument()
  })

  it("initialMaxReached opens every chip clickable up front — an EDIT dialog's own steps start done", async () => {
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} initialMaxReached={2} />)

    // Still lands on step "a" first — only the chips ahead of it are unlocked, not the view itself.
    expect(await screen.findByLabelText("name")).toBeInTheDocument()
    expect(screen.getByTestId("harness-step-c")).not.toBeDisabled()

    fireEvent.click(screen.getByTestId("harness-step-c"))
    expect(await screen.findByText("step c content")).toBeInTheDocument()
  })

  it("re-validates the WHOLE form on the last step's submit, and snaps back to the step with the error instead of calling onSubmit", async () => {
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)

    // Reach the last step ("c", fields: []) the normal way, with a valid "name".
    fireEvent.change(screen.getByLabelText("name"), { target: { value: "Léa" } })
    fireEvent.click(screen.getByTestId("harness-continue")) // a -> b
    await screen.findByText("step b content")
    fireEvent.click(screen.getByTestId("harness-continue")) // b -> c
    await screen.findByText("step c content")

    // Jump back to step "a" via its header chip (already reached — no revalidation on the way there)
    // and clear the required field, then jump straight back to the recap.
    fireEvent.click(screen.getByTestId("harness-step-a"))
    fireEvent.change(await screen.findByLabelText("name"), { target: { value: "" } })
    fireEvent.click(screen.getByTestId("harness-step-c"))
    await screen.findByText("step c content")

    // The recap's own `fields: []` means the per-step gate alone would pass unconditionally —
    // clicking "Save draft" here used to call onSubmit with the now-invalid "name" still empty.
    fireEvent.click(screen.getByTestId("harness-submit"))

    expect(await screen.findByLabelText("name")).toBeInTheDocument()
    expect(await screen.findByText("Required")).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("does not snap back to step 1 when steps.length changes mid-session, while the dialog stays open", async () => {
    const { rerender } = render(<GrowingHarness extraStep={false} />)

    fireEvent.change(screen.getByLabelText("name"), { target: { value: "Léa" } })
    fireEvent.click(screen.getByTestId("grow-continue")) // a -> b
    await screen.findByText("step b content")

    // A new field group turns non-empty (e.g. picking a GOVERNMENT client) — steps.length grows
    // from 2 to 3 while `open` never changes.
    rerender(<GrowingHarness extraStep={true} />)

    expect(screen.getByText("step b content")).toBeInTheDocument()
    expect(screen.queryByLabelText("name")).not.toBeInTheDocument()
  })
})
