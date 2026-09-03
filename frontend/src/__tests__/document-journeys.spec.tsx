import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PageHeaderProvider } from "@/components/page-header-provider"
import type { DocumentInstance, DocumentTypeDescriptor } from "@/components/documents/types"
import { useDocumentEventsSse } from "@/hooks/use-document-events-sse"
import * as useFetchModule from "@/hooks/use-fetch"

import DocumentTypePage from "@/pages/(app)/documents/[typeId]"

/**
 * TODO_PRODUIT.md T6 / PLAN-V2 P4-T02 — journey coverage, not line coverage: five NAMED tests, one
 * per parcours (émission, rejet, correction, avoir, annulation), each rendering the REAL screen this
 * app actually ships (`DocumentTypePage` — the exact component `[typeId].tsx`'s own route mounts, the
 * SAME tree `document-list.tsx`/`document-form.tsx`/`document-conformity-section.tsx`/
 * `document-settlement.tsx` compose into in production), never an isolated component standing in for
 * it. The API boundary is mocked at `fetch` — this codebase's own boundary (`use-fetch.ts`'s
 * `authenticatedFetch`, wrapped by `use-api-query.ts`'s `apiFetch`) — never a re-implementation of any
 * business rule, so a descriptor/action/event handed back here is exactly the shape a real backend
 * response would carry. i18n is the REAL instance (`src/test/setup.ts`), never mocked. Each `it()`
 * ends with a comment naming the ONE production-code mutation proven to turn it red (see this task's
 * own report for the full red→green trace of all five).
 */

vi.mock("@/hooks/use-fetch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-fetch")>()
  return { ...actual, useSse: vi.fn() }
})

const mockedUseSse = vi.mocked(useFetchModule.useSse)

function sseResult(data: useFetchModule.useSseResult["data"]): useFetchModule.useSseResult {
  return { data, loading: false, error: null, close: vi.fn() }
}

