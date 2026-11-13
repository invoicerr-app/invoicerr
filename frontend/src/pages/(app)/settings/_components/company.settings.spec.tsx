import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
import { toast } from "sonner"

import CompanySettings from "./company.settings"

const originalScrollIntoView = Element.prototype.scrollIntoView
const originalOnline = onlineManager.isOnline()
const queryClients: QueryClient[] = []

function gate() {
  let release = () => {}
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

function companySnapshot() {
  return {
    id: "company-1",
    name: "Original company",
    description: "Original description",
    foundedAt: "2020-01-01T00:00:00.000Z",
    currency: "EUR",
    address: "12 Example Street",
    addressLine2: "",
    postalCode: "75001",
    city: "Paris",
    state: "",
    country: "France",
    countryCode: "FR",
    language: null,
    phone: "+33123456789",
    email: "company@example.test",
    iban: null,
    invoicePDFFormat: "pdf",
    dateFormat: "dd/MM/yyyy",
    exemptVat: false,
    partyIdentifiers: [],
    companyLaw: null,
    reportingProfile: {},
    companyProfileAttributes: [],
    companyProfileValues: {},
  }
}

function setup(
  initial: Record<string, unknown> = {},
  options: { initialGate?: ReturnType<typeof gate>; tolerancePercent?: number } = {},
) {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  Element.prototype.scrollIntoView = vi.fn()
  let company: Record<string, unknown> = { ...companySnapshot(), ...initial }
  let tolerancePercent = options.tolerancePercent ?? 2
  const posts: Record<string, unknown>[] = []
  const puts: { tolerancePercent: number }[] = []
  const requests: string[] = []
  const controls = {
    postGate: undefined as ReturnType<typeof gate> | undefined,
    putGate: undefined as ReturnType<typeof gate> | undefined,
    refetchGate: undefined as ReturnType<typeof gate> | undefined,
    postStatus: 201,
    putStatus: 200,
    refetchStatus: 200,
    refetches: 0,
    normalize: (snapshot: Record<string, unknown>) => snapshot,
    afterPut: () => {},
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost")
      const method = init?.method ?? "GET"
      const key = `${method} ${url.pathname}`
      requests.push(key)
      if (key === "POST /api/company/info") {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        posts.push(body)
        await controls.postGate?.promise
        if (controls.postStatus >= 400) return json({ message: "Save failed" }, controls.postStatus)
        company = { ...company, ...body, partyIdentifiers: body.identifiers }
        return json(company, controls.postStatus)
      }
      if (key === "GET /api/company/info") {
        const snapshot = structuredClone(company)
        if (posts.length > 0) {
          controls.refetches++
          await controls.refetchGate?.promise
          return json(controls.normalize(snapshot), controls.refetchStatus)
        }
        await options.initialGate?.promise
        return json(snapshot)
      }
      if (key === "PUT /api/documents/received-invoices/reconciliation-settings") {
        const body = JSON.parse(String(init?.body)) as { tolerancePercent: number }
        puts.push(body)
        await controls.putGate?.promise
        if (controls.putStatus >= 400) return json({ message: "Save failed" }, controls.putStatus)
        tolerancePercent = body.tolerancePercent
        controls.afterPut()
        return json({ tolerancePercent })
      }
      if (key === "GET /api/documents/received-invoices/reconciliation-settings") {
        return json({ tolerancePercent })
      }
      const responses: Record<string, unknown> = {
        "GET /api/company/revenue-settings": {},
        "GET /api/company/channels": { configured: [], suggested: [] },
        "GET /api/company/number-formats": { formats: [] },
        "GET /api/company/currency-rates": [],
        "GET /api/company/currency-rates/gaps": [],
        "GET /api/documents/transports": [],
        "GET /api/documents/required-identifiers": { requirements: [] },
        "GET /api/documents/company-law": { legalForms: [] },
        "GET /api/company-lookup/capabilities/FR": {
          status: "UNAVAILABLE",
          schemes: [],
          providers: [],
          noteKeys: [],
        },
        "GET /api/country-readiness/FR": { complete: true },
        "GET /api/address-autocomplete/capability": { enabled: false },
      }
      if (!(key in responses)) throw new Error(`Unexpected request: ${key}`)
      return json(responses[key])
    }),
  )

  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  queryClients.push(client)
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CompanySettings />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { controls, posts, puts, requests }
}

