import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/hooks/queries", () => ({
  useBankStatementLines: vi.fn(),
  useReconcileBankStatementLine: vi.fn(),
}))

import { useBankStatementLines, useReconcileBankStatementLine } from "@/hooks/queries"
import type { StatementLinesView } from "@/types/bank-reconciliation"
import { StatementLines } from "./statement-lines"

const mockedUseBankStatementLines = vi.mocked(useBankStatementLines)
const mockedUseReconcileBankStatementLine = vi.mocked(useReconcileBankStatementLine)

function renderStatement(currency: string, amountMinor: number) {
  const view: StatementLinesView = {
    statement: { id: "statement-1", fileName: "statement.csv", currency } as StatementLinesView["statement"],
    candidates: [],
    lines: [
      {
        line: {
          id: "line-1",
          date: "2026-11-20T00:00:00.000Z",
          label: "Incoming transfer",
          amountMinor,
          status: "UNMATCHED",
        } as StatementLinesView["lines"][number]["line"],
        suggestions: [],
        reconciledInvoiceLabel: null,
      },
    ],
  }
  mockedUseBankStatementLines.mockReturnValue({ data: view, isLoading: false } as never)
  mockedUseReconcileBankStatementLine.mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never)

  return render(<StatementLines statementId="statement-1" />)
}

describe("<StatementLines> currency decimals", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("shows a zero-decimal currency's minor amount without dividing it", () => {
    renderStatement("JPY", 1234)

    expect(screen.getByText("1234 JPY")).toBeInTheDocument()
  })

  it("shows a two-decimal currency whose display metadata says otherwise with its stored decimals", () => {
    renderStatement("XPF", 1500)

    expect(screen.getByText("15.00 XPF")).toBeInTheDocument()
  })
})
