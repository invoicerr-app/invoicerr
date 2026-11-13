import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockUseSession = vi.fn()
vi.mock("@/lib/auth", () => ({
  authClient: { useSession: () => mockUseSession() },
}))

import BillingSettings from "@/pages/(app)/settings/_components/billing.settings"

/** Same fetch-boundary mocking convention as `_preferences.spec.tsx`/`payments.settings.spec.tsx`. */
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

const TRIAL_STATUS = {
  status: "TRIAL",
  seats: 1,
  interval: null,
  trialEndsAt: "2026-10-01T00:00:00.000Z",
  daysRemaining: 10,
}

function mockSession(role: "OWNER" | "ADMIN" | "MEMBER") {
  mockUseSession.mockReturnValue({
    data: {
      user: { id: "user-1", email: "user@example.test" },
      companies: [{ companyId: "company-1", role }],
      activeCompanyId: "company-1",
      activeRole: role,
    },
    isPending: false,
    refetch: vi.fn().mockResolvedValue(undefined),
  })
}

function renderBillingSettings() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <BillingSettings />
    </QueryClientProvider>,
  )
}

describe("<BillingSettings>", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("shows the current status, the seat count and the days left in the trial", async () => {
    mockSession("OWNER")
    installFetchMock({ "GET /api/billing/status": () => ({ body: TRIAL_STATUS }) })

    renderBillingSettings()

    expect(await screen.findByTestId("billing-status-badge")).toHaveTextContent("Trial")
    expect(screen.getByTestId("billing-days-remaining")).toHaveTextContent("10")
    expect(screen.queryByTestId("billing-member-notice")).not.toBeInTheDocument()
  })

  it("shows the interval and no countdown for a paying company", async () => {
    mockSession("OWNER")
    installFetchMock({
      "GET /api/billing/status": () => ({
        body: { ...TRIAL_STATUS, status: "ACTIVE", seats: 3, interval: "YEAR", daysRemaining: null },
      }),
    })

    renderBillingSettings()

    expect(await screen.findByTestId("billing-status-badge")).toHaveTextContent("Active")
    expect(screen.getByTestId("billing-settings")).toHaveTextContent("Yearly")
    expect(screen.queryByTestId("billing-days-remaining")).not.toBeInTheDocument()
  })

  it("tells a plain member that only an owner or an admin manages the subscription", async () => {
    mockSession("MEMBER")
    installFetchMock({ "GET /api/billing/status": () => ({ body: TRIAL_STATUS }) })

    renderBillingSettings()

    expect(await screen.findByTestId("billing-member-notice")).toBeInTheDocument()
  })

  it("renders nothing when billing does not exist on this instance (404)", async () => {
    mockSession("OWNER")
    const fetchMock = installFetchMock({
      "GET /api/billing/status": () => ({ status: 404, body: { message: "Not Found" } }),
    })

    const { container } = renderBillingSettings()

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
