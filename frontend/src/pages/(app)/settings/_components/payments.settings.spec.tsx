import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
import { toast } from "sonner"

// Only `useCompanies` is exercised here (for `activeCompanyId`, which feeds the webhook URL) — the
// rest of this screen's data comes through `@/hooks/use-fetch`'s `useGet`, mocked via `fetch` below.
vi.mock("@/hooks/queries", () => ({
  useCompanies: () => ({ activeCompanyId: "company-1" }),
}))

import PaymentsSettings from "@/pages/(app)/settings/_components/payments.settings"

/** Same fetch-boundary mocking convention as `danger.settings.spec.tsx`. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    clone() {
      return this as Response
    },
  } as Response
}

type FetchHandler = (url: URL, init?: RequestInit) => { status?: number; body: unknown }

function installFetchMock(handlers: Record<string, FetchHandler>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input.toString()
    const url = new URL(raw, "http://localhost")
    const method = (init?.method ?? "GET").toUpperCase()
    const key = `${method} ${url.pathname}`
    const handler = handlers[key]
    if (!handler) throw new Error(`Unmocked fetch in test: ${key}${url.search}`)
    const { status = 200, body } = handler(url, init)
    return jsonResponse(body, status)
  })
  vi.stubGlobal("fetch", fn)
  return fn
}

describe("<PaymentsSettings> — copy outcome", () => {
  const originalClipboard = navigator.clipboard
  const originalExecCommand = document.execCommand

  beforeEach(() => {
    vi.clearAllMocks()
    // No provider connected yet: `<ActiveProviderSelector>` renders nothing, and Stripe's own
    // webhook-URL block is the target — it shows regardless of the connect form's editing state.
    installFetchMock({
      "GET /api/company/channels": () => ({ body: { configured: [] } }),
      "GET /api/company/info": () => ({ body: {} }),
    })
  })

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", { value: originalClipboard, configurable: true })
    document.execCommand = originalExecCommand
  })

  // The regression this guards: a rejected clipboard write (no permission, no focus, no secure
  // context) used to throw past an un-awaited `writeText` instead of resolving to a known outcome —
  // the webhook URL stays readable in its input either way, so a failed copy only downgrades the toast.
  it("shows an error toast, never the success one, when the copy fails", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    })
    document.execCommand = vi.fn().mockReturnValue(false)

    render(<PaymentsSettings />)
    fireEvent.click(await screen.findByTestId("payment-webhook-url-stripe-copy-button"))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Couldn't copy — select the URL above and copy it manually."),
    )
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("shows the success toast when the copy actually lands", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    })

    render(<PaymentsSettings />)
    fireEvent.click(await screen.findByTestId("payment-webhook-url-stripe-copy-button"))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Copied to clipboard"))
    expect(toast.error).not.toHaveBeenCalled()
  })
})
