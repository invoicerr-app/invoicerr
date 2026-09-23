import { describe, expect, it } from "vitest"

import { actionAssignsNumber, actionLocksDocument } from "./action-presentation"
import type { DocumentActionDescriptor, DocumentTypeDescriptor } from "./types"

/**
 * Mirrors the REAL shape this codebase's invoice descriptor + FR/DE/IT/PL/PT country-policy files
 * produce (see backend's invoice.descriptor.ts and country-policy/data/*.json): "save-draft" is
 * declared `availableWhen: "always"` at the descriptor level (SAVE_DRAFT_TRANSITIONS' own `from:
 * 'always'`) and only the country policy's `policyRestrictedToStatuses: ["draft"]` narrows it once
 * the record leaves "draft" — exactly the fact `actionLocksDocument` reads, never a hardcoded action
 * id. `send` moves draft/send_failed -> sending, sending -> sent/send_failed, matching
 * SEND_TRANSITIONS.
 */
const saveDraft: DocumentActionDescriptor = {
  id: "save-draft",
  label: "Save draft",
  availableWhen: "always",
  transitions: [{ from: "always", to: "draft" }],
  policyRestrictedToStatuses: ["draft"],
}
const send: DocumentActionDescriptor = {
  id: "send",
  label: "Send",
  availableWhen: ["draft", "send_failed"],
  transitions: [
    { from: ["draft", "send_failed"], to: "sending" },
    { from: ["sending"], to: ["sent", "send_failed"] },
  ],
}
const cancel: DocumentActionDescriptor = {
  id: "cancel",
  label: "Cancel",
  availableWhen: ["sent", "send_failed"],
  transitions: [{ from: ["sent", "send_failed"], to: "cancelled" }],
}
const lockedActions = [saveDraft, send, cancel]

function descriptor(actions: DocumentActionDescriptor[], numbering?: { onEnterStatus: string }) {
  return { id: "invoice", label: "Invoice", fields: [], actions, numbering } as DocumentTypeDescriptor
}

describe("actionLocksDocument", () => {
  it("is true for 'send' from 'draft', when the country policy restricts 'save-draft' to 'draft' — the real FR/DE/IT/PL/PT shape", () => {
    expect(actionLocksDocument(lockedActions, send, "draft")).toBe(true)
  })

  it("is false for a country whose policy does NOT restrict re-editing — no `policyRestrictedToStatuses` on the save action at all", () => {
    const unrestrictedSave: DocumentActionDescriptor = { ...saveDraft, policyRestrictedToStatuses: undefined }
    expect(actionLocksDocument([unrestrictedSave, send, cancel], send, "draft")).toBe(false)
  })

  it("is false on a RETRY from 'send_failed' — the record is already locked, so nothing NEW locks here", () => {
    expect(actionLocksDocument(lockedActions, send, "send_failed")).toBe(false)
  })

  it("is false for an action that declares no transition at all (its effect lands elsewhere)", () => {
    const duplicate: DocumentActionDescriptor = {
      id: "duplicate",
      label: "Duplicate",
      availableWhen: "always",
    }
    expect(actionLocksDocument(lockedActions, duplicate, "draft")).toBe(false)
  })

  it("is false for the save action running on itself (saving a draft never locks the draft)", () => {
    expect(actionLocksDocument(lockedActions, saveDraft, "draft")).toBe(false)
  })

  it("is false when there is no save action for this type/status to compare against", () => {
    expect(actionLocksDocument([send, cancel], send, "draft")).toBe(false)
  })
})

describe("actionAssignsNumber", () => {
  it("is true when the action's transition lands on the type's own numbering.onEnterStatus", () => {
    expect(actionAssignsNumber(descriptor(lockedActions, { onEnterStatus: "sending" }), send, "draft")).toBe(
      true,
    )
  })

  it("is false for a type with no `numbering` declared at all", () => {
    expect(actionAssignsNumber(descriptor(lockedActions), send, "draft")).toBe(false)
  })

  it("is false when the transition target isn't the numbering status", () => {
    expect(
      actionAssignsNumber(descriptor(lockedActions, { onEnterStatus: "sent" }), saveDraft, "draft"),
    ).toBe(false)
  })
})
