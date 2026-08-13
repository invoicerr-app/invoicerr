export type CompanyRole = "OWNER" | "ADMIN" | "MEMBER"

export interface CompanyMembership {
    id: string
    name: string
    role: CompanyRole
}

export interface CompanyMember {
    userId: string
    email: string
    firstname: string
    lastname: string
    role: CompanyRole
    joinedAt: string
}

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
    phone: string
    email: string
    replyToEmail?: string | null
    quoteStartingNumber: number
    quoteNumberFormat: string
    invoiceStartingNumber: number
    invoiceNumberFormat: string
}
