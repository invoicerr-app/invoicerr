import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  useCancelSubscription,
  useCompanyStripeSubscription,
  useOpenBillingPortal,
  useStartCheckout,
} from "./use-company-subscription"

const subscription = vi.hoisted(() => ({
  list: vi.fn(),
  upgrade: vi.fn(),
  billingPortal: vi.fn(),
  cancel: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({ authClient: { subscription } }))

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const company = { referenceId: "company-1", customerType: "organization" }

beforeEach(() => {
  vi.clearAllMocks()
  for (const call of Object.values(subscription)) call.mockResolvedValue({ data: [], error: null })
})

describe("company subscription calls", () => {
  it("lists the subscription of the company customer", async () => {
    const { result } = renderHook(() => useCompanyStripeSubscription("company-1", true), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(subscription.list).toHaveBeenCalledWith({ query: company })
  })

  it("checks out, opens the portal and cancels on the company customer, never the clicking user's", async () => {
    const checkout = renderHook(() => useStartCheckout(), { wrapper }).result
    const portal = renderHook(() => useOpenBillingPortal(), { wrapper }).result
    const cancel = renderHook(() => useCancelSubscription(), { wrapper }).result

    await checkout.current.mutateAsync({ companyId: "company-1", annual: true, seats: 4 })
    await portal.current.mutateAsync({ companyId: "company-1" })
    await cancel.current.mutateAsync({ companyId: "company-1" })

    expect(subscription.upgrade).toHaveBeenCalledWith(
      expect.objectContaining({ ...company, plan: "standard", annual: true, seats: 4 }),
    )
    expect(subscription.billingPortal).toHaveBeenCalledWith(expect.objectContaining(company))
    expect(subscription.cancel).toHaveBeenCalledWith(expect.objectContaining(company))
  })

  it("surfaces the server's refusal as an error", async () => {
    subscription.billingPortal.mockResolvedValue({ data: null, error: { message: "Unauthorized" } })
    const portal = renderHook(() => useOpenBillingPortal(), { wrapper }).result

    await expect(portal.current.mutateAsync({ companyId: "company-1" })).rejects.toThrow("Unauthorized")
  })
})
