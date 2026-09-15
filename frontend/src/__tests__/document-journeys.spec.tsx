import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PageHeaderProvider } from "@/components/page-header-provider"
import type { DocumentInstance, DocumentTypeDescriptor } from "@/components/documents/types"
import { useDocumentEventsSse } from "@/hooks/use-document-events-sse"
import * as useFetchModule from "@/hooks/use-fetch"

import DocumentTypePage from "@/pages/(app)/documents/[typeId]/index"
import DocumentDetailPage from "@/pages/(app)/documents/[typeId]/[id]"

/**
 * Journey coverage, not line coverage: five NAMED tests, one
 * per journey (issuance, rejection, correction, credit note, cancellation), each rendering the REAL screens this
 * app actually ships (`DocumentTypePage` and `DocumentDetailPage` — the exact components
 * `[typeId]/index.tsx` and `[typeId]/[id].tsx`'s own routes mount, the SAME tree `document-list.tsx`/
 * `document-detail.tsx`/`document-form.tsx`/`document-conformity-section.tsx`/
 * `document-settlement.tsx` compose into in production), never an isolated component standing in for
 * it. Opening a saved record is a real navigation from the list's own link to the record's page,
 * exactly as in production. The API boundary is mocked at `fetch` — this codebase's own boundary (`use-fetch.ts`'s
 * `authenticatedFetch`, wrapped by `use-api-query.ts`'s `apiFetch`) — never a re-implementation of any
 * business rule, so a descriptor/action/event handed back here is exactly the shape a real backend
 * response would carry. i18n is the REAL instance (`src/test/setup.ts`), never mocked. Each `it()`
 * ends with a comment naming the ONE production-code mutation proven to turn it red.
 */

vi.mock("@/hooks/use-fetch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-fetch")>()
  return { ...actual, useSse: vi.fn() }
})

const mockedUseSse = vi.mocked(useFetchModule.useSse)

function sseResult(data: useFetchModule.useSseResult["data"]): useFetchModule.useSseResult {
  return { data, loading: false, error: null, close: vi.fn() }
}

/** Mounted alongside the page in the ISSUANCE journey only — the exact hook `(app)/_layout.tsx`
 *  mounts once for the whole authenticated app (see that hook's own header). Every other journey
 *  never renders this: their screens react to a plain refetch, not to a pushed SSE message. */
function SseHost() {
  useDocumentEventsSse()
  return null
}

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

/** Routes the global `fetch` this codebase's whole data layer funnels through
 *  (`authenticatedFetch` in use-fetch.ts) by `"METHOD pathname"`, ignoring the query string — the
 *  same generic REST surface `documents.controller.ts` exposes. A handler may return a plain body
 *  (200) or `{ status, body }` for a non-200 response. An unmocked request throws loudly rather than
 *  silently resolving `undefined` — the same "never a silent gap" discipline this codebase holds
 *  everywhere else. */
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

function documentTypeTree(queryClient: QueryClient, typeId: string, extra?: React.ReactNode) {
  return (
    <QueryClientProvider client={queryClient}>
      <PageHeaderProvider>
        <MemoryRouter initialEntries={[`/documents/${typeId}`]}>
          <Routes>
            <Route
              path="/documents/:typeId"
              element={
                <>
                  {extra}
                  <DocumentTypePage />
                </>
              }
            />
            <Route path="/documents/:typeId/:id" element={<DocumentDetailPage />} />
          </Routes>
        </MemoryRouter>
      </PageHeaderProvider>
    </QueryClientProvider>
  )
}

