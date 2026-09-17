import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
import { toast } from "sonner"

import { WebhookInstructionsModal } from "./webhook-instructions-modal"

function renderModal() {
  return render(
    <WebhookInstructionsModal
      open
      onOpenChange={() => {}}
      pluginName="Documenso"
      webhookUrl="https://app.example.com/webhooks/documenso"
      webhookSecret="whsec_abcdef123456"
      instructions={["webhook.instructions.documenso.title"]}
    />,
  )
}

describe("<WebhookInstructionsModal> — copy outcome", () => {
  const originalClipboard = navigator.clipboard
  const originalExecCommand = document.execCommand

  beforeEach(() => {
    vi.clearAllMocks()
    // jsdom has no ResizeObserver — the copy buttons render inside a `tooltip` prop (`Button`'s own
    // Radix `Tooltip`), whose Popper positioning needs one to exist to mount at all, same stub as
    // `office-svg.spec.tsx`.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
  })

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", { value: originalClipboard, configurable: true })
    document.execCommand = originalExecCommand
  })

  // The regression this guards: both copy handlers already had a try/catch, but relied solely on
  // `navigator.clipboard` — unavailable outside a secure context — with no fallback. A rejection used
  // to skip straight to the error toast even where the `execCommand` fallback would have succeeded,
  // and the "copied" checkmark must never flip on for a copy that never landed.
  it("shows an error toast, never the success one, when copying the URL fails", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    })
    document.execCommand = vi.fn().mockReturnValue(false)

    renderModal()
    fireEvent.click(screen.getByLabelText("Copy webhook URL"))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Couldn't copy the webhook URL — copy it manually instead."),
    )
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("shows the success toast when copying the URL actually lands", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    })

    renderModal()
    fireEvent.click(screen.getByLabelText("Copy webhook URL"))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Webhook URL copied to clipboard!"))
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("shows an error toast, never the success one, when copying the secret fails", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    })
    document.execCommand = vi.fn().mockReturnValue(false)

    renderModal()
    fireEvent.click(screen.getByLabelText("Copy webhook secret"))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Couldn't copy the webhook secret — copy it manually instead.",
      ),
    )
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("shows the success toast when copying the secret actually lands", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    })

    renderModal()
    fireEvent.click(screen.getByLabelText("Copy webhook secret"))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Webhook secret copied to clipboard!"))
    expect(toast.error).not.toHaveBeenCalled()
  })
})
