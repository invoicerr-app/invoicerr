import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useState } from "react"
import { MemoryRouter } from "react-router"
import { describe, expect, it, vi } from "vitest"

import { ReceivedInvoiceUploadButton } from "@/components/documents/custom/received-invoice-upload-button"
import type { DocumentTypeDescriptor } from "@/components/documents/types"

/** Same fetch-boundary mocking as `document-create-dialog.spec.tsx` (kept local to this file rather
 *  than shared — only this one scenario needs it here): the app's real screens, the API mocked at
 *  `fetch`. */
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
    return jsonResponse(handler(url, init))
  })
  vi.stubGlobal("fetch", fn)
  return fn
}

// A fake type id, deliberately NOT "received-invoice" — that id is one of the five native types
// `lib/descriptor-i18n.ts` derives real translation keys for, which would make this test's
// assertions depend on `locales/en/translation.json` staying in sync with a descriptor this test
// invents. Nothing in `ReceivedInvoiceUploadButton` itself is hardcoded to the real id: it only ever
// reads the `descriptor` prop it's handed.
const DESCRIPTOR: DocumentTypeDescriptor = {
  id: "test-received-invoice",
  label: "Received invoice",
  statuses: [{ id: "received", label: "Received" }],
  initialStatus: "received",
  fields: [{ key: "supplier", kind: "text", label: "Supplier", required: false }],
  actions: [{ id: "receive", label: "Save", availableWhen: "always" }],
}

/** jsdom's own `File` does not implement `arrayBuffer()` (only Node's built-in `File`/`Blob` do) —
 *  overridden on the instance alone, never the prototype, so this stays scoped to this one file's
 *  fake upload rather than patching a global other specs could trip over. */
function fakeFile(content: string): File {
  const file = new File([content], "invoice.pdf", { type: "application/pdf" })
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => new TextEncoder().encode(content).buffer,
  })
  return file
}

/** Forces `ReceivedInvoiceUploadButton` to re-render for a reason that has NOTHING to do with its own
 *  `preview` state — exactly what a `refetchOnWindowFocus` refetch or an SSE tick does in the real
 *  app (see that component's own header comment): a plain parent re-render, with no props of the
 *  child actually changing. */
function Harness() {
  const [tick, setTick] = useState(0)
  return (
    <div>
      {/* `data-cy`, not `data-testid` — `src/test/setup.ts` points testing-library's `testIdAttribute`
          at the same attribute Cypress uses, so `data-testid` here would silently never be found. */}
      <button type="button" onClick={() => setTick((t) => t + 1)} data-cy="force-rerender">
        {tick}
      </button>
      <ReceivedInvoiceUploadButton descriptor={DESCRIPTOR} />
    </div>
  )
}

function renderHarness() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      {/* A bare `<MemoryRouter>` — no route ever matched — is enough for `DocumentCreateDialog`'s own
          `useNavigate()` to resolve; this test never triggers a save (and therefore never a
          navigation) at all. */}
      <MemoryRouter>
        <Harness />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe("<ReceivedInvoiceUploadButton> — the review dialog survives an unrelated re-render", () => {
  it("keeps a correction the user just typed instead of resetting it back to the extracted value", async () => {
    installFetchMock({
      "POST /api/documents/received-invoices/upload": () => ({
        fileRef: "sha-abc",
        fileName: "invoice.pdf",
        mime: "application/pdf",
        extraction: { syntax: "CII", fields: { supplier: "Acme Corp" } },
        supplierMatch: { outcome: "matched", clientId: "client-1", matchedBy: "vat" },
        ocr: { outcome: "not-attempted" },
      }),
      "GET /api/documents/types/test-received-invoice": () => DESCRIPTOR,
    })

    renderHarness()

    fireEvent.click(screen.getByTestId("received-invoice-upload-button"))
    const fileInput = await screen.findByTestId("received-invoice-upload-file-input")
    fireEvent.change(fileInput, { target: { files: [fakeFile("%PDF-1.4 fake")] } })

    // The review dialog opens, pre-filled from the extraction.
    const supplierInput = await screen.findByTestId("document-field-supplier-input")
    await waitFor(() => expect(supplierInput).toHaveValue("Acme Corp"))

    // The user corrects the extracted value.
    fireEvent.change(supplierInput, { target: { value: "Acme Corporation SARL" } })
    expect(supplierInput).toHaveValue("Acme Corporation SARL")

    // Something entirely unrelated re-renders this component (the harness's own `tick`, standing in
    // for a background query refetch or an SSE event) — must never touch the form.
    fireEvent.click(screen.getByTestId("force-rerender"))

    expect(screen.getByTestId("document-field-supplier-input")).toHaveValue("Acme Corporation SARL")
  })
})