function renderDocumentTypeScreen(typeId: string, extra?: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const utils = render(documentTypeTree(queryClient, typeId, extra))
  return { queryClient, ...utils }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("Issuance — draft sent, the screen follows without reload (SSE mechanism)", () => {
  it("shows 'Sending' the moment send is clicked, then 'Sent' once the SSE nudge arrives", async () => {
    const descriptor: DocumentTypeDescriptor = {
      id: "invoice",
      label: "Invoice",
      statuses: [
        { id: "draft", label: "Draft" },
        { id: "sending", label: "Sending" },
        { id: "sent", label: "Sent" },
        { id: "send_failed", label: "Send failed" },
      ],
      initialStatus: "draft",
      numbering: { onEnterStatus: "sending" },
      fields: [{ key: "issueDate", kind: "date", label: "Date", required: true }],
      actions: [
        {
          id: "send",
          label: "Send",
          availableWhen: ["draft", "send_failed"],
          transitions: [
            { from: ["draft", "send_failed"], to: "sending" },
            { from: ["sending"], to: ["sent", "send_failed"] },
          ],
        },
      ],
    }

    let status: "draft" | "sending" | "sent" = "draft"
    const instance = (): DocumentInstance => ({
      id: "inv-1",
      typeId: "invoice",
      status,
      data: { issueDate: "2026-08-01T00:00:00.000Z" },
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
      displayNumber: status === "draft" ? null : "INV-2026-0001",
      lastActionError: null,
    })

    installFetchMock({
      "GET /api/documents/types/invoice": () => descriptor,
      "GET /api/documents": () => [instance()],
      "POST /api/documents/types/invoice/actions/send": () => {
        status = "sending"
        return { changed: true, document: instance(), message: "Queued" }
      },
    })

    mockedUseSse.mockReturnValue(sseResult(null))
    const { queryClient, rerender } = renderDocumentTypeScreen("invoice", <SseHost />)

    await waitFor(() => expect(screen.getByTestId("document-status-badge")).toHaveTextContent("Draft"))

    fireEvent.click(screen.getByTestId("document-row-action-send-inv-1"))

    await waitFor(() => expect(screen.getByTestId("document-status-badge")).toHaveTextContent("Sending"))

    // The SSE nudge this journey exists to prove: no further click, no poll fast enough to explain
    // it within a test — only the pushed message, exactly as `use-document-events-sse.spec.tsx`
    // proves the hook's OWN contract in isolation; this is the same mechanism wired to the real list.
    // Same `queryClient` — a real reconnect never remounts the app, and neither should this assertion.
    status = "sent"
    mockedUseSse.mockReturnValue(sseResult({ documentId: "inv-1", typeId: "invoice", kind: "sent" }))
    rerender(documentTypeTree(queryClient, "invoice", <SseHost />))

    await waitFor(() => expect(screen.getByTestId("document-status-badge")).toHaveTextContent("Sent"))
  })
  // MUTATION (proven, reverted): use-document-events-sse.ts — invalidateQueries({ queryKey:
  // ["documents", data.typeId] }) -> queryKey: ["documents", "wrong-type"]. RED: this test times out
  // waiting for "Sent" (screen stays on "Sending" forever — the SSE message arrives but invalidates a
  // key the mounted list never reads). Reverted; suite green again.
})

describe("Custom slots — the list-row-extra component renders on the row AND on the record's page", () => {
  /** The same registration (custom/invoice-correction-routes-button.tsx) must reach both surfaces
   *  that consult the "list-row-extra" slot — the list's row cluster and the detail page's header —
   *  or a user who opens the record loses the Correct button the row just offered. */
  it("an issued invoice carries the correction button on its row, then on its own page", async () => {
    const descriptor = {
      id: "invoice", // document-list resolves the slot by descriptor.id — the tripwire NEEDS it
      typeId: "invoice",
      label: "Invoice",
      statuses: [
        { id: "draft", label: "Draft" },
        { id: "sent", label: "Sent" },
      ],
      numbering: { onEnterStatus: "sent" },
      fields: [{ key: "issueDate", kind: "date", label: "Date", required: true }],
      actions: [],
    }
    const instance: DocumentInstance = {
      id: "inv-slots",
      typeId: "invoice",
      status: "sent",
      data: { issueDate: "2026-08-29T00:00:00.000Z" },
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T10:00:05.000Z",
      displayNumber: "INV-2026-0099",
      lastActionError: null,
    }
    installFetchMock({
      "GET /api/documents/types/invoice": () => descriptor,
      "GET /api/documents": () => [instance],
      "GET /api/documents/inv-slots": () => instance,
      "GET /api/documents/inv-slots/authority-events": () => [],
      "GET /api/documents/inv-slots/archives": () => [],
    })
    renderDocumentTypeScreen("invoice")
    await screen.findByTestId("document-list-row-inv-slots")
    expect(screen.getByTestId("document-correction-button-inv-slots")).toBeInTheDocument()

    fireEvent.click(screen.getByTestId("document-open-link-inv-slots"))
    await screen.findByTestId("document-detail-page")
    expect(screen.getByTestId("document-correction-button-inv-slots")).toBeInTheDocument()
  })

  /** Same validation pass: the status gating ("only an ISSUED document can be corrected") mutated to
   *  `true` also left the suite green — pinned here: a draft does NOT have a Correct button. */
  it("a DRAFT does not carry the correction button", async () => {
    const descriptor = {
      id: "invoice",
      typeId: "invoice",
      label: "Invoice",
      statuses: [
        { id: "draft", label: "Draft" },
        { id: "sent", label: "Sent" },
      ],
      numbering: { onEnterStatus: "sent" },
      fields: [{ key: "issueDate", kind: "date", label: "Date", required: true }],
      actions: [],
    }
    const instance: DocumentInstance = {
      id: "inv-draft-slots",
      typeId: "invoice",
      status: "draft",
      data: { issueDate: "2026-08-29T00:00:00.000Z" },
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T10:00:05.000Z",
      displayNumber: null,
      lastActionError: null,
    }
    installFetchMock({
      "GET /api/documents/types/invoice": () => descriptor,
      "GET /api/documents": () => [instance],
      "GET /api/documents/inv-draft-slots/authority-events": () => [],
    })
    renderDocumentTypeScreen("invoice")
    await screen.findByTestId("document-list-row-inv-draft-slots")
    expect(screen.queryByTestId("document-correction-button-inv-draft-slots")).not.toBeInTheDocument()
  })
})

describe("Rejection — a logged negative authority verdict appears on the conformity panel", () => {
  it("shows the Rejected badge on the list row and the reason in the record page's timeline", async () => {
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

    const instance: DocumentInstance = {
      id: "inv-2",
      typeId: "invoice",
      status: "sent",
      data: { issueDate: "2026-08-29T00:00:00.000Z" },
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T10:00:05.000Z",
      displayNumber: "INV-2026-0002",
      lastActionError: null,
    }

    const rejectionReason =
      "BR-FR-05/BT-22 : La mention relative aux frais de recouvrement (code PMT) est absente."

    installFetchMock({
      "GET /api/documents/types/invoice": () => descriptor,
      "GET /api/documents": () => [instance],
      "GET /api/documents/inv-2": () => instance,
      "GET /api/documents/inv-2/authority-events": () => [
        {
          id: "evt-1",
          providerId: "pdp",
          statusCode: "fr:200",
          statusText: "Déposée (validée)",
          reason: null,
          observedAt: "2026-08-29T10:00:00.000Z",
        },
        {
          id: "evt-2",
          providerId: "pdp",
          statusCode: "fr:213",
          statusText: "Rejetée",
          reason: rejectionReason,
          observedAt: "2026-08-29T10:00:05.000Z",
        },
      ],
      "GET /api/documents/inv-2/archives": () => [],
    })

    renderDocumentTypeScreen("invoice")

    // The list itself, before the record is opened — the rejected-deposit indicator, proven end to
    // end through the real query, not just `computeConformityVerdict`'s
    // own pure-function unit tests (document-conformity-section.spec.tsx).
    await waitFor(() =>
      expect(screen.getByTestId("document-conformity-badge-inv-2")).toHaveTextContent("Rejected"),
    )

    fireEvent.click(screen.getByTestId("document-open-link-inv-2"))

    await waitFor(() => expect(screen.getByTestId("document-conformity-badge")).toHaveTextContent("Rejected"))
    expect(screen.getByTestId("document-conformity-event-reason")).toHaveTextContent("BR-FR-05/BT-22")
  })
  // MUTATION (proven, reverted): document-conformity-section.tsx —
  // `if (verdict !== "rejected" && verdict !== "declarationIssue") return null` (the LIST indicator's
  // own gate) -> `if (verdict !== "accepted") return null`. RED: the list row's own
  // "document-conformity-badge-inv-2" never appears (a rejected deposit renders no indicator at all
  // on the row a reader is actually scanning). Reverted; suite green again.
})

describe("Correction — what the screen REALLY offers today (not a dedicated screen)", () => {
  /**
   * GAP LOGGED: no descriptor (invoice,
   * credit-note, quote, expense, received-invoice — the five read from `backend/src/modules/
   * documents/descriptors/`) declares a "correct"/"amend" action, and no frontend component has
   * a correction dialog. The ONLY thing the screen does today with "correcting an issued
   * invoice" is: reopen the form and click "Save draft" (invoice.descriptor.ts's own
   * `SAVE_DRAFT_TRANSITIONS: [{ from: 'always', to: 'draft' }]`) — a plain draft restart,
   * never a distinct correction document. France itself REFUSES this path (country-policy/
   * data/fr.json narrows `invoice.save-draft` to `statuses: ["draft"]`, CGI art. 289, I.5 — "an issued
   * invoice is corrected by a DISTINCT document, never rewritten") — `describeTypeForCompany`
   * (documents.service.ts) annotates the action with `policyBlockedReason` for exactly this case, and
   * THIS is the one correction-adjacent state the real screen shows: a disabled button, its reason
   * spelled out, rather than any dedicated correction flow. This test proves THAT — the screen's own
   * refusal — is what "correction" looks like today for an issued French invoice.
   */
  it("shows 'Save draft' disabled, with the CGI art. 289 policy reason, on an issued FR invoice", async () => {
    const policyReason = "Issued invoices can only be corrected by a distinct document (CGI art. 289, I.5)."

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
          id: "save-draft",
          label: "Save draft",
          availableWhen: "always",
          transitions: [{ from: "always", to: "draft" }],
          policyBlockedReason: policyReason,
        },
      ],
    }

    const instance: DocumentInstance = {
      id: "inv-3",
      typeId: "invoice",
      status: "sent",
      data: { issueDate: "2026-08-20T00:00:00.000Z" },
      createdAt: "2026-08-20T00:00:00.000Z",
      updatedAt: "2026-08-20T00:00:00.000Z",
      displayNumber: "INV-2026-0003",
      lastActionError: null,
    }

    installFetchMock({
      "GET /api/documents/types/invoice": () => descriptor,
      "GET /api/documents": () => [instance],
      "GET /api/documents/inv-3": () => instance,
      "GET /api/documents/inv-3/authority-events": () => [],
      "GET /api/documents/inv-3/archives": () => [],
    })

    renderDocumentTypeScreen("invoice")

    await waitFor(() => expect(screen.getByTestId("document-open-link-inv-3")).toBeInTheDocument())
    fireEvent.click(screen.getByTestId("document-open-link-inv-3"))

    // The one action this record offers is blocked — it still takes the page's primary slot (a
    // visibly disabled rule rather than an empty header — see action-presentation.ts's
    // `pickPrimaryAction`), its reason printed right under it.
    const saveDraftButton = await screen.findByTestId("document-action-save-draft")
    expect(saveDraftButton).toBeDisabled()
    expect(screen.getByTestId("document-blocked-reason-save-draft")).toHaveTextContent("CGI art. 289, I.5")
  })
  // MUTATION (proven, reverted): document-form.tsx — `disabled={!!action.policyBlockedReason}`
  // (the action button's own render) -> `disabled={false}`. RED: "document-action-save-draft" is no
  // longer disabled even though the descriptor still carries the policy reason — the screen would let
  // a user click straight through a rule it is simultaneously still printing the text of. Reverted;
  // suite green again.
})

