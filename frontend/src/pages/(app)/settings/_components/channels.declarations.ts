import type { ChannelProvenance } from "@/components/channel-banner"

export type ReportableDocumentType = "invoice" | "credit-note"
export type ObligationTrigger = "issued" | "sent" | "payment" | "period-end"
export type ObligationPeriod = "month" | "quarter" | "year"

/** One row of `GET /channels`'s `reportingObligations`: one document type of one obligation's channel. */
export interface ReportingObligation {
  providerId: string
  /** The platform this row is shown under: a transport and a declaration provider that are the same
   *  legal entity share it (France's "pdp" transport rows carry "fr-pa"). */
  platformId: string
  appliesTo: ReportableDocumentType
  provenance: ChannelProvenance
  /** The v2 obligation this row comes from (issue #767). */
  obligationId: string
  kind: "data" | "summary" | "return"
  trigger: ObligationTrigger
  dischargedBy: "transport" | "provider" | "export" | "manual"
  period?: ObligationPeriod
}

/** One "when" line of a declaration: the event, and every document type it covers. */
export interface DeclarationMoment {
  trigger: ObligationTrigger
  period?: ObligationPeriod
  documentTypes: ReportableDocumentType[]
}

/** How much of a platform's declaring its own deliveries already do. */
export type DeliveryDeclares = "all" | "some" | "none"

/** What the Declarations card shows for one platform. */
export interface DeclarationSummary {
  platformId: string
  /** The source shown behind the label's help: the first row the platform declares itself, else the
   *  first row. */
  provenance: ChannelProvenance
  moments: DeclarationMoment[]
  /** `all`: the delivery declares everything, nothing more to do; `some`: the invoices it delivers are
   *  declared with the delivery, the rest the platform declares on its own. */
  deliveryDeclares: DeliveryDeclares
}

/**
 * Folds the API rows into one summary per platform, in the order the API sent them: rows of the same
 * trigger and period merge into one moment, so Portugal reads "when sent: invoices and credit notes"
 * and France's accredited platform is one entry, with one moment for the send and another for the
 * payment, even though its delivery and its own declarations sit in two registries.
 */
export function summarizeDeclarations(rows: ReportingObligation[]): DeclarationSummary[] {
  const byPlatform = new Map<string, DeclarationSummary & { declaresItself: boolean }>()
  for (const row of rows) {
    const byTransport = row.dischargedBy === "transport"
    let summary = byPlatform.get(row.platformId)
    if (!summary) {
      summary = {
        platformId: row.platformId,
        provenance: row.provenance,
        moments: [],
        deliveryDeclares: byTransport ? "all" : "none",
        declaresItself: !byTransport,
      }
      byPlatform.set(row.platformId, summary)
    } else {
      if (!byTransport && !summary.declaresItself) {
        summary.provenance = row.provenance
        summary.declaresItself = true
      }
      if (byTransport ? summary.deliveryDeclares === "none" : summary.deliveryDeclares === "all") {
        summary.deliveryDeclares = "some"
      }
    }
    let moment = summary.moments.find((m) => m.trigger === row.trigger && m.period === row.period)
    if (!moment) {
      moment = { trigger: row.trigger, period: row.period, documentTypes: [] }
      summary.moments.push(moment)
    }
    if (!moment.documentTypes.includes(row.appliesTo)) moment.documentTypes.push(row.appliesTo)
  }
  return [...byPlatform.values()].map(({ declaresItself: _declaresItself, ...summary }) => summary)
}
