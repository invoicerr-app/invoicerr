import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { DocumentArchiveSection, isRetentionCalcStale } from "./document-archive-section"
import type { DocumentArchive } from "./types"

/**
 * `retentionCalcVersion` is the discriminator that addresses "les archives déjà écrites gardent
 * une date de conservation trop précoce" (2026-09-13): NULL on any row written before
 * the backend started recording which version of `compute-retention.ts` produced it — which INCLUDES
 * every row from before the origin-axis fix (`cf2e7323`) that counted every duration from the
 * archiving instant instead of the statute's own origin (up to a year too EARLY). `retentionBasis`'s
 * own TEXT was checked first and found NOT reliably distinguishable between the two algorithms (see
 * the backend's `archive/retention/calc-version.ts` for the byte-for-byte comparison) — this column,
 * and the pure predicate below, are what the UI actually keys its warning off of.
 *
 * `@/hooks/queries` is mocked wholesale (not `fetch`) — this suite is about what
 * `DocumentArchiveSection` renders for a given archive shape, not about the query layer underneath
 * it, and `useVerifyDocumentArchive` is a mutation this component always calls regardless of the
 * scenario under test.
 */
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
    retentionCalcVersion: 1,
    ...overrides,
  }
}

describe("isRetentionCalcStale — pure", () => {
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

describe("<DocumentArchiveSection> — real render", () => {
  beforeEach(() => {
    mockedUseVerifyDocumentArchive.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      data: undefined,
    } as unknown as ReturnType<typeof useVerifyDocumentArchive>)
  })

  it("shows the stale notice for an archive computed by the OLD (pre-cf2e7323) code", () => {
    mockedUseDocumentArchives.mockReturnValue({
      data: [archive({ id: "old-archive", retentionCalcVersion: null })],
      isLoading: false,
    } as unknown as ReturnType<typeof useDocumentArchives>)

    render(<DocumentArchiveSection typeId="invoice" documentId="doc-1" />)

    // Never asserted against a locale-formatted date string (see `document-conformity-section.spec.tsx`
    // for the same convention) — jsdom's date formatting depends on the runner's own locale/timezone.
    expect(screen.getByTestId("document-archive-retention-stale")).toHaveTextContent(
      "This date was calculated by an earlier version",
    )
  })

  it("shows NO stale notice for an archive computed by the current, version-tracked code", () => {
    mockedUseDocumentArchives.mockReturnValue({
      data: [archive({ id: "new-archive", retentionCalcVersion: 1 })],
      isLoading: false,
    } as unknown as ReturnType<typeof useDocumentArchives>)

    render(<DocumentArchiveSection typeId="invoice" documentId="doc-1" />)

    // The ordinary retention line is still shown — only the warning is gated on the discriminator.
    expect(screen.getByTestId("document-archive-retention")).toHaveTextContent("VAT 5y")
    expect(screen.queryByTestId("document-archive-retention-stale")).not.toBeInTheDocument()
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
