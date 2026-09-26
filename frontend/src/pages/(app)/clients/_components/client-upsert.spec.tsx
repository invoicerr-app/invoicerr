import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ClientUpsert } from "@/pages/(app)/clients/_components/client-upsert"
import type { Client } from "@/types"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
import { toast } from "sonner"

/** Same fetch-boundary mocking convention as `article-upsert.spec.tsx` (kept local, same
 *  convention — see that file's own header). */
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

/** A COMPLETE, already-valid COMPANY client — `countryCode` deliberately left unset (unlike a real
 *  `CountrySelect` pick, which always sets both together) so this test never has to also mock the
 *  country-gated `required-identifiers`/`company-lookup` capability endpoints, neither of which the
 *  defect under test has anything to do with. */
const CLIENT: Client = {
  id: "client-1",
  name: "Acme Corp",
  type: "COMPANY",
  kind: "BUSINESS",
  contactEmail: "billing@acme.test",
  // #415: the API always returns `contacts` now (ordered primary-first) - this is what the
  // wizard's own contacts step actually reads to build its rows, `contactEmail` above stays purely
  // as the derived, read-only flat field a caller unaware of `contacts` would still see.
  contacts: [{ id: "contact-1", email: "billing@acme.test", isPrimary: true }],
  address: "1 Rue de Paris",
  city: "Paris",
  country: "France",
}

