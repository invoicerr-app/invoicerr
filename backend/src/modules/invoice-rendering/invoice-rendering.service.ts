import { splitCiiIncludedNotes } from '@/compliance/schemas/cii-post-process';
import { resolveInvoiceNotes, toUblNote } from '@/compliance/profiles/invoice-notes';
import { defaultRegistry } from '@/compliance/profiles/registry';
import { documentTypeCode } from './document-type-code';
import { Injectable, BadRequestException } from '@nestjs/common';
import * as Handlebars from 'handlebars';
import type { Invoice as EuInvoice } from '@e-invoice-eu/core';
import { InvoiceService as EuInvoiceService } from '@e-invoice-eu/core';
import prisma from '@/prisma/prisma.service';
import { logger } from '@/logger/logger.service';
import { getInvertColor, getPDF } from '@/utils/pdf';
import { baseTemplate } from '@/modules/invoices/templates/base.template';
import { formatAmount } from '@/utils/format-amount';
import { formatDate } from '@/utils/date';
import { formatNotes, formatRichText } from '@/utils/format-text';
import { clampDiscountRate } from '@/utils/financial';
import { getDraftWatermarkLabel } from '@/utils/watermark';
import { augmentWithIdentifiers, getIdentifier } from '@/utils/entity-identifiers';
import { guessCountryCode } from '@/utils/country-name-to-iso';
import { EU_MEMBERS } from '@/compliance/engine/classification';
import type { InvoiceRenderData, LineAllowance } from './render-data';
import { buildFatturaPa as buildFatturaPaXml } from './national/fattura-pa';
import { buildCfdi as buildCfdiXml } from './national/cfdi';
import { buildFacturae as buildFacturaeXml } from './national/facturae';
import { buildKsaUbl as buildKsaUblXml } from './national/ksa-ubl';
import {
  buildFaVat as buildFaVatXml,
  buildFaVat2 as buildFaVat2Xml,
  buildFaVat3 as buildFaVat3Xml,
} from './national/fa-vat';
import { NATIONAL_XML_BUILDERS } from './national/index';
import { buildGenericNationalXml } from './national/generic-builder';

export type { InvoiceRenderData, LineAllowance } from './render-data';
export { computeKsaInvoiceHash, ZATCA_PIH_INIT } from './national/ksa-ubl';
export { selectFaVatVersion, FA_VAT_3_EFFECTIVE_DATE } from './national/fa-vat';
export type { FaVatVersion } from './national/fa-vat';

/**
 * Logger for @e-invoice-eu/core: quiet on chatter, LOUD on errors.
 *
 * It used to silence everything, on the reasoning that "validation errors surface as thrown
 * exceptions". They do — but the exception's message is the bare string `validation failed`, and
 * the part that names the offending field lives on `.errors`, which this library ALSO writes to
 * `logger.error` as formatted JSON. Muting that threw away the only readable copy of the diagnosis
 * and left an operator with a four-word error to act on.
 *
 * `log` and `warn` stay silent: the library narrates every conversion step and this service runs on
 * every rendered document, so relaying them would drown the journal that matters.
 */
const EU_LOGGER = {
  log: () => {},
  warn: () => {},
  error: (message: unknown) => {
    logger.error('e-invoice library rejected the document', {
      category: 'invoice-rendering',
      details: { message: typeof message === 'string' ? message : JSON.stringify(message) },
    });
  },
};

/** Format name mapping: our ExportFormat strings → @e-invoice-eu/core format names. */
const EU_FORMAT_MAP: Record<string, string> = {
  ubl: 'UBL',
  cii: 'CII',
  xrechnung: 'XRECHNUNG-UBL',
  facturx: 'CII', // Factur-X XML content is CII (PDF embedding via embedInPdf)
  zugferd: 'CII', // ZUGFeRD 2.x uses the same CII/EN16931 profile
};

/**
 * Thin wrapper around @e-invoice-eu/core Invoice data object.
 * Provides the exportXml / embedInPdf interface consumed by all downstream code.
 */
export class BuiltEInvoice {
  constructor(private readonly invoice: EuInvoice) {}

  async exportXml(format: string): Promise<string> {
    const fmtName = EU_FORMAT_MAP[format] ?? 'CII';
    const svc = new EuInvoiceService(EU_LOGGER);
    const result = await svc.generate(this.invoice, { format: fmtName, lang: 'en' });
    // The generator packs several notes into one `IncludedNote`, which is invalid CII. Fixed here
    // rather than only in the CTC post-processor, so every CII consumer gets a valid document —
    // the transmitting path is not the only one that reads this. No-op on UBL and on CII with at
    // most one plain note.
    return splitCiiIncludedNotes(result.toString());
  }

  async embedInPdf(pdfBuffer: Buffer, _format: string): Promise<Uint8Array> {
    // Hybrid PDF/A-3 formats: embed CII XML into the PDF container.
    // ZUGFeRD 2.x is fully aligned with Factur-X 1.0 (same CII/EN16931 content, PDF/A-3 container,
    // identical CustomizationID). The library uses 'Factur-X-EN16931' for both; no separate profile.
    const fmtName = 'Factur-X-EN16931';
    const svc = new EuInvoiceService(EU_LOGGER);
    const result = await svc.generate(this.invoice, {
      format: fmtName,
      lang: 'en',
      pdf: { buffer: pdfBuffer, filename: 'invoice.pdf', mimetype: 'application/pdf' },
    });
    if (typeof result === 'string') return Buffer.from(result, 'utf-8');
    return result as Uint8Array;
  }
}

/**
 * Map the app's payment method enum value to an UNCL4461 PaymentMeansCode.
 *
 * UNCL4461 codes used here:
 *   1  = Instrument not defined (safe default — satisfies BR-DE-14 without triggering IBAN rules)
 *   10 = In cash
 *   20 = Cheque
 *   30 = Credit transfer (SEP AT-01, SEPA CT; requires PayeeFinancialAccount/IBAN with code 58)
 *   48 = Bank card (debit/credit card — Mastercard, Visa, etc.)
 *   49 = Direct debit (generic / non-SEPA)
 *   58 = SEPA credit transfer (preferred over 30 for SEPA zone)
 *   59 = SEPA direct debit (preferred over 49 for SEPA zone; requires PaymentMandate)
 *   97 = Clearing between partners (used for PayPal, Stripe, and other PSPs)
 *
 * Code 30/58 + IBAN → CII-SR-470 requires PayeeFinancialAccount; we add it when an IBAN is found.
 * Code 59 + mandate reference in paymentDetails → emit cac:PaymentMandate/cbc:ID.
 */
