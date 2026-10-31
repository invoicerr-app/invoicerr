import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { DocumentArchiveSection, isRetentionCalcStale } from "./document-archive-section"
import type { DocumentArchive } from "./types"

// `retentionCalcVersion` is null on rows written before the retention origin fix; those dates can be too early.
vi.mock("@/hooks/queries", () => ({
  useDocumentArchives: vi.fn(),
  useVerifyDocumentArchive: vi.fn(),
}))

import { useDocumentArchives, useVerifyDocumentArchive } from "@/hooks/queries"

const mockedUseDocumentArchives = vi.mocked(useDocumentArchives)
const mockedUseVerifyDocumentArchive = vi.mocked(useVerifyDocumentArchive)

function archive(overrides: Partial<DocumentArchive> = {}): DocumentArchive {
  return {
    id: "archive-1",
    contentHash: "abc123def456abc123def456",
    uri: "file:///wherever",
    artifacts: [],
    archivedAt: "2026-09-01T00:00:00.000Z",
    retentionUntil: "2032-12-31T00:00:00.000Z",
    retentionBasis: "VAT 5y (ustawa o VAT art. 112).",
    retentionBasisMessage: null,
    retentionCalcVersion: 1,
    ...overrides,
  }
}

describe("isRetentionCalcStale", () => {
  it("flags an archive written by the OLD code — no retentionCalcVersion was ever recorded for it", () => {
    expect(isRetentionCalcStale(archive({ retentionCalcVersion: null }))).toBe(true)
  })

  it("does NOT flag an archive written by the NEW, version-tracked code", () => {
    expect(isRetentionCalcStale(archive({ retentionCalcVersion: 1 }))).toBe(false)
  })

  it("never flags a country with no declared retention rule at all — nothing to be too early about", () => {
    expect(isRetentionCalcStale(archive({ retentionUntil: null, retentionCalcVersion: null }))).toBe(false)
  })
})

describe("<DocumentArchiveSection>", () => {
  beforeEach(() => {
    mockedUseVerifyDocumentArchive.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      data: undefined,
    } as unknown as ReturnType<typeof useVerifyDocumentArchive>)
  })

  it("shows a one-line stale status for an archive computed by the OLD code, the reason behind its help", () => {
    mockedUseDocumentArchives.mockReturnValue({
      data: [archive({ id: "old-archive", retentionCalcVersion: null })],
      isLoading: false,
    } as unknown as ReturnType<typeof useDocumentArchives>)

    render(<DocumentArchiveSection typeId="invoice" documentId="doc-1" />)

    const status = screen.getByTestId("document-archive-retention-stale")
    expect(status).toHaveClass("bg-warning")
    expect(screen.getByText("This date may be too early")).toBeVisible()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId("document-archive-retention-stale-help-trigger"))
    expect(screen.getByRole("dialog")).toHaveTextContent("This date was calculated by an earlier version")
  })

  it("shows the retention date as a title and its legal basis only behind the help button", () => {
    mockedUseDocumentArchives.mockReturnValue({
      data: [archive({ id: "new-archive", retentionCalcVersion: 1 })],
      isLoading: false,
    } as unknown as ReturnType<typeof useDocumentArchives>)

    render(<DocumentArchiveSection typeId="invoice" documentId="doc-1" />)

    expect(screen.getByText(/^Retain until /)).toBeVisible()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId("document-archive-retention-help-trigger"))
    expect(screen.getByRole("dialog")).toHaveTextContent("VAT 5y (ustawa o VAT art. 112).")
    expect(screen.queryByTestId("document-archive-retention-stale")).not.toBeInTheDocument()
  })

  it("says no duration applies when no rule is declared, with the reason behind the help button", () => {
    mockedUseDocumentArchives.mockReturnValue({
      data: [
        archive({
          id: "no-rule-archive",
          retentionUntil: null,
          retentionBasis: "No retention rule declared for this country, so no duration is invented.",
        }),
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useDocumentArchives>)

    render(<DocumentArchiveSection typeId="invoice" documentId="doc-1" />)

    expect(screen.getByText("No retention duration applies")).toBeVisible()
    fireEvent.click(screen.getByTestId("document-archive-retention-help-trigger"))
    expect(screen.getByRole("dialog")).toHaveTextContent("No retention rule declared for this country")
  })

  it("shows NO stale notice for a country with no declared retention rule, even with no calc version", () => {
    mockedUseDocumentArchives.mockReturnValue({
      data: [archive({ id: "no-rule-archive", retentionUntil: null, retentionCalcVersion: null })],
      isLoading: false,
    } as unknown as ReturnType<typeof useDocumentArchives>)

    render(<DocumentArchiveSection typeId="invoice" documentId="doc-1" />)

    expect(screen.queryByTestId("document-archive-retention-stale")).not.toBeInTheDocument()
  })
})
