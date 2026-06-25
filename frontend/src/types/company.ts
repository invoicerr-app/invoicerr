import type { PartyIdentifier } from './client'

export interface Company {
    id: string
    description?: string | null
    foundedAt: Date | string
    name: string
    currency: string
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
    partyIdentifiers?: PartyIdentifier[]
}
