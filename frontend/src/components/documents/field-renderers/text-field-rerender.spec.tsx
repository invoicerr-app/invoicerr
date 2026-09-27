import { fireEvent, render, screen } from "@testing-library/react"
import { Profiler } from "react"
import { useForm } from "react-hook-form"
import { beforeEach, describe, expect, it } from "vitest"

import type { DocumentFieldDescriptor } from "@/components/documents/types"
import { Form } from "@/components/ui/form"

import { TextField } from "./primitive-fields"

/**
 * Issue #479, point 2: a line's text field must not subscribe to its whole `lines` array unless it
 * opted into sibling suggestions (`suggestSiblingValues`). Before the fix every text field of every
 * row called `useWatch` on the array, so typing one character in one line's `description` committed
 * EVERY row's text fields.
 *
 * Measured with React's own `<Profiler>`, one per field: `onRender` fires once per commit of that
 * field's subtree, whatever caused it. The harness deliberately has no parent that re-renders on
 * input (no whole-form `useWatch` above the fields), so what is counted is the fields' OWN
 * subscriptions and nothing else - see the PR for the same measurement taken on the real detail page,
 * where a parent re-render currently hides this effect.
 */

const ROWS = 5
const TYPED = "abcdefghij"

const descriptionField: DocumentFieldDescriptor = { key: "description", kind: "text", label: "Designation" }
const optionField: DocumentFieldDescriptor = {
  key: "option",
  kind: "text",
  label: "Option",
  suggestSiblingValues: true,
}

const commits = new Map<string, number>()
const countCommit = (id: string) => commits.set(id, (commits.get(id) ?? 0) + 1)
const commitsOf = (pattern: RegExp) =>
  [...commits.entries()].filter(([id]) => pattern.test(id)).reduce((sum, [, count]) => sum + count, 0)

function LinesForm() {
  const form = useForm({
    defaultValues: {
      lines: Array.from({ length: ROWS }, (_, index) => ({
        description: `Line ${index}`,
        option: index % 2 === 0 ? "Basic" : "Premium",
      })),
    },
  })
  return (
    <Form {...form}>
      {Array.from({ length: ROWS }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed-size fixture, the index IS the row
        <div key={index} data-cy={`row-${index}`}>
          <Profiler id={`lines.${index}.description`} onRender={countCommit}>
            <TextField field={descriptionField} name={`lines.${index}.description`} />
          </Profiler>
          <Profiler id={`lines.${index}.option`} onRender={countCommit}>
            <TextField field={optionField} name={`lines.${index}.option`} />
          </Profiler>
        </div>
      ))}
    </Form>
  )
}

function typeInto(input: HTMLElement, text: string) {
  let value = (input as HTMLInputElement).value
  for (const character of text) {
    value += character
    fireEvent.change(input, { target: { value } })
  }
}

describe("TextField re-renders while typing in a line (issue #479)", () => {
  beforeEach(() => commits.clear())

  it("typing in one line's description never commits another line's description", () => {
    render(<LinesForm />)
    const inputs = screen.getAllByTestId("document-field-description-input")
    // The FIRST keystroke flips the form's own `isDirty`, which re-renders the form host and so every
    // field once, fixed or not (`FormField` reads `formState`). Counting starts after it, so what is
    // left is exactly the per-keystroke cost the fix removes.
    typeInto(inputs[0], TYPED[0])
    commits.clear()

    typeInto(inputs[0], TYPED.slice(1))

    expect(commitsOf(/^lines\.0\.description$/)).toBe(TYPED.length - 1)
    expect(commitsOf(/^lines\.[1-9]\d*\.description$/)).toBe(0)
  })

  it("a field that opted into sibling suggestions still follows its siblings", () => {
    render(<LinesForm />)
    const options = screen.getAllByTestId("document-field-option-input")
    typeInto(options[0], " ")
    commits.clear()

    typeInto(options[0], "X")

    // Every row's own `option` field re-reads the array so its datalist can offer "Basic X".
    expect(commitsOf(/^lines\.[1-9]\d*\.option$/)).toBe(ROWS - 1)
    expect(document.querySelector("#lines-1-option-suggestions option[value='Basic X']")).not.toBeNull()
  })
})
