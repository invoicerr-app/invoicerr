import type { TFunction } from "i18next"
import { describe, expect, it } from "vitest"
import { lookupNote } from "./use-company-lookup"

const t = ((key: string) => `<${key}>`) as unknown as TFunction

describe("lookupNote", () => {
  it("translates every key and joins them with a space, in order", () => {
    expect(lookupNote({ noteKeys: ["companyLookup.notes.US", "companyLookup.notes.partialOnly"] }, t)).toBe(
      "<companyLookup.notes.US> <companyLookup.notes.partialOnly>",
    )
  })

  it("has no note without keys or without a capability", () => {
    expect(lookupNote({ noteKeys: [] }, t)).toBeUndefined()
    expect(lookupNote(undefined, t)).toBeUndefined()
  })
})
