import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
import { toast } from "sonner"

vi.mock("@/lib/after-company-gone", () => ({ afterCompanyGone: vi.fn() }))
import { afterCompanyGone } from "@/lib/after-company-gone"

vi.mock("@/lib/auth", () => ({
  authClient: {
    useSession: vi.fn(),
    listAccounts: vi.fn().mockResolvedValue({ data: [] }),
    deleteUser: vi.fn(),
  },
}))
import { authClient } from "@/lib/auth"

import AccountDangerPage from "@/pages/(app)/account/danger"

/** Same fetch-boundary mocking convention as `danger.settings.spec.tsx` — `useDelete`
 *  (`@/hooks/use-fetch`) goes through the global `fetch`. */
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

function mockSession(
  companies: { id: string; name: string; role: string }[],
  activeCompanyId: string | null,
) {
  vi.mocked(authClient.useSession).mockReturnValue({
    data: { user: { id: "user-1" }, companies, activeCompanyId, activeRole: "OWNER" },
    isPending: false,
    refetch: vi.fn().mockResolvedValue(undefined),
  } as never)
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AccountDangerPage />
    </MemoryRouter>,
  )
}

describe("<AccountDangerPage> — leave company", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("is not shown at all when the caller has no active company", () => {
    mockSession([], null)
    installFetchMock({})

    renderPage()

    expect(screen.queryByTestId("account-leave-company-card")).not.toBeInTheDocument()
  })

  it("names the active company, confirms, calls DELETE /api/companies/leave, then hands off to afterCompanyGone", async () => {
    mockSession(
      [
        { id: "company-1", name: "Acme Corp", role: "OWNER" },
        { id: "company-2", name: "Solo Co", role: "OWNER" },
      ],
      "company-1",
    )
    let leaveCalled = false
    installFetchMock({
      "DELETE /api/companies/leave": () => {
        leaveCalled = true
        return { body: { success: true } }
      },
    })

    renderPage()

    expect(await screen.findByTestId("account-leave-company-card")).toHaveTextContent("Acme Corp")
    fireEvent.click(screen.getByTestId("account-leave-company-button"))
    expect(await screen.findByTestId("account-leave-company-confirm")).toBeInTheDocument()

    fireEvent.click(screen.getByTestId("account-leave-company-confirm"))

    await waitFor(() => expect(leaveCalled).toBe(true))
    await waitFor(() => expect(afterCompanyGone).toHaveBeenCalled())
    expect(toast.success).toHaveBeenCalled()
  })

  it("surfaces the backend's last-owner refusal with a link to ownership transfer, instead of navigating away", async () => {
    mockSession([{ id: "company-1", name: "Acme Corp", role: "OWNER" }], "company-1")
    installFetchMock({
      "DELETE /api/companies/leave": () => ({
        status: 400,
        body: {
          statusCode: 400,
          message: "You are the last owner of this company.",
          code: "LAST_OWNER_CANNOT_LEAVE",
        },
      }),
    })

    renderPage()

    fireEvent.click(await screen.findByTestId("account-leave-company-button"))
    fireEvent.click(await screen.findByTestId("account-leave-company-confirm"))

    expect(await screen.findByTestId("account-leave-company-sole-owner-notice")).toBeInTheDocument()
    expect(screen.getByTestId("account-leave-company-sole-owner-notice")).toHaveTextContent(
      /transfer ownership/i,
    )
    expect(afterCompanyGone).not.toHaveBeenCalled()
  })
})
