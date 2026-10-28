import { describe, expect, it } from "vitest"

import { DOCUMENT_TYPE_ICON_KEYS, documentTypeIcon, GENERIC_DOCUMENT_ICON } from "./document-type-icon"

describe("documentTypeIcon", () => {
  it("falls back to the generic document icon for an unknown or missing key", () => {
    expect(documentTypeIcon("not-a-type")).toBe(GENERIC_DOCUMENT_ICON)
    expect(documentTypeIcon(undefined)).toBe(GENERIC_DOCUMENT_ICON)
    expect(documentTypeIcon(null)).toBe(GENERIC_DOCUMENT_ICON)
    expect(documentTypeIcon("")).toBe(GENERIC_DOCUMENT_ICON)
  })

  it("never resolves an object prototype key to something else", () => {
    expect(documentTypeIcon("constructor")).toBe(GENERIC_DOCUMENT_ICON)
    expect(documentTypeIcon("__proto__")).toBe(GENERIC_DOCUMENT_ICON)
  })

  it("gives every known type its own icon, none of them the generic one", () => {
    const icons = DOCUMENT_TYPE_ICON_KEYS.map(documentTypeIcon)
    expect(new Set(icons).size).toBe(icons.length)
    expect(icons).not.toContain(GENERIC_DOCUMENT_ICON)
  })
})
