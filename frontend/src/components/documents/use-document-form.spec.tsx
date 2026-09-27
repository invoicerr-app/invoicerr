import { render, screen, fireEvent } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { Form } from "@/components/ui/form"
import { DocumentFormFields } from "@/components/documents/document-form"
import { useDocumentForm } from "@/components/documents/use-document-form"
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
  useReferenceFields: vi.fn(),
  useRunDocumentAction: vi.fn(),
  useResolveActionParamsDefaults: vi.fn(),
}))

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

    const { rerender } = render(<Harness descriptor={pageDescriptor} />)

    fireEvent.click(screen.getByTestId("document-field-issueDate-input"))
    expect(screen.getByTestId("date-picker-today")).toBeInTheDocument()

    // The refetch "lands": a brand-new descriptor object, structurally identical to the one already
    // rendered (same field keys, same everything) — the only thing that changed is its IDENTITY.
    mockedUseDocumentType.mockReturnValue({ data: makeDescriptor() } as never)
    rerender(<Harness descriptor={pageDescriptor} />)

    // The popover must still be open: nothing about what this field IS actually changed.
    expect(screen.getByTestId("date-picker-today")).toBeInTheDocument()
  })
})
