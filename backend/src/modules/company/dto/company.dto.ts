import { finance } from "@fin.cx/einvoice/dist_ts/plugins"

export interface PDFConfigDto {
    fontFamily: string
    includeLogo: boolean
    logoB64: string | null
    padding: number
    primaryColor: string
    secondaryColor: string
    labels: {
        // Generic labels
        payment: string
        billTo: string
        receivedFrom: string
        invoiceRefer: string
        paymentDate: string
        totalReceived: string
        
        // Common fields
        description: string
        dueDate: string
        date: string
        grandTotal: string
        invoice: string
        quantity: string
        quote: string
        quoteFor: string
        subtotal: string
        discount: string
        total: string
        unitPrice: string
        validUntil: string
        vat: string
        vatRate: string
        notes: string
        paymentMethod: string
        paymentDetails: string

        type: string
        hour: string
        day: string
        deposit: string
        service: string
        product: string

        // Payment method labels (for mapping enum types to display text)
        paymentMethodBankTransfer: string
        paymentMethodPayPal: string
        paymentMethodCash: string
        paymentMethodCheck: string
        paymentMethodOther: string

        // Legal fields
        legalId: string
        VATId: string
    }
}

export class EditCompanyDto {
    description?: string
    legalId?: string
    // Optional: the simplified onboarding only sends name + country; the rest is
    // filled in later via Settings. The backend supplies blank defaults on creation.
    foundedAt?: Date
    name: string
    currency: finance.TCurrency
    VAT?: string
    exemptVat?: boolean
    address?: string
    addressLine2?: string
    postalCode?: string
    city?: string
    state?: string
    country: string
    phone?: string
    email?: string
    pdfConfig: PDFConfigDto
    quoteStartingNumber: number
    quoteNumberFormat: string
    invoiceStartingNumber: number
    invoiceNumberFormat: string
    paymentStartingNumber: number
    paymentNumberFormat: string
}
