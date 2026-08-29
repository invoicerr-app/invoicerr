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

/**
 * Faktura korygująca (PL post-clearance correction) reference data — populated only when this
 * document corrects a previously issued one. Consumed by the PL FA_VAT builder
 * (national/fa-vat.ts: RodzajFaktury=KOR + the DaneFaKorygowanej block, per the vendored
 * schemat_FA2.xsd/schemat_FA3.xsd); every other national builder ignores this field (M-4).
 */
export interface CorrectedInvoiceRef {
  /** The corrected document's own issue date (→ FA's DataWystFaKorygowanej). */
  originalIssueDate: Date;
  /** The corrected document's legal number (→ FA's NrFaKorygowanej). */
  originalNumber: string;
  /**
   * KSeF number of the corrected document, when it was cleared through KSeF
   * (→ FA's NrKSeF + NrKSeFFaKorygowanej). Null/undefined means the corrected document was
   * issued outside KSeF (→ FA's NrKSeFN marker instead — the XSD requires exactly one of the two).
   */
  originalKsefNumber?: string | null;
  /** Free-text correction reason (→ FA's PrzyczynaKorekty). */
  reason?: string | null;
}

/** Minimal data shape required by {@link InvoiceRenderingService.buildEInvoice}.
 *  Matches the Prisma include used by {@link renderXml} / {@link renderPdf} but is
 *  decoupled from Prisma so tests can build invoices from plain objects. */
export interface InvoiceRenderData {
  /**
   * WHICH document this is — BT-3 comes from here and from nowhere else.
   *
   * The renderer had no notion of document kind at all, so `InvoiceTypeCode` was the literal `380`
   * for everything: a credit note went out as a COMMERCIAL INVOICE carrying negative amounts, which
   * is not the same statement and not what a recipient's system reads. The value was on the Prisma
   * row all along (`Invoice.kind`) — it simply was never declared here, so nothing could reach it.
   *
   * Optional because the fixtures and the plain-PDF path predate it; absent means `INVOICE`, which
   * is the behaviour every caller had before.
   */
  kind?: string | null;
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
    /** BT-151 as the ENGINE resolved it (S, Z, E, AE, K, G, O). Not derivable from vatRate: six
     *  categories share rate 0. Absent on rows created before the column existed — the renderer
     *  refuses those rather than guessing. */
    vatCategory?: string | null;
    /** BT-121, the engine's exemption reason where it has one. */
    vatExemptionReason?: string | null;
    type: string;
    /** Per-line allowances (BG-27). EN16931-compliant alternative to negative unitPrice. */
    allowances?: LineAllowance[];
  }[];
  /** Present only for a correction document (faktura korygująca) — see {@link CorrectedInvoiceRef}. */
  correction?: CorrectedInvoiceRef;
}
