import type { Invoice } from "@/types"

export interface DistributedItem {
    invoiceItemId: string
    description: string
    amountPaid: number
    proportion: number // share of the invoice total, 0..1
}

const clampDiscount = (rate?: number) => Math.min(Math.max(rate ?? 0, 0), 100)

/**
 * Splits a total payment amount proportionally across an invoice's items,
 * mirroring the backend `createPaymentFromInvoice` formula. The last item
 * absorbs the rounding remainder so the amounts sum exactly to `total`.
 */
export function distributePayment(invoice: Invoice, total: number): DistributedItem[] {
    const discountFactor = 1 - clampDiscount(invoice.discountRate) / 100
    const items = invoice.items ?? []
    const fullTTCs = items.map(it => it.quantity * it.unitPrice * discountFactor * (1 + (it.vatRate || 0) / 100))
    const ttcSum = fullTTCs.reduce((sum, value) => sum + value, 0)
    const ratio = invoice.totalTTC > 0 ? total / invoice.totalTTC : 0

    const list: DistributedItem[] = items.map((it, i) => ({
        invoiceItemId: it.id,
        description: it.description,
        amountPaid: Math.round(fullTTCs[i] * ratio * 100) / 100,
        proportion: ttcSum > 0 ? fullTTCs[i] / ttcSum : 0,
    }))

    const diff = Math.round((total - list.reduce((sum, i) => sum + i.amountPaid, 0)) * 100) / 100
    if (list.length && diff !== 0) list[list.length - 1].amountPaid += diff

    return list
}
