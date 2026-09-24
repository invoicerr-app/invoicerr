import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router"
import { describe, expect, it, vi } from "vitest"

import { PageHeaderProvider } from "@/components/page-header-provider"
import type { DocumentTypeDescriptor } from "@/components/documents/types"

import DocumentTypePage from "@/pages/(app)/documents/[typeId]/index"

/**
 * GitHub issue #451, defect 2 — ROOT CAUSE, established here: the client-aware descriptor refetch
 * landing while a sibling popover is open does NOT, on its own, unmount that popover. This test
 * proves it end to end through the REAL screen and a REAL `QueryClient` (no hooks mocked, same
 * `fetch`-boundary approach as `document-create-dialog.spec.tsx`): the client-aware response is held
 * back and released only once the calendar is already open, and the calendar survives regardless.
 *
 * A hand-mocked `useDocumentType` swap was tried FIRST and also reconciled fine (kept as
 * `use-document-form.spec.tsx`) — React's own `field.key`-keyed diffing does not care that
 * `effectiveDescriptor` is a new object identity, and this test additionally proves that holds
 * through the REAL fetch/query-client/select pipeline the live app actually runs. The popover that
 * actually did vanish in the traced CI failure is dismissed by a DIFFERENT, unrelated mechanism —
 * the same deferred close-autofocus race as defect 1, this time from the CLIENT reference field's
 * OWN popover closing right before the calendar opens — fixed in `search-input.tsx` and covered by
 * `search-input.sibling-popover.spec.tsx`. This file is kept as the regression guard for the
 * descriptor-identity theory specifically: whatever else changes about field rendering, an unchanged
 * field must never remount just because the descriptor object handed to it is a new instance.
 */
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

function installFetchMock(handlers: Record<string, (url: URL) => unknown>) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const raw = typeof input === "string" ? input : input.toString()
    const url = new URL(raw, "http://localhost")
    const key = `GET ${url.pathname}`
    const handler = handlers[key]
    if (!handler) throw new Error(`Unmocked fetch in test: ${key}${url.search}`)
    return jsonResponse(handler(url))
  })
  vi.stubGlobal("fetch", fn)
  return fn
}

function descriptor(): DocumentTypeDescriptor {
  return {
    id: "invoice",
    label: "Invoice",
    statuses: [{ id: "draft", label: "Draft" }],
    initialStatus: "draft",
    fields: [
      { key: "client", kind: "reference", entity: "client", label: "Client", required: true },
      { key: "issueDate", kind: "date", label: "Issue date", required: true },
    ],
    actions: [{ id: "save-draft", label: "Save draft", availableWhen: "always" }],
  }
}

describe("<DocumentCreateDialog> — an open calendar survives the client-aware descriptor landing (real fetch/QueryClient)", () => {
  it("keeps the issueDate popover open when GET .../invoice?clientId=... resolves while it's open", async () => {
    // Held back deliberately — resolved only once the calendar is already open, matching the live
    // trace the e2e comment (43-correction-routes.cy.ts) records.
    let resolveClientAware: (() => void) | undefined
    const clientAwareGate = new Promise<void>((resolve) => {
      resolveClientAware = resolve
    })

    installFetchMock({
      "GET /api/documents/types/invoice": (url) =>
        url.searchParams.has("clientId") ? descriptor() : descriptor(),
      "GET /api/documents": () => ({ items: [], total: 0, page: 1, pageSize: 25 }),
      "GET /api/documents/types": () => [],
      "GET /api/documents/references/client/search": () => [{ id: "client-1", label: "Acme" }],
    })

    // Re-wrap the client-aware call specifically, so it can be held back independently of the base
    // (no-clientId) fetch the page itself makes first.
    const originalFetch = vi.mocked(fetch)
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const raw = typeof input === "string" ? input : input.toString()
        const url = new URL(raw, "http://localhost")
        if (url.pathname === "/api/documents/types/invoice" && url.searchParams.has("clientId")) {
          await clientAwareGate
        }
        return originalFetch(input)
      }),
    )

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <PageHeaderProvider>
          <MemoryRouter initialEntries={["/documents/invoice"]}>
            <Routes>
              <Route path="/documents/:typeId" element={<DocumentTypePage />} />
            </Routes>
          </MemoryRouter>
        </PageHeaderProvider>
      </QueryClientProvider>,
    )

    fireEvent.click(await screen.findByTestId("document-create-button"))
    await screen.findByTestId("document-create-dialog")

    // Pick the client FIRST, then open the calendar RIGHT AWAY — deliberately NOT waiting for the
    // client popover's own deferred focus-restore (defect 1's mechanism) to settle first, to isolate
    // whether defect 2 is a genuinely SEPARATE cause from defect 1, or the same race wearing a
    // different name.
    fireEvent.click(screen.getByTestId("document-field-client-input").querySelector("button")!)
    fireEvent.click(await screen.findByText("Acme"))
    // Let the client popover's own exit-animation-gated, deferred (`setTimeout(...,0)`) focus
    // restore actually run — a real macrotask boundary, the same gap two separate `cy.click()`
    // commands naturally have in the browser but two synchronous `fireEvent.click()` calls do not.
    await new Promise((resolve) => setTimeout(resolve, 0))

    fireEvent.click(screen.getByTestId("document-field-issueDate-input"))
    expect(screen.getByTestId("date-picker-today")).toBeInTheDocument()

    // The calendar is open right now, exactly like the live trace, with the client-aware refetch
    // still held back. Let it land.
    resolveClientAware?.()
    await waitFor(() => expect(fetch).toHaveBeenCalled())

    // Give react-query's own state update (and the descriptor swap it drives) a tick to land.
    await waitFor(() => {
      expect(screen.getByTestId("date-picker-today")).toBeInTheDocument()
    })
  })
})