function renderDialog(client: Client | null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      {/* `MemoryRouter` — the duplicate-warning banner's own "View existing client" is a real
       *  `<Link>` (react-router), which throws without a Router ancestor even when nothing in a
       *  given test ever navigates. */}
      <MemoryRouter>
        <ClientUpsert client={client} open onOpenChange={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** `SteppedDialog`'s `DialogContent` (Radix) teleports into a portal appended straight to
 *  `document.body` — see `article-upsert.spec.tsx`'s own identical helper for why `container` alone
 *  can't reach it. */
function fieldInput(name: string): HTMLInputElement {
  const input = document.body.querySelector(`input[name="${name}"]`)
  if (!input) throw new Error(`No input named "${name}" in the document`)
  return input as HTMLInputElement
}

/** Drives a brand-new CREATE dialog from the Identity step to the Address step — the minimum every
 *  language-suggestion test below needs before it can pick a country. Company name is the only
 *  thing Identity requires with the default COMPANY type. */
async function advanceToAddressStep() {
  await screen.findByTestId("client-dialog-step-body-identity")
  fireEvent.change(fieldInput("name"), { target: { value: "Nowa Firma" } })
  fireEvent.click(screen.getByTestId("client-dialog-continue"))
  await screen.findByTestId("client-dialog-step-body-address")
}

/** Picks `label` (the exact `Intl.DisplayNames` English label `CountrySelect` renders — i18n is
 *  pinned to "en" in `test/setup.ts`) from the country popover the Address step renders. */
function pickCountry(label: string) {
  fireEvent.click(within(screen.getByTestId("client-country-select")).getByRole("button"))
  fireEvent.click(
    screen.getByTestId(`client-country-select-option-${label.toLowerCase().replace(/\s+/g, "-")}`),
  )
}

describe("<ClientUpsert>", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // `CountrySelect`'s popover and `DocumentLanguageSelect`'s Radix `<Select>` both position
    // themselves through Radix's Popper primitive (needs `ResizeObserver`, absent from jsdom) and,
    // for the Select, scroll the active item into view on open (`scrollIntoView`, also absent) —
    // same stub as `date-picker.spec.tsx`/`office-svg.spec.tsx` for the same reason.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    Element.prototype.scrollIntoView = vi.fn()
  })

  it("does not save an emptied required field after jumping past it via a header chip to the Summary step", async () => {
    const patch = vi.fn()
    installFetchMock({
      "GET /api/custom-fields/resolved": () => [],
      "PATCH /api/clients/client-1": (_url, init) => {
        patch(init?.body ? JSON.parse(init.body as string) : undefined)
        return CLIENT
      },
    })

    renderDialog(CLIENT)

    // Editing an already-valid client opens every step's header chip clickable from the start
    // (`initialMaxReached`) — no need to walk forward through the wizard first. The dialog opens on
    // the Identity step, which already renders "name" for a COMPANY client.
    await screen.findByTestId("client-dialog-step-body-identity")
    fireEvent.change(fieldInput("name"), { target: { value: "" } })

    // Jump STRAIGHT to the read-only Summary step via its header chip — `stepperJumpTo` never
    // revalidates a step it lands ON, so Identity's own emptied, now-invalid "name" is never
    // re-checked on the way, and the Summary step itself declares `fields: []` (nothing of its own
    // to validate against).
    fireEvent.click(screen.getByTestId("client-dialog-step-recap"))
    fireEvent.click(await screen.findByTestId("client-submit"))

    // No silent save with the invalid value: `SteppedDialog` itself re-validates the WHOLE form on
    // the last step's submit and jumps back to the step actually carrying the error BEFORE this
    // component's own `onSubmit` (and its `safeParse` last-line-of-defense) ever runs.
    await waitFor(() => expect(patch).not.toHaveBeenCalled())
    expect(toast.error).not.toHaveBeenCalled()

    // The error is visible RIGHT NOW: the wizard jumped back to Identity (the step that actually
    // renders "name"), instead of leaving the user on a Summary screen whose own "Continue" button
    // just silently refused to do anything.
    expect(await screen.findByText("Company name is required")).toBeInTheDocument()
    expect(screen.getByTestId("client-dialog-step-body-identity")).toBeInTheDocument()
  })

  it("saves with a BLANK email — the field is optional, not a client-side block", async () => {
    const patch = vi.fn()
    installFetchMock({
      "GET /api/custom-fields/resolved": () => [],
      "GET /api/clients/duplicates": () => [],
      "PATCH /api/clients/client-1": (_url, init) => {
        patch(init?.body ? JSON.parse(init.body as string) : undefined)
        return { ...CLIENT, contactEmail: "" }
      },
    })

    renderDialog(CLIENT)

    fireEvent.click(await screen.findByTestId("client-dialog-step-contact"))
    await screen.findByTestId("client-dialog-step-body-contact")
    fireEvent.change(fieldInput("contacts.0.email"), { target: { value: "" } })

    fireEvent.click(screen.getByTestId("client-dialog-step-recap"))
    fireEvent.click(await screen.findByTestId("client-submit"))

    await waitFor(() => expect(patch).toHaveBeenCalled())
    expect(patch.mock.calls[0][0].contacts[0].email).toBe("")
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("shows a non-blocking duplicate warning naming the existing client, without stopping the save", async () => {
    const patch = vi.fn()
    installFetchMock({
      "GET /api/custom-fields/resolved": () => [],
      "GET /api/clients/duplicates": () => [
        {
          id: "existing-client-9",
          name: "Existing Dupe SARL",
          contactEmail: "billing@acme.test",
          country: "France",
          matchedOn: ["email"],
        },
      ],
      "PATCH /api/clients/client-1": (_url, init) => {
        patch(init?.body ? JSON.parse(init.body as string) : undefined)
        return CLIENT
      },
    })

    renderDialog(CLIENT)

    fireEvent.click(await screen.findByTestId("client-dialog-step-contact"))
    await screen.findByTestId("client-dialog-step-body-contact")

    // Visible: the warning names the OTHER client the email collides with.
    const warning = await screen.findByTestId("client-duplicate-warning")
    expect(warning.textContent).toContain("Existing Dupe SARL")

    // Non-blocking: the warning being on screen does not stop "Continue"/"Save".
    fireEvent.click(screen.getByTestId("client-dialog-step-recap"))
    fireEvent.click(await screen.findByTestId("client-submit"))

    await waitFor(() => expect(patch).toHaveBeenCalled())
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("pre-fills the language from the country when creating a client, flagged as a suggestion", async () => {
    installFetchMock({
      "GET /api/custom-fields/resolved": () => [],
      "GET /api/documents/required-identifiers": () => ({ requirements: [] }),
      "GET /api/clients/duplicates": () => [],
    })

    renderDialog(null)
    await advanceToAddressStep()

    pickCountry("Poland")
    fireEvent.change(fieldInput("address"), { target: { value: "1 Rue Test" } })
    fireEvent.change(fieldInput("city"), { target: { value: "Warszawa" } })
    fireEvent.click(screen.getByTestId("client-dialog-continue"))

    await screen.findByTestId("client-dialog-step-body-fiscal")
    fireEvent.click(screen.getByTestId("client-dialog-continue"))

    await screen.findByTestId("client-dialog-step-body-contact")
    expect(screen.getByTestId("client-language-select")).toHaveTextContent("Polski")
    expect(screen.getByTestId("client-language-suggested-hint")).toBeInTheDocument()
  })

  it("never overwrites a language picked by hand, even after the country changes again", async () => {
    installFetchMock({
      "GET /api/custom-fields/resolved": () => [],
      "GET /api/documents/required-identifiers": () => ({ requirements: [] }),
      "GET /api/clients/duplicates": () => [],
    })

    renderDialog(null)
    await advanceToAddressStep()

    pickCountry("Poland")
    fireEvent.change(fieldInput("address"), { target: { value: "1 Rue Test" } })
    fireEvent.change(fieldInput("city"), { target: { value: "Warszawa" } })
    fireEvent.click(screen.getByTestId("client-dialog-continue"))
    await screen.findByTestId("client-dialog-step-body-fiscal")
    fireEvent.click(screen.getByTestId("client-dialog-continue"))
    await screen.findByTestId("client-dialog-step-body-contact")

    // "Polski" was suggested (proven above) — now the user picks a language BY HAND.
    fireEvent.click(screen.getByTestId("client-language-select"))
    fireEvent.click(await screen.findByTestId("client-language-select-de"))
    expect(screen.getByTestId("client-language-select")).toHaveTextContent("Deutsch")
    expect(screen.queryByTestId("client-language-suggested-hint")).not.toBeInTheDocument()

    // Back to Address, switch to a country with its OWN clear suggestion (Italy → "it") — the
    // hand-picked "de" must survive untouched, and the suggestion hint must stay gone.
    fireEvent.click(screen.getByTestId("client-dialog-step-address"))
    await screen.findByTestId("client-dialog-step-body-address")
    pickCountry("Italy")
    fireEvent.click(screen.getByTestId("client-dialog-step-contact"))
    await screen.findByTestId("client-dialog-step-body-contact")

    expect(screen.getByTestId("client-language-select")).toHaveTextContent("Deutsch")
    expect(screen.queryByTestId("client-language-suggested-hint")).not.toBeInTheDocument()
  })

  it("never touches an existing client's language, even when its country implies a different one", async () => {
    const patch = vi.fn()
    // Germany implies "de" (see country-default-language.ts) — this client's `language` is
    // deliberately left unset, so a bug re-applying the creation-time pre-fill logic while EDITING
    // would silently turn a blank ("Automatic") language into "de" the moment this dialog opens.
    const germanClientNoLanguage: Client = {
      ...CLIENT,
      country: "Germany",
      countryCode: "DE",
      language: null,
    }
    installFetchMock({
      "GET /api/custom-fields/resolved": () => [],
      "GET /api/documents/required-identifiers": () => ({ requirements: [] }),
      "GET /api/clients/duplicates": () => [],
      "PATCH /api/clients/client-1": (_url, init) => {
        patch(init?.body ? JSON.parse(init.body as string) : undefined)
        return germanClientNoLanguage
      },
    })

    renderDialog(germanClientNoLanguage)

    fireEvent.click(await screen.findByTestId("client-dialog-step-contact"))
    await screen.findByTestId("client-dialog-step-body-contact")

    expect(screen.getByTestId("client-language-select")).toHaveTextContent("Automatic")
    expect(screen.queryByTestId("client-language-suggested-hint")).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId("client-dialog-step-recap"))
    fireEvent.click(await screen.findByTestId("client-submit"))

    await waitFor(() => expect(patch).toHaveBeenCalled())
    expect(patch.mock.calls[0][0].language).toBeNull()
  })
})
