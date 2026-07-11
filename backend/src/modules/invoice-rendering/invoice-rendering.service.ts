import { Injectable, BadRequestException } from '@nestjs/common';
import * as Handlebars from 'handlebars';
import type { Invoice as EuInvoice } from '@e-invoice-eu/core';
import { InvoiceService as EuInvoiceService } from '@e-invoice-eu/core';
import prisma from '@/prisma/prisma.service';
import { logger } from '@/logger/logger.service';
import { getInvertColor, getPDF } from '@/utils/pdf';
import { baseTemplate } from '@/modules/invoices/templates/base.template';
import { formatDate } from '@/utils/date';
import { formatRichText } from '@/utils/format-text';
import { clampDiscountRate } from '@/utils/financial';
import { getDraftWatermarkLabel } from '@/utils/watermark';
import { augmentWithIdentifiers, getIdentifier } from '@/utils/entity-identifiers';
import { guessCountryCode } from '@/utils/country-name-to-iso';
import type { InvoiceRenderData, LineAllowance } from './render-data';
import { buildFatturaPa as buildFatturaPaXml } from './national/fattura-pa';
import { buildCfdi as buildCfdiXml } from './national/cfdi';
import { buildFacturae as buildFacturaeXml } from './national/facturae';
import { buildKsaUbl as buildKsaUblXml } from './national/ksa-ubl';
import { buildFaVat as buildFaVatXml } from './national/fa-vat';
import { NATIONAL_XML_BUILDERS } from './national/index';
import { buildGenericNationalXml } from './national/generic-builder';

export type { InvoiceRenderData, LineAllowance } from './render-data';
export { computeKsaInvoiceHash, ZATCA_PIH_INIT } from './national/ksa-ubl';

/** Silent logger for @e-invoice-eu/core — validation errors surface as thrown exceptions. */
const EU_LOGGER = { log: () => {}, warn: () => {}, error: () => {} };

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
    return result.toString();
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
        unitPrice: i.unitPrice.toFixed(2),
        vatRate: (i.vatRate || 0).toFixed(2),
        totalPrice: (i.quantity * i.unitPrice * (1 + (i.vatRate || 0) / 100)).toFixed(2),
        type: itemTypeLabels[i.type] || i.type,
      })),
      totalHT: invoice.totalHT.toFixed(2),
      totalVAT: invoice.totalVAT.toFixed(2),
      totalTTC: invoice.totalTTC.toFixed(2),
      subtotalBeforeDiscount: subtotalBeforeDiscount.toFixed(2),
      discountAmount: discountAmountValue.toFixed(2),
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
      notes: (invoice.notes || '').replace(/\n/g, '<br>'),

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

    const sellerVat = getIdentifier(data.company, 'VAT');
    const buyerVat = getIdentifier(data.client, 'VAT');
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

    const vatGroups = new Map<number, { taxable: number; tax: number }>();
    let lineExtensionTotal = 0;

    for (const item of positiveItems) {
      const rate = item.vatRate || 0;
      // Line net = gross minus any explicit per-line allowances (BG-27).
      const lineAllowanceTotal = (item.allowances ?? []).reduce((s, a) => s + a.amount, 0);
      const net = item.quantity * item.unitPrice - lineAllowanceTotal;
      lineExtensionTotal += net;
      const g = vatGroups.get(rate) ?? { taxable: 0, tax: 0 };
      g.taxable += net;
      g.tax += (net * rate) / 100;
      vatGroups.set(rate, g);
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
    const taxSubtotalsAfterDiscount = [...vatGroups.entries()].map(([rate, g]) => {
      const discountedTaxable = g.taxable * discountRatio;
      const discountedTax = (discountedTaxable * rate) / 100;
      totalVat += discountedTax;
      return { rate, taxable: discountedTaxable, tax: discountedTax };
    });
    const totalIncl = taxableBase + totalVat;

    const taxSubtotals = taxSubtotalsAfterDiscount.map(({ rate, taxable, tax }) => ({
      'cbc:TaxableAmount': fmt2(taxable),
      'cbc:TaxableAmount@currencyID': currency,
      'cbc:TaxAmount': fmt2(tax),
      'cbc:TaxAmount@currencyID': currency,
      'cac:TaxCategory': {
        'cbc:ID': rate === 0 ? 'Z' : 'S',
        'cbc:Percent': String(rate),
        'cac:TaxScheme': { 'cbc:ID': 'VAT' },
      },
    }));

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
            'cbc:ID': (item.vatRate || 0) === 0 ? 'Z' : 'S',
            'cbc:Percent': String(item.vatRate || 0),
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
    //           3) email with EM
    //           4) placeholder
    const rawPeppolSeller = getIdentifier(data.company, 'PEPPOL_ENDPOINT');
    const peppolSellerParts = rawPeppolSeller?.match(/^(\d{4,}):(.+)$/);
    const sellerEndpointId =
      peppolSellerParts?.[2] ??
      sellerSiren ??
      (data.company.email ? data.company.email.trim() : null) ??
      'seller@local.invalid';
    const sellerEndpointScheme = peppolSellerParts?.[1] ?? (sellerSiren ? '0225' : 'EM');

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
    // BR-DE-11 (seller telephone) + BR-DE-12 (seller email) — emit when data is available
    if (data.company.phone || data.company.email) {
      sellerParty['cac:Contact'] = {
        ...(data.company.phone ? { 'cbc:Telephone': data.company.phone } : {}),
        ...(data.company.email ? { 'cbc:ElectronicMail': data.company.email } : {}),
      };
    }

    // @e-invoice-eu/core requires EndpointID on the buyer party (mandatory in its JSON schema).
    // Priority: 1) PEPPOL_ENDPOINT party identifier (format 'schemeId:value', e.g. '0088:7300010000001')
    //           2) SIREN with schemeID 0225 (FR B2B routing)
    //           3) contact email with EM
    //           4) placeholder
    const rawPeppolBuyer = getIdentifier(data.client, 'PEPPOL_ENDPOINT');
    const peppolBuyerParts = rawPeppolBuyer?.match(/^(\d{4,}):(.+)$/);
    const buyerEndpointId =
      peppolBuyerParts?.[2] ??
      buyerSiren ??
      (data.client.contactEmail ? data.client.contactEmail.trim() : null) ??
      ((data.client as any).email ? (data.client as any).email.trim() : null) ??
      'consumer@local.invalid';
    const buyerEndpointScheme = peppolBuyerParts?.[1] ?? (buyerSiren ? '0225' : 'EM');

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
    const vatCategoryId = (taxSubtotalsAfterDiscount[0]?.rate ?? 0) === 0 ? 'Z' : 'S';
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
        'cbc:InvoiceTypeCode': '380',
        'cbc:DocumentCurrencyCode': currency,
        // PEPPOL-EN16931-R003: buyer reference or purchase order reference is required.
        // Fall back to the invoice number when no explicit buyer PO ref is provided.
        'cbc:BuyerReference': data.rawNumber || (data.number?.toString() ?? '0'),
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

    return this.buildEInvoice(invRec);
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

  /** FA_VAT (PL/KSeF) XML — see national/fa-vat.ts. */
  async buildFaVat(data: InvoiceRenderData): Promise<string> {
    return buildFaVatXml(data);
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
      },
    });
    if (!inv) {
      logger.error('Invoice not found', { category: 'invoice' });
      throw new BadRequestException('Invoice not found');
    }
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
