import { describe, expect, it } from "vitest"

import { type ReportingObligation, summarizeDeclarations } from "./channels.declarations"

const legal = { kind: "legal", sourceText: "Statute text" } as ReportingObligation["provenance"]

function row(overrides: Partial<ReportingObligation>): ReportingObligation {
  return {
    providerId: "provider-a",
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
  it("keeps one entry per provider, in the order the API sent them", () => {
    const summaries = summarizeDeclarations([
      row({ providerId: "provider-b" }),
      row({ providerId: "provider-a" }),
      row({ providerId: "provider-b", trigger: "payment" }),
    ])
    expect(summaries.map((s) => s.providerId)).toEqual(["provider-b", "provider-a"])
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
    expect(summarizeDeclarations([row({ dischargedBy: "transport" })])[0].dischargedByTransport).toBe(true)
    expect(
      summarizeDeclarations([
        row({ dischargedBy: "transport" }),
        row({ dischargedBy: "provider", trigger: "payment" }),
      ])[0].dischargedByTransport,
    ).toBe(false)
  })

  it("keeps the first row's provenance for the label's help", () => {
    const unverified = { kind: "unverified", resolutionNote: "Note" } as ReportingObligation["provenance"]
    const [summary] = summarizeDeclarations([row({ provenance: unverified }), row({ trigger: "payment" })])
    expect(summary.provenance).toBe(unverified)
  })
})
