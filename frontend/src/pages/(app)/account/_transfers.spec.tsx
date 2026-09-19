import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router"
import { describe, expect, it, vi } from "vitest"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
import { toast } from "sonner"

const refetchSession = vi.fn().mockResolvedValue(undefined)
vi.mock("@/lib/auth", () => ({
  authClient: {
    useSession: () => ({ data: { user: { id: "user-1" } }, isPending: false, refetch: refetchSession }),
  },
}))

import AccountTransfersPage from "./transfers"

/** Same fetch-boundary mocking convention as `danger.settings.spec.tsx`/`legal/_accept.spec.tsx`. */
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

const PENDING_TRANSFER = {
  id: "transfer-1",
  companyId: "company-1",
  companyName: "Acme Corp",
  status: "PENDING",
  toEmail: "me@example.com",
  fromUserId: "owner-1",
  fromName: "Ada Owner",
  fromEmail: "ada@example.com",
  expiresAt: "2026-09-24T00:00:00.000Z",
  createdAt: "2026-09-17T00:00:00.000Z",
  acceptedAt: null,
  canceledAt: null,
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/account/transfers"]}>
        <Routes>
          <Route path="/account/transfers" element={<AccountTransfersPage />} />
          <Route path="/legal/accept" element={<div data-cy="legal-accept-stub" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe("<AccountTransfersPage> — empty state", () => {
  it("shows the empty state when nothing is addressed to this account", async () => {
    installFetchMock({ "GET /api/account/transfers": () => ({ body: [] }) })

    renderPage()

    expect(await screen.findByTestId("account-transfers-empty")).toBeInTheDocument()
  })
})

describe("<AccountTransfersPage> — accepting", () => {
  it("asks for confirmation, then accepts, refreshes the session, and shows the company name", async () => {
    let accepted = false
    installFetchMock({
      "GET /api/account/transfers": () => ({ body: [PENDING_TRANSFER] }),
      "POST /api/account/transfers/transfer-1/accept": () => {
        accepted = true
        return { body: { success: true } }
      },
    })

    renderPage()

    fireEvent.click(await screen.findByTestId("account-transfer-accept-transfer-1"))
    fireEvent.click(await screen.findByTestId("account-transfer-confirm-confirm"))

    await waitFor(() => expect(accepted).toBe(true))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('You are now the owner of "Acme Corp"'))
    await waitFor(() => expect(refetchSession).toHaveBeenCalled())
  })

  it("sends a caller stuck behind a pending legal re-acceptance to /legal/accept, never a generic error", async () => {
    installFetchMock({
      "GET /api/account/transfers": () => ({ body: [PENDING_TRANSFER] }),
      "POST /api/account/transfers/transfer-1/accept": () => ({
        status: 403,
        body: {
          message: "You must accept the latest legal documents before continuing.",
          code: "LEGAL_ACCEPTANCE_REQUIRED",
        },
      }),
    })

    renderPage()

    fireEvent.click(await screen.findByTestId("account-transfer-accept-transfer-1"))
    fireEvent.click(await screen.findByTestId("account-transfer-confirm-confirm"))

    expect(await screen.findByTestId("legal-accept-stub")).toBeInTheDocument()
    // Not the generic fallback — the caller was routed to fix the real problem, not just told "failed".
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("surfaces a real refusal (e.g. already expired) as a plain error toast, without navigating anywhere", async () => {
    installFetchMock({
      "GET /api/account/transfers": () => ({ body: [PENDING_TRANSFER] }),
      "POST /api/account/transfers/transfer-1/accept": () => ({
        status: 410,
        body: { message: "This transfer request has expired" },
      }),
    })

    renderPage()

    fireEvent.click(await screen.findByTestId("account-transfer-accept-transfer-1"))
    fireEvent.click(await screen.findByTestId("account-transfer-confirm-confirm"))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("This transfer request has expired"))
    expect(screen.queryByTestId("legal-accept-stub")).not.toBeInTheDocument()
  })
})

describe("<AccountTransfersPage> — history", () => {
  it("lists a non-pending transfer separately, with its own status badge", async () => {
    installFetchMock({
      "GET /api/account/transfers": () => ({
        body: [{ ...PENDING_TRANSFER, id: "transfer-2", status: "EXPIRED" }],
      }),
    })

    renderPage()

    expect(await screen.findByTestId("account-transfers-history-card")).toBeInTheDocument()
    expect(screen.getByTestId("account-transfer-history-transfer-2")).toHaveTextContent("Expired")
    // The pending list stays empty — an expired request is not something to act on.
    expect(screen.getByTestId("account-transfers-empty")).toBeInTheDocument()
  })
})
