import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { DocumentInstance, DocumentTypeDescriptor } from "@/components/documents/types"
import { PageHeaderProvider } from "@/components/page-header-provider"

import DocumentDetailPage from "@/pages/(app)/documents/[typeId]/[id]"

/**
 * Issue #858 review (one blocking finding): in demo mode the "send" refusal was only passed to a
 * DISABLED button's tooltip. `button.tsx` sets `disabled:pointer-events-none`, so the Radix tooltip
 * never opens, and a disabled button is not focusable, so no keyboard or screen-reader user could
 * reach the reason. The record page must print it as visible text and name it on the button.
 */

// The real page, not a stand-in; only the demo-mode flag is pinned, because this spec is about the
// demo refusal itself.
vi.mock("@/hooks/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/queries")>()
  return { ...actual, useDemoMode: () => ({ demoMode: true, demo: null, isLoading: false }) }
})

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
  actions: [
    {
      id: "send",
      label: "Send",
      availableWhen: ["draft"],
      transitions: [{ from: ["draft"], to: "sent" }],
    },
  ],
}

const instance: DocumentInstance = {
  id: "inv-demo",
  typeId: "invoice",
  status: "draft",
  data: { issueDate: "2026-11-03T00:00:00.000Z" },
  createdAt: "2026-11-03T00:00:00.000Z",
  updatedAt: "2026-11-03T00:00:00.000Z",
  displayNumber: null,
  lastActionError: null,
}

function installFetchMock() {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const raw = typeof input === "string" ? input : input.toString()
    const url = new URL(raw, "http://localhost")
    const handlers: Record<string, unknown> = {
      "/api/documents/types/invoice": descriptor,
      "/api/documents/available-types": { types: [{ id: "invoice", label: "Invoice" }] },
      "/api/documents/inv-demo": instance,
      "/api/documents/inv-demo/authority-events": [],
      "/api/documents/inv-demo/archives": [],
    }
    // Every other GET is a side panel this spec does not exercise: an empty collection is the
    // honest answer, and it keeps an unrelated endpoint from failing the whole page.
    return jsonResponse(handlers[url.pathname] ?? [])
  })
  vi.stubGlobal("fetch", fn)
}

function renderDetailPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <PageHeaderProvider>
        <MemoryRouter initialEntries={["/documents/invoice/inv-demo"]}>
          <Routes>
            <Route path="/documents/:typeId/:id" element={<DocumentDetailPage />} />
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

describe("Demo mode - the record page explains a disabled action", () => {
  it("prints 'Disabled in this demo.' under the send button and describes the button with it", async () => {
    installFetchMock()
    renderDetailPage()

    await screen.findByTestId("document-detail-page")
    const button = await screen.findByTestId("document-action-send")

    await waitFor(() => expect(button).toBeDisabled())
    // Visible: a plain paragraph in the page, reachable without a hover or a click.
    expect(screen.getByTestId("document-blocked-reason-send")).toHaveTextContent("Disabled in this demo.")
    expect(screen.getByText("Disabled in this demo.")).toBeVisible()
    // Accessible: the disabled button's own description names the same text.
    expect(button).toHaveAccessibleDescription("Disabled in this demo.")
  })
})
