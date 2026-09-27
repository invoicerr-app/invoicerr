import { describe, expect, it } from "vitest"

import { type DocumentActionDescriptor, isActionAvailable } from "./types"

/**
 * Issue #468: `lockedStatuses` is a TYPE-level lock the backend enforces whatever the country policy
 * says, so the screen must never be more permissive than it. A country file that allows more statuses
 * than the type does (`policyRestrictedToStatuses` wider than the lock) is exactly the shape that
 * would reopen the button if `isActionAvailable` returned on the policy check first.
 */
describe("isActionAvailable with lockedStatuses", () => {
  const saveDraft: DocumentActionDescriptor = {
    id: "save-draft",
    label: "Save draft",
    availableWhen: "always",
    transitions: [{ from: "always", to: "draft" }],
    lockedStatuses: ["sent"],
  }

  it("refuses a locked status even when the country policy would allow it", () => {
    const widerPolicy: DocumentActionDescriptor = {
      ...saveDraft,
      policyRestrictedToStatuses: ["draft", "sent"],
    }
    expect(isActionAvailable(widerPolicy, "sent")).toBe(false)
    expect(isActionAvailable(widerPolicy, "draft")).toBe(true)
  })

  it("never locks a brand-new, never-saved record", () => {
    expect(isActionAvailable(saveDraft, undefined)).toBe(true)
  })

  it("leaves every status outside the list available", () => {
    expect(isActionAvailable(saveDraft, "draft")).toBe(true)
    expect(isActionAvailable(saveDraft, "sent")).toBe(false)
  })
})
