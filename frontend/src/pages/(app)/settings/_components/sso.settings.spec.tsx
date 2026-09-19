import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
import { toast } from "sonner"

import SsoSettings from "@/pages/(app)/settings/_components/sso.settings"

/** Same fetch-boundary mocking convention as `danger.settings.spec.tsx` — `useGet` (`@/hooks/use-fetch`)
 *  goes through the same global `fetch`. */
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

describe("<SsoSettings> — copy outcome", () => {
  const originalClipboard = navigator.clipboard
  const originalExecCommand = document.execCommand

  beforeEach(() => {
    vi.clearAllMocks()
    // No provider configured: the redirect URI is the only copy button on screen, so it can be
    // targeted by its (translated, otherwise ambiguous) "Copy" label alone.
    installFetchMock({
      "GET /api/company/sso": () => ({
        body: { provider: null, redirectUri: "https://app.example.com/callback/c_1" },
      }),
    })
  })

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", { value: originalClipboard, configurable: true })
    document.execCommand = originalExecCommand
  })

  // The regression this guards: a rejected clipboard write (no permission, no focus, no secure
  // context) used to throw past an un-awaited `writeText` instead of resolving to a known outcome —
  // the redirect URI stays readable in its input either way, so a failed copy only downgrades the toast.
  it("shows an error toast, never the success one, when the copy fails", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    })
    document.execCommand = vi.fn().mockReturnValue(false)

    render(<SsoSettings />)
    fireEvent.click(await screen.findByLabelText("Copy"))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Couldn't copy — select the value above and copy it manually.",
      ),
    )
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("shows the success toast when the copy actually lands", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    })

    render(<SsoSettings />)
    fireEvent.click(await screen.findByLabelText("Copy"))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Copied to clipboard"))
    expect(toast.error).not.toHaveBeenCalled()
  })
})
