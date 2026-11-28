import { describe, expect, it } from "vitest"

import {
  DEFAULT_PEPPOL_SCHEME_ID,
  PEPPOL_ENDPOINT_SCHEME,
  peppolEndpointIdentifier,
  splitPeppolEndpoint,
  withoutPeppolEndpoint,
} from "./peppol-endpoint"

describe("peppolEndpointIdentifier", () => {
  it("joins the scheme and the trimmed endpoint id into one PEPPOL_ENDPOINT identifier", () => {
    expect(peppolEndpointIdentifier("0088", "  7300010000001 ")).toEqual({
      scheme: "PEPPOL_ENDPOINT",
      value: "0088:7300010000001",
    })
  })

  it("gives nothing when either field is empty", () => {
    expect(peppolEndpointIdentifier("0088", "")).toBeNull()
    expect(peppolEndpointIdentifier("0088", "   ")).toBeNull()
    expect(peppolEndpointIdentifier("0088", undefined)).toBeNull()
    expect(peppolEndpointIdentifier("", "7300010000001")).toBeNull()
    expect(peppolEndpointIdentifier(undefined, "7300010000001")).toBeNull()
  })
})

describe("splitPeppolEndpoint", () => {
  it("reads back exactly what peppolEndpointIdentifier built", () => {
    const built = peppolEndpointIdentifier("0192", "987654321")
    expect(built).not.toBeNull()
    expect(splitPeppolEndpoint([{ scheme: "VAT", value: "NO987654321" }, built!])).toEqual({
      schemeId: "0192",
      endpointId: "987654321",
    })
  })

  it("splits on the first colon only", () => {
    expect(splitPeppolEndpoint([{ scheme: PEPPOL_ENDPOINT_SCHEME, value: "9925:BE:0123" }])).toEqual({
      schemeId: "9925",
      endpointId: "BE:0123",
    })
  })

  it("falls back to the default scheme and an empty endpoint id", () => {
    const empty = { schemeId: DEFAULT_PEPPOL_SCHEME_ID, endpointId: "" }
    expect(DEFAULT_PEPPOL_SCHEME_ID).toBe("0088")
    expect(splitPeppolEndpoint([])).toEqual(empty)
    expect(splitPeppolEndpoint([{ scheme: "VAT", value: "FR12345678901" }])).toEqual(empty)
    expect(splitPeppolEndpoint([{ scheme: PEPPOL_ENDPOINT_SCHEME, value: "7300010000001" }])).toEqual(empty)
  })
})

describe("withoutPeppolEndpoint", () => {
  it("drops only the Peppol endpoint and keeps the other identifiers in order", () => {
    const identifiers = [
      { scheme: "LEGAL_ID", value: "12345678901234" },
      { scheme: PEPPOL_ENDPOINT_SCHEME, value: "0088:7300010000001" },
      { scheme: "VAT", value: "FR12345678901" },
    ]
    expect(withoutPeppolEndpoint(identifiers)).toEqual([
      { scheme: "LEGAL_ID", value: "12345678901234" },
      { scheme: "VAT", value: "FR12345678901" },
    ])
  })
})
