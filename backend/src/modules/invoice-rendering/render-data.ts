/**
 * Data shapes consumed by the invoice rendering/build pipeline.
 *
 * Extracted verbatim from invoice-rendering.service.ts (behaviour-preserving).
 */

/** Per-line discount/charge for EN16931 BG-27/BG-28. */
export interface LineAllowance {
  /** Human-readable reason (e.g. "Early payment discount"). */
  reason: string;
  /** UNTDID 5189 code for allowances (default "95" = discount). */
  reasonCode?: string;
  /** Absolute allowance amount (positive number = reduction). */
  amount: number;
}

/** Minimal data shape required by {@link InvoiceRenderingService.buildEInvoice}.
 *  Matches the Prisma include used by {@link renderXml} / {@link renderPdf} but is
 *  decoupled from Prisma so tests can build invoices from plain objects. */
export interface InvoiceRenderData {
  rawNumber: string | null;
  number: number | null;
  issuedAt: Date | null;
  createdAt: Date;
  /** Payment method type — drives UNCL4461 PaymentMeansCode in EN16931/XRechnung. */
  paymentMethod?: string | null;
  /** Free-text payment details, e.g. IBAN or PayPal address — used as PayeeFinancialAccount/IBAN.
   *  Also used as SEPA mandate reference for DIRECT_DEBIT (prefix "MANDATE:" extracted). */
  paymentDetails?: string | null;
  /** Document-level discount rate (0–100). When > 0, an AllowanceCharge is emitted in EN16931. */
  discountRate?: number | null;
  company: {
    name: string;
    description: string | null;
    foundedAt: Date | null;
    currency: string;
    address: string | null;
    city: string | null;
    postalCode: string | null;
    country: string | null;
    phone?: string | null;
    email?: string | null;
    partyIdentifiers?: { scheme: string; value: string }[];
  };
  client: {
    type: string;
    name: string;
    description: string | null;
    foundedAt: Date | null;
    contactFirstname: string | null;
    contactLastname: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
    salutation: string | null;
    sex: string | null;
    title: string | null;
    isActive: boolean;
    address: string | null;
    city: string | null;
    postalCode: string | null;
    country: string | null;
    partyIdentifiers?: { scheme: string; value: string }[];
  };
  items: {
    name: string;
    quantity: number;
    unitPrice: number;
    vatRate: number;
    type: string;
    /** Per-line allowances (BG-27). EN16931-compliant alternative to negative unitPrice. */
    allowances?: LineAllowance[];
  }[];
}
