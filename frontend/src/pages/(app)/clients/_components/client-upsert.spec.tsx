import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import i18n from "i18next"
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

// The Address step's `address` field is now an `AddressAutocompleteInput` (#197), which always
// checks this capability endpoint on mount regardless of what a given test is about - defaulted here
// (disabled, the self-hosted default) so none of the tests below need to know about it. A test
// exercising the feature itself overrides this key in its own `handlers` map.
const DEFAULT_HANDLERS: Record<string, FetchHandler> = {
  "GET /api/address-autocomplete/capability": () => ({ enabled: false }),
}

function installFetchMock(handlers: Record<string, FetchHandler>) {
  const merged = { ...DEFAULT_HANDLERS, ...handlers }
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input.toString()
    const url = new URL(raw, "http://localhost")
    const method = (init?.method ?? "GET").toUpperCase()
    const key = `${method} ${url.pathname}`
    const handler = merged[key]
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
  // `firstName` set so clearing `email` below leaves the row non-blank (#415 follow-up review round
  // 3, point 3: a fully blank row is dropped from the payload, never sent as an empty-string primary
  // - see `normalize-client-contacts.ts`'s own header).
  contacts: [{ id: "contact-1", firstName: "Alice", email: "billing@acme.test", isPrimary: true }],
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

/** The dialog's `DialogContent` (Radix) teleports into a portal appended straight to
 *  `document.body` — see `article-upsert.spec.tsx`'s own identical helper for why `container` alone
 *  can't reach it. */
function fieldInput(name: string): HTMLInputElement {
  const input = document.body.querySelector(`input[name="${name}"]`)
  if (!input) throw new Error(`No input named "${name}" in the document`)
  return input as HTMLInputElement
}

/** Opens a brand-new CREATE form with the one field Identity requires for the default COMPANY type. */
async function startWithName() {
  await screen.findByTestId("client-dialog-step-body-identity")
  fireEvent.change(fieldInput("name"), { target: { value: "Nowa Firma" } })
}

/** Picks `label` (the exact `Intl.DisplayNames` English label `CountrySelect` renders — i18n is
 *  pinned to "en" in `test/setup.ts`) from the country popover of the Address section. */
function pickCountry(label: string) {
  fireEvent.click(within(screen.getByTestId("client-country-select")).getByRole("button"))
  fireEvent.click(
    screen.getByTestId(`client-country-select-option-${label.toLowerCase().replace(/\s+/g, "-")}`),
  )
}

/** Picks a country in the Address section and fills the rest of it. */
function fillAddress(countryLabel: string) {
  pickCountry(countryLabel)
  fireEvent.change(fieldInput("address"), { target: { value: "1 Rue Test" } })
  fireEvent.change(fieldInput("city"), { target: { value: "Warszawa" } })
}

const CREATE_HANDLERS: Record<string, FetchHandler> = {
  "GET /api/custom-fields/resolved": () => [],
  "GET /api/documents/required-identifiers": () => ({ requirements: [] }),
  "GET /api/clients/duplicates": () => [],
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

  it("does not save an emptied required field, and takes the reader to it", async () => {
    const patch = vi.fn()
    installFetchMock({
      "GET /api/custom-fields/resolved": () => [],
      "PATCH /api/clients/client-1": (_url, init) => {
        patch(init?.body ? JSON.parse(init.body as string) : undefined)
        return CLIENT
      },
    })

    renderDialog(CLIENT)

    await screen.findByTestId("client-dialog-step-body-identity")
    fireEvent.change(fieldInput("name"), { target: { value: "" } })
    fireEvent.click(await screen.findByTestId("client-submit"))

    // The whole form is validated before this component's own `onSubmit` ever runs.
    await waitFor(() => expect(patch).not.toHaveBeenCalled())
    expect(toast.error).not.toHaveBeenCalled()
    expect(await screen.findByText("Company name is required")).toBeInTheDocument()
    await waitFor(() => expect(fieldInput("name")).toHaveFocus())
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
    await screen.findByTestId("client-dialog-step-body-contact")
    fireEvent.change(fieldInput("contacts.0.email"), { target: { value: "" } })
    fireEvent.click(await screen.findByTestId("client-submit"))

    await waitFor(() => expect(patch).toHaveBeenCalled())
    expect(patch.mock.calls[0][0].contacts[0].email).toBe("")
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("names the lock on another contact's primary radio after that control, for an individual client", async () => {
    installFetchMock({
      "GET /api/custom-fields/resolved": () => [],
      "GET /api/clients/duplicates": () => [],
    })

    renderDialog({
      ...CLIENT,
      type: "INDIVIDUAL",
      name: "",
      contactFirstname: "Jean",
      contactLastname: "Dupont",
      contacts: [
        {
          id: "contact-1",
          firstName: "Jean",
          lastName: "Dupont",
          email: "jean@example.test",
          isPrimary: true,
        },
        {
          id: "contact-2",
          firstName: "Marie",
          lastName: "Curie",
          email: "marie@example.test",
          isPrimary: false,
        },
      ],
    })
    await screen.findByTestId("client-dialog-step-body-contact")
    const lock = screen.getByRole("button", { name: "Why is Set as primary locked?" })
    expect(lock).toHaveAttribute("data-cy", "client-contact-primary-locked-1-trigger")
    expect(screen.getByTestId("client-contact-primary-radio-1")).toHaveAccessibleDescription(
      "Only the person in the Identity section can be the primary contact of an individual client.",
    )
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
    await screen.findByTestId("client-dialog-step-body-contact")

    // Visible: the warning names the OTHER client the email collides with.
    const warning = await screen.findByTestId("client-duplicate-warning")
    expect(warning.textContent).toContain("Existing Dupe SARL")

    // Non-blocking: the warning being on screen does not stop the save.
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
    await startWithName()
    fillAddress("Poland")

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
    await startWithName()

    pickCountry("Poland")
    fireEvent.change(fieldInput("address"), { target: { value: "1 Rue Test" } })
    fireEvent.change(fieldInput("city"), { target: { value: "Warszawa" } })
    await screen.findByTestId("client-dialog-step-body-fiscal")
    await screen.findByTestId("client-dialog-step-body-contact")

    // "Polski" was suggested (proven above) — now the user picks a language BY HAND.
    fireEvent.click(screen.getByTestId("client-language-select"))
    fireEvent.click(await screen.findByTestId("client-language-select-de"))
    expect(screen.getByTestId("client-language-select")).toHaveTextContent("Deutsch")
    expect(screen.queryByTestId("client-language-suggested-hint")).not.toBeInTheDocument()

    // Another country with its OWN clear suggestion (Italy → "it"): the hand-picked "de" must
    // survive untouched, and the suggestion hint must stay gone.
    await screen.findByTestId("client-dialog-step-body-address")
    pickCountry("Italy")
    await screen.findByTestId("client-dialog-step-body-contact")

    expect(screen.getByTestId("client-language-select")).toHaveTextContent("Deutsch")
    expect(screen.queryByTestId("client-language-suggested-hint")).not.toBeInTheDocument()
  })

  it("never touches an existing client's language, even when its country implies a different one", async () => {
    const patch = vi.fn()
    // Germany implies "de" (see lib/reference/countries.json) - this client's `language` is
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
    await screen.findByTestId("client-dialog-step-body-contact")

    expect(screen.getByTestId("client-language-select")).toHaveTextContent("Automatic")
    expect(screen.queryByTestId("client-language-suggested-hint")).not.toBeInTheDocument()
    fireEvent.click(await screen.findByTestId("client-submit"))

    await waitFor(() => expect(patch).toHaveBeenCalled())
    expect(patch.mock.calls[0][0].language).toBeNull()
  })

  it("pre-fills the currency from the country picked in a French interface", async () => {
    await i18n.changeLanguage("fr")
    try {
      installFetchMock(CREATE_HANDLERS)
      renderDialog(null)
      await startWithName()
      fillAddress("Allemagne")

      expect(screen.getByTestId("client-currency-select")).toHaveTextContent("Euro")
    } finally {
      await i18n.changeLanguage("en")
    }
  })

  it("pre-fills the national currency of a country outside the euro area", async () => {
    installFetchMock(CREATE_HANDLERS)
    renderDialog(null)
    await startWithName()
    fillAddress("Poland")

    expect(screen.getByTestId("client-currency-select")).toHaveTextContent("Polish")
  })

  it("keeps an existing client's currency when the dialog opens", async () => {
    installFetchMock(CREATE_HANDLERS)
    renderDialog({ ...CLIENT, currency: "USD" })
    await screen.findByTestId("client-dialog-step-body-fiscal")

    expect(screen.getByTestId("client-currency-select")).toHaveTextContent("United States Dollar")
  })
})

describe("<ClientUpsert quick>", () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  function renderQuick(onCreate = vi.fn()) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ClientUpsert quick open onOpenChange={vi.fn()} onCreate={onCreate} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    return onCreate
  }

  const quickHandlers = (post: (body: Record<string, unknown>) => void) => ({
    "GET /api/company/info": () => ({ country: "France", countryCode: "FR" }),
    "GET /api/custom-fields/resolved": () => [],
    "GET /api/documents/required-identifiers": () => ({
      requirements: [{ scheme: "LEGAL_ID", label: "SIREN / SIRET", required: true, appliesTo: "BOTH" }],
    }),
    "POST /api/clients": (_url: URL, init?: RequestInit) => {
      post(JSON.parse(init?.body as string))
      return { id: "client-new", name: "Name Only SARL" }
    },
  })

  it("creates a client from a name alone, with the company country prefilled, and hands it back", async () => {
    const post = vi.fn()
    installFetchMock(quickHandlers(post))
    const onCreate = renderQuick()

    await screen.findByTestId("client-quick-dialog")
    await waitFor(() => expect(screen.getByTestId("client-country-select")).toHaveTextContent("France"))
    fireEvent.change(fieldInput("name"), { target: { value: "Name Only SARL" } })
    fireEvent.click(screen.getByTestId("client-quick-submit"))

    await waitFor(() => expect(post).toHaveBeenCalled())
    expect(post.mock.calls[0][0]).toMatchObject({
      name: "Name Only SARL",
      country: "France",
      countryCode: "FR",
    })
    expect(post.mock.calls[0][0].address).toBe("")
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith({ id: "client-new", name: "Name Only SARL" }))
  })

  it("asks for a name before saving", async () => {
    const post = vi.fn()
    installFetchMock(quickHandlers(post))
    renderQuick()

    await screen.findByTestId("client-quick-dialog")
    fireEvent.click(screen.getByTestId("client-quick-submit"))

    expect(await screen.findByText("Company name is required")).toBeInTheDocument()
    expect(post).not.toHaveBeenCalled()
  })

  it("opens the full form, keeping what was typed", async () => {
    installFetchMock(quickHandlers(vi.fn()))
    renderQuick()

    await screen.findByTestId("client-quick-dialog")
    fireEvent.change(fieldInput("name"), { target: { value: "Kept Name" } })
    fireEvent.click(screen.getByTestId("client-quick-open-full"))

    await screen.findByTestId("client-dialog-step-body-identity")
    expect(screen.queryByTestId("client-quick-dialog")).not.toBeInTheDocument()
    expect(fieldInput("name").value).toBe("Kept Name")
  })
})
