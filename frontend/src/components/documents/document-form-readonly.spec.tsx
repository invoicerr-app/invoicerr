import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import { useForm } from "react-hook-form"
import { describe, expect, it } from "vitest"

import { DocumentFormReadOnlyProvider } from "@/components/documents/document-form-readonly"
import { ArrayField } from "@/components/documents/field-renderers/array-field"
import { SelectField, TextField } from "@/components/documents/field-renderers/primitive-fields"
import type { DocumentFieldDescriptor } from "@/components/documents/types"
import { Form } from "@/components/ui/form"

// `ArrayField`'s own `LineRowCard` mounts inside a Popper-driven picker only when a row declares
// `prefillFrom` - this fixture never does, so no `ResizeObserver` stub is needed the way
// date-field.spec.tsx's does for its own Popover-based `DatePicker`.

const textField: DocumentFieldDescriptor = { key: "notes", kind: "text", label: "Notes" }
const selectField: DocumentFieldDescriptor = {
  key: "category",
  kind: "select",
  label: "Category",
  options: [{ value: "a", label: "A" }],
}
const arrayField: DocumentFieldDescriptor = {
  key: "lines",
  kind: "array",
  label: "Lines",
  fields: [{ key: "description", kind: "text", label: "Description" }],
}

function Harness({ readOnly }: { readOnly: boolean }) {
  const form = useForm({ defaultValues: { notes: "", category: "", lines: [{ description: "Widget" }] } })
  return (
    <Form {...form}>
      <DocumentFormReadOnlyProvider value={readOnly}>
        <TextField field={textField} name="notes" />
        <SelectField field={selectField} name="category" />
        <ArrayField field={arrayField} name="lines" />
      </DocumentFormReadOnlyProvider>
    </Form>
  )
}

function renderHarness(readOnly: boolean) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <Harness readOnly={readOnly} />
    </QueryClientProvider>,
  )
}

/**
 * Issue #468 (point 3, the reviewer's third finding): the locked-record notice
 * (`document-save-locked-notice`) used to be the ONLY signal a record could not be saved - the fields
 * underneath stayed white and clickable, disagreeing with the notice above them. `DocumentFormReadOnlyProvider`
 * (`document-detail.tsx`, fed by `action-presentation.ts#saveDraftLockNotice`) is what makes every
 * field kind agree with it. This spec proves the PROPAGATION generically, one representative kind at
 * a time (a plain text input, a SearchSelect-backed select, and an array field's own add/remove
 * buttons) - not every kind's own rendering detail, which each kind's own spec already covers.
 */
describe("DocumentFormReadOnlyProvider - every field kind disables itself once the form is locked", () => {
  it("a plain text field is editable when the provider says the form is NOT locked", () => {
    renderHarness(false)
    expect(screen.getByTestId("document-field-notes-input")).not.toBeDisabled()
  })

  it("a plain text field is disabled once the provider says the form is locked", () => {
    renderHarness(true)
    expect(screen.getByTestId("document-field-notes-input")).toBeDisabled()
  })

  it("a select field's trigger is disabled once the form is locked", () => {
    renderHarness(true)
    // `data-cy` sits on SearchSelect's own outer wrapper `<div>`, never on the button itself - the
    // actual `disabled` attribute lands on the trigger `<button>` inside it (search-input.tsx).
    const trigger = within(screen.getByTestId("document-field-category-input")).getByRole("button")
    expect(trigger).toBeDisabled()
  })

  it("a select field's trigger stays enabled when the form is not locked", () => {
    renderHarness(false)
    const trigger = within(screen.getByTestId("document-field-category-input")).getByRole("button")
    expect(trigger).not.toBeDisabled()
  })

  it("an array field's add-row and remove-row buttons are disabled once the form is locked", () => {
    renderHarness(true)
    expect(screen.getByTestId("document-field-lines-add-row")).toBeDisabled()
    expect(screen.getByTestId("document-field-lines-remove-row-0")).toBeDisabled()
    // The row's own subfield renders through the SAME `DocumentField` every top-level field does-
    // proving IT disables too is what proves the provider propagates through a nested row, not merely
    // to the fields mounted directly under it. `data-cy` is keyed by the row FIELD's own key
    // ("description"), not its full react-hook-form path - same convention every field renderer uses.
    expect(screen.getByTestId("document-field-description-input")).toBeDisabled()
  })

  it("an array field's add-row and remove-row buttons stay enabled when the form is not locked", () => {
    renderHarness(false)
    expect(screen.getByTestId("document-field-lines-add-row")).not.toBeDisabled()
    expect(screen.getByTestId("document-field-lines-remove-row-0")).not.toBeDisabled()
  })
})
