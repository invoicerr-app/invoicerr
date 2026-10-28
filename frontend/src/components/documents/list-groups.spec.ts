import { describe, expect, it } from "vitest"

import { groupConsecutiveByMonth } from "./list-groups"

const row = (id: string, date: unknown) => ({ id, date })
const byDate = (r: { date: unknown }) => r.date

describe("groupConsecutiveByMonth", () => {
  it("groups consecutive rows of the same calendar month, in the order they came", () => {
    const groups = groupConsecutiveByMonth(
      [row("a", "2026-10-28"), row("b", "2026-10-02"), row("c", "2026-09-30"), row("d", "2026-09-01")],
      byDate,
    )
    expect(groups.map((g) => [g.month, g.items.map((i) => i.id)])).toEqual([
      ["2026-10", ["a", "b"]],
      ["2026-09", ["c", "d"]],
    ])
  })

  it("starts a new group when a month comes back after another one, rather than reordering rows", () => {
    const groups = groupConsecutiveByMonth(
      [row("a", "2026-10-01"), row("b", "2026-09-01"), row("c", "2026-10-05")],
      byDate,
    )
    expect(groups.map((g) => g.month)).toEqual(["2026-10", "2026-09", "2026-10"])
  })

  it("keeps rows with no usable date together under a null month", () => {
    const groups = groupConsecutiveByMonth(
      [row("a", undefined), row("b", "not a date"), row("c", "2026-01-15")],
      byDate,
    )
    expect(groups.map((g) => [g.month, g.items.length])).toEqual([
      [null, 2],
      ["2026-01", 1],
    ])
  })

  it("returns no group for no rows", () => {
    expect(groupConsecutiveByMonth([], byDate)).toEqual([])
  })
})
