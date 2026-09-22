import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DocumentTaxWarnings, DocumentTaxWarningsSection } from "./document-tax-warnings"

/**
 * What a seller actually SEES for a tax caveat the engine records — the whole point of the panel,
 * since the resolver had produced these strings for a while and no screen had ever printed one.
 *
 * The two warning texts below are not invented for this file: they are what the real backend engine
 * emits for the two situations it can hit today, copied verbatim from what
 * `backend/src/modules/documents/documents.service.tax-warnings.spec.ts` gets back out of
 * `resolveInvoiceCrossBorderTax` itself. Paraphrasing them here would make this suite pass against a
 * panel that renders something the server never sends.
 *
 * `@/hooks/queries` is mocked wholesale, not `fetch` — same reason (and same shape) as
 * `document-archive-section.spec.tsx`: this is about what the totals card shows for a given answer,
 * not about the query layer underneath it.
 */
vi.mock("@/hooks/queries", () => ({
  useDocumentTaxWarnings: vi.fn(),
}))

import { useDocumentTaxWarnings } from "@/hooks/queries"

const mockedUseDocumentTaxWarnings = vi.mocked(useDocumentTaxWarnings)

/** The buyer's VAT number could not be confirmed, so a BUSINESS sale was taxed as a CONSUMER sale —
 *  the warning that changes the tax outright. */
const UNCONFIRMED_VAT_WARNING =
  'Buyer VAT number "DE136695976" has not been confirmed valid yet (status: not checked) — ' +
  "treating this buyer as B2C until it is verified, never a silent B2B."

/** A reduced rate that could not be applied to a cross-border sale, so the line is OVER-taxed. */
const OSS_STANDARD_RATE_WARNING =
  "This invoice is an intra-Community distance sale taxed in DE (EU One-Stop-Shop, Directive " +
  "2006/112/EC art. 33(a)), so DE's STANDARD VAT rate (19%) was applied. DE's own reduced rates are " +
  "not modelled here and an invoice line carries nothing that says which products they cover — " +
  "check the destination rate yourself if what you are selling is reduced-rated there, or this " +
  "invoice over-charges the customer."

describe("<DocumentTaxWarnings> — what the seller reads next to the amounts", () => {
  it("prints the unconfirmed-VAT warning in full, so the reader learns the sale was taxed as B2C", () => {
    render(<DocumentTaxWarnings warnings={[UNCONFIRMED_VAT_WARNING]} />)

    expect(screen.getByTestId("document-tax-warnings")).toHaveTextContent("has not been confirmed valid yet")
    expect(screen.getByTestId("document-tax-warnings")).toHaveTextContent("treating this buyer as B2C")
  })

  it("prints the over-taxed-line warning in full, naming the rate that was applied", () => {
    render(<DocumentTaxWarnings warnings={[OSS_STANDARD_RATE_WARNING]} />)

    const panel = screen.getByTestId("document-tax-warnings")
    expect(panel).toHaveTextContent("STANDARD VAT rate (19%)")
    expect(panel).toHaveTextContent("over-charges the customer")
  })

  it("titles the panel so it reads as a note about the tax, never as a failed save", () => {
    render(<DocumentTaxWarnings warnings={[UNCONFIRMED_VAT_WARNING]} />)

    // The real i18n instance is loaded in `src/test/setup.ts`, so this is the actual English string
    // a user sees, not a key echoed back by a mocked `t`.
    expect(screen.getByTestId("document-tax-warnings")).toHaveTextContent("About this VAT treatment")
  })

  it("shows one line per warning when the engine records several", () => {
    render(<DocumentTaxWarnings warnings={[UNCONFIRMED_VAT_WARNING, OSS_STANDARD_RATE_WARNING]} />)

    expect(screen.getAllByTestId("document-tax-warning")).toHaveLength(2)
  })

  /** The silence half — the one a panel like this usually gets wrong. */
  it("renders NOTHING for a document with no caveat: no panel, no title, no empty state", () => {
    const { container } = render(<DocumentTaxWarnings warnings={[]} />)

    expect(screen.queryByTestId("document-tax-warnings")).not.toBeInTheDocument()
    expect(screen.queryByText("About this VAT treatment")).not.toBeInTheDocument()
    expect(container).toBeEmptyDOMElement()
  })
})

describe("<DocumentTaxWarningsSection> — the fetching half, wired to the endpoint", () => {
  afterEach(() => vi.resetAllMocks())

  function answer(warnings: string[] | undefined) {
    mockedUseDocumentTaxWarnings.mockReturnValue({
      data: warnings === undefined ? undefined : { warnings },
    } as ReturnType<typeof useDocumentTaxWarnings>)
  }

  it("asks for THIS document's warnings and renders what comes back", () => {
    answer([OSS_STANDARD_RATE_WARNING])
    render(<DocumentTaxWarningsSection typeId="invoice" documentId="doc-1" />)

    expect(mockedUseDocumentTaxWarnings).toHaveBeenCalledWith("invoice", "doc-1")
    expect(screen.getByTestId("document-tax-warnings")).toHaveTextContent("STANDARD VAT rate (19%)")
  })

  it("a document whose tax resolution produced no caveat leaves the totals card untouched", () => {
    answer([])
    const { container } = render(<DocumentTaxWarningsSection typeId="invoice" documentId="doc-1" />)

    expect(container).toBeEmptyDOMElement()
  })

  /** While the query is still in flight — and on a type the endpoint answers empty for — the card must
   *  look exactly as it does when there is nothing to warn about, never carry a placeholder. */
  it("renders nothing at all before the answer arrives", () => {
    answer(undefined)
    const { container } = render(<DocumentTaxWarningsSection typeId="quote" documentId="doc-2" />)

    expect(container).toBeEmptyDOMElement()
  })
})
