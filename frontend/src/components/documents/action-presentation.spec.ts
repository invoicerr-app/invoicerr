import type { TFunction } from "i18next"
import { describe, expect, it } from "vitest"

import { actionAssignsNumber, actionLocksDocument, saveDraftLockNotice } from "./action-presentation"
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

/** Echoes the key back - enough to prove WHICH key `saveDraftLockNotice` picked without needing the
 *  real i18next catalog loaded in this unit spec. */
const echoT = ((key: string) => key) as TFunction

describe("saveDraftLockNotice", () => {
  // Issue #468 shape: the descriptor's own `lockedStatuses` refuses "save-draft" once the record has
  // left "draft" - no `policyRestrictedToStatuses` involved at all.
  const codeLockedSave: DocumentActionDescriptor = {
    id: "save-draft",
    label: "Save draft",
    availableWhen: "always",
    transitions: [{ from: "always", to: "draft" }],
    lockedStatuses: ["sending", "sent", "send_failed", "cancelled"],
  }

  it('returns the invoice-specific key once "save-draft" is locked for the current status', () => {
    const invoiceDescriptor = descriptor([codeLockedSave, send, cancel])
    expect(saveDraftLockNotice(echoT, invoiceDescriptor, "sent")).toBe("documents.form.saveLocked.invoice")
  })

  it('returns the credit-note-specific key for a descriptor id of "credit-note"', () => {
    const creditNoteDescriptor = {
      ...descriptor([codeLockedSave, send]),
      id: "credit-note",
    } as DocumentTypeDescriptor
    expect(saveDraftLockNotice(echoT, creditNoteDescriptor, "sent")).toBe(
      "documents.form.saveLocked.creditNote",
    )
  })

  it('returns the quote-specific key for a descriptor id of "quote"', () => {
    const quoteDescriptor = { ...descriptor([codeLockedSave, send]), id: "quote" } as DocumentTypeDescriptor
    expect(saveDraftLockNotice(echoT, quoteDescriptor, "sent")).toBe("documents.form.saveLocked.quote")
  })

  it("falls back to the generic key for a type with no dedicated wording", () => {
    const pluginDescriptor = {
      ...descriptor([codeLockedSave, send]),
      id: "some-plugin-type",
    } as DocumentTypeDescriptor
    expect(saveDraftLockNotice(echoT, pluginDescriptor, "sent")).toBe("documents.form.saveLocked.generic")
  })

  it("returns undefined once 'save-draft' is available again (e.g. a quote's own 'sent' status)", () => {
    const quoteDescriptor = { ...descriptor([saveDraft, send]), id: "quote" } as DocumentTypeDescriptor
    // `saveDraft` above only ever carries `policyRestrictedToStatuses: ["draft"]` - swap it out for
    // an action truly unrestricted, so this proves the "available" branch, not a policy coincidence.
    const openSave: DocumentActionDescriptor = { ...saveDraft, policyRestrictedToStatuses: undefined }
    expect(
      saveDraftLockNotice(echoT, { ...quoteDescriptor, actions: [openSave, send] }, "sent"),
    ).toBeUndefined()
  })

  it("returns undefined for a brand-new, never-saved record (status undefined)", () => {
    const invoiceDescriptor = descriptor([codeLockedSave, send])
    expect(saveDraftLockNotice(echoT, invoiceDescriptor, undefined)).toBeUndefined()
  })

  it('returns undefined for a type that declares no "save-draft" action at all', () => {
    const noSaveDraft = descriptor([send, cancel])
    expect(saveDraftLockNotice(echoT, noSaveDraft, "sent")).toBeUndefined()
  })

  it("also fires for the pre-existing country-policy lock (policyRestrictedToStatuses), same wording", () => {
    // `saveDraft` (this file's own top-level fixture) carries `policyRestrictedToStatuses: ["draft"]`
    // and NO `lockedStatuses` at all - the France invoice shape this notice already had to cover.
    const invoiceDescriptor = descriptor([saveDraft, send, cancel])
    expect(saveDraftLockNotice(echoT, invoiceDescriptor, "sending")).toBe("documents.form.saveLocked.invoice")
  })
})