describe("Credit note — the mandatory reference, the locked currency, the credit visible at settlement", () => {
  it("locks the currency to the picked invoice's own, then shows the saved credit note on that invoice's settlement", async () => {
    const creditNoteDescriptor: DocumentTypeDescriptor = {
      id: "credit-note",
      label: "Credit note",
      statuses: [
        { id: "draft", label: "Draft" },
        { id: "sending", label: "Sending" },
        { id: "sent", label: "Sent" },
      ],
      initialStatus: "draft",
      fields: [
        { key: "invoice", kind: "reference", label: "Invoice", required: true, entity: "invoice" },
        {
          key: "currency",
          kind: "select",
          label: "Currency",
          required: true,
          options: [
            { value: "EUR", label: "EUR" },
            { value: "USD", label: "USD" },
          ],
          lockedFromReference: { field: "invoice", entity: "invoice", sourceKey: "currency" },
        },
        {
          key: "correctedLines",
          kind: "rowSelection",
          label: "Corrected lines",
          required: true,
          min: 1,
          sourceField: "invoice",
          sourceEntity: "invoice",
          sourceArrayField: "lines",
        },
      ],
      actions: [
        {
          id: "save-draft",
          label: "Save draft",
          availableWhen: "always",
          transitions: [{ from: "always", to: "draft" }],
        },
      ],
    }

    let saved: DocumentInstance | undefined
    installFetchMock({
      "GET /api/documents/types/credit-note": () => creditNoteDescriptor,
      "GET /api/documents": () => (saved ? [saved] : []),
      "GET /api/documents/references/invoice/search": () => [{ id: "inv-9", label: "Invoice INV-2026-0009" }],
      "GET /api/documents/references/invoice/inv-9": () => ({
        id: "inv-9",
        label: "Invoice INV-2026-0009",
      }),
      "GET /api/documents/references/invoice/inv-9/fields": () => ({ currency: "EUR" }),
      "GET /api/documents/types/credit-note/fields/correctedLines/rows": () => ({
        sourceTypeId: "invoice",
        sourceArrayField: "lines",
        rows: [{ id: "line-1", data: { description: "Consulting", quantity: 2, unitPrice: 100 } }],
      }),
      "POST /api/documents/types/credit-note/actions/save-draft": (_url, init) => {
        const body = JSON.parse(String(init?.body))
        saved = {
          id: "cn-1",
          typeId: "credit-note",
          status: "draft",
          data: body.data,
          createdAt: "2026-08-29T00:00:00.000Z",
          updatedAt: "2026-08-29T00:00:00.000Z",
          displayNumber: null,
          lastActionError: null,
        }
        return { changed: true, document: saved, message: "Done." }
      },
    })

    renderDocumentTypeScreen("credit-note")

    fireEvent.click(await screen.findByTestId("document-create-button"))
    await screen.findByTestId("document-create-dialog")

    // Each SearchSelect's `data-cy` lands on its own wrapping <div> (search-input.tsx) — the actual
    // <button>/toggle control a click (or `toBeDisabled`) must target is the element inside it.
    const currencyTrigger = () =>
      within(screen.getByTestId("document-field-currency-input")).getByRole("button")
    const invoiceTrigger = () =>
      within(screen.getByTestId("document-field-invoice-input")).getByRole("button")

    // The reference field: no invoice picked yet, currency still a normal, editable select.
    expect(currencyTrigger()).not.toBeDisabled()

    fireEvent.click(invoiceTrigger())
    fireEvent.click(await screen.findByTestId("document-field-invoice-input-option-invoice-inv-2026-0009"))

    // Picking the invoice locks the currency to ITS OWN ("EUR") — disabled, with the reference
    // note shown — never a value the user could still pick independently.
    await waitFor(() => expect(currencyTrigger()).toHaveTextContent("EUR"))
    expect(currencyTrigger()).toBeDisabled()
    expect(screen.getByTestId("document-field-currency-note")).toHaveTextContent("cannot be edited directly")

    // The corrected line, picked from the invoice's own lines (rowSelection, live off `invoice`).
    fireEvent.click(await screen.findByTestId("document-field-correctedLines-row-line-1-checkbox"))

    fireEvent.click(screen.getByTestId("document-action-save-draft"))
    await waitFor(() => expect(saved).toBeDefined())
    expect(saved?.data).toMatchObject({ invoice: "inv-9", currency: "EUR", correctedLines: ["line-1"] })

    // Second half of the journey: the invoice this credit note corrects now shows it at settlement —
    // a SEPARATE mount of the real invoice screens (document-settlement.tsx renders on the invoice's
    // OWN page, under ITS OWN type route), fed the settlement the backend would now compute once the
    // credit note above is persisted.
    const invoiceDescriptor: DocumentTypeDescriptor = {
      id: "invoice",
      label: "Invoice",
      statuses: [{ id: "sent", label: "Sent" }],
      initialStatus: "draft",
      numbering: { onEnterStatus: "sent" },
      fields: [{ key: "issueDate", kind: "date", label: "Date", required: true }],
      actions: [{ id: "record-payment", label: "Record payment", availableWhen: ["sent"] }],
    }
    const invoiceInstance: DocumentInstance = {
      id: "inv-9",
      typeId: "invoice",
      status: "sent",
      data: { issueDate: "2026-08-01T00:00:00.000Z" },
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
      displayNumber: "INV-2026-0009",
      lastActionError: null,
    }

    installFetchMock({
      "GET /api/documents/types/invoice": () => invoiceDescriptor,
      "GET /api/documents": () => [invoiceInstance],
      "GET /api/documents/inv-9": () => invoiceInstance,
      "GET /api/documents/inv-9/authority-events": () => [],
      "GET /api/documents/inv-9/archives": () => [],
      "GET /api/documents/inv-9/settlement": () => ({
        totals: { currency: "EUR", grossMinor: 24000 },
        payments: [],
        credits: [{ id: "cn-1", displayNumber: null, amountMinor: 12000, currency: "EUR" }],
        warnings: [],
        settlement: {
          totalGrossMinor: 24000,
          paidMinor: 0,
          creditedMinor: 12000,
          outstandingMinor: 12000,
          excessMinor: 0,
          settled: false,
        },
      }),
    })

    renderDocumentTypeScreen("invoice")

    fireEvent.click(await screen.findByTestId("document-open-link-inv-9"))
    await screen.findByTestId("document-settlement-section")
    expect(screen.getByTestId("document-settlement-credit-cn-1")).toHaveTextContent("120.00 EUR")
    expect(screen.getByTestId("document-settlement-credited")).toHaveTextContent("120.00 EUR")
  })
  // MUTATION (proven, reverted): document-settlement.tsx — the credits block's own guard,
  // `credits.length > 0 || warnings.length > 0` -> `false`. RED: "document-settlement-credit-cn-1"
  // never renders even though the settlement response still carries the credit note — the ONE thing
  // this journey exists to prove (a credit note is visible at the invoice's own settlement) silently
  // disappears from the screen. Reverted; suite green again.
})

