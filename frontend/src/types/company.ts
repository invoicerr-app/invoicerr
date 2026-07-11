import type { PartyIdentifier } from "./client"

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
