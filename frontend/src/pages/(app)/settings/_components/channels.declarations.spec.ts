import { describe, expect, it } from "vitest"

import { type ReportingObligation, summarizeDeclarations } from "./channels.declarations"

const legal = { kind: "legal", sourceText: "Statute text" } as ReportingObligation["provenance"]

function row(overrides: Partial<ReportingObligation>): ReportingObligation {
  return {
    providerId: "provider-a",
    platformId: "provider-a",
    appliesTo: "invoice",
    provenance: legal,
    obligationId: "provider-a:invoice",
    kind: "data",
    trigger: "sent",
    dischargedBy: "provider",
    ...overrides,
  }
}

describe("summarizeDeclarations", () => {
  it("keeps one entry per platform, in the order the API sent them", () => {
    const summaries = summarizeDeclarations([
      row({ providerId: "provider-b", platformId: "provider-b" }),
      row({ providerId: "provider-a" }),
      row({ providerId: "provider-b", platformId: "provider-b", trigger: "payment" }),
    ])
    expect(summaries.map((s) => s.platformId)).toEqual(["provider-b", "provider-a"])
  })

  it("shows a transport and a provider of the same platform as one entry", () => {
    const summaries = summarizeDeclarations([
      row({ providerId: "transport-a", platformId: "platform", dischargedBy: "transport" }),
      row({ providerId: "provider-a", platformId: "platform" }),
      row({ providerId: "provider-a", platformId: "platform", trigger: "payment" }),
    ])
    expect(summaries).toHaveLength(1)
    expect(summaries[0].platformId).toBe("platform")
    expect(summaries[0].moments.map((m) => m.trigger)).toEqual(["sent", "payment"])
    expect(summaries[0].deliveryDeclares).toBe("some")
  })

  it("explains the platform with its own declaration's source, not the delivery's", () => {
    const delivery = { kind: "legal", sourceText: "Delivery text" } as ReportingObligation["provenance"]
    const [summary] = summarizeDeclarations([
      row({ platformId: "platform", dischargedBy: "transport", provenance: delivery }),
      row({ platformId: "platform", provenance: legal }),
    ])
    expect(summary.provenance).toBe(legal)
  })

  it("merges the document types of one trigger into one moment", () => {
    const [summary] = summarizeDeclarations([
      row({ appliesTo: "invoice" }),
      row({ appliesTo: "credit-note", obligationId: "provider-a:credit-note" }),
    ])
    expect(summary.moments).toEqual([
      { trigger: "sent", period: undefined, documentTypes: ["invoice", "credit-note"] },
    ])
  })

  it("gives the send and the payment their own moment", () => {
    const [summary] = summarizeDeclarations([row({ trigger: "sent" }), row({ trigger: "payment" })])
    expect(summary.moments.map((m) => m.trigger)).toEqual(["sent", "payment"])
  })

  it("separates two periodic obligations with different periods", () => {
    const [summary] = summarizeDeclarations([
      row({ trigger: "period-end", period: "month" }),
      row({ trigger: "period-end", period: "quarter" }),
    ])
    expect(summary.moments.map((m) => m.period)).toEqual(["month", "quarter"])
  })

  it("says nothing more is needed only when every row is discharged by the delivery itself", () => {
    expect(summarizeDeclarations([row({ dischargedBy: "transport" })])[0].deliveryDeclares).toBe("all")
    expect(
      summarizeDeclarations([
        row({ dischargedBy: "transport" }),
        row({ dischargedBy: "provider", trigger: "payment" }),
      ])[0].deliveryDeclares,
    ).toBe("some")
    expect(summarizeDeclarations([row({})])[0].deliveryDeclares).toBe("none")
  })

  it("keeps the first row's provenance for the label's help", () => {
    const unverified = { kind: "unverified", resolutionNote: "Note" } as ReportingObligation["provenance"]
    const [summary] = summarizeDeclarations([row({ provenance: unverified }), row({ trigger: "payment" })])
    expect(summary.provenance).toBe(unverified)
  })
})
