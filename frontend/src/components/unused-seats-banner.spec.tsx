import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

import * as queriesModule from "@/hooks/queries"
import type { SeatsView } from "@/hooks/queries/use-seats"

import { UnusedSeatsBanner } from "./unused-seats-banner"

vi.mock("@/hooks/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/queries")>()
  return { ...actual, useCompanies: vi.fn(), useSeats: vi.fn() }
})

const mockedUseCompanies = vi.mocked(queriesModule.useCompanies)
const mockedUseSeats = vi.mocked(queriesModule.useSeats)

function member(userId: string) {
  return {
    userId,
    email: `${userId}@acme.org`,
    firstname: userId,
    lastname: "Acme",
    role: "MEMBER" as const,
    seatIndex: 1,
    joinedAt: "2026-11-13T00:00:00.000Z",
  }
}

function setup(role: "OWNER" | "ADMIN" | "MEMBER" | null, view: SeatsView | null | undefined) {
  mockedUseCompanies.mockReturnValue({ activeRole: role } as ReturnType<typeof queriesModule.useCompanies>)
  mockedUseSeats.mockReturnValue({ data: view } as ReturnType<typeof queriesModule.useSeats>)
  render(
    <MemoryRouter>
      <UnusedSeatsBanner />
    </MemoryRouter>,
  )
}

afterEach(() => vi.clearAllMocks())

describe("<UnusedSeatsBanner>", () => {
  it.each(["OWNER", "ADMIN"] as const)("shows a red banner with the unused seat count to an %s", (role) => {
    setup(role, { seats: 5, members: [member("a"), member("b")], waiting: [] })

    const banner = screen.getByTestId("unused-seats-banner")
    expect(banner).toHaveTextContent("3 seats are paid for but unused")
    expect(banner).toHaveTextContent("Your company pays for 5 seats and has 2 members.")
    expect(banner.className).toContain("destructive")
    expect(screen.getByTestId("unused-seats-banner-billing-link")).toHaveAttribute(
      "href",
      "/settings/billing",
    )
  })

  it("uses the singular for one unused seat", () => {
    setup("OWNER", { seats: 2, members: [member("a")], waiting: [] })

    expect(screen.getByTestId("unused-seats-banner")).toHaveTextContent("1 seat is paid for but unused")
  })

  it("never shows to a MEMBER, and never even asks for the seats view", () => {
    setup("MEMBER", { seats: 5, members: [member("a")], waiting: [] })

    expect(screen.queryByTestId("unused-seats-banner")).not.toBeInTheDocument()
    expect(mockedUseSeats).toHaveBeenCalledWith(false)
  })

  it("stays hidden when every seat is used", () => {
    setup("OWNER", { seats: 2, members: [member("a"), member("b")], waiting: [] })

    expect(screen.queryByTestId("unused-seats-banner")).not.toBeInTheDocument()
  })

  it("stays hidden when the company has fewer seats than members", () => {
    setup("OWNER", { seats: 1, members: [member("a")], waiting: [member("b")] })

    expect(screen.queryByTestId("unused-seats-banner")).not.toBeInTheDocument()
  })

  it("stays hidden without billing on this instance, or while loading", () => {
    setup("OWNER", null)
    expect(screen.queryByTestId("unused-seats-banner")).not.toBeInTheDocument()
    setup("OWNER", undefined)
    expect(screen.queryByTestId("unused-seats-banner")).not.toBeInTheDocument()
  })
})