const nameInput = () => screen.getByTestId("company-name-input")
const saveButton = () => screen.getByTestId("company-submit-btn")

async function loaded() {
  await waitFor(() => expect(nameInput()).toHaveValue("Original company"))
}

function changeName(value: string) {
  fireEvent.change(nameInput(), { target: { value } })
}

async function release(pending: ReturnType<typeof gate>) {
  await act(async () => {
    pending.release()
    await pending.promise
  })
}

afterEach(() => {
  for (const client of queryClients.splice(0)) client.clear()
  onlineManager.setOnline(originalOnline)
  Element.prototype.scrollIntoView = originalScrollIntoView
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe("company settings save synchronization", () => {
  it("keeps a reverted edit through the late refetch and sends it on the next save", async () => {
    const { controls, posts } = setup()
    await loaded()
    const pending = gate()
    controls.refetchGate = pending
    changeName("Saved company")
    fireEvent.click(saveButton())
    await waitFor(() => expect(controls.refetches).toBe(1))
    changeName("Original company")
    expect(saveButton()).toBeDisabled()

    await release(pending)
    await waitFor(() => expect(saveButton()).toBeEnabled())
    expect(nameInput()).toHaveValue("Original company")

    fireEvent.click(saveButton())
    await waitFor(() => expect(posts).toHaveLength(2))
    expect(posts[1].name).toBe("Original company")
    await waitFor(() => expect(saveButton()).toBeEnabled())
  })

  it.each(["postGate", "putGate"] as const)("preserves a revert made while %s is pending", async (stage) => {
    const { controls, posts, puts } = setup()
    await loaded()
    const pending = gate()
    controls[stage] = pending
    changeName("Saved company")
    fireEvent.click(saveButton())
    await waitFor(() => expect(stage === "postGate" ? posts : puts).toHaveLength(1))
    changeName("Original company")

    await release(pending)
    await waitFor(() => expect(controls.refetches).toBe(1))
    await waitFor(() => expect(saveButton()).toBeEnabled())
    expect(nameInput()).toHaveValue("Original company")
    fireEvent.click(saveButton())
    await waitFor(() => expect(posts).toHaveLength(2))
    expect(posts[1].name).toBe("Original company")
    await waitFor(() => expect(saveButton()).toBeEnabled())
  })

  it("updates an unedited normalized value while preserving another edit made during the save", async () => {
    const { controls, posts } = setup()
    await loaded()
    const pending = gate()
    controls.postGate = pending
    controls.normalize = (snapshot) => ({ ...snapshot, name: "Normalized company" })
    changeName("Saved company")
    fireEvent.click(saveButton())
    await waitFor(() => expect(posts).toHaveLength(1))
    fireEvent.change(screen.getByTestId("company-description-input"), {
      target: { value: "Next description" },
    })
    await release(pending)
    await waitFor(() => expect(saveButton()).toBeEnabled())
    await waitFor(() => expect(nameInput()).toHaveValue("Normalized company"))
    expect(screen.getByTestId("company-description-input")).toHaveValue("Next description")
  })

  it("applies an unchanged canonical snapshot after saving a differently formatted IBAN", async () => {
    const original = { ...companySnapshot(), iban: "DE89370400440532013000" }
    const { controls, posts } = setup(original)
    await loaded()
    controls.normalize = () => original
    fireEvent.change(screen.getByTestId("company-iban-input"), {
      target: { value: "de89 3704 0044 0532 0130 00" },
    })
    fireEvent.click(saveButton())
    await waitFor(() => expect(controls.refetches).toBe(1))
    await waitFor(() => expect(saveButton()).toBeEnabled())
    expect(posts[0].iban).toBe(original.iban)
    expect(screen.getByTestId("company-iban-input")).toHaveValue(original.iban)
  })

  it.each([
    "postStatus",
    "putStatus",
  ] as const)("keeps edits and allows retry when %s fails", async (stage) => {
    const { controls, posts } = setup()
    await loaded()
    controls[stage] = 500
    changeName("Unsaved company")
    fireEvent.click(saveButton())
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(saveButton()).toBeEnabled()
    expect(nameInput()).toHaveValue("Unsaved company")
    expect(toast.success).not.toHaveBeenCalled()

    controls[stage] = 200
    fireEvent.click(saveButton())
    await waitFor(() => expect(posts).toHaveLength(2))
    expect(posts[1].name).toBe("Unsaved company")
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    await waitFor(() => expect(saveButton()).toBeEnabled())
  })

  it("releases the save button after a failed refresh without losing a later edit", async () => {
    const { controls, posts } = setup()
    await loaded()
    const pending = gate()
    controls.refetchGate = pending
    controls.refetchStatus = 500
    changeName("Saved company")
    fireEvent.click(saveButton())
    await waitFor(() => expect(controls.refetches).toBe(1))
    changeName("Next company")
    await release(pending)
    await waitFor(() => expect(saveButton()).toBeEnabled())
    expect(nameInput()).toHaveValue("Next company")
    controls.refetchStatus = 200
    fireEvent.click(saveButton())
    await waitFor(() => expect(posts).toHaveLength(2))
    expect(posts[1].name).toBe("Next company")
    await waitFor(() => expect(saveButton()).toBeEnabled())
  })

  it("settles a failed refresh when the browser goes offline after the writes", async () => {
    const { controls } = setup()
    await loaded()
    controls.refetchStatus = 500
    controls.afterPut = () => onlineManager.setOnline(false)
    changeName("Saved company")
    fireEvent.click(saveButton())
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    await waitFor(() => expect(controls.refetches).toBe(1))
    await waitFor(() => expect(saveButton()).toBeEnabled())
    expect(nameInput()).toHaveValue("Saved company")
  })

  it("keeps the separately saved tolerance available for a second submit", async () => {
    const { controls, posts, puts } = setup()
    await loaded()
    fireEvent.change(screen.getByTestId("company-reconciliation-tolerance-input"), {
      target: { value: "4" },
    })
    fireEvent.click(saveButton())
    await waitFor(() => expect(controls.refetches).toBe(1))
    await waitFor(() => expect(saveButton()).toBeEnabled())
    expect(screen.getByTestId("company-reconciliation-tolerance-input")).toHaveValue(4)
    changeName("Second save")
    fireEvent.click(saveButton())
    await waitFor(() => expect(posts).toHaveLength(2))
    await waitFor(() => expect(puts).toHaveLength(2))
    expect(puts[1]).toEqual({ tolerancePercent: 4 })
    await waitFor(() => expect(saveButton()).toBeEnabled())
  })

  it("keeps a loaded non-default tolerance when saving the company", async () => {
    const { controls, puts } = setup({}, { tolerancePercent: 4 })
    await loaded()
    await waitFor(() => expect(screen.getByTestId("company-reconciliation-tolerance-input")).toHaveValue(4))
    changeName("Updated company")
    fireEvent.click(saveButton())
    await waitFor(() => expect(controls.refetches).toBe(1))
    await waitFor(() => expect(saveButton()).toBeEnabled())
    expect(puts).toEqual([{ tolerancePercent: 4 }])
    expect(screen.getByTestId("company-reconciliation-tolerance-input")).toHaveValue(4)
  })

  it("keeps a reverted tolerance while its save is pending", async () => {
    const { controls, puts } = setup()
    await loaded()
    const pending = gate()
    controls.putGate = pending
    const tolerance = screen.getByTestId("company-reconciliation-tolerance-input")
    fireEvent.change(tolerance, { target: { value: "4" } })
    fireEvent.click(saveButton())
    await waitFor(() => expect(puts).toHaveLength(1))
    fireEvent.change(tolerance, { target: { value: "2" } })
    await release(pending)
    await waitFor(() => expect(controls.refetches).toBe(1))
    await waitFor(() => expect(saveButton()).toBeEnabled())
    expect(tolerance).toHaveValue(2)
    fireEvent.click(saveButton())
    await waitFor(() => expect(puts).toHaveLength(2))
    expect(puts[1]).toEqual({ tolerancePercent: 2 })
    await waitFor(() => expect(saveButton()).toBeEnabled())
  })

  it("preserves a nested profile edit without restoring an answer hidden by VAT exemption", async () => {
    const { controls, posts } = setup({
      reportingProfile: { sizeCategory: "SME", vatDebitsOption: "EXERCISED" },
      companyProfileAttributes: [
        {
          key: "sizeCategory",
          label: "Size category",
          values: [
            { value: "SME", label: "SME" },
            { value: "LARGE", label: "Large" },
          ],
        },
        {
          key: "vatRegime",
          label: "VAT regime",
          values: [{ value: "FRANCHISE", label: "Exempt" }],
          derived: { source: "exemptVat", whenTrue: "FRANCHISE" },
        },
        {
          key: "vatDebitsOption",
          label: "Option for VAT on debits",
          values: [{ value: "EXERCISED", label: "Exercised" }],
          askedWhen: { vatRegime: ["REAL_MONTHLY"] },
        },
      ],
    })
    await loaded()
    const pending = gate()
    controls.refetchGate = pending
    fireEvent.click(screen.getByTestId("company-exemptvat-switch"))
    fireEvent.click(saveButton())
    await waitFor(() => expect(controls.refetches).toBe(1))
    fireEvent.keyDown(screen.getByTestId("company-profile-sizeCategory-select"), { key: "ArrowDown" })
    fireEvent.click(await screen.findByTestId("company-profile-sizeCategory-option-LARGE"))
    await release(pending)
    await waitFor(() => expect(saveButton()).toBeEnabled())
    expect(screen.getByTestId("company-profile-sizeCategory-select")).toHaveTextContent("Large")
    expect(screen.queryByTestId("company-profile-vatDebitsOption-select")).not.toBeInTheDocument()
    fireEvent.click(saveButton())
    await waitFor(() => expect(posts).toHaveLength(2))
    expect(posts[1].reportingProfile).toEqual({ sizeCategory: "LARGE" })
    await waitFor(() => expect(saveButton()).toBeEnabled())
  })

  it("requests a fresh snapshot when a save finishes before the initial company load", async () => {
    const pending = gate()
    const { controls, posts } = setup({}, { initialGate: pending })
    for (const [id, value] of Object.entries({
      "company-name-input": "New company",
      "company-address-input": "12 Example Street",
      "company-postalcode-input": "75001",
      "company-city-input": "Paris",
      "company-phone-input": "+33123456789",
      "company-email-input": "company@example.test",
    })) {
      fireEvent.change(screen.getByTestId(id), { target: { value } })
    }
    fireEvent.click(screen.getByTestId("company-country-input").querySelector("button")!)
    fireEvent.click(await screen.findByRole("option", { name: "France" }))
    fireEvent.keyDown(screen.getByTestId("company-pdfformat-select"), { key: "ArrowDown" })
    fireEvent.click(await screen.findByTestId("company-pdfformat-option-pdf"))
    fireEvent.keyDown(screen.getByTestId("company-dateformat-select"), { key: "ArrowDown" })
    fireEvent.click(await screen.findByTestId("company-dateformat-option-dd.MM.yyyy"))
    fireEvent.click(saveButton())
    await waitFor(() => expect(posts).toHaveLength(1))
    await waitFor(() => expect(controls.refetches).toBe(1))
    await waitFor(() => expect(saveButton()).toBeEnabled())
    await release(pending)
    expect(nameInput()).toHaveValue("New company")
  })
})
