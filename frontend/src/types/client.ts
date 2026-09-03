export interface PartyIdentifier {
  scheme: string
  value: string
}

export interface Client {
  id: string
  name: string
  description?: string
  type: "INDIVIDUAL" | "COMPANY"
  // B2G routing (documents/b2g-routing/) — GOVERNMENT changes which channel/format an invoice to
  // this client must use, per its own country. Optional: absent means BUSINESS (the schema default).
  kind?: "BUSINESS" | "GOVERNMENT"
  // TODO_PRODUIT.md T5(b) — the received-invoice reconciliation's own role, a PLAIN boolean
  // independent from "kind" above (see the backend's own Client.isSupplier schema comment for why).
  // Optional: absent/false means "not a supplier" (the schema default) — set automatically when this
  // client is linked from a received invoice (auto-match or a manual pick), or by hand on this form.
  isSupplier?: boolean
  foundedAt?: Date
  contactFirstname?: string
  contactLastname?: string
  contactEmail: string
  contactPhone?: string
  address?: string
  addressLine2?: string
  postalCode?: string
  city?: string
  state?: string
  country?: string
  countryCode?: string | null
  currency?: string // Assuming currency is a string, e.g., "USD", "EUR"
  isActive?: boolean
  partyIdentifiers?: PartyIdentifier[]
}
