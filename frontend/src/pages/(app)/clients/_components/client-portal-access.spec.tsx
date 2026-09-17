import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
import { toast } from "sonner"

// `@/hooks/queries` mocked wholesale — same convention as `share-link-dialog.spec.tsx`, which this
// dialog is deliberately built on the exact model of (see this file's own header comment).
vi.mock("@/hooks/queries", () => ({
  usePortalAccess: vi.fn(),
  useCreatePortalAccess: vi.fn(),
  useRevokePortalAccess: vi.fn(),
  useRevokeAllPortalAccess: vi.fn(),
  portalAccessKey: (clientId: string) => ["clients", clientId, "portal-access"],
}))

import {
  useCreatePortalAccess,
  usePortalAccess,
  useRevokeAllPortalAccess,
  useRevokePortalAccess,
} from "@/hooks/queries"
import type { Client } from "@/types"
import { ClientPortalAccessDialog } from "./client-portal-access"

const mockedUsePortalAccess = vi.mocked(usePortalAccess)
const mockedUseCreatePortalAccess = vi.mocked(useCreatePortalAccess)
const mockedUseRevokePortalAccess = vi.mocked(useRevokePortalAccess)
const mockedUseRevokeAllPortalAccess = vi.mocked(useRevokeAllPortalAccess)

const CLIENT = { id: "client-1", name: "Acme", contactEmail: "acme@example.com" } as Client

function renderDialog(mutateAsync: () => Promise<{ path: string; emailStatus: "sent" }>) {
  mockedUsePortalAccess.mockReturnValue({ data: [], isLoading: false } as never)
  mockedUseCreatePortalAccess.mockReturnValue({ mutateAsync, isPending: false } as never)
  mockedUseRevokePortalAccess.mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never)
  mockedUseRevokeAllPortalAccess.mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never)

  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <ClientPortalAccessDialog client={CLIENT} onOpenChange={() => {}} />
    </QueryClientProvider>,
  )
}

describe("<ClientPortalAccessDialog> — copy outcome", () => {
  const originalClipboard = navigator.clipboard
  const originalExecCommand = document.execCommand

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", { value: originalClipboard, configurable: true })
    document.execCommand = originalExecCommand
  })

  // Same regression as `share-link-dialog.spec.tsx`: a rejected clipboard write must never leave the
  // user believing the invite link was copied when it wasn't.
  it("shows an error toast, never the success one, when the copy fails", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    })
    document.execCommand = vi.fn().mockReturnValue(false)

    renderDialog(async () => ({ path: "/portal/token-abc", emailStatus: "sent" }))
    fireEvent.click(await screen.findByTestId("portal-access-create-button"))
    fireEvent.click(await screen.findByTestId("portal-access-copy-button"))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Couldn't copy the link — select it above and copy it manually.",
      ),
    )
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("shows the success toast once the copy actually lands", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    })

    renderDialog(async () => ({ path: "/portal/token-abc", emailStatus: "sent" }))
    fireEvent.click(await screen.findByTestId("portal-access-create-button"))
    fireEvent.click(await screen.findByTestId("portal-access-copy-button"))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Link copied to clipboard."))
    expect(toast.error).not.toHaveBeenCalled()
  })
})