/** Mounted alongside the page in the ÉMISSION journey only — the exact hook `(app)/_layout.tsx`
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

describe("Émission — brouillon envoyé, l'écran suit sans reload (T1's SSE mechanism)", () => {
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

describe("Rejet — un verdict d'autorité négatif journalisé apparaît sur le panneau de conformité", () => {
  it("shows the Rejected badge on the list row and the reason in the edit dialog's timeline", async () => {
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

    // The list itself, with the dialog still closed — root TODO item 10's own "un indicateur discret
    // pour rejeté", proven end to end through the real query, not just `computeConformityVerdict`'s
    // own pure-function unit tests (document-conformity-section.spec.tsx).
    await waitFor(() =>
      expect(screen.getByTestId("document-conformity-badge-inv-2")).toHaveTextContent("Rejected"),
    )

    fireEvent.click(screen.getByTestId("document-edit-button-inv-2"))

    await waitFor(() => expect(screen.getByTestId("document-conformity-badge")).toHaveTextContent("Rejected"))
    expect(screen.getByTestId("document-conformity-event-reason")).toHaveTextContent("BR-FR-05/BT-22")
  })
  // MUTATION (proven, reverted): document-conformity-section.tsx —
  // `if (verdict !== "rejected" && verdict !== "declarationIssue") return null` (the LIST indicator's
  // own gate) -> `if (verdict !== "accepted") return null`. RED: the list row's own
  // "document-conformity-badge-inv-2" never appears (a rejected deposit renders no indicator at all
  // on the row a reader is actually scanning). Reverted; suite green again.
})

describe("Correction — ce que l'écran offre RÉELLEMENT aujourd'hui (pas un écran dédié)", () => {
  /**
   * ÉCART CONSIGNÉ (voir le rapport de tâche pour le détail) : aucun descripteur (invoice,
   * credit-note, quote, expense, received-invoice — les cinq lus depuis `backend/src/modules/
   * documents/descriptors/`) ne déclare d'action "correct"/"amend", et aucun composant frontend n'a
   * de dialogue de correction. La SEULE chose que l'écran fait aujourd'hui avec « corriger une facture
   * émise » est : re-ouvrir le formulaire et cliquer "Save draft" (invoice.descriptor.ts's own
   * `SAVE_DRAFT_TRANSITIONS: [{ from: 'always', to: 'draft' }]`) — un simple redémarrage de brouillon,
   * jamais un document de correction distinct. La France elle-même REFUSE ce chemin (country-policy/
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
      "GET /api/documents/inv-3/authority-events": () => [],
      "GET /api/documents/inv-3/archives": () => [],
    })

    renderDocumentTypeScreen("invoice")

    await waitFor(() => expect(screen.getByTestId("document-edit-button-inv-3")).toBeInTheDocument())
    fireEvent.click(screen.getByTestId("document-edit-button-inv-3"))

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

describe("Avoir — la référence obligatoire, la devise verrouillée (T4-d), le crédit visible au règlement", () => {
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

    // T4-d: picking the invoice locks the currency to ITS OWN ("EUR") — disabled, with the reference
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
    // a SEPARATE mount of the real invoice screen (document-settlement.tsx renders inside ITS OWN
    // edit dialog, on ITS OWN type route), fed the settlement the backend would now compute once the
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

    fireEvent.click(await screen.findByTestId("document-edit-button-inv-9"))
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

describe("Annulation — le parcours tel qu'il existe (ÉCART consigné : aucun écran dédié)", () => {
  /**
   * ÉCART CONSIGNÉ (voir le rapport de tâche) : `grep`-ing les cinq descripteurs shippés
   * (`backend/src/modules/documents/descriptors/*.descriptor.ts` — invoice, credit-note, quote,
   * expense, received-invoice) et chaque spec Cypress (`e2e/cypress/e2e/*.cy.ts`) ne trouve NULLE
   * PART une action "cancel"/"void"/"annul" pour un document déjà émis. `LifecyclePolicy.cancellation`
   * existe dans le MOTEUR de conformité (`state-machine-preview.ts`, `GET /compliance/
   * state-machine-preview` — un endpoint de PRÉVISUALISATION, jamais rendu sur aucun écran, voir
   * `grep -rn state-machine-preview src` : zéro composant, zéro page) mais n'est câblé à AUCUN bouton,
   * aucun dialogue, pour aucun des cinq types réels. Il n'y a donc pas de parcours d'annulation à
   * observer aujourd'hui — seulement un GARDE-FOU générique (`isActionAvailable`, types.ts) qui
   * déciderait si un futur "cancel" apparaîtrait ou non selon le statut courant : c'est CE garde-fou,
   * le seul mécanisme réel en jeu, que ce test verrouille, sur l'écran réel, avec une action "cancel"
   * hypothétique déclarée par le descripteur (une donnée, exactement comme "send"/"record-payment" le
   * sont déjà — voir ce fichier's own header : « add an action... this component never changes either
   * way ») restreinte à "draft" — jamais "sent", le seul point qui compte tant qu'aucune loi n'a été
   * établie sur ce qu'annuler une facture ÉMISE voudrait dire (voir PLAN-V2's own Phase 3 ter).
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
      "GET /api/documents/inv-5/authority-events": () => [],
      "GET /api/documents/inv-5/archives": () => [],
    })

    renderDocumentTypeScreen("invoice")

    await waitFor(() => expect(screen.getByTestId("document-status-badge")).toHaveTextContent("Sent"))
    expect(screen.queryByTestId("document-row-action-cancel-inv-5")).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId("document-edit-button-inv-5"))
    await screen.findByTestId("document-form")
    expect(screen.queryByTestId("document-action-cancel")).not.toBeInTheDocument()
  })
  // MUTATION (proven, reverted): types.ts — `isActionAvailable`'s own status gate,
  // `const availableByDescriptor = action.availableWhen === "always" || (status !== undefined &&
  // action.availableWhen.includes(status))` -> `const availableByDescriptor = true`. RED: the
  // draft-only "cancel" action now renders for the SENT instance too, in both the list row
  // ("document-row-action-cancel-inv-5") and the edit dialog ("document-action-cancel") — exactly
  // the failure mode that would silently expose a future cancel action on a document it was never
  // scoped for. Reverted; suite green again.
})
