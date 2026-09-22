import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import i18n from "i18next"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
import { toast } from "sonner"

const mockUseSession = vi.fn()
vi.mock("@/lib/auth", () => ({
  authClient: { useSession: () => mockUseSession() },
}))

import AccountPreferencesPage from "@/pages/(app)/account/preferences"
import { LANGUAGE_STORAGE_KEY } from "@/lib/i18n"

/** Same fetch-boundary mocking convention as `_danger.spec.tsx`/`_transfers.spec.tsx`. */
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
    if (!handler) throw new Error(`Unmocked fetch in test: ${key}`)
    const { status = 200, body } = handler(url, init)
    return jsonResponse(body, status)
  })
  vi.stubGlobal("fetch", fn)
  return fn
}

function mockSession(locale: string | null | undefined) {
  mockUseSession.mockReturnValue({
    data: { user: { id: "user-1", locale } },
    isPending: false,
    refetch: vi.fn().mockResolvedValue(undefined),
  })
}

describe("<AccountPreferencesPage> — server-side language persistence", () => {
  beforeEach(async () => {
    localStorage.clear()
    await i18n.changeLanguage("en")
    // The Radix `<Select>` positions itself through the Popper primitive (needs `ResizeObserver`,
    // absent from jsdom) and scrolls the active item into view on open (`scrollIntoView`, also
    // absent) — same stub as `client-upsert.spec.tsx`/`date-picker.spec.tsx` for the same reason.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    Element.prototype.scrollIntoView = vi.fn()
  })

  afterEach(async () => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    localStorage.clear()
    await i18n.changeLanguage("en")
  })

  it("applies the account's own locale on load, ahead of whatever this browser had stored", async () => {
    mockSession("fr")
    installFetchMock({})

    render(<AccountPreferencesPage />)

    await waitFor(() => expect(i18n.resolvedLanguage).toBe("fr"))
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("fr")
    // The Select itself reflects it — not just the underlying i18n instance.
    expect(screen.getByTestId("account-preferences-language-select")).toHaveTextContent("Français")
  })

  it("changing the language saves it server-side, in addition to localStorage", async () => {
    mockSession("en")
    let patchedBody: unknown
    const fetchMock = installFetchMock({
      "PATCH /api/auth-extended/preferences": (_url, init) => {
        patchedBody = init?.body ? JSON.parse(init.body as string) : undefined
        return { body: { success: true, locale: "fr" } }
      },
    })

    render(<AccountPreferencesPage />)

    fireEvent.click(screen.getByTestId("account-preferences-language-select"))
    fireEvent.click(await screen.findByTestId("account-preferences-language-option-fr"))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/auth-extended/preferences"),
        expect.objectContaining({ method: "PATCH" }),
      ),
    )
    expect(patchedBody).toEqual({ locale: "fr" })
    // The local switch never waited on the network round-trip.
    await waitFor(() => expect(i18n.resolvedLanguage).toBe("fr"))
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("fr")
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("a 400 (a beta UI language the render layer doesn't support yet) is not surfaced as an error", async () => {
    mockSession("en")
    installFetchMock({
      "PATCH /api/auth-extended/preferences": () => ({
        status: 400,
        body: { statusCode: 400, message: "locale must be one of en, fr, it, pl, de, pt, or null" },
      }),
    })

    render(<AccountPreferencesPage />)

    fireEvent.click(screen.getByTestId("account-preferences-language-select"))
    fireEvent.click(await screen.findByTestId("account-preferences-language-option-ar"))

    // The local UI language still changes — only the account-wide persistence was refused.
    await waitFor(() => expect(i18n.resolvedLanguage).toBe("ar"))
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("a genuine failure (not a 400) IS surfaced, since the account will not remember the change", async () => {
    mockSession("en")
    installFetchMock({
      "PATCH /api/auth-extended/preferences": () => ({
        status: 500,
        body: { statusCode: 500, message: "boom" },
      }),
    })

    render(<AccountPreferencesPage />)

    fireEvent.click(screen.getByTestId("account-preferences-language-select"))
    fireEvent.click(await screen.findByTestId("account-preferences-language-option-fr"))

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
  })
})
