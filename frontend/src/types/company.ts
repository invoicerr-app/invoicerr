export interface Company {
    id: string
    description?: string | null
    legalId?: string | null
    foundedAt: Date | string
    name: string
    currency: string
    VAT?: string | null
    exemptVat?: boolean
    address: string
    addressLine2?: string | null
    postalCode: string
    city: string
    state?: string | null
    country: string
    countryCode?: string | null
    phone: string
    email: string
    quoteStartingNumber: number
    quoteNumberFormat: string
    invoiceStartingNumber: number
    invoiceNumberFormat: string
}