export function mapPaymentMeansCode(method: string | null | undefined): number {
  const m = (method ?? '').toUpperCase();
  if (m === 'BANK_TRANSFER') return 58; // SEPA credit transfer
  if (m === 'CHECK' || m === 'CHEQUE') return 20;
  if (m === 'CASH') return 10;
  if (m === 'DIRECT_DEBIT' || m === 'SEPA_DIRECT_DEBIT') return 59; // SEPA direct debit
  if (m === 'CARD') return 48; // Bank card (debit/credit card)
  if (m === 'PAYPAL' || m === 'STRIPE') return 97; // Clearing between partners (PSP)
  return 1; // instrument not defined — safe default
}

/** Extract a SEPA mandate reference from free-text paymentDetails.
 *  Looks for "MANDATE: <ref>" or "MANDATE/<ref>" (case-insensitive). */
export function extractMandateReference(details: string | null | undefined): string | undefined {
  if (!details) return undefined;
  const m = details.match(/mandate[:/\s]+([A-Za-z0-9_-]+)/i);
  return m ? m[1] : undefined;
}

/** Extract a bare IBAN from a free-text details string (e.g. "IBAN: DE89 3704 0044 0532 0130 00"). */
export function extractIban(details: string | null | undefined): string | undefined {
  if (!details) return undefined;
  const m = details.replace(/\s/g, '').match(/[A-Z]{2}\d{2}[A-Z0-9]{8,30}/);
  return m ? m[0] : undefined;
}

/**
 * Map a VAT identifier's 2-letter country prefix → the OpenPeppol Electronic Address Scheme (EAS,
 * ISO 6523 ICD) code that specifically denotes THAT country's national VAT-number scheme.
 *
 * A VAT number is only a valid Peppol electronic address under its own country's VAT EAS — e.g.
 * a French VAT is scheme 9957, a German VAT is 9930; there is no single generic "EU VAT" code
 * (9925 is Belgium's, not a catch-all). Every code below is verified against the authoritative
 * OpenPeppol "Participant identifier schemes" code list (docs.peppol.eu/edelivery/codelists — the
 * genericode/XML source, cross-checked against the vendored eaid enumeration in
 * schemas/peppol/PEPPOL-EN16931-UBL.sch so each also passes PEPPOL-EN16931-CL008). Only EU VAT
 * schemes that (a) exist as a dedicated "<country> VAT number" EAS AND (b) are in that eaid
 * enumeration are listed; member states whose only Peppol scheme is an organisation-number list
 * (DK, SE, FI, SK) are intentionally OMITTED — a VAT there falls back to the email/placeholder
 * path rather than being mislabelled under an org-number or wrong-country scheme.
 *
 * Greece is keyed by its VAT prefix "EL" (not the ISO country code "GR") — Greek VAT numbers use
 * the EL prefix, as EN16931 rule BR-CO-09 itself notes. Italy uses 0211 (PARTITA IVA); 0210 is
 * CODICE FISCALE and is deliberately not used here.
 */
const VAT_PREFIX_TO_PEPPOL_EAS: Readonly<Record<string, string>> = {
  AT: '9914', // Österreichische Umsatzsteuer-Identifikationsnummer
  BE: '9925', // Belgium VAT number
  BG: '9926', // Bulgaria VAT number
  CY: '9928', // Cyprus VAT number
  CZ: '9929', // Czech Republic VAT number
  DE: '9930', // Germany VAT number
  EE: '9931', // Estonia VAT number
  EL: '9933', // Greece VAT number (VAT prefix EL, ISO country GR)
  ES: '9920', // Agencia Española de Administración Tributaria (Spain VAT)
  FR: '9957', // French VAT number
  HR: '9934', // Croatia VAT number
  HU: '9910', // Hungary VAT number
  IE: '9935', // Ireland VAT number
  IT: '0211', // PARTITA IVA (Italy VAT; 0210 CODICE FISCALE is NOT VAT)
  LT: '9937', // Lithuania VAT number
  LU: '9938', // Luxemburg VAT number
  LV: '9939', // Latvia VAT number
  MT: '9943', // Malta VAT number
  NL: '9944', // Netherlands VAT number
  PL: '9945', // Poland VAT number
  PT: '9946', // Portugal VAT number
  RO: '9947', // Romania VAT number
  SI: '9949', // Slovenia VAT number
};

/**
 * The Peppol EAS code for a VAT identifier's country, or `undefined` when its 2-letter prefix has
 * no dedicated, CL008-valid VAT EAS in {@link VAT_PREFIX_TO_PEPPOL_EAS} (caller then falls back to
 * the email/placeholder endpoint path — never an incorrect scheme code).
 */
export function peppolEasForVat(vat: string | null | undefined): string | undefined {
  if (!vat) return undefined;
  const prefix = vat.trim().slice(0, 2).toUpperCase();
  return VAT_PREFIX_TO_PEPPOL_EAS[prefix];
}

