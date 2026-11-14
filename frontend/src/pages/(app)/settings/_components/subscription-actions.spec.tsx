import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

import * as queriesModule from "@/hooks/queries"
import * as subscriptionModule from "@/hooks/queries/use-company-subscription"

import { SubscriptionActions } from "./subscription-actions"

vi.mock("@/hooks/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/queries")>()
  return { ...actual, useSeats: vi.fn() }
})
vi.mock("@/hooks/queries/use-company-subscription", () => ({
  useCompanyStripeSubscription: vi.fn(),
  useStartCheckout: vi.fn(),
  useOpenBillingPortal: vi.fn(),
  useCancelSubscription: vi.fn(),
}))
const toastSuccess = vi.fn()
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() } }))

const sub = vi.mocked(subscriptionModule)
const mockedUseSeats = vi.mocked(queriesModule.useSeats)

function member(userId: string) {
  return {
    userId,
    email: `${userId}@acme.org`,
    firstname: userId,
    lastname: "Acme",
    role: "MEMBER" as const,
    seatIndex: 1,
    joinedAt: "2026-11-13T00:00:00.000Z",
  }
}

function mutation() {
  return { mutate: vi.fn(), isPending: false } as unknown as ReturnType<
    typeof subscriptionModule.useStartCheckout
  >
}

function setup({
  status = "TRIAL" as queriesModule.CompanySubscriptionStatus,
  subscription = null as subscriptionModule.CompanyStripeSubscription | null,
  members = 3,
  url = "/settings/billing",
  priceGrid = "standard" as "standard" | "founder",
} = {}) {
  sub.useCompanyStripeSubscription.mockReturnValue({ data: subscription, isPending: false } as ReturnType<
    typeof subscriptionModule.useCompanyStripeSubscription
  >)
  const checkout = mutation()
  const portal = mutation()
  const cancel = mutation()
  sub.useStartCheckout.mockReturnValue(checkout)
  sub.useOpenBillingPortal.mockReturnValue(portal as never)
  sub.useCancelSubscription.mockReturnValue(cancel as never)
  mockedUseSeats.mockReturnValue({
    data: { seats: 1, members: Array.from({ length: members }, (_, i) => member(`m${i}`)), waiting: [] },
  } as unknown as ReturnType<typeof queriesModule.useSeats>)
  const queryClient = new QueryClient()
  const invalidate = vi.spyOn(queryClient, "invalidateQueries")
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[url]}>
        <SubscriptionActions companyId="company-1" status={status} priceGrid={priceGrid} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { checkout, portal, cancel, invalidate }
}

afterEach(() => vi.clearAllMocks())

describe("<SubscriptionActions>", () => {
  it("offers a checkout prefilled with one seat per member when the company has no subscription", () => {
    const { checkout } = setup({ members: 3 })

    expect(screen.getByTestId("billing-subscribe")).toHaveTextContent("Your company has 3 members.")
    expect(screen.getByTestId("billing-seats-input")).toHaveValue(3)
    expect(screen.queryByTestId("billing-portal-btn")).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId("billing-subscribe-btn"))
    expect(checkout.mutate).toHaveBeenCalledWith(
      { companyId: "company-1", plan: "standard", annual: false, seats: 3 },
      expect.anything(),
    )
  })

  it("sends the seat quantity the manager typed, never fewer than one", () => {
    const { checkout } = setup({ members: 2 })

    fireEvent.change(screen.getByTestId("billing-seats-input"), { target: { value: "5" } })
    fireEvent.click(screen.getByTestId("billing-subscribe-btn"))
    expect(checkout.mutate).toHaveBeenLastCalledWith(
      { companyId: "company-1", plan: "standard", annual: false, seats: 5 },
      expect.anything(),
    )

    fireEvent.change(screen.getByTestId("billing-seats-input"), { target: { value: "0" } })
    expect(screen.getByTestId("billing-seats-input")).toHaveValue(1)
  })

  it("checks a founder company out on the founder grid, and says so", () => {
    const { checkout } = setup({ members: 1, priceGrid: "founder" })

    expect(screen.getByTestId("billing-founder-note")).toBeInTheDocument()
    fireEvent.click(screen.getByTestId("billing-subscribe-btn"))
    expect(checkout.mutate).toHaveBeenCalledWith(
      { companyId: "company-1", plan: "founder", annual: false, seats: 1 },
      expect.anything(),
    )
  })

  it("shows no founder note to a standard company", () => {
    setup()
    expect(screen.queryByTestId("billing-founder-note")).not.toBeInTheDocument()
  })

  it("opens the portal and offers cancellation once the company has a subscription", () => {
    const { portal, cancel } = setup({
      status: "ACTIVE",
      subscription: { id: "s1", plan: "standard", status: "active", cancelAtPeriodEnd: false },
    })

    expect(screen.queryByTestId("billing-subscribe")).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId("billing-portal-btn"))
    expect(portal.mutate).toHaveBeenCalledWith({ companyId: "company-1" }, expect.anything())
    fireEvent.click(screen.getByTestId("billing-cancel-btn"))
    expect(cancel.mutate).toHaveBeenCalledWith({ companyId: "company-1" }, expect.anything())
  })

  it("shows the end date instead of a cancel button when cancellation is already scheduled", () => {
    setup({
      status: "ACTIVE",
      subscription: {
        id: "s1",
        plan: "standard",
        status: "active",
        cancelAtPeriodEnd: true,
        periodEnd: "2026-12-31T00:00:00.000Z",
      },
    })

    expect(screen.queryByTestId("billing-cancel-btn")).not.toBeInTheDocument()
    expect(screen.getByTestId("billing-cancel-scheduled")).toHaveTextContent("Your subscription ends on")
  })

  it("sends a past due company to the portal to fix its payment, not to a second checkout", () => {
    setup({ status: "PAST_DUE", subscription: null })

    expect(screen.getByTestId("billing-portal-btn")).toBeInTheDocument()
    expect(screen.queryByTestId("billing-subscribe")).not.toBeInTheDocument()
    expect(screen.queryByTestId("billing-cancel-btn")).not.toBeInTheDocument()
  })

  it("confirms a finished checkout once and refreshes the billing data", () => {
    const { invalidate } = setup({ url: "/settings/billing?checkout=success" })

    expect(toastSuccess).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["billing"] })
  })
})
