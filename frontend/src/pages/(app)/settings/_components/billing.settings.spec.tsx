import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
import { toast } from "sonner"

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

/** A TRIAL company with no Polar customer yet — `canSubscribe` reads `true`, so the Subscribe buttons
 *  (and, past that, the checkout call this file's own error-surfacing test exercises) actually render. */
const TRIAL_STATUS = {
  status: "TRIAL",
  seats: 1,
  interval: null,
  trialEndsAt: "2026-10-01T00:00:00.000Z",
  daysRemaining: 10,
  checkoutUrl: "/api/billing/checkout",
  portalUrl: "/api/billing/portal",
  hasCompanyCustomer: false,
  legacySubscription: false,
  legacyPortalAvailable: false,
  seatPaymentFailureExplainsStatus: false,
}

function mockSession(email: string) {
  mockUseSession.mockReturnValue({
    data: {
      user: { id: "user-1", email },
      companies: [{ companyId: "company-1", role: "OWNER" }],
      activeCompanyId: "company-1",
      activeRole: "OWNER",
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

describe("<BillingSettings> — billing email pre-fill", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSession("owner@example.test")
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("shows the saved override as-is when one is already on file", async () => {
    installFetchMock({
      "GET /api/billing/status": () => ({ body: TRIAL_STATUS }),
      "GET /api/billing/billing-email": () => ({
        body: { billingEmail: "billing@acme.test", companyEmail: "contact@acme.test" },
      }),
    })

    renderBillingSettings()

    const input = await screen.findByTestId<HTMLInputElement>("billing-email-input")
    await waitFor(() => expect(input.value).toBe("billing@acme.test"))
    expect(screen.queryByTestId("billing-email-none-on-file-notice")).not.toBeInTheDocument()
  })

  it("pre-fills the company's own contact email when no override is set, with no notice", async () => {
    installFetchMock({
      "GET /api/billing/status": () => ({ body: TRIAL_STATUS }),
      "GET /api/billing/billing-email": () => ({
        body: { billingEmail: null, companyEmail: "contact@acme.test" },
      }),
    })

    renderBillingSettings()

    const input = await screen.findByTestId<HTMLInputElement>("billing-email-input")
    await waitFor(() => expect(input.value).toBe("contact@acme.test"))
    expect(screen.queryByTestId("billing-email-none-on-file-notice")).not.toBeInTheDocument()
  })

  it("falls back to the signed-in user's own account email and shows the notice when NEITHER address is on file", async () => {
    installFetchMock({
      "GET /api/billing/status": () => ({ body: TRIAL_STATUS }),
      "GET /api/billing/billing-email": () => ({ body: { billingEmail: null, companyEmail: "" } }),
    })

    renderBillingSettings()

    const input = await screen.findByTestId<HTMLInputElement>("billing-email-input")
    await waitFor(() => expect(input.value).toBe("owner@example.test"))
    expect(await screen.findByTestId("billing-email-none-on-file-notice")).toBeInTheDocument()
  })
})

describe("<BillingSettings> — checkout failure surfacing", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSession("owner@example.test")
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // The regression this guards: a 500 used to reach this screen as a hardcoded "Failed to start
  // checkout" (there was no BILLING_EMAIL_MISSING branch to special-case, and the generic ApiError
  // fallback was never reached because the error never made it back as a clean 4xx at all). Proves
  // the fix end-to-end: the backend's OWN wording — not a frontend-authored string — is what the
  // toast shows, by asserting the EXACT text `MissingBillingEmailError`
  // (backend/src/modules/billing/billing-customer.ts) constructs, read back off the mocked 422
  // response body the same way a real one would arrive.
  it("shows the backend's own actionable message verbatim when checkout refuses a missing billing email (422)", async () => {
    const BACKEND_MESSAGE =
      "This company has no billing email address on file. Set one in Settings > Billing, then try again."
    installFetchMock({
      "GET /api/billing/status": () => ({ body: TRIAL_STATUS }),
      "GET /api/billing/billing-email": () => ({ body: { billingEmail: null, companyEmail: "" } }),
      "POST /api/billing/checkout": () => ({
        status: 422,
        body: { message: BACKEND_MESSAGE, code: "BILLING_EMAIL_MISSING" },
      }),
    })

    renderBillingSettings()
    fireEvent.click(await screen.findByTestId("billing-subscribe-monthly"))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(BACKEND_MESSAGE))
    // Never the generic fallback string — proves this path did NOT fall through to the "no ApiError"
    // branch, which would mean the real message got lost somewhere between the response and the toast.
    expect(toast.error).not.toHaveBeenCalledWith("Failed to start checkout")
  })
})
