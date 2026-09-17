import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
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
  address: "1 Rue de Paris",
  city: "Paris",
  country: "France",
}

function renderDialog(client: Client) {
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

describe("<ClientUpsert>", () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    fireEvent.change(fieldInput("contactEmail"), { target: { value: "" } })

    fireEvent.click(screen.getByTestId("client-dialog-step-recap"))
    fireEvent.click(await screen.findByTestId("client-submit"))

    await waitFor(() => expect(patch).toHaveBeenCalled())
    expect(patch.mock.calls[0][0].contactEmail).toBe("")
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
})
