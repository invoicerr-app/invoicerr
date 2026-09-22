import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
import { toast } from "sonner"

vi.mock("@/hooks/queries", () => ({ useCompanies: vi.fn() }))
import { useCompanies } from "@/hooks/queries"

import DataExportSettings from "@/pages/(app)/settings/_components/data-export.settings"

/** Same fetch-boundary mocking convention as `api-keys.settings.spec.tsx`/`danger.settings.spec.tsx`,
 *  extended with `blob()` — the 200 (small export) path streams the body back as a zip, never JSON. */
function fakeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    blob: async () => new Blob([JSON.stringify(body)], { type: "application/zip" }),
  } as unknown as Response
}

describe("<DataExportSettings>", () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal("fetch", fetchMock)
    // `URL.createObjectURL`/`revokeObjectURL` are not implemented in jsdom — the download branch
    // (200, small export) calls both, so they need a stand-in or the test throws before it can even
    // reach the toast it is actually asserting on.
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:fake"), revokeObjectURL: vi.fn() })
    vi.mocked(useCompanies).mockReturnValue({ activeRole: "OWNER" } as ReturnType<typeof useCompanies>)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("hides the export button for a MEMBER and shows the notice instead", () => {
    vi.mocked(useCompanies).mockReturnValue({ activeRole: "MEMBER" } as ReturnType<typeof useCompanies>)
    render(<DataExportSettings />)

    // The card TITLE reuses the same wording as the button label, so this checks the ROLE specifically
    // — a MEMBER sees the section (it explains what the feature is) but never the button that fires it.
    expect(screen.queryByRole("button", { name: "Export all my data" })).not.toBeInTheDocument()
    expect(screen.getByText(/only the company's owner or an admin/i)).toBeInTheDocument()
  })

  it("downloads the zip directly and confirms it when the export is small (200)", async () => {
    fetchMock.mockResolvedValue(fakeResponse(200, {}))
    render(<DataExportSettings />)

    fireEvent.click(screen.getByRole("button", { name: "Export all my data" }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Your export has downloaded."))
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/companies/export"),
      expect.objectContaining({ method: "POST" }),
    )
  })

  it("reports the export was emailed instead when it was too large (202)", async () => {
    fetchMock.mockResolvedValue(
      fakeResponse(202, {
        message: "Your export was too large to download directly — it was emailed to you.",
      }),
    )
    render(<DataExportSettings />)

    fireEvent.click(screen.getByRole("button", { name: "Export all my data" }))

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Your export was too large to download directly — it was emailed to you.",
      ),
    )
  })

  it("surfaces the rate-limit message verbatim on 429, never a generic failure", async () => {
    fetchMock.mockResolvedValue(
      fakeResponse(429, { message: "You can only export your company's full data once every 15 minutes." }),
    )
    render(<DataExportSettings />)

    fireEvent.click(screen.getByRole("button", { name: "Export all my data" }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "You can only export your company's full data once every 15 minutes.",
      ),
    )
  })
})