describe("Cancellation — the journey as it exists (GAP logged: no dedicated screen)", () => {
  /**
   * GAP LOGGED: `grep`-ing the five shipped descriptors
   * (`backend/src/modules/documents/descriptors/*.descriptor.ts` — invoice, credit-note, quote,
   * expense, received-invoice) and every Cypress spec (`e2e/cypress/e2e/*.cy.ts`) finds NOWHERE a
   * "cancel"/"void"/"annul" action for an already-issued document. `LifecyclePolicy.cancellation`
   * exists in the compliance ENGINE (`state-machine-preview.ts`, `GET /compliance/
   * state-machine-preview` — a PREVIEW endpoint, never rendered on any screen, see
   * `grep -rn state-machine-preview src`: zero components, zero pages) but is wired to NO button,
   * no dialog, for any of the five real types. There is therefore no cancellation journey to
   * observe today — only a generic GUARD (`isActionAvailable`, types.ts) that would decide whether a
   * future "cancel" appears or not depending on the current status: it is THIS guard, the only real
   * mechanism in play, that this test locks down, on the real screen, with a hypothetical "cancel"
   * action declared by the descriptor (a piece of data, exactly like "send"/"record-payment" already
   * are — see this file's own header: « add an action... this component never changes either
   * way ») restricted to "draft" — never "sent", the only point that matters as long as no law has
   * been established on what cancelling an ISSUED invoice would mean.
   */
  it("never renders a 'cancel' action for an already-SENT invoice, even when one is declared for drafts", async () => {
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
        // Hypothetical — declared here ONLY to exercise the real status gate a shipped "cancel"
        // would depend on; no such action exists in any descriptor this app actually ships today.
        { id: "cancel", label: "Cancel", availableWhen: ["draft"] },
      ],
    }

    const instance: DocumentInstance = {
      id: "inv-5",
      typeId: "invoice",
      status: "sent",
      data: { issueDate: "2026-08-15T00:00:00.000Z" },
      createdAt: "2026-08-15T00:00:00.000Z",
      updatedAt: "2026-08-15T00:00:00.000Z",
      displayNumber: "INV-2026-0005",
      lastActionError: null,
    }

    installFetchMock({
      "GET /api/documents/types/invoice": () => descriptor,
      "GET /api/documents": () => [instance],
      "GET /api/documents/inv-5": () => instance,
      "GET /api/documents/inv-5/authority-events": () => [],
      "GET /api/documents/inv-5/archives": () => [],
    })

    renderDocumentTypeScreen("invoice")

    await waitFor(() => expect(screen.getByTestId("document-status-badge")).toHaveTextContent("Sent"))
    expect(screen.queryByTestId("document-row-action-cancel-inv-5")).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId("document-open-link-inv-5"))
    await screen.findByTestId("document-form")
    // Neither as the page's primary button nor inside its actions menu. Opened from the keyboard: a
    // Radix menu trigger listens to pointerdown (never a synthetic `click`) and to Enter/Space, and
    // jsdom has no real pointer events to offer.
    expect(screen.queryByTestId("document-action-cancel")).not.toBeInTheDocument()
    fireEvent.keyDown(screen.getByTestId("document-actions-menu"), { key: "Enter" })
    await screen.findByTestId("document-actions-menu-content")
    expect(screen.queryByTestId("document-action-cancel")).not.toBeInTheDocument()
  })
  // MUTATION (proven, reverted): types.ts — `isActionAvailable`'s own status gate,
  // `const availableByDescriptor = action.availableWhen === "always" || (status !== undefined &&
  // action.availableWhen.includes(status))` -> `const availableByDescriptor = true`. RED: the
  // draft-only "cancel" action now renders for the SENT instance too, in both the list row
  // ("document-row-action-cancel-inv-5") and the record's page ("document-action-cancel") — exactly
  // the failure mode that would silently expose a future cancel action on a document it was never
  // scoped for. Reverted; suite green again.
})

