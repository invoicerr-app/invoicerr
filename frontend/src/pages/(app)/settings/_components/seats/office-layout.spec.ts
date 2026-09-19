import { describe, expect, it } from "vitest"

import type { SeatMemberView } from "@/hooks/queries"
import { buildOfficeLayout, groupIntoIslands } from "./office-layout"

function member(userId: string, seatIndex: number | null): SeatMemberView {
  return {
    userId,
    email: `${userId}@acme.test`,
    firstname: userId,
    lastname: "Test",
    role: "MEMBER",
    seatIndex,
    joinedAt: "2026-01-01T00:00:00.000Z",
  }
}

describe("groupIntoIslands", () => {
  it("returns nothing for zero (or fewer) desks", () => {
    expect(groupIntoIslands(0)).toEqual([])
    expect(groupIntoIslands(-1)).toEqual([])
  })

  it("is always pairs of 2 for an even desk count", () => {
    expect(groupIntoIslands(2)).toEqual([2])
    expect(groupIntoIslands(4)).toEqual([2, 2])
    expect(groupIntoIslands(8)).toEqual([2, 2, 2, 2])
  })

  it("a lone, unpaired last desk for an odd desk count", () => {
    expect(groupIntoIslands(1)).toEqual([1])
    expect(groupIntoIslands(3)).toEqual([2, 1])
    expect(groupIntoIslands(5)).toEqual([2, 2, 1])
  })

  it("every entry sums back to the desk count", () => {
    for (const deskCount of [1, 2, 3, 4, 5, 7, 8, 11]) {
      const islands = groupIntoIslands(deskCount)
      expect(islands.reduce((sum, size) => sum + size, 0)).toBe(deskCount)
    }
  })

  it("is deterministic — the same desk count always produces the same plan", () => {
    expect(groupIntoIslands(17)).toEqual(groupIntoIslands(17))
  })
})

describe("buildOfficeLayout", () => {
  it("places every seated member at their own desk number", () => {
    const members = [member("a", 1), member("b", 3)]

    const { islands } = buildOfficeLayout(4, members)

    const allDesks = islands.flatMap((island) => island.desks)
    expect(allDesks).toHaveLength(4)
    expect(allDesks.find((d) => d.index === 1)?.occupant?.userId).toBe("a")
    expect(allDesks.find((d) => d.index === 2)?.occupant).toBeNull()
    expect(allDesks.find((d) => d.index === 3)?.occupant?.userId).toBe("b")
    expect(allDesks.find((d) => d.index === 4)?.occupant).toBeNull()
  })

  it("groups desk numbers into pairs matching groupIntoIslands", () => {
    const { islands } = buildOfficeLayout(7, [])
    expect(islands.map((island) => island.desks.length)).toEqual(groupIntoIslands(7))
  })

  it("surfaces a seated member with no seatIndex yet as unplaced, never crashing the plan", () => {
    const members = [member("a", 1), member("ghost", null)]

    const { islands, unplaced } = buildOfficeLayout(2, members)

    expect(unplaced.map((m) => m.userId)).toEqual(["ghost"])
    expect(islands.flatMap((i) => i.desks)).toHaveLength(2)
  })

  it("treats a desk number outside the current capacity as unplaced too, never dropping the member", () => {
    // A stale desk number from before capacity shrank (the backend normally repairs this —
    // seats-view.ts#ensureSeatIndexesAssigned — this is the frontend's own defensive fallback).
    const members = [member("a", 1), member("stale", 5)]

    const { islands, unplaced } = buildOfficeLayout(2, members)

    expect(unplaced.map((m) => m.userId)).toEqual(["stale"])
    expect(islands.flatMap((i) => i.desks).find((d) => d.index === 2)?.occupant).toBeNull()
  })

  it("renders zero desks for a company with no bought seats", () => {
    const { islands, unplaced } = buildOfficeLayout(0, [])
    expect(islands).toEqual([])
    expect(unplaced).toEqual([])
  })
})
