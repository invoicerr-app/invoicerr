import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, within } from "@testing-library/react"
import type { ReactNode } from "react"
import { MemoryRouter, Route, Routes } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

import { InvoiceOverviewPanel } from "@/components/dashboard/invoice-overview"
import type { DocumentInstance, DocumentTypeDescriptor } from "@/components/documents/types"
import { PageHeaderProvider } from "@/components/page-header-provider"
import type { InvoiceOverview } from "@/hooks/queries"
import DocumentDetailPage from "@/pages/(app)/documents/[typeId]/[id]"
import DocumentTypePage from "@/pages/(app)/documents/[typeId]/index"

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
    clone() {
      return this as Response
    },
  } as Response
}

const descriptor: DocumentTypeDescriptor = {
  id: "invoice",
  label: "Invoice",
  statuses: [
    { id: "draft", label: "Draft" },
    { id: "sent", label: "Sent" },
  ],
  initialStatus: "draft",
  numbering: { onEnterStatus: "sent" },
  fields: [{ key: "issueDate", kind: "date", label: "Date", required: true }],
  actions: [],
}

const rejected: DocumentInstance = {
  id: "inv-rejected",
  typeId: "invoice",
  status: "sent",
  data: { issueDate: "2026-11-03T00:00:00.000Z" },
  createdAt: "2026-11-03T00:00:00.000Z",
  updatedAt: "2026-11-03T00:00:00.000Z",
  displayNumber: "F-2026-0042",
  conformityRejectedAt: "2026-11-04T09:00:00.000Z",
  conformityRejectedReason: "Unknown buyer SIREN",
}

const overview: InvoiceOverview = {
  currency: "EUR",
  month: "2026-11",
  invoicedThisMonth: 0,
  invoicedLastMonth: 0,
  months: [],
  toChase: [],
  thisWeek: [],
  rejected: [
    {
      documentId: "inv-rejected",
      displayNumber: "F-2026-0042",
      client: "Acme",
      reason: "Unknown buyer SIREN",
    },
  ],
}

function installFetchMock(handlers: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === "string" ? input : input.toString(), "http://localhost")
      return jsonResponse(handlers[url.pathname] ?? [])
    }),
  )
}

function renderAt(path: string, routePath: string, element: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <PageHeaderProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={routePath} element={element} />
          </Routes>
        </MemoryRouter>
      </PageHeaderProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("an invoice the e-invoicing platform rejected", () => {
  it("raises a dashboard alert counting it, with its reason", async () => {
    installFetchMock({ "/api/documents/dashboard/overview": overview })
    renderAt("/", "/", <InvoiceOverviewPanel />)

    const alert = await screen.findByTestId("dashboard-overview-rejected")
    expect(alert).toHaveTextContent("1 invoice rejected by the platform")
    expect(within(alert).getByTestId("dashboard-overview-rejected-inv-rejected")).toHaveTextContent(
      "Unknown buyer SIREN",
    )
  })

  it("shows no dashboard alert when nothing is rejected", async () => {
    installFetchMock({ "/api/documents/dashboard/overview": { ...overview, rejected: [] } })
    renderAt("/", "/", <InvoiceOverviewPanel />)

    await screen.findByTestId("dashboard-overview")
    expect(screen.queryByTestId("dashboard-overview-rejected")).not.toBeInTheDocument()
  })

  it("is marked in error on its list row", async () => {
    installFetchMock({
      "/api/documents/types/invoice": descriptor,
      "/api/documents/available-types": { types: [{ id: "invoice", label: "Invoice" }] },
      "/api/documents": { items: [rejected], total: 1, page: 1, pageSize: 25 },
    })
    renderAt("/documents/invoice", "/documents/:typeId", <DocumentTypePage />)

    expect(await screen.findByTestId("document-row-rejected-inv-rejected")).toHaveTextContent(
      "Rejected by the platform: Unknown buyer SIREN",
    )
  })

  it("shows a banner with the reason and a correct-and-resend action on its detail page", async () => {
    installFetchMock({
      "/api/documents/types/invoice": descriptor,
      "/api/documents/available-types": { types: [{ id: "invoice", label: "Invoice" }] },
      "/api/documents/inv-rejected": rejected,
      "/api/documents/inv-rejected/authority-events": [],
      "/api/documents/inv-rejected/archives": [],
    })
    renderAt("/documents/invoice/inv-rejected", "/documents/:typeId/:id", <DocumentDetailPage />)

    const banner = await screen.findByTestId("document-rejection-banner")
    expect(banner).toHaveTextContent("Rejected by the e-invoicing platform")
    expect(within(banner).getByTestId("document-rejection-reason")).toHaveTextContent(
      "Reason given: Unknown buyer SIREN",
    )

    fireEvent.click(within(banner).getByTestId("document-rejection-correct"))
    expect(await screen.findByTestId("document-correction-dialog")).toBeInTheDocument()
  })
})