/**
 * The "Correct" screen: a country-is-data dialog rendered off the
 * `GET .../correction-routes`, on the REAL screen (custom/invoice-correction-routes-button.tsx,
 * registered through custom-registrations.ts like every other slot), never a re-implementation of the
 * status/label vocabulary. Four journeys: FR sees the internal credit
 * note IMPOSED and reaches the real, pre-linked credit-note screen; PL sees the SAME routeId
 * FORBIDDEN, disabled, with its own reason; a declared-but-unwired route shows the honest
 * "not implemented" panel, never a stub; an unresolved seller country shows the backend's own NAMED
 * 404, verbatim.
 */
describe("Correct — correction routes, by seller country", () => {
  const invoiceDescriptor: DocumentTypeDescriptor = {
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

  function issuedInvoice(id: string): DocumentInstance {
    return {
      id,
      typeId: "invoice",
      status: "sent",
      data: { issueDate: "2026-08-20T00:00:00.000Z" },
      createdAt: "2026-08-20T00:00:00.000Z",
      updatedAt: "2026-08-20T00:00:00.000Z",
      displayNumber: `INV-${id}`,
      lastActionError: null,
    }
  }

  const frCitation =
    'Dans les cas des statuts "Refusée" ou "Rejetée", le fournisseur doit procéder à une annulation ' +
    "comptable (avoir interne). Cette opération ne doit pas générer de flux de données réglementaires " +
    "(F1) au PPF."
  const plCitation =
    "Po przesłaniu pliku faktury do KSeF nie jest możliwe jej edytowanie… Jedyną formą poprawienia " +
    "błędu… jest wystawienie faktury korygującej w KSeF."
  const creditNoteAllowedCitation =
    "la rectification des factures s'entend [...] de l'envoi d'une note d'avoir."
  const limitationText =
    "This reads the document's SELLER country only — never the buyer's. See the seller×buyer " +
    "composition limitation."

  it("seller FR: the internal credit note (INTERNAL_CREDIT_NOTE) is shown IMPOSED with its legal basis, clickable, and leads to the REAL pre-linked credit note (reference filled, currency locked)", async () => {
    const invoice = issuedInvoice("inv-fr")
    const creditNoteDescriptor: DocumentTypeDescriptor = {
      id: "credit-note",
      label: "Credit note",
      statuses: [{ id: "draft", label: "Draft" }],
      initialStatus: "draft",
      fields: [
        { key: "invoice", kind: "reference", label: "Invoice", required: true, entity: "invoice" },
        {
          key: "currency",
          kind: "select",
          label: "Currency",
          required: true,
          options: [{ value: "EUR", label: "EUR" }],
          lockedFromReference: { field: "invoice", entity: "invoice", sourceKey: "currency" },
        },
      ],
      actions: [],
    }

    installFetchMock({
      "GET /api/documents/types/invoice": () => invoiceDescriptor,
      "GET /api/documents/types/credit-note": () => creditNoteDescriptor,
      "GET /api/documents": (url) => (url.searchParams.get("typeId") === "credit-note" ? [] : [invoice]),
      "GET /api/documents/inv-fr/authority-events": () => [],
      "GET /api/documents/inv-fr/correction-routes": () => ({
        countryCode: "FR",
        routes: [
          { routeId: "INTERNAL_CREDIT_NOTE", status: "required", label: frCitation, implemented: true },
          {
            routeId: "CREDIT_NOTE",
            status: "allowed",
            label: creditNoteAllowedCitation,
            implemented: false,
          },
        ],
        limitation: limitationText,
      }),
      "GET /api/documents/references/invoice/search": () => [{ id: "inv-fr", label: "INV-inv-fr" }],
      "GET /api/documents/references/invoice/inv-fr": () => ({ id: "inv-fr", label: "INV-inv-fr" }),
      "GET /api/documents/references/invoice/inv-fr/fields": () => ({ currency: "EUR" }),
    })

    renderDocumentTypeScreen("invoice")

    fireEvent.click(await screen.findByTestId("document-correction-button-inv-fr"))
    await screen.findByTestId("document-correction-dialog")

    const requiredRow = await screen.findByTestId("document-correction-route-INTERNAL_CREDIT_NOTE")
    expect(
      within(requiredRow).getByTestId("document-correction-route-INTERNAL_CREDIT_NOTE-status"),
    ).toHaveTextContent("Required by law")
    expect(
      within(requiredRow).getByTestId("document-correction-route-INTERNAL_CREDIT_NOTE-label"),
    ).toHaveTextContent(frCitation)
    const chooseButton = within(requiredRow).getByTestId(
      "document-correction-route-INTERNAL_CREDIT_NOTE-button",
    )
    expect(chooseButton).not.toBeDisabled()

    fireEvent.click(chooseButton)

    // THE REAL mechanism — a fresh mount of the credit-note create screen, pre-linked: the invoice
    // reference already resolved, the currency lock already engaged, no manual search needed.
    await screen.findByTestId("document-create-dialog")
    await waitFor(() =>
      expect(
        within(screen.getByTestId("document-field-currency-input")).getByRole("button"),
      ).toHaveTextContent("EUR"),
    )
    expect(within(screen.getByTestId("document-field-currency-input")).getByRole("button")).toBeDisabled()
    expect(within(screen.getByTestId("document-field-invoice-input")).getByRole("button")).toHaveTextContent(
      "INV-inv-fr",
    )
  })
  // MUTATION (proven, reverted): invoice-correction-routes-button.tsx — `isChoosable`'s own
  // `route.status === "required" || route.status === "allowed"` -> `true` (see the dedicated
  // red→green mutation test below, which targets this exact function against the PL fixture instead
  // of repeating the same fixture here).

  it("seller PL: the SAME routeId (INTERNAL_CREDIT_NOTE) is shown FORBIDDEN, disabled, with its own reason — never the French route", async () => {
    const invoice = issuedInvoice("inv-pl")

    installFetchMock({
      "GET /api/documents/types/invoice": () => invoiceDescriptor,
      "GET /api/documents": () => [invoice],
      "GET /api/documents/inv-pl/authority-events": () => [],
      "GET /api/documents/inv-pl/correction-routes": () => ({
        countryCode: "PL",
        routes: [
          { routeId: "INTERNAL_CREDIT_NOTE", status: "forbidden", label: plCitation, implemented: true },
        ],
        limitation: limitationText,
      }),
    })

    renderDocumentTypeScreen("invoice")

    fireEvent.click(await screen.findByTestId("document-correction-button-inv-pl"))
    const forbiddenRow = await screen.findByTestId("document-correction-route-INTERNAL_CREDIT_NOTE")

    expect(
      within(forbiddenRow).getByTestId("document-correction-route-INTERNAL_CREDIT_NOTE-status"),
    ).toHaveTextContent("Forbidden")
    const button = within(forbiddenRow).getByTestId("document-correction-route-INTERNAL_CREDIT_NOTE-button")
    expect(button).toBeDisabled()
    // The reason is the country's OWN citation, wrapped in the same policyBlockedReason phrasing the
    // rest of this screen already uses — never hidden, never a generic "blocked" with no reason.
    expect(
      within(forbiddenRow).getByTestId("document-correction-route-INTERNAL_CREDIT_NOTE-reason"),
    ).toHaveTextContent(plCitation)
    expect(
      within(forbiddenRow).getByTestId("document-correction-route-INTERNAL_CREDIT_NOTE-reason"),
    ).toHaveTextContent("Not available:")

    // Never even reaches the credit-note screen — a forbidden route has no click to fire in the
    // first place, whatever `implemented` claims (this fixture deliberately sets it `true`, exactly
    // the case a naive "implemented alone decides clickability" bug would get wrong).
    expect(screen.queryByTestId("document-create-dialog")).not.toBeInTheDocument()
  })

  it("a DECLARED but NOT IMPLEMENTED route (CREDIT_NOTE, allowed in France): the honest 501 state, never a stub that pretends to work", async () => {
    const invoice = issuedInvoice("inv-notimpl")

    installFetchMock({
      "GET /api/documents/types/invoice": () => invoiceDescriptor,
      "GET /api/documents": () => [invoice],
      "GET /api/documents/inv-notimpl/authority-events": () => [],
      "GET /api/documents/inv-notimpl/correction-routes": () => ({
        countryCode: "FR",
        routes: [
          {
            routeId: "CREDIT_NOTE",
            status: "allowed",
            label: creditNoteAllowedCitation,
            implemented: false,
          },
        ],
        limitation: limitationText,
      }),
    })

    renderDocumentTypeScreen("invoice")

    fireEvent.click(await screen.findByTestId("document-correction-button-inv-notimpl"))
    const allowedRow = await screen.findByTestId("document-correction-route-CREDIT_NOTE")
    const button = within(allowedRow).getByTestId("document-correction-route-CREDIT_NOTE-button")
    expect(button, "permise par la loi française, donc cliquable").not.toBeDisabled()

    fireEvent.click(button)

    const panel = await screen.findByTestId("document-correction-not-implemented")
    expect(panel).toHaveTextContent("Credit note")
    expect(panel).toHaveTextContent("FR")
    expect(panel).toHaveTextContent("not implement")
    // Never a stub pretending to work: no create dialog for any type ever opens.
    expect(screen.queryByTestId("document-create-dialog")).not.toBeInTheDocument()
  })

  it("seller country with NO FILE: the API's NAMED 404, verbatim — never an empty dialog", async () => {
    const invoice = issuedInvoice("inv-be")
    const namedMessage =
      'Aucune règle de correction déclarée pour BE — no correction-routes rule is declared for "BE" yet.'

    installFetchMock({
      "GET /api/documents/types/invoice": () => invoiceDescriptor,
      "GET /api/documents": () => [invoice],
      "GET /api/documents/inv-be/authority-events": () => [],
      "GET /api/documents/inv-be/correction-routes": () => ({
        status: 404,
        body: { message: namedMessage },
      }),
    })

    renderDocumentTypeScreen("invoice")

    fireEvent.click(await screen.findByTestId("document-correction-button-inv-be"))
    const errorMessage = await screen.findByTestId("document-correction-error-message")
    expect(errorMessage).toHaveTextContent(namedMessage)
  })

  it("Seller FR: CANCEL_AND_REPLACE is IMPLEMENTED; the click requires an irreversibility confirmation before actually cancelling", async () => {
    const invoice = issuedInvoice("inv-cancel-fr")
    const cancelCitation =
      "Doit porter référence exacte à la facture initiale et la mention expresse de l'annulation de " +
      "celle-ci."
    let ranCancel = false

    installFetchMock({
      "GET /api/documents/types/invoice": () => invoiceDescriptor,
      "GET /api/documents": () => [invoice],
      "GET /api/documents/inv-cancel-fr/authority-events": () => [],
      "GET /api/documents/inv-cancel-fr/correction-routes": () => ({
        countryCode: "FR",
        routes: [
          {
            routeId: "CANCEL_AND_REPLACE",
            status: "allowed",
            label: cancelCitation,
            implemented: true,
          },
        ],
        limitation: limitationText,
      }),
      "POST /api/documents/types/invoice/actions/cancel": () => {
        ranCancel = true
        return {
          changed: true,
          message: "Cancelled.",
          document: { ...invoice, status: "cancelled" },
        }
      },
    })

    renderDocumentTypeScreen("invoice")

    fireEvent.click(await screen.findByTestId("document-correction-button-inv-cancel-fr"))
    const row = await screen.findByTestId("document-correction-route-CANCEL_AND_REPLACE")
    const chooseButton = within(row).getByTestId("document-correction-route-CANCEL_AND_REPLACE-button")
    expect(chooseButton).not.toBeDisabled()

    fireEvent.click(chooseButton)

    // The confirmation step — clicking "choose" never cancels on its own.
    const confirmPanel = await screen.findByTestId("document-correction-confirm-cancel")
    expect(confirmPanel).toHaveTextContent("cannot be undone")
    expect(screen.getByTestId("document-correction-confirm-cancel-label")).toHaveTextContent(cancelCitation)
    expect(ranCancel, "no cancel ran yet — only the confirmation panel opened").toBe(false)

    fireEvent.click(screen.getByTestId("document-correction-confirm-cancel-confirm"))

    await waitFor(() => expect(ranCancel).toBe(true))
  })
  // MUTATION (proven, reverted): invoice-correction-routes-button.tsx — the CANCEL_AND_REPLACE branch
  // in `handleChoose` disabled (`if (false && route.routeId === ...)`). RED: "document-correction-
  // confirm-cancel" never appears — the choose click falls through to the generic "not-implemented"
  // panel instead, exactly the silent regression that would let a click skip the irreversibility
  // confirmation. Reverted; suite green again.
  // MUTATION (proven, reverted): invoice-correction-routes-button.tsx — `isChoosable`'s own
  // `route.status === "required" || route.status === "allowed"` -> `true` unconditionally. RED: the
  // PL test above ("the SAME routeId ... is shown FORBIDDEN, disabled") fails —
  // "document-correction-route-INTERNAL_CREDIT_NOTE-button" is no longer disabled even though its own
  // status is still "forbidden", and clicking it would silently navigate to the credit-note screen
  // for a route the seller's own country refuses outright. Reverted; suite green again.
})
