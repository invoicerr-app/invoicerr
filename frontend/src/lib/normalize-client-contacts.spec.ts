/**
 * The exact same case table as `backend/src/modules/clients/contacts/normalize-contacts.spec.ts` -
 * pinning this frontend twin's behavior to the backend's byte-for-byte (#415 follow-up review round
 * 3, point 3). See `normalize-client-contacts.ts`'s own header for why this is a twin, not a shared
 * import.
 */
import { describe, expect, it } from "vitest"

import { normalizeClientContacts, type ClientContactLike } from "./normalize-client-contacts"

describe("normalizeClientContacts", () => {
  it("returns no contacts and a null primary for an empty array", () => {
    expect(normalizeClientContacts([])).toEqual({ contacts: [], primary: null })
  })

  it("returns no contacts and a null primary for undefined/null input", () => {
    expect(normalizeClientContacts(undefined)).toEqual({ contacts: [], primary: null })
    expect(normalizeClientContacts(null)).toEqual({ contacts: [], primary: null })
  })

  it("drops a row whose fields are all empty or whitespace-only", () => {
    const blank: ClientContactLike = { firstName: "", lastName: " ", role: undefined, email: "", phone: "  " }
    const result = normalizeClientContacts([blank])
    expect(result.contacts).toEqual([])
    expect(result.primary).toBeNull()
  })

  it("keeps a row with just one non-blank field", () => {
    const row: ClientContactLike = { email: "bob@example.test" }
    const result = normalizeClientContacts([row])
    expect(result.contacts).toEqual([row])
    expect(result.primary).toBe(row)
  })

  it("a blank row flagged primary is dropped, and the next real row becomes primary", () => {
    const blankPrimary: ClientContactLike = { firstName: "", lastName: "", isPrimary: true }
    const bob: ClientContactLike = { firstName: "Bob", email: "bob@example.test" }
    const result = normalizeClientContacts([blankPrimary, bob])
    expect(result.contacts).toEqual([bob])
    expect(result.primary).toBe(bob)
  })

  it("the first row flagged primary among several wins, even out of array order", () => {
    const alice: ClientContactLike = { firstName: "Alice" }
    const bob: ClientContactLike = { firstName: "Bob", isPrimary: true }
    const carol: ClientContactLike = { firstName: "Carol", isPrimary: true }
    const result = normalizeClientContacts([alice, bob, carol])
    expect(result.contacts).toEqual([alice, bob, carol])
    expect(result.primary).toBe(bob)
  })

  it("falls back to the first survivor when none is flagged primary", () => {
    const alice: ClientContactLike = { firstName: "Alice" }
    const bob: ClientContactLike = { firstName: "Bob" }
    const result = normalizeClientContacts([alice, bob])
    expect(result.primary).toBe(alice)
  })

  it("an all-blank array normalizes to zero contacts and a null primary", () => {
    const result = normalizeClientContacts([{}, { firstName: "   " }])
    expect(result.contacts).toEqual([])
    expect(result.primary).toBeNull()
  })
})
