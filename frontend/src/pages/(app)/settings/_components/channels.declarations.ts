import type { ChannelProvenance } from "@/components/channel-banner"

export type ReportableDocumentType = "invoice" | "credit-note"
export type ObligationTrigger = "issued" | "sent" | "payment" | "period-end"
export type ObligationPeriod = "month" | "quarter" | "year"

/** One row of `GET /channels`'s `reportingObligations`: one document type of one obligation's channel. */
export interface ReportingObligation {
  providerId: string
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

/** What the Declarations card shows for one provider. */
export interface DeclarationSummary {
  providerId: string
  /** The first row's provenance: the source shown behind the label's help. */
  provenance: ChannelProvenance
  moments: DeclarationMoment[]
  /** Every row is discharged by the delivery itself: the company has nothing more to do. */
  dischargedByTransport: boolean
}

/**
 * Folds the API rows into one summary per provider, in the order the API sent them: rows of the same
 * trigger and period merge into one moment, so Portugal reads "when sent: invoices and credit notes"
 * and France's accredited platform gets one moment for the send and another for the payment.
 */
export function summarizeDeclarations(rows: ReportingObligation[]): DeclarationSummary[] {
  const byProvider = new Map<string, DeclarationSummary>()
  for (const row of rows) {
    let summary = byProvider.get(row.providerId)
    if (!summary) {
      summary = {
        providerId: row.providerId,
        provenance: row.provenance,
        moments: [],
        dischargedByTransport: true,
      }
      byProvider.set(row.providerId, summary)
    }
    if (row.dischargedBy !== "transport") summary.dischargedByTransport = false
    let moment = summary.moments.find((m) => m.trigger === row.trigger && m.period === row.period)
    if (!moment) {
      moment = { trigger: row.trigger, period: row.period, documentTypes: [] }
      summary.moments.push(moment)
    }
    if (!moment.documentTypes.includes(row.appliesTo)) moment.documentTypes.push(row.appliesTo)
  }
  return [...byProvider.values()]
}
