import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
import { toast } from "sonner"

import ApiKeysSettings from "@/pages/(app)/settings/_components/api-keys.settings"

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

async function renderWithCreatedKey() {
  installFetchMock({
    "GET /api/api-keys": () => ({ body: [] }),
    "GET /api/api-keys/options": () => ({ body: { scopes: [] } }),
    "POST /api/api-keys": () => ({ body: { key: "ivr_live_abcdef123456" } }),
  })

  render(<ApiKeysSettings />)
  fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "CLI on my laptop" } })
  fireEvent.click(screen.getByRole("button", { name: "Create API Key" }))

  // The created-key panel only exists once the create call resolves — its own Copy button is the
  // one and only "Copy" control on screen at that point.
  return screen.findByLabelText("Copy")
}

describe("<ApiKeysSettings> — copy outcome", () => {
  const originalClipboard = navigator.clipboard
  const originalExecCommand = document.execCommand

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", { value: originalClipboard, configurable: true })
    document.execCommand = originalExecCommand
  })

  // The regression this guards: `handleCopy` used to fire-and-forget `navigator.clipboard`'s `writeText`
  // with no toast at all — a rejection here was a silent no-op, indistinguishable from a real copy.
  // The key is shown only once (`createdKeyNotice`), so a silent failure meant it was gone for good.
  it("shows an error toast, never the success one, when the copy fails", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    })
    document.execCommand = vi.fn().mockReturnValue(false)

    const copyButton = await renderWithCreatedKey()
    fireEvent.click(copyButton)

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Couldn't copy — select the key above and copy it manually."),
    )
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("shows the success toast when the copy actually lands", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    })

    const copyButton = await renderWithCreatedKey()
    fireEvent.click(copyButton)

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Copied to clipboard"))
    expect(toast.error).not.toHaveBeenCalled()
  })
})
