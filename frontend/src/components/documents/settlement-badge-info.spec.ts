import { describe, expect, it } from "vitest"

import { settlementBadgeInfo } from "./document-settlement"

const unpaid = {
  totalGrossMinor: 1000,
  paidMinor: 0,
  creditedMinor: 0,
  outstandingMinor: 1000,
  excessMinor: 0,
  settled: false,
}
const today = "2026-10-28"

describe("settlementBadgeInfo", () => {
  it("reads late once the due date has passed and nothing has been paid", () => {
    expect(settlementBadgeInfo(unpaid, { dueDate: "2026-10-02T00:00:00.000Z", today })).toEqual({
      tone: "destructive",
      labelKey: "documents.settlement.badge.late",
    })
  })

  it("keeps a partly paid record as partially paid, even past its due date", () => {
    const partly = { ...unpaid, paidMinor: 400, outstandingMinor: 600 }
    expect(settlementBadgeInfo(partly, { dueDate: "2026-10-02", today }).labelKey).toBe(
      "documents.settlement.badge.partiallyPaid",
    )
  })

  it("is not late on its due date, without one, or once settled", () => {
    expect(settlementBadgeInfo(unpaid, { dueDate: today, today }).labelKey).toBe(
      "documents.settlement.badge.unpaid",
    )
    expect(settlementBadgeInfo(unpaid, { today }).labelKey).toBe("documents.settlement.badge.unpaid")
    const settled = { ...unpaid, paidMinor: 1000, outstandingMinor: 0, settled: true }
    expect(settlementBadgeInfo(settled, { dueDate: "2026-10-02", today }).labelKey).toBe(
      "documents.settlement.badge.settled",
    )
  })
})
