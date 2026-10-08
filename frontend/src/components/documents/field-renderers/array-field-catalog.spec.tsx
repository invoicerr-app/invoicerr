import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { type UseFormReturn, useForm } from "react-hook-form"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { DocumentFieldDescriptor } from "@/components/documents/types"
import { Form } from "@/components/ui/form"

const fetchPrefillFields = vi.fn()
vi.mock("@/hooks/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/queries")>()),
  fetchPrefillFields: (...args: unknown[]) => fetchPrefillFields(...args),
}))
vi.mock("@/hooks/use-catalog-search", () => ({
  useCatalogSearch: (_entity: string, query: string, enabled: boolean) => ({
    options: enabled && query ? [{ id: "art-1", label: "Consulting day" }] : [],
  }),
}))

import { ArrayField } from "./array-field"

const prefillMap = { articleId: "id", description: "name", unitPrice: "unitPrice", vatRate: "vatRate" }

const linesField: DocumentFieldDescriptor = {
  key: "lines",
  kind: "array",
  label: "Lines",
  prefillFrom: { entity: "article", map: prefillMap },
  fields: [
    { key: "description", kind: "text", label: "Designation" },
    { key: "articleId", kind: "hiddenReference", label: "Article", entity: "article" },
    { key: "quantity", kind: "number", label: "Quantity" },
    { key: "unitPrice", kind: "money", label: "Unit price", currency: "EUR" },
    {
      key: "vatRate",
      kind: "select",
      label: "VAT rate",
      options: [{ value: "std", label: "20%" }],
      legacyOptions: [{ value: "20", label: "20%" }],
    },
  ],
}

const article = { id: "art-1", name: "Consulting day", unitPrice: 450, vatRate: 20, stock: 3 }

type LinesForm = { lines: Record<string, unknown>[] }

function renderLines(field: DocumentFieldDescriptor) {
  const form: { current?: UseFormReturn<LinesForm> } = {}
  function Harness() {
    const methods = useForm<LinesForm>({ defaultValues: { lines: [{ quantity: 2 }] } })
    form.current = methods
    return (
      <Form {...methods}>
        <ArrayField field={field} name="lines" />
      </Form>
    )
  }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  )
  return () => form.current!.getValues("lines.0")
}

function pickFromDesignation(text: string) {
  const input = screen.getByTestId("document-field-description-input")
  fireEvent.change(input, { target: { value: text } })
  fireEvent.mouseDown(screen.getByTestId("catalog-search-option-0"))
}

describe("ArrayField: catalog pick from the designation", () => {
  beforeEach(() => {
    fetchPrefillFields.mockReset()
    fetchPrefillFields.mockResolvedValue(article)
  })

  it("fills every field the prefill map declares, and leaves the others alone", async () => {
    const row = renderLines(linesField)
    pickFromDesignation("cons")

    await waitFor(() => expect(row().unitPrice).toBe(450))
    expect(fetchPrefillFields).toHaveBeenCalledWith("article", "art-1")
    expect(row()).toEqual({
      quantity: 2,
      articleId: "art-1",
      description: "Consulting day",
      unitPrice: 450,
      vatRate: "std",
    })
    expect(screen.getByTestId("document-field-description-input")).toHaveValue("Consulting day")
  })

  it("offers no separate catalog picker on the row", () => {
    renderLines(linesField)
    expect(screen.queryByTestId("document-field-lines-row-0-prefill")).toBeNull()
    expect(screen.getByTestId("document-field-description-input")).toHaveAttribute("role", "combobox")
  })

  it("keeps a plain designation input when the array declares no prefill", () => {
    renderLines({ ...linesField, prefillFrom: undefined })
    expect(screen.getByTestId("document-field-description-input")).not.toHaveAttribute("role")
  })
})
