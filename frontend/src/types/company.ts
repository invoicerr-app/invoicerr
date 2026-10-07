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
  /** Where this company's intra-Community DISTANCE SALES to consumers are taxed: "ORIGIN" (its own
   *  country) or "DESTINATION" (the buyer's). Null/unset means never declared, which is not a
   *  default the product picks — sending a cross-border B2C sale of goods inside the EU is refused,
   *  by name, until it is declared (see backend's Company.distanceSalesRegime schema.prisma comment
   *  for the Directive articles, and documents/tax/resolve-invoice-tax.ts for the block). */
  distanceSalesRegime?: string | null
  address: string
  addressLine2?: string | null
  postalCode: string
  city: string
  state?: string | null
  country: string
  countryCode?: string | null
  // The FALLBACK document language for a client with no `Client.language` of its own. See the
  // backend's `Company.language` schema.prisma comment and
  // documents/rendering/language/resolve-recipient-language.ts.
  language?: string | null
  phone: string
  email: string
  /** BT-84 (Payment account identifier) — the seller's own receiving account, optional. Required by
   *  XRechnung's own BR-DE-1 (backend/src/modules/documents/formats/xrechnung-provider.ts); absent
   *  for every other syntax. Never auto-filled — see Company.iban's own schema.prisma comment. */
  iban?: string | null
  /** Issue #496: the company's RUNNING SERIES (`{ typeId: pattern }`), not a setting - read-only.
   *  Number formats are defined per country and document type by the backend
   *  (`GET /api/company/number-formats`, `CompanyNumberFormats` below). */
  numberFormats?: Record<string, string> | null
  partyIdentifiers?: PartyIdentifier[]
  /** Which registered document transport (GET /api/documents/transports) the invoice "send" action
   *  uses — e.g. "email". Null/unset means no transport is configured: sending blocks until one is
   *  chosen (see backend/src/modules/documents/actions/invoice-actions.ts). Never a country/channel
   *  the app infers — it is only ever this stored choice. */
  invoiceTransportId?: string | null
  /** Opts the company INTO multi-currency consolidation — null/unset means every
   *  dashboard aggregate stays grouped by currency, unchanged (see backend's Company.referenceCurrency
   *  comment in schema.prisma). */
  referenceCurrency?: string | null
  /** Internal approval workflow ("internal approval workflow beyond a threshold") — the "send"
   *  approval-threshold gate. MINOR units, in the company's OWN `currency` above (a rough guardrail,
   *  never currency-converted — see backend's documents/approval/approval-gate.ts). Null/unset means
   *  no approval is ever required, for any role, at any amount. */
  approvalThresholdMinor?: number | null
  /** Gates the daily reminder sweep (backend's `reminders/reminder-sweep-runner.ts`) — sends
   *  escalating overdue-payment reminders (7/14/30 days) to clients. Off by default; see backend's
   *  Company.remindersEnabled comment in schema.prisma. */
  remindersEnabled?: boolean
  /** Which registered payment provider (GET /api/company/channels, `payments/payment-provider-
   *  registry.ts`) the client portal's "Pay" link opens a checkout session against — "stripe" |
   *  "mollie" | "paypal". Null/unset falls back to "stripe" (backend's `Company.paymentProviderId`
   *  schema.prisma comment) — never a country/channel this app infers, only this stored choice.
   *  Written by its OWN small selector on the Payments settings screen (`payments.settings.tsx`),
   *  never this big form. */
  paymentProviderId?: string | null
  /** "invoiced" or "cashed" - see backend's Company.revenueBasis schema.prisma comment and
   *  `resolve-revenue-basis.ts` for the per-country default this overrides. Null/unset means "use the
   *  computed default" - `GET /api/company/revenue-settings` reports the RESOLVED value; this raw
   *  column is only what the company explicitly chose. */
  revenueBasis?: string | null
  /** "monthly" or "quarterly" - see backend's Company.revenuePeriod schema.prisma comment. */
  revenuePeriod?: string | null
  /** Default due date for new quotes and invoices: a day count and "net" or "endOfMonth". Null/unset
   *  means no default (the due date stays blank). `GET /api/company/payment-terms` reports the
   *  resolved terms and the country's legal cap. */
  quoteDueDays?: number | null
  quoteDueMode?: string | null
  invoiceDueDays?: number | null
  invoiceDueMode?: string | null
  /** Issue #603 - whether this company's country requires a validation-code scheme on its own
   *  documents (e.g. Portugal's ATCUD, Decreto-Lei n.º 28/2019 art. 7.º n.º 3 / Portaria n.º
   *  195/2020) - computed backend-side from the country's own `documentValidationCode` fact
   *  (backend's `country-policy/schema.ts`), never decided here from `country`/`countryCode`. Null
   *  for a country with no such scheme declared (every shipped country but Portugal today). */
  documentValidationCode?: { scheme: string } | null
}

