import { act, fireEvent, render, screen } from "@testing-library/react"
import { Profiler } from "react"
import { type UseFormReturn, useForm } from "react-hook-form"
import { describe, expect, it } from "vitest"

import { useUnsavedChanges } from "@/components/documents/use-unsaved-changes"

/**
 * Issue #488: `useUnsavedChanges` must answer "does the form differ from the saved baseline?"
 * correctly on every path (typing, undoing, reset, a new baseline), while re-rendering its host only
 * when that answer flips. Before the hook, the same component called `useWatch({ control })` and
 * committed once per keystroke.
 */

const SAVED = { lines: [{ description: "Consulting" }] }

let commits = 0
let formRef: UseFormReturn<typeof SAVED> | undefined

/** Stands for one of the form's fields: what the page body renders under it. */
function Field() {
  return <span />
}

/** Plays the part of `DocumentDetailBody`: a child of the component that owns the form, reading the
 *  flag through the hook, with a field under it. The FIELD's commits are counted, with React's own
 *  `<Profiler>` (the instrument #486 used): that is the cost #488 is about. React may still call
 *  `Body` itself once more after a state change before bailing out, which renders nothing under it. */
function Body({ form, baseline }: { form: UseFormReturn<typeof SAVED>; baseline: Record<string, unknown> }) {
  const dirty = useUnsavedChanges(form, baseline)
  return (
    <>
      <p data-cy="flag">{dirty ? "dirty" : "clean"}</p>
      <Profiler
        id="field"
        onRender={() => {
          commits += 1
        }}
      >
        <Field />
      </Profiler>
    </>
  )
}

function Host({ baseline }: { baseline: Record<string, unknown> }) {
  const form = useForm({ defaultValues: SAVED })
  formRef = form
  return (
    <>
      <input data-cy="description" {...form.register("lines.0.description")} />
      <Body form={form} baseline={baseline} />
    </>
  )
}

function type(value: string) {
  fireEvent.change(screen.getByTestId("description"), { target: { value } })
}

describe("useUnsavedChanges (issue #488)", () => {
  it("follows typing, undoing and a reset", () => {
    render(<Host baseline={SAVED} />)
    expect(screen.getByTestId("flag").textContent).toBe("clean")

    type("Consulting day")
    expect(screen.getByTestId("flag").textContent).toBe("dirty")

    type("Consulting")
    expect(screen.getByTestId("flag").textContent).toBe("clean")

    type("Consulting!")
    expect(screen.getByTestId("flag").textContent).toBe("dirty")
    act(() => formRef?.reset(SAVED))
    expect(screen.getByTestId("flag").textContent).toBe("clean")
  })

  it("does not commit the fields under the body on a keystroke that leaves the answer unchanged", () => {
    render(<Host baseline={SAVED} />)
    // The FIRST keystroke flips the answer (and react-hook-form's own `isDirty`, which re-renders the
    // form's owner): that commit is expected. Counting starts after it, as in #486's harness.
    type("Consulting d")
    expect(screen.getByTestId("flag").textContent).toBe("dirty")
    commits = 0

    for (const value of ["Consulting da", "Consulting day", "Consulting days", "Consulting days!"]) {
      type(value)
    }

    expect(screen.getByTestId("flag").textContent).toBe("dirty")
    expect(commits).toBe(0)
  })

  it("compares against a new baseline as soon as it arrives", () => {
    const { rerender } = render(<Host baseline={SAVED} />)
    type("Consulting day")
    expect(screen.getByTestId("flag").textContent).toBe("dirty")

    // What a save does: the host adopts the persisted data as its baseline.
    rerender(<Host baseline={{ lines: [{ description: "Consulting day" }] }} />)
    expect(screen.getByTestId("flag").textContent).toBe("clean")
  })
})
