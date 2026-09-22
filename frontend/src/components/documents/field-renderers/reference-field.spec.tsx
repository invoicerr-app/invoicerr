import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { FormProvider, useForm } from "react-hook-form"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { DocumentFieldDescriptor } from "@/components/documents/types"
import {
  type ReferenceCreateComponentProps,
  registerReferenceCreateComponent,
} from "@/components/documents/reference-create-registry"

import { ReferenceField } from "./reference-field"

/**
 * A persistent "+ Create new…" option in a 'reference' field's picker, opening its registered
 * quick-create dialog ON TOP of whatever form is already open, without losing what the user already
 * typed. Exercised here against a FAKE entity/component
 * (`registerReferenceCreateComponent` is an open registry, the same shape `field-renderers/
 * registry.ts` holds for KINDS — see reference-create-registry.ts's own header) rather than the real
 * "client" -> `ClientUpsert` wiring (custom/client-quick-create.tsx): that wiring pulls in the whole
 * client wizard's own dependency surface (company lookup, country-identifiers, B2G routing…), which
 * is exactly what `05-clients.cy.ts`/`46-client-reference.cy.ts`-style Cypress coverage against the
 * real backend is for. What belongs here, and IS isolable, is the generic mechanism itself: the
 * SearchSelect footer, the registry lookup, and that opening/closing the nested dialog never touches
 * a sibling field's own value.
 */

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

/** Routes the global `fetch` this field's own hooks (`useReferenceSearch`/`useReferenceResolve`,
 *  `hooks/queries/use-document-types.ts`) go through, by `"METHOD pathname"` — same shape
 *  `__tests__/document-journeys.spec.tsx`'s own `installFetchMock` uses, kept local here since this
 *  spec needs far fewer routes. */
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

const field: DocumentFieldDescriptor = {
  key: "widget",
  kind: "reference",
  label: "Widget",
  required: true,
  entity: "quick-create-fixture",
}

/** Stands in for a real quick-create component (`custom/client-quick-create.tsx`'s own shape): a
 *  visible marker while `open`, a button that hands back a fixed id then closes itself — enough to
 *  prove `ReferenceField` wires `open`/`onOpenChange`/`onCreated` correctly without depending on any
 *  real record-creation form. */
function FixtureQuickCreate({ open, onOpenChange, onCreated }: ReferenceCreateComponentProps) {
  if (!open) return null
  return (
    <div data-cy="fixture-quick-create-dialog">
      <button
        type="button"
        onClick={() => {
          // The exact order `ClientUpsert`'s own `onSubmit` uses (client-upsert.tsx): `onCreate`
          // fires with the new record FIRST, `onOpenChange(false)` closes the dialog SECOND — so the
          // field already holds the new id by the time this dialog's own unmount runs.
          onCreated("created-id")
          onOpenChange(false)
        }}
      >
        Confirm create
      </button>
      <button type="button" onClick={() => onOpenChange(false)}>
        Cancel
      </button>
    </div>
  )
}
registerReferenceCreateComponent("quick-create-fixture", FixtureQuickCreate)

function Harness({ testField = field }: { testField?: DocumentFieldDescriptor }) {
  const form = useForm({ defaultValues: { widget: "", sibling: "" } })
  return (
    <FormProvider {...form}>
      {/* Stands in for whatever ELSE the user already typed on the surrounding document form —
          the exact thing a create-a-client-mid-form detour must never lose. */}
      <input aria-label="sibling field" {...form.register("sibling")} />
      <ReferenceField field={testField} name="widget" />
    </FormProvider>
  )
}

function renderHarness(testField?: DocumentFieldDescriptor) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <Harness testField={testField} />
    </QueryClientProvider>,
  )
}

/** The trigger's own `data-cy` also lands on the popover's portaled CONTENT while it is open
 *  (search-input.tsx applies the same `dataCyValue` to both) — `screen.getByTestId` would then match
 *  two nodes at once. `document-journeys.spec.tsx`'s own harness sidesteps this by only ever reading
 *  the wrapper BEFORE the popover opens; this test needs it AFTER too (to re-focus and to read the
 *  resolved label), so it queries the DOM directly instead — exactly what the production code itself
 *  does to restore focus (reference-field.tsx's own `onOpenChange` handler). */
