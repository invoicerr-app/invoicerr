 import { useApiQuery } from "@/hooks/use-api-query"
 
 export interface AvailableActions {
     invoiceId: string
     status: string
     kind?: string
     immutableAfter: string
     correctionModel: string
     cancellation: {
         allowed: boolean
        reason?: string
    }
    actions: {
        edit: boolean
        issue: boolean
        correct: boolean
        cancel: boolean
        cancelAndReplace: boolean
        send: boolean
        convertToInvoice: boolean
        deposit: boolean
    }
    correctionKinds: string[]
}

export function useAvailableActions(invoiceId: string | null | undefined) {
    return useApiQuery<AvailableActions>(
        ["invoices", "availableActions", invoiceId ?? ""],
        `/api/invoices/${invoiceId}/available-actions`,
        {
            enabled: !!invoiceId,
        },
    )
}
