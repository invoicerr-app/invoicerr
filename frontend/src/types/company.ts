export interface Company {
    id: string
    description: string
    foundedAt: Date | string
    name: string
    currency: string
    VAT: string
    exemptVat?: boolean
    address: string
    addressLine2?: string
    postalCode: string
    city: string
    state?: string
    country: string
    phone: string
    email: string
    quoteStartingNumber: number
    quoteNumberFormat: string
    invoiceStartingNumber: number
    invoiceNumberFormat: string
}
