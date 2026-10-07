import { fireEvent, render, screen } from "@testing-library/react"
import { useForm } from "react-hook-form"
import { describe, expect, it } from "vitest"

import { Form } from "@/components/ui/form"
import type { DocumentFieldDescriptor } from "@/components/documents/types"

import { arrayRowFieldPath, legacyOptionLabels, TextField } from "./primitive-fields"

/** Same shape `vat-rates/registry.ts#vatRateFieldOptions` sends: `options`/`legacyOptions` built
 *  together, same length and order, so index i names the same rate in both. */
const vatRateField: DocumentFieldDescriptor = {
  key: "vatRate",
  kind: "select",
  label: "VAT rate",
  options: [
    { value: "fr-standard", label: "20% — Taux normal" },
    { value: "fr-intermediate", label: "10% — Taux intermédiaire" },
  ],
  legacyOptions: [
    { value: "20", label: "20% — Taux normal" },
    { value: "10", label: "10% — Taux intermédiaire" },
  ],
}

describe("legacyOptionLabels", () => {
  it("pairs each legacy bare-percentage value with the CURRENT catalog's label at the same index", () => {
    expect(legacyOptionLabels(vatRateField)).toEqual([
      { value: "20", label: "20% — Taux normal" },
      { value: "10", label: "10% — Taux intermédiaire" },
    ])
  })

  it("returns nothing for a field with no legacyOptions at all", () => {
    const plainSelect: DocumentFieldDescriptor = { key: "category", kind: "select", label: "Category" }
    expect(legacyOptionLabels(plainSelect)).toEqual([])
  })

  it("drops a legacy entry whose index has no current option left (catalog shrank)", () => {
    const shrunkField: DocumentFieldDescriptor = {
      ...vatRateField,
      options: [{ value: "fr-standard", label: "20% — Taux normal" }],
    }
    expect(legacyOptionLabels(shrunkField)).toEqual([{ value: "20", label: "20% — Taux normal" }])
  })
})

describe("arrayRowFieldPath (issue #373 follow-up, editor option suggestions)", () => {
  it("splits a row-nested field's name into its array field and subfield key", () => {
    expect(arrayRowFieldPath("lines.2.option")).toEqual({ arrayFieldName: "lines", subFieldKey: "option" })
    expect(arrayRowFieldPath("lines.0.description")).toEqual({
      arrayFieldName: "lines",
      subFieldKey: "description",
    })
  })

  it("is undefined for a top-level (non-row) field - nothing to suggest from", () => {
    expect(arrayRowFieldPath("notes")).toBeUndefined()
    expect(arrayRowFieldPath("client")).toBeUndefined()
  })

  it("is undefined when the middle segment isn't a numeric row index", () => {
    expect(arrayRowFieldPath("company.address.street")).toBeUndefined()
  })
})

/** Two rows so a suggestion (from row 0's own value) would exist to offer on row 1 - if the
 *  gating below were absent, that is exactly what would render for every 'text' array subfield. */
const rows = [{ option: "Basic" }, { option: "" }]

function ArrayRowForm({ field }: { field: DocumentFieldDescriptor }) {
  const methods = useForm<{ lines: typeof rows }>({ defaultValues: { lines: rows } })
  return (
    <Form {...methods}>
      <TextField field={field} name="lines.1.option" />
    </Form>
  )
}

describe("<TextField> - suggestSiblingValues gates the datalist (issue #373 follow-up)", () => {
  it("renders a datalist offering the other row's value when the field opts in", () => {
    const optedIn: DocumentFieldDescriptor = {
      key: "option",
      kind: "text",
      label: "Option",
      suggestSiblingValues: true,
    }

    render(<ArrayRowForm field={optedIn} />)

    const input = screen.getByTestId("document-field-option-input")
    const listId = input.getAttribute("list")
    expect(listId).toBeTruthy()
    const datalist = document.getElementById(listId as string)
    expect(datalist).not.toBeNull()
    expect(datalist?.querySelector("option")?.getAttribute("value")).toBe("Basic")
  })

  it("renders no datalist at all for a plain text subfield without the opt-in", () => {
    const plain: DocumentFieldDescriptor = {
      key: "option",
      kind: "text",
      label: "Option",
    }

    render(<ArrayRowForm field={plain} />)

    const input = screen.getByTestId("document-field-option-input")
    expect(input.getAttribute("list")).toBeNull()
    expect(document.querySelectorAll("datalist")).toHaveLength(0)
  })
})

const unitField: DocumentFieldDescriptor = {
  key: "unit",
  kind: "text",
  label: "Unit",
  suggestedValues: [
    { value: "DAY", label: "Jour" },
    { value: "HUR", label: "Heure" },
  ],
}

function UnitForm({ stored, onChange }: { stored: string; onChange: (value: string) => void }) {
  const methods = useForm<{ unit: string }>({ defaultValues: { unit: stored } })
  methods.watch((values) => onChange(values.unit ?? ""))
  return (
    <Form {...methods}>
      <TextField field={unitField} name="unit" />
    </Form>
  )
}

describe("<TextField> - suggestedValues", () => {
  it("offers the labels in a datalist and shows a stored code as its label", () => {
    render(<UnitForm stored="DAY" onChange={() => {}} />)

    const input = screen.getByTestId("document-field-unit-input") as HTMLInputElement
    expect(input.value).toBe("Jour")
    const options = document.getElementById(input.getAttribute("list") as string)?.querySelectorAll("option")
    expect(Array.from(options ?? []).map((option) => option.getAttribute("value"))).toEqual(["Jour", "Heure"])
  })

  it("shows a stored free-text value as typed", () => {
    render(<UnitForm stored="sprint" onChange={() => {}} />)

    expect((screen.getByTestId("document-field-unit-input") as HTMLInputElement).value).toBe("sprint")
  })

  it("stores the code when a label is entered and the raw text otherwise", () => {
    let stored = ""
    render(<UnitForm stored="" onChange={(value) => (stored = value)} />)
    const input = screen.getByTestId("document-field-unit-input")

    fireEvent.change(input, { target: { value: "heure" } })
    expect(stored).toBe("HUR")

    fireEvent.change(input, { target: { value: "sprint" } })
    expect(stored).toBe("sprint")
  })
})
