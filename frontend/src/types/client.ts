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
  // The received-invoice reconciliation's own role, a PLAIN boolean
  // independent from "kind" above (see the backend's own Client.isSupplier schema comment for why).
  // Optional: absent/false means "not a supplier" (the schema default) — set automatically when this
  // client is linked from a received invoice (auto-match or a manual pick), or by hand on this form.
  isSupplier?: boolean
  foundedAt?: Date
  contactFirstname?: string
  contactLastname?: string
  // Optional — only required where it is actually USED (sending a document by email, the client
  // portal invite, dunning reminders): each of those refuses/skips cleanly with its own explicit
  // message rather than silently guessing an address (see the backend's own `email-transport.ts`,
  // `portal-tokens.service.ts` and `reminder-sweep-runner.ts`). A client with no email at all is a
  // normal, supported record — e.g. one only ever billed on paper, or via the client portal itself.
  contactEmail?: string
  contactPhone?: string
  address?: string
  addressLine2?: string
  postalCode?: string
  city?: string
  state?: string
  country?: string
  countryCode?: string | null
  // The document language for THIS client — which language their documents (PDF + covering email)
  // render in. `null`/absent falls back to the company's own default language, then to English — see
  // the backend's `Client.language` schema.prisma comment and
  // documents/rendering/language/resolve-recipient-language.ts for the full resolution order.
  language?: string | null
  currency?: string // Assuming currency is a string, e.g., "USD", "EUR"
  isActive?: boolean
  partyIdentifiers?: PartyIdentifier[]
  // This company's custom fields for this client — one entry per company-defined CLIENT-target
  // custom field, keyed by that definition's own immutable `key` (never prefixed — see the backend's
  // own `Client.customFields` schema.prisma header). Absent/`{}` for a client with none filled in yet.
  customFields?: Record<string, unknown>
}

/** One potential duplicate found by `GET /clients/duplicates` — mirrors the backend's own
 *  `ClientDuplicateMatch` (clients/dto/clients.dto.ts). `matchedOn` is why THIS row was returned: a
 *  shared `contactEmail` and/or a shared `name` + `country` pair (see that endpoint's own header for
 *  the exact rule) — the wizard uses it to pick which warning copy to show. */
export interface ClientDuplicateMatch {
  id: string
  name: string
  contactEmail: string | null
  country: string
  matchedOn: ("email" | "name_country")[]
}

/**
 * Client account statement — mirrors the backend's
 * `ClientStatementDocumentRow` (settlement/client-statement.ts). ONE shape for both an invoice and a
 * credit note correcting it — see that file's own header for why `paidMinor`/`outstandingMinor` are
 * always 0 for a credit note (it carries no independent balance of its own: it already reduced the
 * invoice's own `outstandingMinor`, never a second time here).
 */
export interface ClientStatementDocumentRow {
  id: string
  typeId: "invoice" | "credit-note"
  displayNumber: string | null
  status: string
  issueDate: string | null
  dueDate: string | null
  currency: string
  amountMinor: number
  paidMinor: number
  outstandingMinor: number
  settled: boolean
}

/** One currency's own aged balance — mirrors the backend's `ClientStatementCurrencyTotals`. NEVER
 *  summed across currencies (same discipline as the dashboard's own pending-invoice totals) — a
 *  client billed in two currencies gets two of these. */
export interface ClientStatementCurrencyTotals {
  currency: string
  totalOutstandingMinor: number
  currentMinor: number
  days0to30Minor: number
  days31to60Minor: number
  days60PlusMinor: number
}

/** What `GET /clients/:id/statement` returns — mirrors the backend's `ClientStatement`. */
export interface ClientStatement {
  clientId: string
  documents: ClientStatementDocumentRow[]
  totals: ClientStatementCurrencyTotals[]
}
