import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
import { toast } from "sonner"

// `@/hooks/queries` mocked wholesale, same convention as `document-archive-section.spec.tsx` — this
// suite is about what the dialog does with a mutation's result, not about the query layer underneath.
vi.mock("@/hooks/queries", () => ({
  useShareLinks: vi.fn(),
  useCreateShareLink: vi.fn(),
  useRevokeShareLink: vi.fn(),
  shareLinksKey: (typeId: string, documentId: string) => ["documents", typeId, documentId, "share-links"],
}))

import { useCreateShareLink, useRevokeShareLink, useShareLinks } from "@/hooks/queries"
import { ShareLinkDialog } from "./share-link-dialog"

const mockedUseShareLinks = vi.mocked(useShareLinks)
const mockedUseCreateShareLink = vi.mocked(useCreateShareLink)
const mockedUseRevokeShareLink = vi.mocked(useRevokeShareLink)

function renderDialog(mutateAsync: () => Promise<{ path: string }>) {
  mockedUseShareLinks.mockReturnValue({ data: [], isLoading: false } as never)
  mockedUseCreateShareLink.mockReturnValue({ mutateAsync, isPending: false } as never)
  mockedUseRevokeShareLink.mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never)

  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <ShareLinkDialog typeId="invoice" documentId="doc-1" open onOpenChange={() => {}} />
    </QueryClientProvider>,
  )
}

describe("<ShareLinkDialog> — copy outcome", () => {
  const originalClipboard = navigator.clipboard
  const originalExecCommand = document.execCommand

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", { value: originalClipboard, configurable: true })
    document.execCommand = originalExecCommand
  })

  it("shows the success toast once a link is created and the copy actually lands", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    })

    renderDialog(async () => ({ path: "/api/documents/public/token-abc" }))
    fireEvent.click(await screen.findByTestId("share-link-create-button"))
    fireEvent.click(await screen.findByTestId("share-link-copy-button"))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Link copied to clipboard."))
    expect(toast.error).not.toHaveBeenCalled()
  })

  // The regression this guards: a rejected clipboard write (no permission, no focus, no secure
  // context) used to throw past an un-awaited `writeText` — silently or as an uncaught rejection —
  // while the toast still claimed success. Both the async API AND the execCommand fallback are made
  // to fail here so the assertion is about the toast shown, not about which path was tried.
  it("shows an error toast, never the success one, when the copy fails", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    })
    document.execCommand = vi.fn().mockReturnValue(false)

    renderDialog(async () => ({ path: "/api/documents/public/token-abc" }))
    fireEvent.click(await screen.findByTestId("share-link-create-button"))
    fireEvent.click(await screen.findByTestId("share-link-copy-button"))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Couldn't copy the link — select it above and copy it manually.",
      ),
    )
    expect(toast.success).not.toHaveBeenCalled()
    // The link itself is untouched by the failed copy — still there, still selectable by hand.
    const input = screen.getByTestId("share-link-created-url") as HTMLInputElement
    expect(input.value.endsWith("/api/documents/public/token-abc")).toBe(true)
  })
})
