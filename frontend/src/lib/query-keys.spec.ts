import { describe, expect, it } from "vitest"

import { queryKeys } from "./query-keys"

// The document keys are matched by PREFIX (`invalidateQueries({ queryKey: ["documents"] })` sweeps
// every per-instance query), so each factory must keep producing the exact tuple the hooks used to
// write inline.
describe("queryKeys.documents", () => {
  const filters = { page: 2, status: ["sent"] }

  it("keeps the tuples the document hooks wrote inline", () => {
    expect(queryKeys.documents.all()).toEqual(["documents"])
    expect(queryKeys.documents.byType("invoice")).toEqual(["documents", "invoice"])
    expect(queryKeys.documents.list("invoice", filters)).toEqual(["documents", "invoice", filters])
    expect(queryKeys.documents.list(undefined, {})).toEqual(["documents", undefined, {}])
    expect(queryKeys.documents.instance("invoice", "doc-1")).toEqual(["documents", "invoice", "doc-1"])
    for (const sub of [
      "settlement",
      "tax-warnings",
      "archives",
      "manual-acceptance",
      "correction-routes",
      "authority-events",
      "share-links",
    ]) {
      expect(queryKeys.documents.instanceSub("invoice", "doc-1", sub)).toEqual([
        "documents",
        "invoice",
        "doc-1",
        sub,
      ])
    }
    expect(queryKeys.documents.transmissionPreview("invoice", "doc-1", "send")).toEqual([
      "documents",
      "invoice",
      "doc-1",
      "actions",
      "send",
      "transmission-preview",
    ])
  })

  it("nests every instance key under its type key and the documents prefix", () => {
    const typeKey = queryKeys.documents.byType("invoice")
    for (const key of [
      queryKeys.documents.list("invoice", filters),
      queryKeys.documents.instance("invoice", "doc-1"),
      queryKeys.documents.instanceSub("invoice", "doc-1", "settlement"),
      queryKeys.documents.transmissionPreview("invoice", "doc-1", "send"),
    ]) {
      expect(key.slice(0, typeKey.length)).toEqual(typeKey)
    }
  })
})

describe("queryKeys.documentReferences", () => {
  it("keeps the tuples the reference hooks wrote inline", () => {
    expect(queryKeys.documentReferences.search("client", "acme")).toEqual([
      "document-references",
      "client",
      "search",
      "acme",
    ])
    expect(queryKeys.documentReferences.byId("client", "c-1")).toEqual([
      "document-references",
      "client",
      "c-1",
    ])
    expect(queryKeys.documentReferences.fields("article", "a-1")).toEqual([
      "document-references",
      "article",
      "a-1",
      "fields",
    ])
  })

  it("nests under the per-entity key client-quick-create.tsx invalidates", () => {
    const entityKey = queryKeys.documentReferences.entity("client")
    expect(queryKeys.documentReferences.search("client", "").slice(0, 2)).toEqual(entityKey)
    expect(queryKeys.documentReferences.byId("client", "c-1").slice(0, 2)).toEqual(entityKey)
  })
})

describe("queryKeys.declarations", () => {
  it("prefixes the declarations list", () => {
    expect(queryKeys.declarations.all()).toEqual(["declarations"])
    expect(queryKeys.declarations.list(1, "failed").slice(0, 1)).toEqual(queryKeys.declarations.all())
  })
})
