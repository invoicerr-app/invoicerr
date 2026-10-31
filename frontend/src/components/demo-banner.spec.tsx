import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DemoBanner } from "./demo-banner"

function installLegalDocuments(demo: { email: string; password: string; resetIntervalHours: number } | null) {
  const body = { saasMode: false, demoMode: demo !== null, demo, documents: [] }
  const fn = vi.fn(
    async () =>
      ({
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
        clone() {
          return this as Response
        },
      }) as Response,
  )
  vi.stubGlobal("fetch", fn)
  return fn
}

function renderBanner() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <DemoBanner />
    </QueryClientProvider>,
  )
  return client
}

const demo = { email: "visitor@demo.test", password: "open-sesame", resetIntervalHours: 6 }

afterEach(() => vi.unstubAllGlobals())

describe("<DemoBanner>", () => {
  it("states the reset interval the server serves", async () => {
    installLegalDocuments(demo)
    renderBanner()

    expect(await screen.findByTestId("demo-banner")).toHaveTextContent("Demo: data resets every 6 hours")
  })

  // Issue #592: a generic "nothing is kept or sent" left payments looking live.
  it("names the outbound actions the demo disables, payments included", async () => {
    installLegalDocuments(demo)
    renderBanner()

    expect(await screen.findByTestId("demo-banner")).toHaveTextContent(
      "Sending documents, e-invoicing declarations and payments are disabled in this demo.",
    )
  })

  it("says every hour for a one-hour interval", async () => {
    installLegalDocuments({ ...demo, resetIntervalHours: 1 })
    renderBanner()

    expect(await screen.findByTestId("demo-banner")).toHaveTextContent("Demo: data resets every hour")
  })

  it("renders nothing outside demo mode", async () => {
    installLegalDocuments(null)
    const client = renderBanner()

    await waitFor(() => expect(client.isFetching()).toBe(0))
    expect(screen.queryByTestId("demo-banner")).not.toBeInTheDocument()
  })
})
