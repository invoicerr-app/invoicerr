import { describe, expect, it } from "vitest"

import { isDemoBlockedAction } from "./demo-actions"

describe("isDemoBlockedAction", () => {
  it("blocks the outbound send in demo mode", () => {
    expect(isDemoBlockedAction("send", true)).toBe(true)
  })

  it("leaves send alone outside demo mode", () => {
    expect(isDemoBlockedAction("send", false)).toBe(false)
  })

  it.each([
    "validate",
    "record-payment",
    "save-draft",
    "download-xml",
    "delete",
  ])("keeps the local action %s enabled in demo mode", (actionId) => {
    expect(isDemoBlockedAction(actionId, true)).toBe(false)
  })
})