function getTrigger(): HTMLButtonElement {
  const el = document.querySelector<HTMLButtonElement>('[data-cy="document-field-widget-input"] button')
  if (!el) throw new Error("trigger button not found")
  return el
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("<ReferenceField> — quick-create escape hatch", () => {
  it("offers '+ Create new Widget' even when the search matches nothing", async () => {
    installFetchMock({
      "GET /api/documents/references/quick-create-fixture/search": () => [],
      // `ReferenceField` unconditionally calls `useDocumentTypesList` (it only needs the result for
      // a MULTI-target field's per-hit label — see that hook's own callsite comment), so every test
      // here has to answer it regardless of which path is under test.
      "GET /api/documents/types": () => [],
    })
    renderHarness()

    fireEvent.click(within(screen.getByTestId("document-field-widget-input")).getByRole("button"))

    const options = await screen.findByTestId("document-field-widget-input-options")
    // The real "no matches" copy — proving the footer isn't hiding an actual result the assertion
    // below would otherwise have missed.
    expect(within(options).getByText("No matches")).toBeInTheDocument()
    expect(screen.getByTestId("document-field-widget-input-create-new")).toHaveTextContent(
      "Create new Widget",
    )
  })

  it("a field with no quick-create registered for its entity renders no footer action at all", async () => {
    installFetchMock({
      "GET /api/documents/references/unregistered-entity/search": () => [],
      "GET /api/documents/types": () => [],
    })
    const unregisteredField: DocumentFieldDescriptor = { ...field, entity: "unregistered-entity" }
    renderHarness(unregisteredField)

    fireEvent.click(within(screen.getByTestId("document-field-widget-input")).getByRole("button"))
    await screen.findByTestId("document-field-widget-input-options")
    expect(screen.queryByTestId("document-field-widget-input-create-new")).not.toBeInTheDocument()
  })

  it("opening the quick-create dialog never touches a sibling field's own value, and selecting the created record resolves and focuses back", async () => {
    installFetchMock({
      "GET /api/documents/references/quick-create-fixture/search": () => [],
      "GET /api/documents/references/quick-create-fixture/created-id": () => ({
        id: "created-id",
        label: "Freshly Created Widget",
      }),
      "GET /api/documents/types": () => [],
    })
    renderHarness()

    fireEvent.change(screen.getByLabelText("sibling field"), {
      target: { value: "Already typed before opening the picker" },
    })

    fireEvent.click(within(screen.getByTestId("document-field-widget-input")).getByRole("button"))
    await screen.findByTestId("document-field-widget-input-options")

    fireEvent.click(screen.getByTestId("document-field-widget-input-create-new"))

    // The picker's own popover closed (the footer action does that itself, same as picking an
    // ordinary option) and the registered dialog mounted in its place.
    expect(screen.queryByTestId("document-field-widget-input-options")).not.toBeInTheDocument()
    const dialog = await screen.findByTestId("fixture-quick-create-dialog")

    // The regression itself: the sibling field, never re-rendered by opening the nested dialog,
    // still holds exactly what was typed before.
    expect(screen.getByLabelText("sibling field")).toHaveValue("Already typed before opening the picker")

    fireEvent.click(within(dialog).getByText("Confirm create"))

    // The dialog closes itself (the fixture calls `onCreated` only, `ReferenceField` doesn't close
    // it — a real quick-create component owns that, same as `ClientUpsert`'s own `onSubmit`), and
    // the field's own trigger now shows the newly created record's resolved label.
    await waitFor(() => expect(screen.queryByTestId("fixture-quick-create-dialog")).not.toBeInTheDocument())
    await waitFor(() => expect(getTrigger()).toHaveTextContent("Freshly Created Widget"))

    // Two Radix Dialogs stacked, no real DialogTrigger tying them together (reference-field.tsx's
    // own header) — focus is handed back to the picker's trigger explicitly rather than trusting
    // Radix's own default, which has nothing left to restore it to (the "+ Create new…" button it
    // would otherwise remember is the one this same flow already unmounted).
    await waitFor(() => expect(document.activeElement).toBe(getTrigger()))

    expect(screen.getByLabelText("sibling field")).toHaveValue("Already typed before opening the picker")
  })
})