@Injectable()
export class InvoiceRenderingService {
  async renderPdf(id: string): Promise<Uint8Array> {
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        items: true,
        client: { include: { partyIdentifiers: true } },
        company: {
          include: { pdfConfig: true, partyIdentifiers: true },
        },
      },
    });

    if (!invoice) {
      logger.error('Invoice not found', { category: 'invoice' });
      throw new BadRequestException('Invoice not found');
    }

    const template = Handlebars.compile(baseTemplate);

    // Frozen at the issue date exactly like the XML: a rate that moved in July must not rewrite a
    // June invoice when someone reprints it.
    const mentionsAt = invoice.issuedAt ?? invoice.createdAt ?? new Date();
    const mentionsIso = invoice.company?.country ? guessCountryCode(invoice.company.country) : undefined;
    const pdfLegalMentions = mentionsIso
      ? resolveInvoiceNotes(defaultRegistry.resolve(mentionsIso).profile, mentionsAt).map((n) => n.text)
      : [];

    // Default payment display values
    let paymentMethodName = invoice.paymentMethod;
    let paymentMethodDetails = invoice.paymentDetails;

    if (invoice.client.name.length === 0) {
      invoice.client.name = invoice.client.contactFirstname + ' ' + invoice.client.contactLastname;
    }

    const companyAugmented = augmentWithIdentifiers(invoice.company);
    const clientAugmented = augmentWithIdentifiers(invoice.client);
    const { pdfConfig } = companyAugmented;

    // Map payment method enum -> PDFConfig label
    const paymentMethodLabels: Record<string, string> = {
      BANK_TRANSFER: pdfConfig.paymentMethodBankTransfer,
      PAYPAL: pdfConfig.paymentMethodPayPal,
      CASH: pdfConfig.paymentMethodCash,
      CHECK: pdfConfig.paymentMethodCheck,
      OTHER: pdfConfig.paymentMethodOther,
    };

    // Resolve payment method display values if a saved paymentMethodId is referenced
    if (invoice.paymentMethodId) {
      const pm = await prisma.paymentMethod.findUnique({ where: { id: invoice.paymentMethodId } });
      if (pm) {
        // Use configured label for the payment method type when available
        paymentMethodName = paymentMethodLabels[pm.type as string] || pm.type;
        paymentMethodDetails = pm.details || invoice.paymentDetails;
      }
    } else {
      // If paymentMethod was stored as an enum-like string (e.g. "PAYPAL"), map it to the configured label
      if (paymentMethodName && paymentMethodLabels[paymentMethodName.toUpperCase()]) {
        paymentMethodName = paymentMethodLabels[paymentMethodName.toUpperCase()];
      }
    }

    // Map item type enums to PDF label text (from pdfConfig)
    const itemTypeLabels: Record<string, string> = {
      HOUR: pdfConfig.hour,
      DAY: pdfConfig.day,
      DEPOSIT: pdfConfig.deposit,
      SERVICE: pdfConfig.service,
      PRODUCT: pdfConfig.product,
    };

    const subtotalBeforeDiscount = invoice.items.reduce(
      (sum, item) => sum + item.quantity * item.unitPrice,
      0,
    );
    const normalizedDiscountRate = clampDiscountRate(invoice.discountRate);
    const discountAmountValue = Math.max(0, subtotalBeforeDiscount - invoice.totalHT);
    const hasDiscount = normalizedDiscountRate > 0 && discountAmountValue > 0;

    const html = template({
      isDraft: invoice.status === 'DRAFT',
      draftLabel: getDraftWatermarkLabel(invoice.company.country),
      number:
        invoice.rawNumber || (invoice.number?.toString() ?? getDraftWatermarkLabel(invoice.company.country)),
      date: formatDate(invoice.company, invoice.issuedAt ?? invoice.createdAt),
      dueDate: formatDate(invoice.company, invoice.dueDate),
      company: companyAugmented,
      client: clientAugmented,
      currency: invoice.currency,
      items: invoice.items.map((i) => ({
        name: i.name,
        description: formatRichText(i.description),
        quantity: Number.isInteger(i.quantity)
          ? i.quantity.toString()
          : i.quantity.toFixed(3).replace(/\.?0+$/, ''),
        unitPrice: formatAmount(i.unitPrice, invoice.company.country),
        vatRate: (i.vatRate || 0).toFixed(2),
        totalPrice: formatAmount(
          i.quantity * i.unitPrice * (1 + (i.vatRate || 0) / 100),
          invoice.company.country,
        ),
        type: itemTypeLabels[i.type] || i.type,
      })),
      totalHT: formatAmount(invoice.totalHT, invoice.company.country),
      totalVAT: formatAmount(invoice.totalVAT, invoice.company.country),
      totalTTC: formatAmount(invoice.totalTTC, invoice.company.country),
      subtotalBeforeDiscount: formatAmount(subtotalBeforeDiscount, invoice.company.country),
      discountAmount: formatAmount(discountAmountValue, invoice.company.country),
      discountRate: Number(normalizedDiscountRate.toFixed(2)),
      hasDiscount,
      vatExemptText:
        invoice.company.exemptVat && (invoice.company.country || '').toUpperCase() === 'FRANCE'
          ? 'TVA non applicable, art. 293 B du CGI'
          : null,

      paymentMethod: paymentMethodName,
      paymentDetails: paymentMethodDetails,

      fontFamily: pdfConfig.fontFamily ?? 'Inter',
      primaryColor: pdfConfig.primaryColor ?? '#0ea5e9',
      secondaryColor: pdfConfig.secondaryColor ?? '#f3f4f6',
      tableTextColor: getInvertColor(pdfConfig.secondaryColor),
      padding: pdfConfig?.padding ?? 40,
      includeLogo: !!pdfConfig?.logoB64,
      logoB64: pdfConfig?.logoB64 ?? '',

      noteExists: !!invoice.notes,
      notes: formatNotes(invoice.notes),
      // The readable half of the obligation. L441-9 is about what the invoice SAYS, so the XML
      // carrying the mentions is not enough on its own — the document the client reads must too.
      // Same resolver as the structured path, so the two can never disagree.
      legalMentions: pdfLegalMentions,
      legalMentionsExist: pdfLegalMentions.length > 0,

      // Labels
      labels: {
        invoice: pdfConfig.invoice,
        dueDate: pdfConfig.dueDate,
        billTo: pdfConfig.billTo,
        description: pdfConfig.description,
        type: pdfConfig.type,
        quantity: pdfConfig.quantity,
        unitPrice: pdfConfig.unitPrice,
        vatRate: pdfConfig.vatRate,
        subtotal: pdfConfig.subtotal,
        discount: pdfConfig.discount,
        total: pdfConfig.total,
        vat: pdfConfig.vat,
        grandTotal: pdfConfig.grandTotal,
        date: pdfConfig.date,
        notes: pdfConfig.notes,
        paymentMethod: pdfConfig.paymentMethod,
        paymentDetails: pdfConfig.paymentDetails,
        legalId: pdfConfig.legalId,
        VATId: pdfConfig.VATId,
        hour: pdfConfig.hour,
        day: pdfConfig.day,
        deposit: pdfConfig.deposit,
        service: pdfConfig.service,
        product: pdfConfig.product,
      },
    });

    const pdfBuffer = await getPDF(html);

    return pdfBuffer;
  }

  /** Pure construction — no DB access. Builds a BuiltEInvoice from a plain data object. */
  buildEInvoice(data: InvoiceRenderData): BuiltEInvoice {
    const currency = data.company.currency || 'EUR';
    const issueDate = new Date(data.issuedAt ?? data.createdAt);
    const issueDateStr = issueDate.toISOString().split('T')[0];

    const sellerCountryCode = guessCountryCode(data.company.country) ?? 'FR';
    const buyerCountryCode = guessCountryCode(data.client.country) ?? 'FR';

    // BR-O-02, read off the Schematron after it fired on a real render: an invoice with a line in
    // category "Not subject to VAT" SHALL NOT contain the seller VAT identifier (BT-31), the seller
    // tax representative's (BT-63) or the buyer's (BT-48). O is a whole-document mode — BR-O-11..14
    // likewise forbid mixing it with any other breakdown — so the identifiers come out of the
    // document. Not a judgement of ours: the operation is outside the scope of VAT, and the
    // standard refuses a document that claims a VAT registration for it.
    const outOfScope = data.items.some((i) => i.unitPrice >= 0 && i.vatCategory === 'O');
    const sellerVat = outOfScope ? undefined : getIdentifier(data.company, 'VAT');
    const buyerVat = outOfScope ? undefined : getIdentifier(data.client, 'VAT');

    // BT-151 comes from the PLAN, persisted on the line at creation and refreshed at issuance.
    //
    // It used to be re-derived here, from the rate, with three outcomes — S, AE, Z — for an engine
    // that produces five. The comment that stood here even listed what it was collapsing:
    // "domestic zero-rating, non-EU export, out-of-scope supply, ... keeps using Z". Measured
    // against the rendered XML, three cases in five came out wrong: an intra-EU supply of GOODS (K)
    // was declared as a reverse-charged service (AE), and an out-of-scope supply (O) was declared
    // zero-rated (Z) — a document no identifier could make valid, since BR-O-02 forbids the seller
    // VAT identifier that BR-Z-02 requires. The tax was computed correctly and the artifact said
    // something else.
    //
    // A rate cannot carry that decision: Z, E, AE, K, G and O all sit at rate 0 and demand
    // contradictory things. So the renderer does not decide any more — it reads, and refuses when
    // there is nothing to read. A guess here is worse than a refusal: it produces a document that
    // looks filed and is wrong.
    const missing = data.items.filter((i) => i.unitPrice >= 0 && !i.vatCategory);
    if (missing.length > 0) {
      throw new Error(
        `Cannot build an e-invoice: ${missing.length} line(s) carry no resolved VAT category ` +
          '(BT-151). The category is resolved by the compliance engine and stored on the line; ' +
          'a line without one predates that column. Re-save the invoice to resolve it. The ' +
          'renderer will not infer a category from the rate — six categories share rate 0 and ' +
          'require contradictory things of the document.',
      );
    }
    const categoryOf = (item: { vatCategory?: string | null }) => item.vatCategory as string;

    /**
     * BT-121. BR-AE-10, BR-IC-10, BR-G-10 and BR-O-10 each require an exemption reason on the
     * breakdown. The engine supplies one where it has one; the fallbacks below are the single
     * canonical VATEX code the EN 16931 code list defines for that category, not a choice. E is
     * absent on purpose: it covers a dozen exemptions with a dozen different codes, so there is
     * nothing to fall back TO, and inventing one would be inventing a legal basis.
     */
    const CATEGORY_VATEX: Record<string, { code: string; text: string }> = {
      AE: { code: 'VATEX-EU-AE', text: 'Reverse charge — Autoliquidation, Art. 196 Directive 2006/112/EC' },
      K: { code: 'VATEX-EU-IC', text: 'Intra-Community supply — Art. 138 Directive 2006/112/EC' },
      G: { code: 'VATEX-EU-G', text: 'Export outside the EU — Art. 146 Directive 2006/112/EC' },
      O: { code: 'VATEX-EU-O', text: 'Not subject to VAT' },
    };
    const exemptionFor = (category: string, reason?: string | null) => {
      const fallback = CATEGORY_VATEX[category];
      if (!fallback) return undefined;
      return { code: reason || fallback.code, text: fallback.text };
    };

    // BT-10 Buyer reference / DE Leitweg-ID (M-9 part 2): the mandatory routing key for German
    // federal/state B2G invoices. When the buyer carries a LEITWEG_ID party identifier, it MUST
    // travel in cbc:BuyerReference — falls back to the invoice-number placeholder otherwise (see
    // PEPPOL-EN16931-R003 note below, which only requires SOME buyer reference to be present).
    const buyerLeitwegId = getIdentifier(data.client, 'LEITWEG_ID');
    // schemeID 0002 = SIREN (9 digits). The app stores the French legal id as a 14-digit SIRET
    // (SIREN + NIC); derive the SIREN from its first 9 digits so the CTC seller/buyer id is valid.
    const toSiren = (legalId?: string): string | undefined => {
      const digits = (legalId ?? '').replace(/\D/g, '');
      return digits.length === 14 ? digits.slice(0, 9) : legalId || undefined;
    };
    const sellerSiren = toSiren(getIdentifier(data.company, 'LEGAL_ID'));
    const buyerSiren = toSiren(getIdentifier(data.client, 'LEGAL_ID'));

    // ── Compute totals ────────────────────────────────────────────────
    const fmt2 = (n: number) => n.toFixed(2);

    // EN16931 BR-27: "The Item net price (BT-146) shall NOT be negative."
    // Items with unitPrice < 0 represent inline discounts (e.g. "Remise fidélité").
    // Split them out: positive-price items become invoice lines; negative-price items are
    // folded into the document-level AllowanceCharge (BG-20) so BR-27 never fires.
    const positiveItems = data.items.filter((it) => it.unitPrice >= 0);
    const negativeItems = data.items.filter((it) => it.unitPrice < 0);
    // Total absolute discount from negative-price items (positive number = reduction).
    const negativeItemsDiscountTotal = negativeItems.reduce(
      (sum, it) => sum + Math.abs(it.unitPrice * it.quantity),
      0,
    );

    const vatGroups = new Map<string, { taxable: number; tax: number }>();
    let lineExtensionTotal = 0;

    for (const item of positiveItems) {
      const rate = item.vatRate || 0;
      // Line net = gross minus any explicit per-line allowances (BG-27).
      const lineAllowanceTotal = (item.allowances ?? []).reduce((s, a) => s + a.amount, 0);
      const net = item.quantity * item.unitPrice - lineAllowanceTotal;
      lineExtensionTotal += net;
      // BG-23 is keyed on (category, rate), not on rate alone. Grouping by rate was harmless while
      // every 0 collapsed to Z; with real categories an invoice can carry a K line and an AE line
      // both at 0, and merging them into one breakdown would report an intra-Community supply of
      // goods as a reverse-charged service — the same error, moved from the line to the summary.
      const key = `${categoryOf(item)}|${rate}`;
      const g = vatGroups.get(key) ?? { taxable: 0, tax: 0 };
      g.taxable += net;
      g.tax += (net * rate) / 100;
      vatGroups.set(key, g);
    }

    // Document-level discount (AllowanceCharge BT-92/BT-93).
    // Combined: rate-based discount + amounts from folded negative-price items (BR-27 fix).
    const discountRate = Math.max(0, Math.min(100, data.discountRate ?? 0));
    // Note: lineExtensionTotal already equals the sum of positive-item nets (with per-line allowances).
    const rateDiscountAmount = discountRate > 0 ? Math.round(lineExtensionTotal * discountRate) / 100 : 0;
    // Total document-level discount (rate-based + folded negatives).
    const discountAmount = rateDiscountAmount + negativeItemsDiscountTotal;
    // Taxable base after ALL document-level discounts — used for VAT and LegalMonetaryTotal.
    const taxableBase = lineExtensionTotal - discountAmount;

    // Re-compute VAT on the fully-discounted base (proportional reduction across all VAT groups)
    const discountRatio = lineExtensionTotal > 0 ? taxableBase / lineExtensionTotal : 1;
    let totalVat = 0;
    const taxSubtotalsAfterDiscount = [...vatGroups.entries()].map(([key, g]) => {
      const [category, rateStr] = key.split('|');
      const rate = Number(rateStr);
      const discountedTaxable = g.taxable * discountRatio;
      const discountedTax = (discountedTaxable * rate) / 100;
      totalVat += discountedTax;
      return { rate, category, taxable: discountedTaxable, tax: discountedTax };
    });
    const totalIncl = taxableBase + totalVat;

    const taxSubtotals = taxSubtotalsAfterDiscount.map(({ rate, category, taxable, tax }) => {
      return {
        'cbc:TaxableAmount': fmt2(taxable),
        'cbc:TaxableAmount@currencyID': currency,
        'cbc:TaxAmount': fmt2(tax),
        'cbc:TaxAmount@currencyID': currency,
        'cac:TaxCategory': {
          'cbc:ID': category,
          ...(category === 'O' ? {} : { 'cbc:Percent': String(rate) }),
          // BR-AE-10 / BR-IC-10 / BR-G-10 / BR-O-10: each of these categories must carry a
          // reason on the breakdown. Only AE was handled while AE was the only one reachable.
          ...(() => {
            const ex = exemptionFor(category);
            return ex ? { 'cbc:TaxExemptionReasonCode': ex.code, 'cbc:TaxExemptionReason': ex.text } : {};
          })(),
          'cac:TaxScheme': { 'cbc:ID': 'VAT' },
        },
      };
    });

    // Build invoice lines from positive-price items only.
    // Line-level allowances (BG-27) are emitted as cac:AllowanceCharge inside cac:InvoiceLine.
    const invoiceLines = positiveItems.map((item, idx) => {
      const lineAllowances: LineAllowance[] = item.allowances ?? [];
      const lineAllowanceTotal = lineAllowances.reduce((s, a) => s + a.amount, 0);
      const gross = item.quantity * item.unitPrice;
      const net = gross - lineAllowanceTotal;
      const unitCode =
        item.type === 'HOUR' ? 'HUR' : item.type === 'DAY' ? 'DAY' : item.type === 'DEPOSIT' ? 'SET' : 'C62';
      const lineEntry: Record<string, unknown> = {
        'cbc:ID': String(idx + 1),
        'cbc:InvoicedQuantity': String(item.quantity),
        'cbc:InvoicedQuantity@unitCode': unitCode,
        'cbc:LineExtensionAmount': fmt2(net),
        'cbc:LineExtensionAmount@currencyID': currency,
        'cac:Item': {
          'cbc:Name': item.name,
          'cac:ClassifiedTaxCategory': {
            'cbc:ID': categoryOf(item),
            // BR-O-05: an O line shall NOT carry an invoiced item VAT rate (BT-152). Emitting "0"
            // is not the same as emitting nothing — the rule is about the field's presence, and a
            // rate of zero still asserts that a rate applies.
            ...(categoryOf(item) === 'O' ? {} : { 'cbc:Percent': String(item.vatRate || 0) }),
            'cac:TaxScheme': { 'cbc:ID': 'VAT' },
          },
        },
        'cac:Price': {
          'cbc:PriceAmount': fmt2(item.unitPrice),
          'cbc:PriceAmount@currencyID': currency,
        },
      };
      // BG-27: per-line allowances (e.g. early-payment or volume discount on a line).
      if (lineAllowances.length > 0) {
        lineEntry['cac:AllowanceCharge'] = lineAllowances.map((la) => ({
          'cbc:ChargeIndicator': 'false',
          'cbc:AllowanceChargeReasonCode': la.reasonCode ?? '95',
          'cbc:AllowanceChargeReason': la.reason,
          'cbc:Amount': fmt2(la.amount),
          'cbc:Amount@currencyID': currency,
          'cbc:BaseAmount': fmt2(gross),
          'cbc:BaseAmount@currencyID': currency,
        }));
      }
      return lineEntry;
    });

    // ── Build invoice data object ──────────────────────────────────────
    // @e-invoice-eu/core requires EndpointID on both parties.
    // Priority: 1) PEPPOL_ENDPOINT party identifier (format 'schemeId:value', e.g. '0088:7300010000001')
    //           2) SIREN with schemeID 0225 (FR PDP routing)
    //           3) VAT identifier under its OWN country's VAT EAS code (peppolEasForVat — e.g.
    //              FR→9957, DE→9930, BE→9925, IT→0211); only when that country has a dedicated,
    //              CL008-valid VAT scheme
    //           4) email with EM
    //           5) placeholder
    // NOTE on 'EM': it satisfies the base EN16931 schema but is NOT a valid Peppol Electronic
    // Address Scheme code (PEPPOL-EN16931-CL008 — see the vendored eaid codelist in
    // schemas/peppol/PEPPOL-EN16931-UBL.sch). A party with neither a numeric legal id nor a
    // mappable VAT identifier still falls back to it (email-only parties have no other EAS-listed
    // id to use), which will fail Peppol-BIS validation specifically — a pre-existing, narrower
    // gap than what tier 3 (VAT) now closes for the common case of a VAT-registered EU counterparty.
    const rawPeppolSeller = getIdentifier(data.company, 'PEPPOL_ENDPOINT');
    const peppolSellerParts = rawPeppolSeller?.match(/^(\d{4,}):(.+)$/);
    const sellerVatEas = peppolEasForVat(sellerVat);
    const sellerEndpointId =
      peppolSellerParts?.[2] ??
      sellerSiren ??
      (sellerVatEas ? sellerVat : null) ??
      (data.company.email ? data.company.email.trim() : null) ??
      'seller@local.invalid';
    const sellerEndpointScheme = peppolSellerParts?.[1] ?? (sellerSiren ? '0225' : (sellerVatEas ?? 'EM'));

    const sellerParty: Record<string, unknown> = {
      'cbc:EndpointID': sellerEndpointId,
      'cbc:EndpointID@schemeID': sellerEndpointScheme,
      'cac:PostalAddress': {
        'cbc:StreetName': data.company.address || 'N/A',
        'cbc:CityName': data.company.city || '',
        'cbc:PostalZone': data.company.postalCode || '',
        'cac:Country': { 'cbc:IdentificationCode': sellerCountryCode },
      },
      'cac:PartyLegalEntity': {
        'cbc:RegistrationName': data.company.name,
        ...(sellerSiren ? { 'cbc:CompanyID': sellerSiren, 'cbc:CompanyID@schemeID': '0002' } : {}),
      },
    };
    if (sellerSiren) {
      sellerParty['cac:PartyIdentification'] = [{ 'cbc:ID': sellerSiren, 'cbc:ID@schemeID': '0225' }];
    }
    if (sellerVat) {
      sellerParty['cac:PartyTaxScheme'] = [
        { 'cbc:CompanyID': sellerVat, 'cac:TaxScheme': { 'cbc:ID': 'VAT' } },
      ];
    }
    // Seller cac:Contact (BG-6) — ALWAYS emitted so BR-DE-2 (group present) and BR-DE-5
    // (BT-41 Seller contact point / cbc:Name) always hold, not just when phone/email happen to be
    // set. cbc:Name (BT-41) has no dedicated contact-name field on InvoiceRenderData (see
    // render-data.ts — company only carries name/phone/email), so it falls back to the company's
    // own registered name — a non-empty value that satisfies BR-DE-5 in the absence of a real
    // per-person contact. Telephone (BT-42/BR-DE-6) and ElectronicMail (BT-43/BR-DE-7) stay
    // conditional on the data being present. UBL cac:Contact child order is cbc:ID?, cbc:Name?,
    // cbc:Telephone?, cbc:Telefax?, cbc:ElectronicMail? — Name must precede Telephone/ElectronicMail
    // or base UBL XSD/schema validation breaks.
    sellerParty['cac:Contact'] = {
      'cbc:Name': data.company.name,
      ...(data.company.phone ? { 'cbc:Telephone': data.company.phone } : {}),
      ...(data.company.email ? { 'cbc:ElectronicMail': data.company.email } : {}),
    };

    // @e-invoice-eu/core requires EndpointID on the buyer party (mandatory in its JSON schema).
    // Priority: 1) PEPPOL_ENDPOINT party identifier (format 'schemeId:value', e.g. '0088:7300010000001')
    //           2) SIREN with schemeID 0225 (FR B2B routing)
    //           3) VAT identifier under its OWN country's VAT EAS code (peppolEasForVat — see the
    //              seller-side comment above for why a single hardcoded code / 'EM' is not correct)
    //           4) contact email with EM
    //           5) placeholder
    const rawPeppolBuyer = getIdentifier(data.client, 'PEPPOL_ENDPOINT');
    const peppolBuyerParts = rawPeppolBuyer?.match(/^(\d{4,}):(.+)$/);
    const buyerVatEas = peppolEasForVat(buyerVat);
    const buyerEndpointId =
      peppolBuyerParts?.[2] ??
      buyerSiren ??
      (buyerVatEas ? buyerVat : null) ??
      (data.client.contactEmail ? data.client.contactEmail.trim() : null) ??
      ((data.client as any).email ? (data.client as any).email.trim() : null) ??
      'consumer@local.invalid';
    const buyerEndpointScheme = peppolBuyerParts?.[1] ?? (buyerSiren ? '0225' : (buyerVatEas ?? 'EM'));

    const buyerParty: Record<string, unknown> = {
      'cbc:EndpointID': buyerEndpointId,
      'cbc:EndpointID@schemeID': buyerEndpointScheme,
      'cac:PostalAddress': {
        'cbc:StreetName': data.client.address || 'N/A',
        'cbc:CityName': data.client.city || '',
        'cbc:PostalZone': data.client.postalCode || '',
        'cac:Country': { 'cbc:IdentificationCode': buyerCountryCode },
      },
      'cac:PartyLegalEntity': {
        'cbc:RegistrationName': data.client.name || data.client.contactFirstname || 'N/A',
        ...(buyerSiren ? { 'cbc:CompanyID': buyerSiren, 'cbc:CompanyID@schemeID': '0002' } : {}),
      },
    };
    if (buyerVat) {
      buyerParty['cac:PartyTaxScheme'] = { 'cbc:CompanyID': buyerVat, 'cac:TaxScheme': { 'cbc:ID': 'VAT' } };
    }

    // ── PaymentMeans (BT-81 / BR-DE-14) ──────────────────────────────────
    // Derive UNCL4461 code from the invoice's payment method.
    // Code 58 (SEPA CT) and 30 (credit transfer) require PayeeFinancialAccount/IBAN per
    // CII-SR-470; we add cac:PayeeFinancialAccount when a recognisable IBAN is present.
    // Code 59 (SEPA direct debit) may carry cac:PaymentMandate/cbc:ID (mandate reference).
    const pmCode = mapPaymentMeansCode(data.paymentMethod);
    const iban = extractIban(data.paymentDetails);
    const mandateRef = extractMandateReference(data.paymentDetails);
    const paymentMeansEntry: Record<string, unknown> = { 'cbc:PaymentMeansCode': String(pmCode) };
    if ((pmCode === 58 || pmCode === 30) && iban) {
      // cbc:ID carries the IBAN; the @e-invoice-eu/core CREDITTRANSFER schema
      // does not support @schemeID on this field so we omit it.
      paymentMeansEntry['cac:PayeeFinancialAccount'] = {
        'cbc:ID': iban,
      };
    }
    // SEPA direct debit: emit cac:PaymentMandate when a mandate reference is present.
    if ((pmCode === 59 || pmCode === 49) && mandateRef) {
      paymentMeansEntry['cac:PaymentMandate'] = { 'cbc:ID': mandateRef };
    }

    // ── AllowanceCharge (BG-20 document-level discount) ─────────────────
    // We emit one AllowanceCharge for the rate-based discount and one for the folded
    // negative-price items (if any). Both are ChargeIndicator=false (= reduction).
    // EN16931 requires AllowanceTotalAmount in LegalMonetaryTotal to match their sum.
    const allowanceCharges: Record<string, unknown>[] = [];
    // The document-level allowance carries the category of the breakdown it reduces (BR-CO-* pair
    // it with an existing BG-23). Same source as everything else now: the first breakdown's own
    // category, not a second guess from its rate.
    const vatCategoryId = taxSubtotalsAfterDiscount[0]?.category ?? 'S';
    const vatPercent = String(taxSubtotalsAfterDiscount[0]?.rate ?? 0);
    if (rateDiscountAmount > 0) {
      allowanceCharges.push({
        'cbc:ChargeIndicator': 'false',
        'cbc:AllowanceChargeReasonCode': '95', // UNTDID 5189 code 95 = "Discount"
        'cbc:AllowanceChargeReason': 'Discount',
        'cbc:MultiplierFactorNumeric': fmt2(discountRate),
        'cbc:Amount': fmt2(rateDiscountAmount),
        'cbc:Amount@currencyID': currency,
        'cbc:BaseAmount': fmt2(lineExtensionTotal),
        'cbc:BaseAmount@currencyID': currency,
        'cac:TaxCategory': {
          'cbc:ID': vatCategoryId,
          'cbc:Percent': vatPercent,
          'cac:TaxScheme': { 'cbc:ID': 'VAT' },
        },
      });
    }
    if (negativeItemsDiscountTotal > 0) {
      // Folded negative-price items → document-level allowance (BR-27 fix).
      // BaseAmount is the full positive-item total; Amount is the absolute discount.
      allowanceCharges.push({
        'cbc:ChargeIndicator': 'false',
        'cbc:AllowanceChargeReasonCode': '95',
        'cbc:AllowanceChargeReason': 'Discount',
        'cbc:Amount': fmt2(negativeItemsDiscountTotal),
        'cbc:Amount@currencyID': currency,
        'cbc:BaseAmount': fmt2(lineExtensionTotal + negativeItemsDiscountTotal),
        'cbc:BaseAmount@currencyID': currency,
        'cac:TaxCategory': {
          'cbc:ID': vatCategoryId,
          'cbc:Percent': vatPercent,
          'cac:TaxScheme': { 'cbc:ID': 'VAT' },
        },
      });
    }

    const euInvoice: EuInvoice = {
      'ubl:Invoice': {
        'cbc:CustomizationID': 'urn:cen.eu:en16931:2017',
        'cbc:ProfileID': 'M1',
        'cbc:ID': data.rawNumber || (data.number?.toString() ?? 'DRAFT'),
        'cbc:IssueDate': issueDateStr,
        // BT-3, from the document kind. Was the literal '380' for everything, so a credit note
        // left as a commercial invoice with negative amounts.
        'cbc:InvoiceTypeCode': documentTypeCode(data.kind),
        // BG-1 — the mentions the country requires (France: C. com. L441-9 I al. 5). `#CODE#text` is
        // how EN 16931 UBL carries BT-21 alongside BT-22; the generator splits it for CII.
        ...(data.notes?.length ? { 'cbc:Note': data.notes.map(toUblNote) } : {}),
        // BG-3 / BT-25 / BT-26 — the invoice this one corrects. Emitted whenever the link exists,
        // not only for credit notes: a corrective invoice and a replacement reference their
        // predecessor for the same reason, and a document that carries no link is unreadable to the
        // recipient's system.
        ...(data.precedingInvoice
          ? {
              'cac:BillingReference': [
                {
                  'cac:InvoiceDocumentReference': {
                    'cbc:ID': data.precedingInvoice.number,
                    'cbc:IssueDate': data.precedingInvoice.issueDate,
                  },
                },
              ],
            }
          : {}),
        'cbc:DocumentCurrencyCode': currency,
        // PEPPOL-EN16931-R003: buyer reference or purchase order reference is required.
        // DE Leitweg-ID takes priority (BT-10, mandatory for B2G); otherwise fall back to the
        // invoice number so the rule is still satisfied when no routing id is configured.
        'cbc:BuyerReference': buyerLeitwegId || data.rawNumber || (data.number?.toString() ?? '0'),
        'cac:AccountingSupplierParty': { 'cac:Party': sellerParty as any },
        'cac:AccountingCustomerParty': { 'cac:Party': buyerParty as any },
        'cac:Delivery': { 'cbc:ActualDeliveryDate': issueDateStr },
        // BR-DE-14: payment means code (mandatory in XRechnung). Derived from paymentMethod.
        'cac:PaymentMeans': [paymentMeansEntry] as any,
        // BG-20: document-level allowance/charge (discount). Empty array when no discount.
        ...(allowanceCharges.length > 0 ? { 'cac:AllowanceCharge': allowanceCharges as any } : {}),
        'cac:TaxTotal': [
          {
            'cbc:TaxAmount': fmt2(totalVat),
            'cbc:TaxAmount@currencyID': currency,
            'cac:TaxSubtotal': taxSubtotals as any,
          },
        ],
        'cac:LegalMonetaryTotal': {
          'cbc:LineExtensionAmount': fmt2(lineExtensionTotal),
          'cbc:LineExtensionAmount@currencyID': currency,
          // BR-27: AllowanceTotalAmount must be present when AllowanceCharge entries exist
          ...(discountAmount > 0
            ? {
                'cbc:AllowanceTotalAmount': fmt2(discountAmount),
                'cbc:AllowanceTotalAmount@currencyID': currency,
              }
            : {}),
          // TaxExclusiveAmount = net after allowances (BT-109)
          'cbc:TaxExclusiveAmount': fmt2(taxableBase),
          'cbc:TaxExclusiveAmount@currencyID': currency,
          'cbc:TaxInclusiveAmount': fmt2(totalIncl),
          'cbc:TaxInclusiveAmount@currencyID': currency,
          'cbc:PayableAmount': fmt2(totalIncl),
          'cbc:PayableAmount@currencyID': currency,
        },
        'cac:InvoiceLine': invoiceLines as any,
      },
    } as EuInvoice;

    return new BuiltEInvoice(euInvoice);
  }

  async renderXml(id: string): Promise<BuiltEInvoice> {
    const invRec = await prisma.invoice.findUnique({
      where: { id },
      include: {
        // BT-25/BT-26: the corrected invoice's number and date travel with the correction.
        correctsInvoice: true,
        items: true,
        client: { include: { partyIdentifiers: true } },
        company: {
          include: { pdfConfig: true, partyIdentifiers: true },
        },
      },
    });

    if (!invRec) {
      logger.error('Invoice not found', { category: 'invoice' });
      throw new BadRequestException('Invoice not found');
    }

    // The transmitting path — renderXmlFormat() goes through here — so this is where the country's
    // mandatory mentions have to be attached. Frozen at the issue date, falling back to today only
    // for a document that has none yet (a draft preview).
    const at = invRec.issuedAt ?? invRec.createdAt ?? new Date();
    const country = invRec.company?.country ?? null;
    const iso = country ? guessCountryCode(country) : undefined;
    const notes = iso
      ? resolveInvoiceNotes(defaultRegistry.resolve(iso).profile, at).map((n) => ({
          subjectCode: n.subjectCode,
          text: n.text,
        }))
      : [];

    // BT-25/BT-26 from the correction link. `correctsInvoice` is included by the query above.
    const preceding = (
      invRec as {
        correctsInvoice?: {
          rawNumber: string | null;
          number: number | null;
          issuedAt: Date | null;
          createdAt: Date;
        } | null;
      }
    ).correctsInvoice;
    const precedingInvoice = preceding
      ? {
          number: preceding.rawNumber ?? String(preceding.number ?? ''),
          issueDate: (preceding.issuedAt ?? preceding.createdAt).toISOString().slice(0, 10),
        }
      : null;

    return this.buildEInvoice({ ...invRec, notes, precedingInvoice } as never);
  }

  async renderXmlFormat(invoiceId: string, format: 'ubl' | 'cii' | 'xrechnung'): Promise<string> {
    const inv = await this.renderXml(invoiceId);
    return inv.exportXml(format);
  }

  // ─── National XML format builders (cycle-safe, no DB) ────────────────

  /** FatturaPA 1.2 XML (IT/SM) via @digitalia/fatturapa — see national/fattura-pa.ts. */
  async buildFatturaPa(data: InvoiceRenderData): Promise<string> {
    return buildFatturaPaXml(data);
  }

  /** CFDI 4.0 Comprobante XML (MX) — see national/cfdi.ts. */
  async buildCfdi(data: InvoiceRenderData): Promise<string> {
    return buildCfdiXml(data);
  }

  /** Facturae 3.2.2 XML (ES) — see national/facturae.ts. */
  async buildFacturae(data: InvoiceRenderData): Promise<string> {
    return buildFacturaeXml(data);
  }

  /** KSA UBL 2.1 + TLV QR (SA/ZATCA FATOORA) — see national/ksa-ubl.ts. */
  async buildKsaUbl(data: InvoiceRenderData, options?: { pih?: string }): Promise<string> {
    return buildKsaUblXml(data, options);
  }

  /** FA_VAT (PL/KSeF) XML — selects FA(2)/FA(3) by issue date, see national/fa-vat.ts. */
  async buildFaVat(data: InvoiceRenderData): Promise<string> {
    return buildFaVatXml(data);
  }

  /** FA_VAT / FA(2) XML — explicit build, kept available during the FA(2)→FA(3) transition. */
  async buildFaVat2(data: InvoiceRenderData): Promise<string> {
    return buildFaVat2Xml(data);
  }

  /** FA_VAT / FA(3) XML — explicit build (KSeF 2.0 structure). */
  async buildFaVat3(data: InvoiceRenderData): Promise<string> {
    return buildFaVat3Xml(data);
  }

  async renderPdfFormat(invoiceId: string, format: '' | 'pdf' | string): Promise<Uint8Array> {
    const invRec = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        items: true,
        client: { include: { partyIdentifiers: true } },
        company: { include: { partyIdentifiers: true } },
        quote: true,
      },
    });
    if (!invRec) {
      logger.error('Invoice not found', { category: 'invoice' });
      throw new BadRequestException('Invoice not found');
    }

    const pdfBuffer = await this.renderPdf(invoiceId);

    if (format === 'pdf' || format === '') {
      return pdfBuffer;
    }

    const inv = await this.renderXml(invoiceId);

    return await inv.embedInPdf(Buffer.from(pdfBuffer), format);
  }

  // ─── InvoiceArtifactPort national XML renderers ──────────────────────

  /** Shared fetch — mirrors the include used by renderXml/renderPdf. */
  private async fetchRenderData(invoiceId: string): Promise<InvoiceRenderData> {
    const inv = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        items: true,
        client: { include: { partyIdentifiers: true } },
        company: { include: { partyIdentifiers: true } },
        // M-4: only populated when this invoice corrects another (Invoice.correctsInvoiceId) —
        // feeds InvoiceRenderData.correction so a national builder (PL's faktura korygująca) can
        // reference the corrected document's own number/date/KSeF number. The compliance
        // documents are ordered so [0] is the most recent one issued for the original invoice
        // (mirrors the `orderBy: createdAt desc` lookup already used by InvoicesService.correctInvoice()).
        correctsInvoice: {
          include: {
            complianceDocuments: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              include: { authorityIds: true },
            },
          },
        },
      },
    });
    if (!inv) {
      logger.error('Invoice not found', { category: 'invoice' });
      throw new BadRequestException('Invoice not found');
    }
    const original = inv.correctsInvoice;
    const originalKsefNumber =
      original?.complianceDocuments[0]?.authorityIds.find((a) => a.scheme === 'KSEF_NUMBER')?.value ?? null;
    return {
      rawNumber: inv.rawNumber,
      number: inv.number,
      issuedAt: inv.issuedAt,
      createdAt: inv.createdAt,
      paymentMethod: inv.paymentMethod ?? null,
      paymentDetails: inv.paymentDetails ?? null,
      discountRate: (inv as any).discountRate ?? null,
      company: {
        name: inv.company.name,
        description: inv.company.description,
        foundedAt: inv.company.foundedAt,
        currency: inv.company.currency,
        address: inv.company.address,
        city: inv.company.city,
        postalCode: inv.company.postalCode,
        country: inv.company.country,
        phone: inv.company.phone,
        email: inv.company.email,
        partyIdentifiers: inv.company.partyIdentifiers.map((p) => ({ scheme: p.scheme, value: p.value })),
      },
      client: {
        type: inv.client.type,
        name: inv.client.name,
        description: inv.client.description,
        foundedAt: inv.client.foundedAt,
        contactFirstname: inv.client.contactFirstname,
        contactLastname: inv.client.contactLastname,
        contactEmail: inv.client.contactEmail,
        contactPhone: inv.client.contactPhone,
        salutation: inv.client.salutation,
        sex: inv.client.sex,
        title: inv.client.title,
        isActive: inv.client.isActive,
        address: inv.client.address,
        city: inv.client.city,
        postalCode: inv.client.postalCode,
        country: inv.client.country,
        partyIdentifiers: inv.client.partyIdentifiers.map((p) => ({ scheme: p.scheme, value: p.value })),
      },
      items: inv.items.map((i) => ({
        name: i.name,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        vatRate: i.vatRate ?? 0,
        type: i.type,
      })),
      correction: original
        ? {
            originalIssueDate: original.issuedAt ?? original.createdAt,
            originalNumber: original.rawNumber || (original.number != null ? String(original.number) : ''),
            originalKsefNumber,
            reason: inv.notes ?? null,
          }
        : undefined,
    };
  }

  async renderFatturaPa(invoiceId: string): Promise<string> {
    return this.buildFatturaPa(await this.fetchRenderData(invoiceId));
  }

  async renderCfdi(invoiceId: string): Promise<string> {
    return this.buildCfdi(await this.fetchRenderData(invoiceId));
  }

  async renderFacturae(invoiceId: string): Promise<string> {
    return this.buildFacturae(await this.fetchRenderData(invoiceId));
  }

  async renderKsaUbl(invoiceId: string): Promise<string> {
    return this.buildKsaUbl(await this.fetchRenderData(invoiceId));
  }

  async renderFaVat(invoiceId: string): Promise<string> {
    return this.buildFaVat(await this.fetchRenderData(invoiceId));
  }

  /** Generic national XML — routes by countryCode to country-specific skeleton. */
  async buildNationalXml(data: InvoiceRenderData, countryCode: string): Promise<string> {
    const cc = countryCode.toUpperCase();
    const builder = NATIONAL_XML_BUILDERS[cc];
    if (builder) return builder(data);
    return buildGenericNationalXml(data, cc);
  }

  async renderNationalXml(invoiceId: string, countryCode: string): Promise<string> {
    return this.buildNationalXml(await this.fetchRenderData(invoiceId), countryCode);
  }
}
