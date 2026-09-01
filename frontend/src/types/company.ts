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
  /** BT-84 (Payment account identifier) — the seller's own receiving account, optional. Required by
   *  XRechnung's own BR-DE-1 (backend/src/modules/documents/formats/xrechnung-provider.ts); absent
   *  for every other syntax. Never auto-filled — see Company.iban's own schema.prisma comment. */
  iban?: string | null
  quoteStartingNumber: number
  quoteNumberFormat: string
  invoiceStartingNumber: number
  invoiceNumberFormat: string
  partyIdentifiers?: PartyIdentifier[]
  /** Which registered document transport (GET /api/documents/transports) the invoice "send" action
   *  uses — e.g. "email". Null/unset means no transport is configured: sending blocks until one is
   *  chosen (see backend/src/modules/documents/actions/invoice-actions.ts). Never a country/channel
   *  the app infers — it is only ever this stored choice. */
  invoiceTransportId?: string | null
  /** Opts the company INTO multi-currency consolidation (item 9, root TODO) — null/unset means every
   *  dashboard aggregate stays grouped by currency, unchanged (see backend's Company.referenceCurrency
   *  comment in schema.prisma). */
  referenceCurrency?: string | null
}

/** A manually-entered exchange rate — GET/POST /api/company/currency-rates. See backend's
 *  CurrencyRate model (schema.prisma) for the full contract: no auto-derived inverse, `asOf`
 *  resolution picks the most recent one not in the future. */
export interface CurrencyRate {
  id: string
  companyId: string
  from: string
  to: string
  rate: number
  asOf: string
  source: string
  createdAt: string
}