/** `GET /api/company/payment-terms`. Mirrors the backend's
 *  `payment-terms/resolve-payment-terms.ts#ResolvedPaymentTerms`. */
export interface ResolvedPaymentTerms {
  quote: { days: number; mode: "net" | "endOfMonth" } | null
  invoice: { days: number; mode: "net" | "endOfMonth" } | null
  cap: { maxNetDays: number; maxEndOfMonthDays: number } | null
  exceedsCap: { quote: boolean; invoice: boolean }
}

/** `GET /api/company/revenue-settings` - the RESOLVED basis/period (explicit choice, or the computed
 *  per-country default), plus whether each is the company's own explicit pick. Mirrors the backend's
 *  `resolve-revenue-basis.ts#ResolvedRevenueSettings` exactly. */
export interface ResolvedRevenueSettings {
  basis: "invoiced" | "cashed"
  period: "monthly" | "quarterly"
  basisIsExplicit: boolean
  basisDefaultReason: string
  periodIsExplicit: boolean
}

/** `GET /api/revenue/cashed` - issue #516's cashed-revenue view per period. Mirrors the backend's
 *  `cashed-revenue.ts#CashedRevenuePeriod`/`revenue-report.service.ts#CashedRevenueReport` exactly.
 *  An AID for preparing a declaration, never the declaration itself - see `report.disclaimer`. */
export interface CashedRevenueCurrencyAmount {
  currency: string
  /** MINOR units - the same convention every other amount in this product's API uses (`fromMinor`
   *  on the way to display). */
  totalMinor: number
}

export interface CashedRevenueConsolidated {
  currency: string
  totalMinor: number
  notes: string[]
}

export interface CashedRevenuePeriod {
  key: string
  label: string
  dateFrom: string
  dateTo: string
  byCurrency: CashedRevenueCurrencyAmount[]
  consolidated: CashedRevenueConsolidated | null
  warnings: string[]
}

export interface CashedRevenueReport {
  basis: "invoiced" | "cashed"
  granularity: "monthly" | "quarterly"
  granularityIsExplicit: boolean
  disclaimer: string
  periods: CashedRevenuePeriod[]
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

/** GET /api/company/currency-rates/gaps — a pair this company entered by hand that the daily sweep
 *  has never been able to refresh from either automatic source (ECB, or the open.er-api.com
 *  fallback). See the backend's `currency-rates.store.ts#listCurrencyRatePairsWithoutAutomaticRate`
 *  for the full contract. */
export interface CurrencyRatePairGap {
  from: string
  to: string
}

/** `GET /api/company/number-formats` (issue #496) - mirrors the backend's
 *  `company/dto/number-formats.dto.ts`. Every human-facing string is plain English catalog data. */
export type NumberFormatProvenance =
  | { kind: "legal"; sourceText: string; sourceCheckedAt: string }
  | { kind: "unverified"; resolutionNote: string }

export interface CompanyNumberFormat {
  typeId: string
  pattern: string
  source: "country-policy" | "running-series"
  countryPattern: string
  nextNumber: number
  nextDisplayNumber: string
  rationale: string
  unconstrained: string | null
  supersededRunningSeries: { pattern: string; violations: { constraintId: string; message: string }[] } | null
  constraints: { id: string; summary: string; maxLength: number | null; provenance: NumberFormatProvenance }[]
  /** Issue #515 - whether this type's counter may restart at 1 on every 1 January, in this country. */
  reset: "yearly" | "never"
  /** Why THIS reset rule - sourced independently of `rationale` above. */
  resetProvenance: NumberFormatProvenance
}

export interface CompanyNumberFormats {
  countryCode: string | null
  runningSeries: { summary: string; onViolation: string } | null
  formats: CompanyNumberFormat[]
  unavailableReason: string | null
}
