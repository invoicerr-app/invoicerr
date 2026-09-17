import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
import { toast } from "sonner"

vi.mock("@/lib/auth", () => ({ authClient: { useSession: vi.fn() } }))
import { authClient } from "@/lib/auth"

import DangerZoneSettings from "@/pages/(app)/settings/_components/danger.settings"

/** Same fetch-boundary mocking convention as `client-upsert.spec.tsx` — the hook under test here
 *  (`usePost`, `@/hooks/use-fetch`) goes through the SAME global `fetch`, so intercepting it (rather
 *  than the hook itself) is what actually proves where the OTP travels on the wire. */
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

const SESSION = {
  companies: [{ id: "company-1", name: "Acme Corp" }],
  activeCompanyId: "company-1",
  activeRole: "OWNER",
}

function renderScreen() {
  return render(
    <MemoryRouter>
      <DangerZoneSettings />
    </MemoryRouter>,
  )
}

/** Opens the OTP modal for the "reset app data" action and fills both fields the confirm button
 *  requires — the fixed `RESET` keyword (the "all"/database action instead asks for the company's
 *  own name, unrelated to what this file tests). */
async function openModalAndFillForm() {
  fireEvent.click(await screen.findByTestId("danger-reset-app-button"))
  await screen.findByTestId("danger-otp-input")
  fireEvent.change(screen.getByTestId("danger-otp-input"), { target: { value: "12345678" } })
  fireEvent.change(screen.getByTestId("danger-confirm-input"), { target: { value: "RESET" } })
}

describe("<DangerZoneSettings> — OTP transport", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authClient.useSession).mockReturnValue({ data: SESSION, isPending: false } as never)
  })

  it("confirms a reset with the OTP in the request BODY, never in the URL", async () => {
    let capturedUrl: URL | undefined
    let capturedBody: unknown
    installFetchMock({
      "POST /api/danger/otp": () => ({ body: { message: "OTP sent successfully" } }),
      "POST /api/danger/reset/app": (url, init) => {
        capturedUrl = url
        capturedBody = init?.body ? JSON.parse(init.body as string) : undefined
        return { body: { message: "Application reset successfully" } }
      },
    })

    renderScreen()
    await openModalAndFillForm()
    fireEvent.click(screen.getByTestId("danger-modal-confirm"))

    await waitFor(() => expect(capturedBody).toEqual({ otp: "1234-5678" }))
    // The exact regression this proves: no `?otp=...` (or anything else) in the query string — a
    // confirmation code is a bearer secret for the duration of its own window, and a query string
    // lands in nginx access logs and browser history the same way a password would.
    expect(capturedUrl?.search).toBe("")
  })

  it("shows a translated, distinct message once the backend reports this company permanently locked out", async () => {
    installFetchMock({
      "POST /api/danger/otp": () => ({
        status: 400,
        body: {
          statusCode: 400,
          message:
            "Too many failed attempts. This action is locked for this company and can no longer be confirmed by OTP.",
          error: "Bad Request",
        },
      }),
    })

    renderScreen()
    fireEvent.click(await screen.findByTestId("danger-reset-app-button"))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Locked out", {
        description:
          "Too many failed attempts. This action is locked for your company and can no longer be confirmed by a one-time code.",
      }),
    )
    // Not the generic fallback path — the raw, untranslated backend string never reaches the toast.
    expect(toast.error).not.toHaveBeenCalledWith("Failed to send verification code", expect.anything())
  })
})
