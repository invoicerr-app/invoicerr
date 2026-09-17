import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router"
import { describe, expect, it, vi } from "vitest"

import { PageHeaderProvider } from "@/components/page-header-provider"
import type { DocumentTypeDescriptor } from "@/components/documents/types"

import DocumentTypePage from "@/pages/(app)/documents/[typeId]/index"

/**
 * Same fetch-boundary mocking as `__tests__/document-journeys.spec.tsx` (kept local to this file
 * rather than shared, since only this one scenario needs it here): the app's real screens, the API
 * mocked at `fetch`.
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

type FetchHandler = (url: URL, init?: RequestInit) => unknown

function installFetchMock(handlers: Record<string, FetchHandler>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input.toString()
    const url = new URL(raw, "http://localhost")
    const method = (init?.method ?? "GET").toUpperCase()
    const key = `${method} ${url.pathname}`
    const handler = handlers[key]
    if (!handler) throw new Error(`Unmocked fetch in test: ${key}${url.search}`)
    const result = handler(url, init)
    if (result && typeof result === "object" && "status" in result && "body" in result) {
      const { status, body } = result as { status: number; body: unknown }
      return jsonResponse(body, status)
    }
    return jsonResponse(result)
  })
  vi.stubGlobal("fetch", fn)
  return fn
}

function renderDocumentTypeScreen(typeId: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <PageHeaderProvider>
        <MemoryRouter initialEntries={[`/documents/${typeId}`]}>
          <Routes>
            <Route path="/documents/:typeId" element={<DocumentTypePage />} />
          </Routes>
        </MemoryRouter>
      </PageHeaderProvider>
    </QueryClientProvider>,
  )
}

describe("<DocumentCreateDialog> — every declared action blocked by country policy", () => {
  it("disables the wizard's own final button rather than a 'Continue' that silently does nothing", async () => {
    const descriptor: DocumentTypeDescriptor = {
      id: "invoice",
      label: "Invoice",
      statuses: [{ id: "draft", label: "Draft" }],
      initialStatus: "draft",
      // No fields at all — the wizard collapses straight to its one "Summary" step, so this test
      // reaches the final button without walking through Details/Lines/Options first.
      fields: [],
      actions: [
        {
          id: "save-draft",
          label: "Save draft",
          availableWhen: "always",
          policyBlockedReason: "Country policy forbids saving a draft here.",
        },
        {
          id: "send",
          label: "Send",
          availableWhen: "always",
          policyBlockedReason: "Country policy forbids sending here.",
        },
      ],
    }

    const postDraft = vi.fn()
    installFetchMock({
      "GET /api/documents/types/invoice": () => descriptor,
      // `GET /documents`'s own paginated shape (`{ items, total, page, pageSize }`) — see
      // `hooks/queries/use-document-types.ts#DocumentInstancesPage`.
      "GET /api/documents": () => ({ items: [], total: 0, page: 1, pageSize: 25 }),
      "POST /api/documents/types/invoice/actions/save-draft": () => {
        postDraft()
        return { changed: true, document: null, message: "Done." }
      },
    })

    renderDocumentTypeScreen("invoice")

    fireEvent.click(await screen.findByTestId("document-create-button"))
    await screen.findByTestId("document-create-dialog")

    // No action is runnable — the button must say so rather than reading "Continue" and doing
    // nothing when pressed.
    const submitButton = await screen.findByTestId("document-create-dialog-submit")
    expect(submitButton).toBeDisabled()

    fireEvent.click(submitButton)
    expect(postDraft).not.toHaveBeenCalled()
    expect(screen.getByTestId("document-create-dialog")).toBeInTheDocument()
  })
})
