import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import * as queriesModule from "@/hooks/queries"

import { NotEnoughSeatsScreen } from "./not-enough-seats-screen"

/**
 * The "not enough seats" takeover lets a member without a seat move to another company they belong
 * to, through the same `POST /api/companies/switch` as the sidebar (real `useSwitchCompany`, only
 * `fetch` and `location.reload` are stubbed). With a single company it stays a sign-out-only screen.
 */
vi.mock("@/hooks/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/queries")>()
  return { ...actual, useCompanies: vi.fn() }
})
vi.mock("@/lib/sign-out", () => ({ signOut: vi.fn() }))

const mockedUseCompanies = vi.mocked(queriesModule.useCompanies)
const fetchMock = vi.fn()
const reloadMock = vi.fn()
const ORIGINAL_LOCATION = window.location

function setup(companies: { id: string; name: string; role: "OWNER" | "ADMIN" | "MEMBER" }[]) {
  mockedUseCompanies.mockReturnValue({
    companies,
    activeCompanyId: "blocked",
    activeRole: "MEMBER",
  } as unknown as ReturnType<typeof queriesModule.useCompanies>)
  render(
    <MemoryRouter>
      <NotEnoughSeatsScreen />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock)
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...ORIGINAL_LOCATION, pathname: "/dashboard", reload: reloadMock },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  Object.defineProperty(window, "location", { configurable: true, value: ORIGINAL_LOCATION })
  vi.clearAllMocks()
})

describe("NotEnoughSeatsScreen", () => {
  it("stays sign-out only when the member belongs to a single company", () => {
    setup([{ id: "blocked", name: "Acme", role: "MEMBER" }])

    expect(screen.queryByTestId("not-enough-seats-switch")).toBeNull()
    expect(screen.getByTestId("not-enough-seats-sign-out")).toBeVisible()
  })

  it("lists the member's other companies, never the blocked one, next to sign-out", () => {
    setup([
      { id: "blocked", name: "Acme", role: "MEMBER" },
      { id: "other", name: "Globex", role: "OWNER" },
      { id: "third", name: "Initech", role: "ADMIN" },
    ])

    const items = screen.getAllByTestId("not-enough-seats-switch-item")
    expect(items.map((item) => item.textContent)).toEqual(["GlobexOWNER", "InitechADMIN"])
    expect(screen.getByTestId("not-enough-seats-sign-out")).toBeVisible()
  })

  it("switches the active company through the shared switch route, then reloads", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 201 }))
    setup([
      { id: "blocked", name: "Acme", role: "MEMBER" },
      { id: "other", name: "Globex", role: "OWNER" },
    ])

    fireEvent.click(screen.getByTestId("not-enough-seats-switch-item"))

    await waitFor(() => expect(reloadMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/api\/companies\/switch$/)
    expect(init).toMatchObject({ method: "POST", body: JSON.stringify({ companyId: "other" }) })
  })

  it("stays on the screen with an error when the switch is refused", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ message: "nope" }), { status: 403 }))
    setup([
      { id: "blocked", name: "Acme", role: "MEMBER" },
      { id: "other", name: "Globex", role: "OWNER" },
    ])

    fireEvent.click(screen.getByTestId("not-enough-seats-switch-item"))

    expect(await screen.findByTestId("not-enough-seats-switch-error")).toBeVisible()
    expect(reloadMock).not.toHaveBeenCalled()
  })
})
