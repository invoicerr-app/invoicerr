import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ServerMessage } from "@/lib/server-message"
import { DocumentTaxWarnings, DocumentTaxWarningsSection } from "./document-tax-warnings"

// The messages are what the backend engine emits (documents.service.tax-warnings.spec.ts); the
// English text they render is the catalog the backend also uses for its PDF.
vi.mock("@/hooks/queries", () => ({
  useDocumentTaxWarnings: vi.fn(),
}))

import { useDocumentTaxWarnings } from "@/hooks/queries"

const mockedUseDocumentTaxWarnings = vi.mocked(useDocumentTaxWarnings)

const UNCONFIRMED_VAT_WARNING = {
  key: "documents.messages.tax.buyerVatUnverified",
  params: { vatNumber: "DE136695976", status: "not checked" },
}

const OSS_STANDARD_RATE_WARNING = {
  key: "documents.messages.tax.ossStandardRate",
  params: { country: "DE", rate: 19 },
}

describe("<DocumentTaxWarnings>: what the seller reads next to the amounts", () => {
  it("shows a one-line warning status, the explanation stays behind its help button", () => {
    render(<DocumentTaxWarnings warnings={[UNCONFIRMED_VAT_WARNING]} />)

    const status = screen.getByTestId("document-tax-warnings")
    expect(status).toHaveClass("bg-warning")
    expect(screen.getByText("Check how VAT was applied")).toBeVisible()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("opens the unconfirmed-VAT warning in full, so the reader learns the sale was taxed as B2C", () => {
    render(<DocumentTaxWarnings warnings={[UNCONFIRMED_VAT_WARNING]} />)
    fireEvent.click(screen.getByTestId("document-tax-warnings-help-trigger"))

    expect(screen.getByRole("dialog")).toHaveTextContent("has not been confirmed valid yet")
    expect(screen.getByRole("dialog")).toHaveTextContent("treated as B2C")
  })

  it("opens every warning when the engine records several", () => {
    render(<DocumentTaxWarnings warnings={[UNCONFIRMED_VAT_WARNING, OSS_STANDARD_RATE_WARNING]} />)
    fireEvent.click(screen.getByTestId("document-tax-warnings-help-trigger"))

    const popover = screen.getByRole("dialog")
    expect(popover).toHaveTextContent("STANDARD VAT rate (19%)")
    expect(popover).toHaveTextContent("over-charges the customer")
    expect(popover).toHaveTextContent("has not been confirmed valid yet")
  })

  it("renders NOTHING for a document with no caveat: no panel, no title, no empty state", () => {
    const { container } = render(<DocumentTaxWarnings warnings={[]} />)

    expect(screen.queryByTestId("document-tax-warnings")).not.toBeInTheDocument()
    expect(screen.queryByText("Check how VAT was applied")).not.toBeInTheDocument()
    expect(container).toBeEmptyDOMElement()
  })
})

describe("<DocumentTaxWarningsSection>: the fetching half, wired to the endpoint", () => {
  afterEach(() => vi.resetAllMocks())

  function answer(warnings: ServerMessage[] | undefined) {
    mockedUseDocumentTaxWarnings.mockReturnValue({
      data: warnings === undefined ? undefined : { warnings },
    } as ReturnType<typeof useDocumentTaxWarnings>)
  }

  it("asks for THIS document's warnings and renders what comes back", () => {
    answer([OSS_STANDARD_RATE_WARNING])
    render(<DocumentTaxWarningsSection typeId="invoice" documentId="doc-1" />)

    expect(mockedUseDocumentTaxWarnings).toHaveBeenCalledWith("invoice", "doc-1")
    fireEvent.click(screen.getByTestId("document-tax-warnings-help-trigger"))
    expect(screen.getByRole("dialog")).toHaveTextContent("STANDARD VAT rate (19%)")
  })

  it("a document whose tax resolution produced no caveat leaves the totals card untouched", () => {
    answer([])
    const { container } = render(<DocumentTaxWarningsSection typeId="invoice" documentId="doc-1" />)

    expect(container).toBeEmptyDOMElement()
  })

  it("renders nothing at all before the answer arrives", () => {
    answer(undefined)
    const { container } = render(<DocumentTaxWarningsSection typeId="quote" documentId="doc-2" />)

    expect(container).toBeEmptyDOMElement()
  })
})
