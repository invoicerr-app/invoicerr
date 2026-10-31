import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router"
import { describe, expect, it, vi } from "vitest"

import { PageHeaderProvider, usePageHeaderContext } from "@/components/page-header-provider"
import DocumentTypePage from "@/pages/(app)/documents/[typeId]/index"

function HeaderTitle() {
  const { title } = usePageHeaderContext()
  return <h1 data-testid="title">{title}</h1>
}

function ok(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response
}

describe("documents list page title", () => {
  it("names the type by its label even when its descriptor cannot be loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(typeof input === "string" ? input : input.toString(), "http://localhost")
        if (url.pathname === "/api/documents/available-types") {
          return ok({ types: [{ id: "invoice", label: "Facture", icon: "invoice" }] })
        }
        throw new TypeError("Failed to fetch")
      }),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <PageHeaderProvider>
          <HeaderTitle />
          <MemoryRouter initialEntries={["/documents/invoice"]}>
            <Routes>
              <Route path="/documents/:typeId" element={<DocumentTypePage />} />
            </Routes>
          </MemoryRouter>
        </PageHeaderProvider>
      </QueryClientProvider>,
    )
    // The summary goes through the same translation as everywhere else: "Invoice" here, never the id.
    expect(await screen.findByText("Invoice", { selector: "h1" })).toBeTruthy()
  })
})
