 import { useApiQuery } from "@/hooks/use-api-query"

 export interface FlowDescriptor {
     primaryChannel: { type: string; providerId?: string; feedback: string }
     channelClass: 'EMAIL' | 'CLEARANCE' | 'PEPPOL' | 'PORTAL' | 'PRINT'
     sendLabelKey: string
     awaiting: 'CLEARANCE' | 'BUYER_RESPONSE' | 'DELIVERY' | null
     pipeline: string[]
     terminal: boolean
     manualActions: string[]
 }

 export interface AvailableActions {
     invoiceId: string
     status: string
     complianceStatus?: string
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
    flow?: FlowDescriptor | null
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
