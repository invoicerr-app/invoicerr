import { render, screen, fireEvent } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { Form } from "@/components/ui/form"
import { DocumentFormFields, LineTotalWarnings } from "@/components/documents/document-form"
import { extractLineTotalWarnings, useDocumentForm } from "@/components/documents/use-document-form"
import type { DocumentTypeDescriptor } from "@/components/documents/types"

/**
 * `@/hooks/queries` mocked wholesale — same convention as `document-archive-section.spec.tsx`: this
 * suite is about what `useDocumentForm`/`DocumentFormFields` do with a descriptor that changes
 * OBJECT IDENTITY between renders (exactly what `useDocumentType`'s own `select` produces on every
 * fetch — `translateDocumentTypeDescriptor` rebuilds the whole graph, even when nothing in it
 * actually differs), never about the query layer underneath.
 */
vi.mock("@/hooks/queries", () => ({
  useDocumentType: vi.fn(),
  useFetchSelectableRows: vi.fn(() => vi.fn()),
  useReferenceFields: vi.fn(),
  useRunDocumentAction: vi.fn(),
  useResolveActionParamsDefaults: vi.fn(),
}))

vi.mock("@/hooks/queries/use-payment-terms", () => ({ usePaymentTerms: vi.fn(() => ({ data: undefined })) }))

import {
  useDocumentType,
  useReferenceFields,
  useResolveActionParamsDefaults,
  useRunDocumentAction,
} from "@/hooks/queries"

const mockedUseDocumentType = vi.mocked(useDocumentType)
const mockedUseReferenceFields = vi.mocked(useReferenceFields)

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  mockedUseReferenceFields.mockReturnValue({ data: undefined } as never)
  vi.mocked(useRunDocumentAction).mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never)
  vi.mocked(useResolveActionParamsDefaults).mockReturnValue({ mutateAsync: vi.fn() } as never)
})

/** Same shape on both fetches — a genuinely UNCHANGED descriptor, only its object identity differs,
 *  which is exactly what a `select()`-composed React Query response gives back on every refetch even
 *  when the server sent back byte-identical JSON. */
function makeDescriptor(): DocumentTypeDescriptor {
  return {
    id: "invoice",
    label: "Invoice",
    statuses: [{ id: "draft", label: "Draft" }],
    initialStatus: "draft",
    fields: [{ key: "issueDate", kind: "date", label: "Issue date" }],
    actions: [{ id: "save-draft", label: "Save draft", availableWhen: "always" }],
  }
}

function Harness({ descriptor }: { descriptor: DocumentTypeDescriptor }) {
  const state = useDocumentForm({ descriptor })
  return (
    <Form {...state.form}>
      <DocumentFormFields descriptor={descriptor} state={state} />
    </Form>
  )
}

describe("<DocumentFormFields> — an open popover survives the client-aware descriptor landing", () => {
  it("keeps the date-picker popover open when the live descriptor is replaced by an equal-but-new object", () => {
    const pageDescriptor = makeDescriptor()
    // Nothing has landed from `useDocumentType` yet — `effectiveDescriptor` falls back to the
    // page-provided descriptor, exactly as a fresh mount does before any client-aware fetch resolves.
    mockedUseDocumentType.mockReturnValue({ data: undefined } as never)

    const { rerender } = render(
      <MemoryRouter>
        <Harness descriptor={pageDescriptor} />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByTestId("document-field-issueDate-input"))
    expect(screen.getByTestId("date-picker-today")).toBeInTheDocument()

    // The refetch "lands": a brand-new descriptor object, structurally identical to the one already
    // rendered (same field keys, same everything) — the only thing that changed is its IDENTITY.
    mockedUseDocumentType.mockReturnValue({ data: makeDescriptor() } as never)
    rerender(
      <MemoryRouter>
        <Harness descriptor={pageDescriptor} />
      </MemoryRouter>,
    )

    // The popover must still be open: nothing about what this field IS actually changed.
    expect(screen.getByTestId("date-picker-today")).toBeInTheDocument()
  })
})

/** `data.lineTotalWarnings` is persisted JSONB the backend never rewrites on read: a received invoice
 *  saved before the message-key switch still carries `string[]`, and must keep its warning. */
describe("extractLineTotalWarnings - both stored shapes stay readable", () => {
  it("keeps a legacy bare-string warning exactly as it was written", () => {
    const data = { lineTotalWarnings: ["Lines add up to 600.00, the invoice states 650.00."] }

    expect(extractLineTotalWarnings(data)).toEqual(["Lines add up to 600.00, the invoice states 650.00."])
  })

  it("keeps message objects, dropping anything that is neither a string nor a keyed object", () => {
    const message = {
      key: "documents.messages.lineTotals.mismatch",
      params: { total: "gross / TTC" },
    }

    expect(extractLineTotalWarnings({ lineTotalWarnings: [message, 42, null, { key: 3 }] })).toEqual([
      message,
    ])
  })

  it("accepts a mix of both shapes, in their stored order", () => {
    const message = { key: "documents.messages.lineTotals.mismatch", params: {} }

    expect(extractLineTotalWarnings({ lineTotalWarnings: ["legacy", message] })).toEqual(["legacy", message])
  })

  it("returns nothing when the key is absent or not a list", () => {
    expect(extractLineTotalWarnings(undefined)).toEqual([])
    expect(extractLineTotalWarnings({})).toEqual([])
    expect(extractLineTotalWarnings({ lineTotalWarnings: "legacy" })).toEqual([])
  })
})

describe("<LineTotalWarnings> - the banner the reader actually sees", () => {
  it("shows a legacy bare-string warning rather than silently dropping it", () => {
    render(<LineTotalWarnings warnings={["Lines add up to 600.00 EUR, the invoice states 650.00 EUR."]} />)

    fireEvent.click(screen.getByTestId("document-line-total-warnings-help-trigger"))
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Lines add up to 600.00 EUR, the invoice states 650.00 EUR.",
    )
  })

  it("shows a current message object through the active language's catalog", () => {
    render(
      <LineTotalWarnings
        warnings={[{ key: "documents.messages.lineTotals.mismatch", params: { total: "gross / TTC" } }]}
      />,
    )

    fireEvent.click(screen.getByTestId("document-line-total-warnings-help-trigger"))
    expect(screen.getByRole("dialog")).toHaveTextContent("Line total mismatch (gross / TTC)")
  })
})
