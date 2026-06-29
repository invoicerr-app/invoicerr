import { Injectable, BadRequestException } from '@nestjs/common';
import * as Handlebars from 'handlebars';
import type { Invoice as EuInvoice } from '@e-invoice-eu/core';
import { InvoiceService as EuInvoiceService } from '@e-invoice-eu/core';
import prisma from '@/prisma/prisma.service';
import { logger } from '@/logger/logger.service';
import { getInvertColor, getPDF } from '@/utils/pdf';
import { baseTemplate } from '@/modules/invoices/templates/base.template';
import { formatDate } from '@/utils/date';
import { formatItemDescription } from '@/utils/format-text';
import { clampDiscountRate } from '@/utils/financial';
import { getDraftWatermarkLabel } from '@/utils/watermark';
import { augmentWithIdentifiers, getIdentifier } from '@/utils/entity-identifiers';
import { parseAddress } from '@/utils/adress';
import { guessCountryCode } from '@/utils/country-name-to-iso';
import type { ExportFormat } from '@/compliance/providers/format/invoice-artifact-port';

/** Silent logger for @e-invoice-eu/core — validation errors surface as thrown exceptions. */
const EU_LOGGER = { log: () => {}, warn: () => {}, error: () => {} };

/** Format name mapping: our ExportFormat strings → @e-invoice-eu/core format names. */
const EU_FORMAT_MAP: Record<string, string> = {
  ubl: 'UBL',
  cii: 'CII',
  xrechnung: 'XRECHNUNG-UBL',
  facturx: 'CII',   // Factur-X XML content is CII (PDF embedding via embedInPdf)
  zugferd: 'CII',   // ZUGFeRD 2.x uses the same CII/EN16931 profile
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

  async embedInPdf(pdfBuffer: Buffer, format: string): Promise<Uint8Array> {
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


/** Minimal data shape required by {@link InvoiceRenderingService.buildEInvoice}.
 *  Matches the Prisma include used by {@link renderXml} / {@link renderPdf} but is
 *  decoupled from Prisma so tests can build invoices from plain objects. */
export interface InvoiceRenderData {
  rawNumber: string | null;
  number: number | null;
  issuedAt: Date | null;
  createdAt: Date;
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
  }[];
}

/**
 * ZATCA FATOORA TLV QR — 5 mandatory fields, base64-encoded.
 * Tags: 1=sellerName, 2=vatNumber, 3=issueDateTime, 4=totalWithVat, 5=vatAmount.
 * Each field: [tag:u8][length:u8][value:utf-8 bytes].
 */
function buildZatcaQrTlv(
    sellerName: string,
    vatNumber: string,
    issueDateTime: string,
    totalWithVat: string,
    vatAmount: string,
): string {
    const encodeField = (tag: number, value: string): Buffer => {
        const valueBytes = Buffer.from(value, 'utf-8');
        const header = Buffer.alloc(2);
        header[0] = tag;
        header[1] = valueBytes.length;
        return Buffer.concat([header, valueBytes]);
    };
    return Buffer.concat([
        encodeField(1, sellerName),
        encodeField(2, vatNumber),
        encodeField(3, issueDateTime),
        encodeField(4, totalWithVat),
        encodeField(5, vatAmount),
    ]).toString('base64');
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

        if (invoice.client.name.length == 0) {
            invoice.client.name = invoice.client.contactFirstname + " " + invoice.client.contactLastname
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

        const subtotalBeforeDiscount = invoice.items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
        const normalizedDiscountRate = clampDiscountRate(invoice.discountRate);
        const discountAmountValue = Math.max(0, subtotalBeforeDiscount - invoice.totalHT);
        const hasDiscount = normalizedDiscountRate > 0 && discountAmountValue > 0;

        const html = template({
            isDraft: invoice.status === 'DRAFT',
            draftLabel: getDraftWatermarkLabel(invoice.company.country),
            number: invoice.rawNumber || (invoice.number?.toString() ?? getDraftWatermarkLabel(invoice.company.country)),
            date: formatDate(invoice.company, invoice.issuedAt ?? invoice.createdAt),
            dueDate: formatDate(invoice.company, invoice.dueDate),
            company: companyAugmented,
            client: clientAugmented,
            currency: invoice.currency,
            items: invoice.items.map(i => ({
                name: i.name,
                description: formatItemDescription(i.description),
                quantity: Number.isInteger(i.quantity) ? i.quantity.toString() : i.quantity.toFixed(3).replace(/\.?0+$/, ''),
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
            vatExemptText: invoice.company.exemptVat && (invoice.company.country || '').toUpperCase() === 'FRANCE' ? 'TVA non applicable, art. 293 B du CGI' : null,

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
            return digits.length === 14 ? digits.slice(0, 9) : (legalId || undefined);
        };
        const sellerSiren = toSiren(getIdentifier(data.company, 'LEGAL_ID'));
        const buyerSiren = toSiren(getIdentifier(data.client, 'LEGAL_ID'));

        // ── Compute totals ────────────────────────────────────────────────
        const fmt2 = (n: number) => n.toFixed(2);

        const vatGroups = new Map<number, { taxable: number; tax: number }>();
        let lineExtensionTotal = 0;

        for (const item of data.items) {
            const rate = item.vatRate || 0;
            const net = item.quantity * item.unitPrice;
            lineExtensionTotal += net;
            const g = vatGroups.get(rate) ?? { taxable: 0, tax: 0 };
            g.taxable += net;
            g.tax += net * rate / 100;
            vatGroups.set(rate, g);
        }

        const totalVat = [...vatGroups.values()].reduce((s, g) => s + g.tax, 0);
        const totalIncl = lineExtensionTotal + totalVat;

        const taxSubtotals = [...vatGroups.entries()].map(([rate, g]) => ({
            'cbc:TaxableAmount': fmt2(g.taxable),
            'cbc:TaxableAmount@currencyID': currency,
            'cbc:TaxAmount': fmt2(g.tax),
            'cbc:TaxAmount@currencyID': currency,
            'cac:TaxCategory': {
                'cbc:ID': rate === 0 ? 'Z' : 'S',
                'cbc:Percent': String(rate),
                'cac:TaxScheme': { 'cbc:ID': 'VAT' },
            },
        }));

        const invoiceLines = data.items.map((item, idx) => {
            const net = item.quantity * item.unitPrice;
            const unitCode = item.type === 'HOUR' ? 'HUR'
                           : item.type === 'DAY'  ? 'DAY'
                           : item.type === 'DEPOSIT' ? 'SET'
                           : 'C62';
            return {
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
        });

        // ── Build invoice data object ──────────────────────────────────────
        // @e-invoice-eu/core requires EndpointID on both parties.
        // For companies: use SIREN with schemeID 0225 (FR PDP routing) or email with EM.
        const sellerEndpointId = sellerSiren
            ?? (data.company.email ? data.company.email.trim() : null)
            ?? 'seller@local.invalid';
        const sellerEndpointScheme = sellerSiren ? '0225' : 'EM';

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
            sellerParty['cac:PartyTaxScheme'] = [{ 'cbc:CompanyID': sellerVat, 'cac:TaxScheme': { 'cbc:ID': 'VAT' } }];
        }
        // BR-DE-11 (seller telephone) + BR-DE-12 (seller email) — emit when data is available
        if (data.company.phone || data.company.email) {
            sellerParty['cac:Contact'] = {
                ...(data.company.phone ? { 'cbc:Telephone': data.company.phone } : {}),
                ...(data.company.email ? { 'cbc:ElectronicMail': data.company.email } : {}),
            };
        }

        // @e-invoice-eu/core requires EndpointID on the buyer party (mandatory in its JSON schema).
        // For B2B: use SIREN with schemeID 0225.
        // For B2C (individual with no SIREN): use contact email with EM, or fall back to a placeholder.
        const buyerEndpointId = buyerSiren
            ?? (data.client.contactEmail ? data.client.contactEmail.trim() : null)
            ?? ((data.client as any).email ? (data.client as any).email.trim() : null)
            ?? 'consumer@local.invalid';
        const buyerEndpointScheme = buyerSiren ? '0225' : 'EM';

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

        const euInvoice: EuInvoice = {
            'ubl:Invoice': {
                'cbc:CustomizationID': 'urn:cen.eu:en16931:2017',
                'cbc:ProfileID': 'M1',
                'cbc:ID': data.rawNumber || (data.number?.toString() ?? 'DRAFT'),
                'cbc:IssueDate': issueDateStr,
                'cbc:InvoiceTypeCode': '380',
                'cbc:DocumentCurrencyCode': currency,
                'cac:AccountingSupplierParty': { 'cac:Party': sellerParty as any },
                'cac:AccountingCustomerParty': { 'cac:Party': buyerParty as any },
                'cac:Delivery': { 'cbc:ActualDeliveryDate': issueDateStr },
                // BR-DE-14: payment means code required in XRechnung (BT-81 is mandatory).
                // Code 1 = "Instrument not defined" — safe default that satisfies the presence
                // requirement without triggering CII-SR-470 (which requires IBAN for code 30/58).
                // TODO: derive a specific code from invoice.paymentMethod when that field is exposed.
                'cac:PaymentMeans': [{ 'cbc:PaymentMeansCode': '1' }] as any,
                'cac:TaxTotal': [{
                    'cbc:TaxAmount': fmt2(totalVat),
                    'cbc:TaxAmount@currencyID': currency,
                    'cac:TaxSubtotal': taxSubtotals as any,
                }],
                'cac:LegalMonetaryTotal': {
                    'cbc:LineExtensionAmount': fmt2(lineExtensionTotal),
                    'cbc:LineExtensionAmount@currencyID': currency,
                    'cbc:TaxExclusiveAmount': fmt2(lineExtensionTotal),
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

    /** FatturaPA 1.2 XML (IT/SM) via @digitalia/fatturapa — JSON→XML.
     *
     *  Key design decisions (reusable as format template):
     *  - ALL amounts/dates are **strings** matching the yup regex patterns
     *    (e.g. /^[-]?\d{1,12}(\.\d{2,8})$/ for PrezzoTotale, /^[-]?\d{1,3}(\.\d{2,2})$/ for AliquotaIVA).
     *  - Natura is deduced from operation nature (client country + VAT) — NOT a blanket N1 for 0%.
     *  - CodiceDestinatario defaults to 'XXXXXXX' (foreign/no-PEC) — PEC field absent from model = documented gap.
     *  - ProgressivoInvio is derived from invoice number or timestamp for uniqueness.
     *  - Contatti only emitted when data exists (never undefined).
     *  - RiferimentoNormativo emitted when Natura is present (legal reference).
     *  - EsigibilitaIVA defaults to 'I' (immédiate).
     */
    async buildFatturaPa(data: InvoiceRenderData): Promise<string> {
        const { fpa2xml } = await import('@digitalia/fatturapa');

        // ── helpers ──────────────────────────────────────────────────────
        /** Format a number as a string matching the yup SPrezzoSchema regex: /^[-]?\d{1,12}(\.\d{2,8})$/ */
        const fmtAmount = (n: number, decimals = 2): string => {
            const factor = 10 ** decimals;
            const rounded = Math.round(n * factor) / factor;
            return rounded.toFixed(decimals);
        };
        /** Format AliquotaIVA as /^[-]?\d{1,3}(\.\d{2,2})$/ */
        const fmtRate = (n: number): string => n.toFixed(2);
        /** Map NaturaType — codes N1–N7 per FatturaPA spec */
        const mapNatura = (vatRate: number, clientCountry: string, clientVatId: string): string | undefined => {
            if (vatRate > 0) return undefined;
            const cc = (clientCountry || '').slice(0, 2).toUpperCase();
            // Intra-EU reverse charge: client in EU (not IT) with valid VAT ID
            const EU_CC = ['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE'];
            if (cc !== 'IT' && EU_CC.includes(cc) && clientVatId) return 'N6';
            // Default non soggette for domestic 0% rate
            return 'N2';
        };
        /** RiferimentoNormativo text per Natura code */
        const riferimentoNormativo = (natura: string): string => {
            switch (natura) {
                case 'N6': return 'Reverse charge art. 17 DPR 633/72';
                case 'N4': return 'Esente art. 10 DPR 633/72';
                case 'N3': return 'Non imponibile art. 8 DPR 633/72';
                case 'N2': return 'Operazione non soggetta';
                default: return 'Art. 1 DPR 633/72';
            }
        };

        // ── identifiers ──────────────────────────────────────────────────
        const vatId = getIdentifier(data.company, 'VAT') || '';
        const vatCountry = (data.company.country || 'IT').slice(0, 2).toUpperCase();
        const cf = getIdentifier(data.company, 'LEGAL_ID') || '';

        const clienteVatId = getIdentifier(data.client, 'VAT') || '';
        const clienteVatCountry = (data.client.country || '').slice(0, 2).toUpperCase();
        const clienteCf = getIdentifier(data.client, 'LEGAL_ID') || '';

        const issueDate = (data.issuedAt ?? data.createdAt).toISOString().split('T')[0];

        // ── ProgressivoInvio: unique per invoice ─────────────────────────
        const progressivoInvio = (data.rawNumber || data.number?.toString() || Date.now().toString())
            .replace(/[^A-Za-z0-9]/g, '')
            .slice(0, 10) || '00001';

        // ── CodiceDestinatario ──────────────────────────────────────────
        // FPR12 requires 7 chars. 'XXXXXXX' = foreign/unknown (no PEC).
        // '0000000' requires PECDestinatario (PEC email) — absent from model → documented gap.
        const codiceDestinatario = 'XXXXXXX';

        // ── DettaglioLinee ──────────────────────────────────────────────
        const dettaglioLinee = data.items.map((item, idx) => {
            const natura = mapNatura(item.vatRate || 0, clienteVatCountry, clienteVatId);
            return {
                NumeroLinea: idx + 1,
                Descrizione: item.name,
                Quantita: fmtAmount(item.quantity, 2),
                PrezzoUnitario: fmtAmount(item.unitPrice, 8),
                PrezzoTotale: fmtAmount(item.quantity * item.unitPrice, 8),
                AliquotaIVA: fmtRate(item.vatRate || 0),
                ...(natura ? { Natura: natura, RiferimentoNormativo: riferimentoNormativo(natura) } : {}),
            };
        });

        // ── DatiRiepilogo: grouped by VAT rate ──────────────────────────
        const datiRiepilogo = data.items.reduce<Record<string, { imponibile: number; imposta: number; rate: number; natura?: string }>>((acc, item) => {
            const rate = item.vatRate || 0;
            const key = String(rate);
            if (!acc[key]) {
                const natura = mapNatura(rate, clienteVatCountry, clienteVatId);
                acc[key] = { imponibile: 0, imposta: 0, rate, natura };
            }
            acc[key].imponibile += item.quantity * item.unitPrice;
            acc[key].imposta += item.quantity * item.unitPrice * rate / 100;
            return acc;
        }, {});

        const riepilogoList = Object.values(datiRiepilogo).map(g => ({
            AliquotaIVA: fmtRate(g.rate),
            ImponibileImporto: fmtAmount(g.imponibile, 2),
            Imposta: fmtAmount(g.imposta, 2),
            EsigibilitaIVA: 'I' as const,
            ...(g.natura ? { Natura: g.natura, RiferimentoNormativo: riferimentoNormativo(g.natura) } : {}),
        }));

        // ── Contatti: only emit if data present (never undefined) ────────
        const contatti: Record<string, string> = {};
        if (data.company.phone) contatti.Telefono = data.company.phone;
        if (data.company.email) contatti.Email = data.company.email;

        const totaleImponibile = data.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
        const totaleIVA = data.items.reduce((s, i) => s + i.quantity * i.unitPrice * (i.vatRate || 0) / 100, 0);

        // ── Build the FatturaPA JSON object ──────────────────────────────
        const fattura = {
            'p:FatturaElettronica': {
                '@': { versione: 'FPR12' },
                FatturaElettronicaHeader: {
                    DatiTrasmissione: {
                        IdTrasmittente: { IdPaese: vatCountry, IdCodice: cf || vatId },
                        ProgressivoInvio: progressivoInvio,
                        FormatoTrasmissione: 'FPR12',
                        CodiceDestinatario: codiceDestinatario,
                    },
                    CedentePrestatore: {
                        DatiAnagrafici: {
                            IdFiscaleIVA: { IdPaese: vatCountry, IdCodice: vatId },
                            Anagrafica: { Denominazione: data.company.name },
                            RegimeFiscale: 'RF01',
                        },
                        Sede: {
                            Indirizzo: data.company.address || 'N/A',
                            CAP: data.company.postalCode || '00000',
                            Comune: data.company.city || 'N/A',
                            Nazione: vatCountry,
                        },
                        ...(Object.keys(contatti).length > 0 ? { Contatti: contatti } : {}),
                    },
                    CessionarioCommittente: {
                        DatiAnagrafici: {
                            Anagrafica: { Denominazione: data.client.name || `${data.client.contactFirstname || ''} ${data.client.contactLastname || ''}`.trim() },
                            ...(clienteVatId ? { IdFiscaleIVA: { IdPaese: clienteVatCountry, IdCodice: clienteVatId } } : {}),
                            ...(clienteCf ? { CodiceFiscale: clienteCf } : {}),
                        },
                        Sede: {
                            Indirizzo: data.client.address || 'N/A',
                            CAP: data.client.postalCode || '00000',
                            Comune: data.client.city || 'N/A',
                            Nazione: clienteVatCountry || 'IT',
                        },
                        // yup schema requires StabileOrganizzazione when Sede.Nazione !== 'IT'
                        ...(clienteVatCountry && clienteVatCountry !== 'IT' ? {
                            StabileOrganizzazione: {
                                Indirizzo: data.client.address || 'N/A',
                                CAP: data.client.postalCode || '00000',
                                Comune: data.client.city || 'N/A',
                                Nazione: clienteVatCountry,
                            },
                        } : {}),
                    },
                },
                'FatturaElettronicaBody': {
                    DatiGenerali: {
                        DatiGeneraliDocumento: {
                            TipoDocumento: 'TD01',
                            Divisa: data.company.currency || 'EUR',
                            Data: issueDate,
                            Numero: data.rawNumber || (data.number?.toString() ?? 'DRAFT'),
                            ImportoTotaleDocumento: fmtAmount(totaleImponibile + totaleIVA, 2),
                        },
                    },
                    DatiBeniServizi: {
                        DettaglioLinee: dettaglioLinee,
                        DatiRiepilogo: riepilogoList,
                    },
                    DatiPagamento: {
                        CondizioniPagamento: 'TP02',
                        DettaglioPagamento: {
                            ModalitaPagamento: 'MP05',
                            ImportoPagamento: fmtAmount(totaleImponibile + totaleIVA, 2),
                        },
                    },
                },
            },
        };

        return fpa2xml(fattura as any);
    }

    /** CFDI 4.0 Comprobante XML (MX) — Emisor/Receptor/Conceptos/Impuestos complete, namespaced
     *  to the SAT cfd/4 schema. Emitted unsealed: Sello/Certificado are the signing port's concern,
     *  the TimbreFiscalDigital UUID is the PAC (timbrado) transmission concern. No values faked. */
    async buildCfdi(data: InvoiceRenderData): Promise<string> {
        const issueDate = (data.issuedAt ?? data.createdAt).toISOString().split('T')[0];
        const rfc = getIdentifier(data.company, 'VAT') || 'XAXX010101000';
        const rfcReceptor = getIdentifier(data.client, 'VAT') || 'XAXX010101000';
        const total = data.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
        const totalIVA = data.items.reduce((s, i) => s + i.quantity * i.unitPrice * (i.vatRate || 0) / 100, 0);
        const currency = data.company.currency || 'MXN';
        const numId = data.rawNumber || (data.number?.toString() ?? '001');
        const postalCode = data.company.postalCode || '00000';
        const receptorName = data.client.name || `${data.client.contactFirstname || ''} ${data.client.contactLastname || ''}`.trim();
        const receptorPostal = data.client.postalCode || '00000';

        let conceptosXml = '';
        for (let idx = 0; idx < data.items.length; idx++) {
            const item = data.items[idx];
            const importe = item.quantity * item.unitPrice;
            let impuestosXml = '';
            if (item.vatRate > 0) {
                const impIVA = importe * item.vatRate / 100;
                impuestosXml = `
              <cfdi:Impuestos>
                <cfdi:Traslados>
                  <cfdi:Traslado Base="${importe.toFixed(2)}" Impuesto="002" TipoFactor="Tasa" TasaOCuota="${(item.vatRate / 100).toFixed(6)}" Importe="${impIVA.toFixed(2)}"/>
                </cfdi:Traslados>
              </cfdi:Impuestos>`;
            }
            conceptosXml += `
          <cfdi:Concepto NoIdentificacion="${idx + 1}" ClaveProdServ="84111506" Cantidad="${item.quantity}" ClaveUnidad="E48" Unidad="Servicio" Descripcion="${item.name}" ValorUnitario="${item.unitPrice.toFixed(2)}" Importe="${importe.toFixed(2)}"${impuestosXml}/>`;
        }

        let impuestosRoot = '<cfdi:Impuestos TotalImpuestosTrasladados="0"/>';
        if (totalIVA > 0) {
            impuestosRoot = `<cfdi:Impuestos TotalImpuestosTrasladados="${totalIVA.toFixed(2)}">
          <cfdi:Traslados>
            <cfdi:Traslado Base="${total.toFixed(2)}" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="${totalIVA.toFixed(2)}"/>
          </cfdi:Traslados>
        </cfdi:Impuestos>`;
        }

        // Sello / Certificado / NoCertificado seam: the CFDI seal is computed over the
        // "cadena original" (a fixed XSLT transform of the document) and signed with the
        // taxpayer's CSD (Certificado de Sello Digital) private key, then the SAT-authorized
        // PAC stamps the TimbreFiscalDigital (UUID) in <cfdi:Complemento>. We emit the document
        // UNSEALED (empty Sello/Certificado/NoCertificado) — the signing port fills the seal and
        // the PAC transmission concern fills the UUID. We do NOT fabricate a certificate or UUID.
        return `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.sat.gob.mx/cfd/4 http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd" Version="4.0" Serie="A" Folio="${numId}" Fecha="${issueDate}T12:00:00" FormaPago="03" NoCertificado="" Certificado="" Sello="" SubTotal="${total.toFixed(2)}" Moneda="${currency}" Total="${(total + totalIVA).toFixed(2)}" TipoDeComprobante="I" MetodoPago="PUE" LugarExpedicion="${postalCode}" Exportacion="01">
  <cfdi:Emisor Rfc="${rfc}" Nombre="${data.company.name}" RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="${rfcReceptor}" Nombre="${receptorName}" RegimenFiscalReceptor="601" DomicilioFiscalReceptor="${receptorPostal}" UsoCFDI="G03"/>
  <cfdi:Conceptos>${conceptosXml}
  </cfdi:Conceptos>
  ${impuestosRoot}
  <cfdi:Complemento/>
</cfdi:Comprobante>`;
    }

    /** Facturae 3.2.2 XML (ES) — structural skeleton. */
    async buildFacturae(data: InvoiceRenderData): Promise<string> {
        const issueDate = (data.issuedAt ?? data.createdAt).toISOString().split('T')[0];
        const total = data.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
        const totalIVA = data.items.reduce((s, i) => s + i.quantity * i.unitPrice * (i.vatRate || 0) / 100, 0);
        const vatId = getIdentifier(data.company, 'VAT') || '';
        const clienteVatId = getIdentifier(data.client, 'VAT') || '';

        const lineas = data.items.map((item, idx) => ({
            InvoiceLine: {
                LineItemNumber: idx + 1,
                ArticleDescription: item.name,
                Quantity: item.quantity,
                UnitOfMeasure: '01',
                UnitPriceWithoutTax: item.unitPrice,
                TotalCost: item.quantity * item.unitPrice,
                DiscountsAndRebates: [],
                TaxesWithheld: [],
                Charge: [],
                Tax: { TaxTypeCode: 'IVA', TaxRate: item.vatRate || 0 },
            },
        }));

        const facturaxml = {
            Facturae: {
                '@': { xmlns: 'http://www.facturae.es/Facturae/2014/v3.2.2/Facturae' },
                FileHeader: {
                    SchemaVersion: '3.2.2',
                    InvoiceIssuerType: 'EM',
                    InvoiceIssueDate: issueDate,
                    InvoiceCurrencyCode: data.company.currency || 'EUR',
                    LanguageName: 'es',
                },
                Parties: {
                    SellerParty: {
                        TaxIdentification: { TaxIdentificationNumber: vatId, PersonTypeCode: 'J', LegalRegistrationNumber: vatId },
                        PartyLegalEntity: { CorporateName: data.company.name, TradeName: data.company.name },
                    },
                    BuyerParty: {
                        TaxIdentification: { TaxIdentificationNumber: clienteVatId, PersonTypeCode: data.client.type === 'COMPANY' ? 'J' : 'F' },
                        PartyLegalEntity: { CorporateName: data.client.name || `${data.client.contactFirstname || ''} ${data.client.contactLastname || ''}`.trim() },
                    },
                },
                Invoices: {
                    Invoice: {
                        InvoiceHeader: { InvoiceNumber: data.rawNumber || (data.number?.toString() ?? 'DRAFT'), InvoiceDocumentType: 'OC' },
                        InvoiceTotals: { InvoiceGrossAmount: total + totalIVA, InvoiceTotalAmountWithoutTax: total, InvoiceTotalTaxAmount: totalIVA },
                        InvoiceItems: lineas,
                    },
                },
            },
        };

        const builder = await import('xmlbuilder2');
        const doc = builder.create(facturaxml as any, { format: 'fragment' });
        return doc.end({ prettyPrint: true });
    }

    /** KSA UBL 2.1 + TLV QR (SA/ZATCA FATOORA). */
    async buildKsaUbl(data: InvoiceRenderData): Promise<string> {
        const issueDateTime = (data.issuedAt ?? data.createdAt).toISOString();
        const issueDate = issueDateTime.split('T')[0];
        const total = data.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
        const totalIVA = data.items.reduce((s, i) => s + i.quantity * i.unitPrice * (i.vatRate || 0) / 100, 0);
        const vatNumber = getIdentifier(data.company, 'VAT') || '';

        // ZATCA TLV QR — generated offline; final QR includes the digital signature (tag 6)
        // which requires the FATOORA clearance step. This covers the 5 pre-clearance fields.
        const qrTlv = buildZatcaQrTlv(
            data.company.name,
            vatNumber,
            issueDateTime,
            (total + totalIVA).toFixed(2),
            totalIVA.toFixed(2),
        );

        const inv = {
            'ubl:Invoice': {
                'cbc:CustomizationID': 'urn:cen.eu:en16931:2017#compliant#urn:fdc:zatca.sa:2017:invoice:01:1.0',
                'cbc:ProfileID': 'reporting:1.0',
                'cbc:ID': data.rawNumber || (data.number?.toString() ?? 'DRAFT'),
                'cbc:IssueDate': issueDate,
                'cbc:InvoiceTypeCode': '380',
                'cbc:DocumentCurrencyCode': data.company.currency || 'SAR',
                // ZATCA QR TLV embedded as AdditionalDocumentReference (tag QR)
                'cac:AdditionalDocumentReference': {
                    'cbc:ID': 'QR',
                    'cac:Attachment': {
                        'cbc:EmbeddedDocumentBinaryObject': qrTlv,
                        'cbc:EmbeddedDocumentBinaryObject@mimeCode': 'text/plain',
                    },
                },
                'cac:AccountingSupplierParty': {
                    'cac:Party': {
                        'cbc:EndpointID': vatNumber,
                        'cac:PostalAddress': {
                            'cbc:CityName': data.company.city || '',
                            'cac:Country': { 'cbc:IdentificationCode': (data.company.country || 'SA').slice(0, 2).toUpperCase() },
                        },
                        'cac:PartyLegalEntity': {
                            'cbc:RegistrationName': data.company.name,
                            'cbc:CompanyID': vatNumber,
                        },
                    },
                },
                'cac:AccountingCustomerParty': {
                    'cac:Party': {
                        'cbc:EndpointID': getIdentifier(data.client, 'VAT') || '',
                        'cac:PostalAddress': {
                            'cbc:CityName': data.client.city || '',
                            'cac:Country': { 'cbc:IdentificationCode': (data.client.country || '').slice(0, 2).toUpperCase() },
                        },
                        'cac:PartyLegalEntity': {
                            'cbc:RegistrationName': data.client.name || `${data.client.contactFirstname || ''} ${data.client.contactLastname || ''}`.trim(),
                            'cbc:CompanyID': getIdentifier(data.client, 'VAT') || '',
                        },
                    },
                },
                'cac:TaxTotal': [{
                    'cbc:TaxAmount': totalIVA.toFixed(2),
                    'cbc:TaxAmount@currencyID': data.company.currency || 'SAR',
                    'cac:TaxSubtotal': Object.values(
                        data.items.reduce<Record<number, { taxable: number; tax: number }>>((acc, item) => {
                            const rate = item.vatRate || 0;
                            if (!acc[rate]) acc[rate] = { taxable: 0, tax: 0 };
                            acc[rate].taxable += item.quantity * item.unitPrice;
                            acc[rate].tax += item.quantity * item.unitPrice * rate / 100;
                            return acc;
                        }, {})
                    ).map(g => ({
                        'cbc:TaxableAmount': g.taxable.toFixed(2),
                        'cbc:TaxAmount': g.tax.toFixed(2),
                        'cac:TaxCategory': {
                            'cbc:ID': g.tax > 0 ? 'S' : 'E',
                            'cbc:Percent': String(Object.keys(data.items.reduce<Record<number, boolean>>((a, i) => { a[i.vatRate || 0] = true; return a; }, {})).find(r => Math.abs(parseFloat(r) * g.taxable / 100 - g.tax) < 0.01) || 0),
                            'cac:TaxScheme': { 'cbc:ID': 'VAT' },
                        },
                    })),
                }],
                'cac:LegalMonetaryTotal': {
                    'cbc:LineExtensionAmount': total.toFixed(2),
                    'cbc:TaxExclusiveAmount': total.toFixed(2),
                    'cbc:TaxInclusiveAmount': (total + totalIVA).toFixed(2),
                    'cbc:PayableAmount': (total + totalIVA).toFixed(2),
                },
                'cac:InvoiceLine': data.items.map((item, idx) => ({
                    'cbc:ID': String(idx + 1),
                    'cbc:InvoicedQuantity': String(item.quantity),
                    'cbc:LineExtensionAmount': (item.quantity * item.unitPrice).toFixed(2),
                    'cac:Item': {
                        'cbc:Name': item.name,
                        'cac:ClassifiedTaxCategory': {
                            'cbc:ID': item.vatRate > 0 ? 'S' : 'E',
                            'cbc:Percent': String(item.vatRate || 0),
                            'cac:TaxScheme': { 'cbc:ID': 'VAT' },
                        },
                    },
                    'cac:Price': {
                        'cbc:PriceAmount': item.unitPrice.toFixed(2),
                    },
                })),
            },
        };

        const builder = await import('xmlbuilder2');
        const doc = builder.create(inv as any, { format: 'fragment' });
        return doc.end({ prettyPrint: true });
    }

    /** FA_VAT (PL/KSeF) XML — fully XSD-compliant FA(2) structure. */
    async buildFaVat(data: InvoiceRenderData): Promise<string> {
        const issueDate = (data.issuedAt ?? data.createdAt).toISOString().split('T')[0];
        const creationDt = (data.issuedAt ?? data.createdAt).toISOString().replace(/\.\d{3}Z$/, '');
        const invoiceNumber = data.rawNumber || (data.number?.toString() ?? 'DRAFT');
        const currency = data.company.currency || 'PLN';
        const sellerNip = (getIdentifier(data.company, 'VAT') || '').replace(/^[A-Z]{2}/, '');
        const clientNip = (getIdentifier(data.client, 'VAT') || '').replace(/^[A-Z]{2}/, '');

        // ── address builder (FA(2) TAdres: KodKraju + AdresPol fields) ──
        const buildAddress = (e: { address?: string | null; city?: string | null; postalCode?: string | null; country?: string | null }) => {
            const cc = guessCountryCode(e.country) ?? 'PL';
            const street = e.address || '';
            const cityLine = [e.postalCode, e.city].filter(Boolean).join(' ') || '';
            const addr: Record<string, string> = { KodKraju: cc, AdresL1: street || cityLine || '-' };
            if (street && cityLine) addr.AdresL2 = cityLine;
            return addr;
        };

        // ── VAT rate grouping ──
        const groups: Record<string, { net: number; tax: number }> = {};
        let totalNet = 0;
        let totalTax = 0;

        for (const item of data.items) {
            const net = Math.round(item.quantity * item.unitPrice * 100) / 100;
            const tax = Math.round(net * (item.vatRate || 0)) / 100;
            totalNet += net;
            totalTax += tax;

            const rate = item.vatRate || 0;
            let gk: string;
            if (rate === 23 || rate === 22) gk = '23';
            else if (rate === 8 || rate === 7) gk = '8';
            else if (rate === 5) gk = '5';
            else gk = '0';

            if (!groups[gk]) groups[gk] = { net: 0, tax: 0 };
            groups[gk].net += net;
            groups[gk].tax += tax;
        }

        // ── P_13_x / P_14_x summary fields ──
        const faSummary: Record<string, string> = {};
        if (groups['23']) {
            faSummary.P_13_1 = groups['23'].net.toFixed(2);
            faSummary.P_14_1 = groups['23'].tax.toFixed(2);
        }
        if (groups['8']) {
            faSummary.P_13_2 = groups['8'].net.toFixed(2);
            faSummary.P_14_2 = groups['8'].tax.toFixed(2);
        }
        if (groups['5']) {
            faSummary.P_13_3 = groups['5'].net.toFixed(2);
            faSummary.P_14_3 = groups['5'].tax.toFixed(2);
        }
        if (groups['0'] && groups['0'].net > 0) {
            faSummary.P_13_7 = groups['0'].net.toFixed(2);
        }

        // ── FaWiersz line items ──
        const faWiersze = data.items.map((item, idx) => {
            const net = Math.round(item.quantity * item.unitPrice * 100) / 100;
            const rate = item.vatRate || 0;

            let p12: string;
            if (rate === 23) p12 = '23';
            else if (rate === 22) p12 = '22';
            else if (rate === 8) p12 = '8';
            else if (rate === 7) p12 = '7';
            else if (rate === 5) p12 = '5';
            else p12 = 'zw';

            const line: Record<string, any> = {
                NrWierszaFa: idx + 1,
                P_7: item.name,
                PKWiU: '00',
                P_8A: (item as any).unit || 'szt.',
                P_8B: Number(item.quantity.toFixed(6)),
                P_9A: Number(item.unitPrice.toFixed(8)),
                P_11: Number(net.toFixed(2)),
                P_12: p12,
            };
            return line;
        });

        // ── full FA(2) object tree ──
        const fa2 = {
            Faktura: {
                '@': {
                    xmlns: 'http://crd.gov.pl/wzor/2023/06/29/12648/',
                    'xmlns:etd': 'http://crd.gov.pl/xml/schematy/dziedzinowe/mf/2022/01/05/eD/DefinicjeTypy/',
                },
                Naglowek: {
                    KodFormularza: { '@': { kodSystemowy: 'FA (2)', wersjaSchemy: '1-0E' }, '#': 'FA' },
                    WariantFormularza: 2,
                    DataWytworzeniaFa: creationDt,
                    SystemInfo: 'invoicerr',
                },
                Podmiot1: {
                    PrefiksPodatnika: 'PL',
                    DaneIdentyfikacyjne: {
                        NIP: sellerNip,
                        Nazwa: data.company.name,
                    },
                    Adres: buildAddress(data.company),
                    ...(data.company.email || data.company.phone ? {
                        DaneKontaktowe: {
                            ...(data.company.email ? { Email: data.company.email } : {}),
                            ...(data.company.phone ? { Telefon: data.company.phone } : {}),
                        },
                    } : {}),
                },
                Podmiot2: {
                    DaneIdentyfikacyjne: clientNip
                        ? { NIP: clientNip, Nazwa: data.client.name || `${data.client.contactFirstname || ''} ${data.client.contactLastname || ''}`.trim() }
                        : { BrakID: '1', Nazwa: data.client.name || `${data.client.contactFirstname || ''} ${data.client.contactLastname || ''}`.trim() },
                    Adres: buildAddress(data.client),
                    ...(data.client.contactEmail || data.client.contactPhone ? {
                        DaneKontaktowe: {
                            ...(data.client.contactEmail ? { Email: data.client.contactEmail } : {}),
                            ...(data.client.contactPhone ? { Telefon: data.client.contactPhone } : {}),
                        },
                    } : {}),
                },
                Fa: {
                    KodWaluty: currency,
                    P_1: issueDate,
                    P_2: invoiceNumber,
                    ...faSummary,
                    P_15: Number((totalNet + totalTax).toFixed(2)),
                    Adnotacje: {
                        P_16: '2',
                        P_17: '2',
                        P_18: '2',
                        P_18A: '2',
                        Zwolnienie: { P_19N: '1' },
                        NoweSrodkiTransportu: { P_22N: '1' },
                        P_23: '2',
                        PMarzy: { P_PMarzyN: '1' },
                    },
                    RodzajFaktury: 'VAT',
                    FaWiersz: faWiersze,
                },
                Stopka: {
                    Informacje: { StopkaFaktury: `Faktura ${invoiceNumber}` },
                },
            },
        };

        const builder = await import('xmlbuilder2');
        const doc = builder.create(fa2 as any, { format: 'fragment' });
        return doc.end({ prettyPrint: true });
    }

    async renderPdfFormat(invoiceId: string, format: '' | 'pdf' | string): Promise<Uint8Array> {
        const invRec = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { items: true, client: { include: { partyIdentifiers: true } }, company: { include: { partyIdentifiers: true } }, quote: true } });
        if (!invRec) {
            logger.error('Invoice not found', { category: 'invoice' });
            throw new BadRequestException('Invoice not found');
        }

        const pdfBuffer = await this.renderPdf(invoiceId);

        if (format === 'pdf' || format === '') {
            return pdfBuffer;
        }

        const inv = await this.renderXml(invoiceId);

        return await inv.embedInPdf(Buffer.from(pdfBuffer), format)
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
                partyIdentifiers: inv.company.partyIdentifiers.map(p => ({ scheme: p.scheme, value: p.value })),
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
                partyIdentifiers: inv.client.partyIdentifiers.map(p => ({ scheme: p.scheme, value: p.value })),
            },
            items: inv.items.map(i => ({
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
        const builders: Record<string, (d: InvoiceRenderData) => string> = {
            CL: (d) => this._buildClDte(d),
            AR: (d) => this._buildArFe(d),
            EC: (d) => this._buildEcFe(d),
            BR: (d) => this._buildBrNfe(d),
            TR: (d) => this._buildTrEfatura(d),
            CN: (d) => this._buildCnEfapiao(d),
            EG: (d) => this._buildEgEta(d),
            IN: (d) => this._buildInIrp(d),
            GR: (d) => this._buildGrMydata(d),
            HU: (d) => this._buildHuSzM(d),
            // LATAM — added by §1.3 scaffold
            CR: (d) => this._buildCrFe(d),
            DO: (d) => this._buildDoEcf(d),
            GT: (d) => this._buildGtFel(d),
            PA: (d) => this._buildPaFe(d),
            PY: (d) => this._buildPyDe(d),
            SV: (d) => this._buildSvDte(d),
            UY: (d) => this._buildUyCfe(d),
            VE: (d) => this._buildVeFe(d),
            BO: (d) => this._buildBoFe(d),
            // Asia — added by §1.3 scaffold
            ID: (d) => this._buildIdEfaktur(d),
            TW: (d) => this._buildTwEgui(d),
            KZ: (d) => this._buildKzEsf(d),
            PH: (d) => this._buildPhEis(d),
            TH: (d) => this._buildThEtax(d),
            NP: (d) => this._buildNpCbms(d),
            BD: (d) => this._buildBdNbr(d),
            PK: (d) => this._buildPkFbr(d),
            VN: (d) => this._buildVnTt78(d),
            MY: (d) => this._buildMyInvois(d),
        };
        const builder = builders[cc];
        if (builder) return builder(data);
        return this._buildGenericNationalXml(data, cc);
    }

    async renderNationalXml(invoiceId: string, countryCode: string): Promise<string> {
        return this.buildNationalXml(await this.fetchRenderData(invoiceId), countryCode);
    }

    // ─── LATAM skeletons ──────────────────────────────────────────────────

    private _buildClDte(data: InvoiceRenderData): string {
        const issueDate = (data.issuedAt ?? data.createdAt).toISOString().split('T')[0];
        const rut = getIdentifier(data.company, 'VAT') || '';
        const total = data.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
        const totalIVA = data.items.reduce((s, i) => s + i.quantity * i.unitPrice * (i.vatRate || 0) / 100, 0);
        return `<!-- TODO: Chile DTE (SII) — requires Folio電子 + Digital Signature -->
<ClaveDTE>
  <Encabezado>
    <IdDoc><TipoDTE>33</TipoDTE><Folio>1</Folio><FchEmis>${issueDate}</FchEmis></IdDoc>
    <Emisor><RUTEmisor>${rut}</RUTEmisor><RznSocEmisor>${data.company.name}</RznSocEmisor></Emisor>
    <Receptor><RUTRecep>${getIdentifier(data.client, 'VAT') || ''}</RUTRecep><RznSocRecep>${data.client.name}</RznSocRecep></Receptor>
    <Totals><MntNeto>${total.toFixed(2)}</MntNeto><IVA>${totalIVA.toFixed(2)}</IVA><MntTotal>${(total + totalIVA).toFixed(2)}</MntTotal></Totals>
  </Encabezado>
  <Detalle>${data.items.map((item, i) => `<Dtl><NroLinea>${i + 1}</NroLinea><NmbItem>${item.name}</NmbItem><QtyItem>${item.quantity}</QtyItem><PrcItem>${item.unitPrice}</PrcItem></Dtl>`).join('')}</Detalle>
</ClaveDTE>
<!-- TODO: FIRMA ELECTRÓNICA (SII Digital Signature) -->`;
    }

    private _buildArFe(data: InvoiceRenderData): string {
        const issueDate = (data.issuedAt ?? data.createdAt).toISOString().split('T')[0];
        const cuit = getIdentifier(data.company, 'VAT') || '';
        const total = data.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
        const totalIVA = data.items.reduce((s, i) => s + i.quantity * i.unitPrice * (i.vatRate || 0) / 100, 0);
        return `<!-- TODO: Argentina Factura Electronica (AFIP/ARCA) — requires CAE + Digital Signature -->
<Factura>
  <Cabecera>
    <TipoComprobante>1</TipoComprobante>
    <PuntoVenta>1</PuntoVenta>
    <FechaEmision>${issueDate}</FechaEmision>
    <CUIT>${cuit}</CUIT>
  </Cabecera>
  <Detalles>${data.items.map((item, i) => `<Detalle><Id>${i + 1}</Id><Descripcion>${item.name}</Descripcion><Cantidad>${item.quantity}</Cantidad><PrecioUnitario>${item.unitPrice}</PrecioUnitario></Detalle>`).join('')}</Detalles>
  <Totales><Neto>${total.toFixed(2)}</Neto><IVA>${totalIVA.toFixed(2)}</IVA><Total>${(total + totalIVA).toFixed(2)}</Total></Totales>
</Factura>
<!-- TODO: CAE (AFIP Authorization Code) + QR Code -->`;
    }

    private _buildEcFe(data: InvoiceRenderData): string {
        const issueDate = (data.issuedAt ?? data.createdAt).toISOString().split('T')[0];
        const ruc = getIdentifier(data.company, 'VAT') || '';
        const total = data.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
        const totalIVA = data.items.reduce((s, i) => s + i.quantity * i.unitPrice * (i.vatRate || 0) / 100, 0);
        return `<!-- TODO: Ecuador Factura Electronica (SRI) — requires ClaveAcceso + Digital Signature -->
<Factura>
  <InfoTributaria><Ambiente>1</Ambiente><TipoEmision>1</TipoEmision><Ruc>${ruc}</Ruc></InfoTributaria>
  <InfoFactura><FechaEmision>${issueDate}</FechaEmision><TotalSinImpuestos>${total.toFixed(2)}</TotalSinImpuestos><ImporteTotal>${(total + totalIVA).toFixed(2)}</ImporteTotal></InfoFactura>
  <Detalles>${data.items.map((item, i) => `<Detalle><CodigoPrincipal>${i + 1}</CodigoPrincipal><Descripcion>${item.name}</Descripcion><Cantidad>${item.quantity}</Cantidad><PrecioUnitario>${item.unitPrice}</PrecioUnitario></Detalle>`).join('')}</Detalles>
</Factura>
<!-- TODO: ClaveAcceso (SRI Access Key) + Firma Digital -->`;
    }

    private _buildBrNfe(data: InvoiceRenderData): string {
        const issueDate = (data.issuedAt ?? data.createdAt).toISOString().split('T')[0];
        const cnpj = getIdentifier(data.company, 'VAT') || '';
        const total = data.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
        const totalIVA = data.items.reduce((s, i) => s + i.quantity * i.unitPrice * (i.vatRate || 0) / 100, 0);
        return `<!-- TODO: Brazil NF-e/NFS-e (SEFAZ) — requires ChaveAcesso + Digital Signature + Lote -->
<nfeProc>
  <NFe>
    <infNFe versao="4.00">
      <ide><natOp>Serviço</natOp><mod>55</mod><serie>1</serie><tpEmis>1</tpEmis><dhEmi>${issueDate}T12:00:00-03:00</dhEmi></ide>
      <emit><CNPJ>${cnpj}</CNPJ><xNome>${data.company.name}</xNome><CRT>1</CRT></emit>
      <det nItem="1"><prod><cProd>1</cProd><xProd>${data.items[0]?.name || 'Service'}</xProd><qCom>${data.items[0]?.quantity || 1}</qCom><vUnCom>${data.items[0]?.unitPrice || 0}</vUnCom><vProd>${total.toFixed(2)}</vProd></prod></det>
      <total><ICMSTot><vBC>${total.toFixed(2)}</vBC><vICMS>${totalIVA.toFixed(2)}</vICMS><vNF>${(total + totalIVA).toFixed(2)}</vNF></ICMSTot></total>
    </infNFe>
  </NFe>
</nfeProc>
<!-- TODO: ChaveAcesso + Protocolo + Lote (SEFAZ submission) -->`;
    }

    private _buildTrEfatura(data: InvoiceRenderData): string {
        const issueDate = (data.issuedAt ?? data.createdAt).toISOString().split('T')[0];
        const vknTckn = getIdentifier(data.company, 'VAT') || '';
        const total = data.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
        const totalIVA = data.items.reduce((s, i) => s + i.quantity * i.unitPrice * (i.vatRate || 0) / 100, 0);
        return `<!-- TODO: Turkey e-Fatura (GİB) — requires e-İmza + KEP -->
<Invoice>
  <Header><ID>${data.rawNumber || 'DRAFT'}</ID><IssueDate>${issueDate}</IssueDate><IssueTime>12:00:00</IssueTime><CurrencyCode>${data.company.currency || 'TRY'}</CurrencyCode></Header>
  <Sender><ID><VKN_TCKN>${vknTckn}</VKN_TCKN></ID><Name>${data.company.name}</Name></Sender>
  <Receiver><ID><VKN_TCKN>${getIdentifier(data.client, 'VAT') || ''}</VKN_TCKN></ID><Name>${data.client.name}</Name></Receiver>
  <Lines>${data.items.map((item, i) => `<Line><Order>${i + 1}</Order><ItemName>${item.name}</ItemName><Quantity>${item.quantity}</Quantity><UnitPrice>${item.unitPrice}</UnitPrice><Price>${(item.quantity * item.unitPrice).toFixed(2)}</Price></Line>`).join('')}</Lines>
  <Totals><SubTotal>${total.toFixed(2)}</SubTotal><Tax>${totalIVA.toFixed(2)}</Tax><GrandTotal>${(total + totalIVA).toFixed(2)}</GrandTotal></Totals>
</Invoice>
<!-- TODO: e-İmza (digital signature) + KEP submission to GİB -->`;
    }

    private _buildCnEfapiao(data: InvoiceRenderData): string {
        const issueDate = (data.issuedAt ?? data.createdAt).toISOString().split('T')[0];
        const nsrsbh = getIdentifier(data.company, 'VAT') || '';
        const total = data.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
        const totalIVA = data.items.reduce((s, i) => s + i.quantity * i.unitPrice * (i.vatRate || 0) / 100, 0);
        return `<!-- TODO: China e-Fapiao (Golden Tax IV / STA) — requires Tax Control Device -->
<Fapiao>
  <Header><FapiaoNo>${data.rawNumber || 'DRAFT'}</FapiaoNo><IssueDate>${issueDate}</IssueDate><FapiaoType>Normal</FapiaoType></Header>
  <Seller><NSRSBH>${nsrsbh}</NSRSBH><Name>${data.company.name}</Name></Seller>
  <Buyer><NSRSBH>${getIdentifier(data.client, 'VAT') || ''}</NSRSBH><Name>${data.client.name}</Name></Buyer>
  <Items>${data.items.map((item, i) => `<Item><SerialNo>${i + 1}</SerialNo><Name>${item.name}</Name><Quantity>${item.quantity}</Quantity><UnitPrice>${item.unitPrice}</UnitPrice></Item>`).join('')}</Items>
  <Totals><TotalAmount>${total.toFixed(2)}</TotalAmount><TaxAmount>${totalIVA.toFixed(2)}</TaxAmount><GrandTotal>${(total + totalIVA).toFixed(2)}</GrandTotal></Totals>
</Fapiao>
<!-- TODO: Tax Control Device (Golden Tax IV) + CRC code -->`;
    }

    private _buildEgEta(data: InvoiceRenderData): string {
        const issueDate = (data.issuedAt ?? data.createdAt).toISOString().split('T')[0];
        const tin = getIdentifier(data.company, 'VAT') || '';
        const total = data.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
        const totalIVA = data.items.reduce((s, i) => s + i.quantity * i.unitPrice * (i.vatRate || 0) / 100, 0);
        return `<!-- TODO: Egypt ETA (E-Invoicing) — requires UUID + QR Code -->
<Invoice>
  <Header><UUID>${data.rawNumber || 'DRAFT'}</UUID><IssueDate>${issueDate}</IssueDate></Header>
  <Seller><TIN>${tin}</TIN><Name>${data.company.name}</Name></Seller>
  <Buyer><TIN>${getIdentifier(data.client, 'VAT') || ''}</TIN><Name>${data.client.name}</Name></Buyer>
  <Lines>${data.items.map((item, i) => `<Line><Index>${i + 1}</Index><ItemName>${item.name}</ItemName><Quantity>${item.quantity}</Quantity><UnitPrice>${item.unitPrice}</UnitPrice></Line>`).join('')}</Lines>
  <Totals><SubTotal>${total.toFixed(2)}</SubTotal><TaxAmount>${totalIVA.toFixed(2)}</TaxAmount><GrandTotal>${(total + totalIVA).toFixed(2)}</GrandTotal></Totals>
</Invoice>
<!-- TODO: UUID + QR Code (ETA submission) -->`;
    }

    private _buildInIrp(data: InvoiceRenderData): string {
        const issueDate = (data.issuedAt ?? data.createdAt).toISOString().split('T')[0];
        const gstin = getIdentifier(data.company, 'VAT') || '';
        const total = data.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
        const totalIVA = data.items.reduce((s, i) => s + i.quantity * i.unitPrice * (i.vatRate || 0) / 100, 0);
        return `<!-- TODO: India IRP (GST e-Invoice via NIC/GSTN) — requires IRN + Signed QR -->
<Invoice>
  <TradeParty><GSTIN>${gstin}</GSTIN><LegalName>${data.company.name}</LegalName></TradeParty>
  <DocumentHeader><DocNo>${data.rawNumber || 'DRAFT'}</DocNo><DocDate>${issueDate}</DocDate><DocType>INV</DocType></DocumentHeader>
  <DocumentDetails><TotalPreTaxValue>${total.toFixed(2)}</TotalPreTaxValue><TotalTaxValue>${totalIVA.toFixed(2)}</TotalTaxValue><TotalInvoiceValue>${(total + totalIVA).toFixed(2)}</TotalInvoiceValue></DocumentDetails>
  <ItemList>${data.items.map((item, i) => `<Item><SlNo>${i + 1}</SlNo><PrDescription>${item.name}</PrDescription><PrdQty>${item.quantity}</PrdQty><PrdUnitPrice>${item.unitPrice}</PrdUnitPrice></Item>`).join('')}</ItemList>
</Invoice>
<!-- TODO: IRN (Invoice Reference Number) + Signed QR Code via IRP -->`;
    }

    private _buildGrMydata(data: InvoiceRenderData): string {
        const issueDate = (data.issuedAt ?? data.createdAt).toISOString().split('T')[0];
        const afm = getIdentifier(data.company, 'VAT') || '';
        const total = data.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
        const totalIVA = data.items.reduce((s, i) => s + i.quantity * i.unitPrice * (i.vatRate || 0) / 100, 0);
        return `<!-- TODO: Greece myDATA (AADE) — requires UBL/CII XML + Digital Signature + AADE submission -->
<myDATA:Invoice xmlns:myDATA="https://www.aade.gr/myDATA/invoice/v1.0">
  <myDATA:InvoiceHeader>
    <myDATA:series>AA</myDATA:series>
    <myDATA:number>${data.rawNumber || 'DRAFT'}</myDATA:number>
    <myDATA:issueDate>${issueDate}</myDATA:issueDate>
    <myDATA:invoiceType>11.1</myDATA:invoiceType>
    <myDATA:currencyCode>EUR</myDATA:currencyCode>
  </myDATA:InvoiceHeader>
  <myDATA:Issuer>
    <myDATA:vatNumber>${afm}</myDATA:vatNumber>
    <myDATA:name>${data.company.name}</myDATA:name>
  </myDATA:Issuer>
  <myDATA:Counterpart>
    <myDATA:vatNumber>${getIdentifier(data.client, 'VAT') || ''}</myDATA:vatNumber>
    <myDATA:name>${data.client.name}</myDATA:name>
  </myDATA:Counterpart>
  <myDATA:InvoiceDetails>${data.items.map((item, i) => `<myDATA:InvoiceDetail>
    <myDATA:lineNumber>${i + 1}</myDATA:lineNumber>
    <myDATA:detailType>1</myDATA:detailType>
    <myDATA:quantity>${item.quantity}</myDATA:quantity>
    <myDATA:unitPrice>${item.unitPrice}</myDATA:unitPrice>
    <myDATA:vatCategory>${item.vatRate > 0 ? '1' : '7'}</myDATA:vatCategory>
    <myDATA:vatAmount>${(item.quantity * item.unitPrice * (item.vatRate || 0) / 100).toFixed(2)}</myDATA:vatAmount>
  </myDATA:InvoiceDetail>`).join('')}</myDATA:InvoiceDetails>
  <myDATA:InvoiceSummary>
    <myDATA:totalNetValue>${total.toFixed(2)}</myDATA:totalNetValue>
    <myDATA:totalVatAmount>${totalIVA.toFixed(2)}</myDATA:totalVatAmount>
    <myDATA:totalWithVat>${(total + totalIVA).toFixed(2)}</myDATA:totalWithVat>
  </myDATA:InvoiceSummary>
</myDATA:Invoice>
<!-- TODO: Digital Signature (Qualif. Electronic Signature) + AADE Taxisnet submission + Mark (if >€150) -->`;
    }

    private _buildHuSzM(data: InvoiceRenderData): string {
        const issueDate = (data.issuedAt ?? data.createdAt).toISOString().split('T')[0];
        const adoszam = getIdentifier(data.company, 'VAT') || '';
        const total = data.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
        const totalIVA = data.items.reduce((s, i) => s + i.quantity * i.unitPrice * (i.vatRate || 0) / 100, 0);
        return `<!-- TODO: Hungary Online Számla (NAV) — requires UBL 2.1 XML + API token + Real-time XML -->
<Invoice xmlns="urn:peppol.eu:xsd:en16931:2" xmlns:ext="urn:central:not:opentender:schema:xsd:ExtensionComponents-1">
  <ext:UBLExtensions>
    <ext:UBLExtension>
      <ext:ExtensionID>1</ext:ExtensionID>
      <ext:ExtensionAgencyID>10</ext:ExtensionAgencyID>
      <ext:ExtensionAgencyName>NAVA</ext:ExtensionAgencyName>
    </ext:UBLExtension>
  </ext:UBLExtensions>
  <ID>${data.rawNumber || 'DRAFT'}</ID>
  <IssueDate>${issueDate}</IssueDate>
  <InvoiceTypeCode>380</InvoiceTypeCode>
  <DocumentCurrencyCode>HUF</DocumentCurrencyCode>
  <AccountingSupplierParty>
    <Party>
      <EndpointID schemeID="2.1">${adoszam}</EndpointID>
      <PartyName><Name>${data.company.name}</Name></PartyName>
    </Party>
  </AccountingSupplierParty>
  <AccountingCustomerParty>
    <Party>
      <EndpointID schemeID="2.1">${getIdentifier(data.client, 'VAT') || ''}</EndpointID>
      <PartyName><Name>${data.client.name}</Name></PartyName>
    </Party>
  </AccountingCustomerParty>
  <LegalMonetaryTotal>
    <TaxExclusiveAmount currencyID="HUF">${total.toFixed(2)}</TaxExclusiveAmount>
    <TaxInclusiveAmount currencyID="HUF">${(total + totalIVA).toFixed(2)}</TaxInclusiveAmount>
  </LegalMonetaryTotal>
  ${data.items.map((item, i) => `<InvoiceLine>
    <ID>${i + 1}</ID>
    <InvoicedQuantity>${item.quantity}</InvoicedQuantity>
    <LineExtensionAmount currencyID="HUF">${(item.quantity * item.unitPrice).toFixed(2)}</LineExtensionAmount>
    <Item>
      <Name>${item.name}</Name>
      <ClassifiedTaxCategory><ID>${item.vatRate > 0 ? 'AAA' : 'AAM'}</ID><Percent>${item.vatRate || 0}</Percent></ClassifiedTaxCategory>
    </Item>
    <Price><PriceAmount currencyID="HUF">${item.unitPrice}</PriceAmount></Price>
  </InvoiceLine>`).join('\n  ')}
</Invoice>
<!-- TODO: API token registration (NAV) + Real-time XML submission + Transaction ID -->`;
    }

    // ─── Additional LATAM skeletons (§1.3 scaffold — live-deferred) ──────────

    /**
     * Costa Rica — Hacienda Factura Electrónica v4.4.
     * Schema: https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica
     * TODO: generate real 50-digit Clave; sign with BCCR qualified cert; POST to
     *   https://api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1/hacienda
     */
    private _buildCrFe(data: InvoiceRenderData): string {
        const issueDate = (data.issuedAt ?? data.createdAt).toISOString().replace('T', 'T').slice(0, 19);
        const ruc = getIdentifier(data.company, 'VAT') || '';
        const total = data.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
        const totalIVA = data.items.reduce((s, i) => s + i.quantity * i.unitPrice * (i.vatRate || 0) / 100, 0);
        return `<!-- TODO: Costa Rica FE v4.4 (Hacienda) — requires 50-digit Clave + BCCR qualified signature -->
<FacturaElectronica xmlns="https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica"
  xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
  <Clave>TODO-50-DIGIT-CLAVE</Clave>
  <CodigoActividad>620100</CodigoActividad>
  <NumeroConsecutivo>00100001010000000001</NumeroConsecutivo>
  <FechaEmision>${issueDate}</FechaEmision>
  <Emisor>
    <Nombre>${data.company.name}</Nombre>
    <Identificacion><Tipo>02</Tipo><Numero>${ruc}</Numero></Identificacion>
    <CorreoElectronico>${(data.company as any).email || 'info@empresa.cr'}</CorreoElectronico>
  </Emisor>
  <Receptor>
    <Nombre>${data.client.name}</Nombre>
    <Identificacion><Tipo>02</Tipo><Numero>${getIdentifier(data.client, 'VAT') || ''}</Numero></Identificacion>
  </Receptor>
  <CondicionVenta>01</CondicionVenta>
  <MedioPago>01</MedioPago>
  <DetalleServicio>${data.items.map((item, i) => `
    <LineaDetalle>
      <NumeroLinea>${i + 1}</NumeroLinea>
      <Cantidad>${item.quantity}</Cantidad>
      <Detalle>${item.name}</Detalle>
      <PrecioUnitario>${item.unitPrice.toFixed(5)}</PrecioUnitario>
      <MontoTotal>${(item.quantity * item.unitPrice).toFixed(5)}</MontoTotal>
      <Impuesto>
        <Codigo>01</Codigo>
        <CodigoTarifa>${item.vatRate === 13 ? '08' : item.vatRate === 4 ? '02' : '01'}</CodigoTarifa>
        <Tarifa>${item.vatRate || 0}</Tarifa>
        <Monto>${(item.quantity * item.unitPrice * (item.vatRate || 0) / 100).toFixed(5)}</Monto>
      </Impuesto>
      <MontoTotalLinea>${(item.quantity * item.unitPrice * (1 + (item.vatRate || 0) / 100)).toFixed(5)}</MontoTotalLinea>
    </LineaDetalle>`).join('')}
  </DetalleServicio>
  <ResumenFactura>
    <CodigoTipoMoneda><CodigoMoneda>${data.company.currency || 'CRC'}</CodigoMoneda><TipoCambio>1</TipoCambio></CodigoTipoMoneda>
    <TotalServGravados>${total.toFixed(5)}</TotalServGravados>
    <TotalGravado>${total.toFixed(5)}</TotalGravado>
    <TotalImpuesto>${totalIVA.toFixed(5)}</TotalImpuesto>
    <TotalComprobante>${(total + totalIVA).toFixed(5)}</TotalComprobante>
  </ResumenFactura>
</FacturaElectronica>
<!-- TODO: POST to Hacienda API + poll for respuesta-Hacienda (aceptado/rechazado) -->`;
    }

    /**
     * Dominican Republic — e-Comprobante Fiscal Electrónico (e-CF).
     * Schema: DGII ECF v1.0
     * TODO: sign with approved CA certificate; submit to
     *   https://ecf.dgii.gov.do/testecf/emisorreceptor (test) or
     *   https://ecf.dgii.gov.do/ecf/emisorreceptor (prod)
     */
    private _buildDoEcf(data: InvoiceRenderData): string {
        const issueDate = (data.issuedAt ?? data.createdAt).toISOString().split('T')[0];
        const rnc = getIdentifier(data.company, 'VAT') || '';
        const total = data.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
        const totalIVA = data.items.reduce((s, i) => s + i.quantity * i.unitPrice * (i.vatRate || 0) / 100, 0);
        return `<!-- TODO: Dominican Republic e-CF (DGII) — requires e-NCF number series + digital signature -->
<FCCE xmlns="http://www.dgii.gov.do/xml/ecf">
  <Encabezado>
    <Version>1.0</Version>
    <IdDoc>
      <TipoeCF>31</TipoeCF>
      <eNCF>TODO-E-NCF-NUMBER</eNCF>
      <FechaVencimientoSecuencia>TODO</FechaVencimientoSecuencia>
      <IndicadorEnvioDiferido>0</IndicadorEnvioDiferido>
      <IndicadorMontoGravado>0</IndicadorMontoGravado>
      <TipoIngresos>01</TipoIngresos>
      <TipoPago>1</TipoPago>
      <FechaPago>${issueDate}</FechaPago>
      <TotalPaginas>1</TotalPaginas>
    </IdDoc>
    <Emisor>
      <RNCEmisor>${rnc}</RNCEmisor>
      <RazonSocialEmisor>${data.company.name}</RazonSocialEmisor>
      <FechaEmision>${issueDate}</FechaEmision>
    </Emisor>
    <Comprador>
      <RNCComprador>${getIdentifier(data.client, 'VAT') || ''}</RNCComprador>
      <RazonSocialComprador>${data.client.name}</RazonSocialComprador>
    </Comprador>
    <Totales>
      <MontoGravadoTotal>${total.toFixed(2)}</MontoGravadoTotal>
      <ITBIS1>${totalIVA.toFixed(2)}</ITBIS1>
      <MontoTotal>${(total + totalIVA).toFixed(2)}</MontoTotal>
    </Totales>
  </Encabezado>
  <DetallesItems>${data.items.map((item, i) => `
    <Item>
      <NumeroLinea>${i + 1}</NumeroLinea>
      <NombreItem>${item.name}</NombreItem>
      <IndicadorFacturacion>1</IndicadorFacturacion>
      <CantidadItem>${item.quantity}</CantidadItem>
      <PrecioUnitarioItem>${item.unitPrice.toFixed(2)}</PrecioUnitarioItem>
      <TablaSubDescuento><SubDescuento><TipoSubDescuento>01</TipoSubDescuento><PorcentajeSubDescuento>0.00</PorcentajeSubDescuento><MontoSubDescuento>0.00</MontoSubDescuento></SubDescuento></TablaSubDescuento>
      <MontoItem>${(item.quantity * item.unitPrice).toFixed(2)}</MontoItem>
    </Item>`).join('')}
  </DetallesItems>
</FCCE>
<!-- TODO: e-NCF numbering via DGII + XAdES-BES signature + POST to DGII -->`;
    }

    /**
     * Guatemala — FEL (Factura Electrónica en Línea) via SAT.
     * Schema: SAT FEL DTE v0.1
     * TODO: sign with CA-accredited certificate; certify via a SAT-authorized certificador
     *   (e.g. INFILE, G4S, Megaprint); SAT assigns UUID on certification.
     */
    private _buildGtFel(data: InvoiceRenderData): string {
        const issueDate = (data.issuedAt ?? data.createdAt).toISOString().replace('.000', '');
        const nit = getIdentifier(data.company, 'VAT') || '';
        const total = data.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
        const totalIVA = data.items.reduce((s, i) => s + i.quantity * i.unitPrice * (i.vatRate || 0) / 100, 0);
        return `<!-- TODO: Guatemala FEL (SAT) — requires certificador authorization; SAT assigns UUID -->
<DTE xmlns="http://www.sat.gob.gt/dte/fel/0.1.0"
     xmlns:ds="http://www.w3.org/2000/09/xmldsig#"
     xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <DatosEmision>
    <DatosGenerales
      CodigoMoneda="${data.company.currency || 'GTQ'}"
      FechaHoraEmision="${issueDate}"
      Tipo="FACT"/>
    <Emisor
      AFiliacionIVA="GEN"
      CodigoEstablecimiento="1"
      CorreoEmisor="${(data.company as any).email || 'info@empresa.gt'}"
      NITEmisor="${nit}"
      NombreComercial="${data.company.name}"
      NombreEmisor="${data.company.name}">
      <DireccionEmisor>
        <Direccion>${data.company.address || ''}</Direccion>
        <CodigoPostal>${data.company.postalCode || '01001'}</CodigoPostal>
        <Municipio>${data.company.city || 'Guatemala'}</Municipio>
        <Departamento>Guatemala</Departamento>
        <Pais>GT</Pais>
      </DireccionEmisor>
    </Emisor>
    <Receptor
      CorreoReceptor="${(data.client as any).email || ''}"
      IDReceptor="${getIdentifier(data.client, 'VAT') || 'CF'}"
      NombreReceptor="${data.client.name}">
      <DireccionReceptor>
        <Direccion>${data.client.address || ''}</Direccion>
        <CodigoPostal>${data.client.postalCode || '01001'}</CodigoPostal>
        <Municipio>${data.client.city || ''}</Municipio>
        <Departamento>TODO</Departamento>
        <Pais>${data.client.country ? data.client.country.slice(0, 2).toUpperCase() : 'GT'}</Pais>
      </DireccionReceptor>
    </Receptor>
    <Frases>
      <Frase CodigoEscenario="1" TipoFrase="1"/>
    </Frases>
    <Items>${data.items.map((item, i) => `
      <Item BienOServicio="S" NumeroLinea="${i + 1}">
        <Cantidad>${item.quantity}</Cantidad>
        <UnidadMedida>UNI</UnidadMedida>
        <Descripcion>${item.name}</Descripcion>
        <PrecioUnitario>${item.unitPrice.toFixed(6)}</PrecioUnitario>
        <Precio>${(item.quantity * item.unitPrice).toFixed(6)}</Precio>
        <Descuento>0.000000</Descuento>
        <Impuestos>
          <Impuesto>
            <NombreCorto>IVA</NombreCorto>
            <CodigoUnidadGravable>1</CodigoUnidadGravable>
            <MontoGravable>${item.unitPrice.toFixed(6)}</MontoGravable>
            <MontoImpuesto>${(item.unitPrice * (item.vatRate || 0) / 100).toFixed(6)}</MontoImpuesto>
          </Impuesto>
        </Impuestos>
        <Total>${(item.quantity * item.unitPrice * (1 + (item.vatRate || 0) / 100)).toFixed(6)}</Total>
      </Item>`).join('')}
    </Items>
    <Totales>
      <TotalImpuestos>
        <TotalImpuesto NombreCorto="IVA" TotalMontoImpuesto="${totalIVA.toFixed(6)}"/>
      </TotalImpuestos>
      <GranTotal>${(total + totalIVA).toFixed(6)}</GranTotal>
    </Totales>
  </DatosEmision>
</DTE>
<!-- TODO: XAdES-BES digital signature + POST to certificador (INFILE etc.) → SAT UUID -->`;
    }

    /**
     * Panama — Factura Electrónica / Comprobante Fiscal Electrónico.
     * Schema: DGI FE v1.0
     * TODO: sign; submit via PAC (Proveedor Autorizado de Certificación) to
     *   https://sfep.mef.gob.pa/api/v1 (prod) or sandbox equivalent.
     */
    private _buildPaFe(data: InvoiceRenderData): string {
        const issueDate = (data.issuedAt ?? data.createdAt).toISOString().split('T')[0];
        const ruc = getIdentifier(data.company, 'VAT') || '';
        const total = data.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
        const totalIVA = data.items.reduce((s, i) => s + i.quantity * i.unitPrice * (i.vatRate || 0) / 100, 0);
        return `<!-- TODO: Panama FE/CF (DGI) — requires CUFE + digital signature + PAC submission -->
<DocumentoFiscal xmlns="http://www.dgi.gob.pa/ns/v1/fe">
  <Encabezado>
    <TipoDocumento>01</TipoDocumento>
    <NumeroDocumento>${data.rawNumber || 'DRAFT'}</NumeroDocumento>
    <PuntoFacturacionFiscal>001</PuntoFacturacionFiscal>
    <NaturalezaOperacion>01</NaturalezaOperacion>
    <TipoOperacion>1</TipoOperacion>
    <FechaEmision>${issueDate}</FechaEmision>
    <CUFE>TODO-CUFE</CUFE>
  </Encabezado>
  <Emisor>
    <RUC>${ruc}</RUC>
    <RazonSocial>${data.company.name}</RazonSocial>
    <DireccionFiscal>${data.company.address || ''}</DireccionFiscal>
  </Emisor>
  <Receptor>
    <RUCReceptor>${getIdentifier(data.client, 'VAT') || ''}</RUCReceptor>
    <NombreReceptor>${data.client.name}</NombreReceptor>
  </Receptor>
  <DetalleItems>${data.items.map((item, i) => `
    <Item>
      <Numero>${i + 1}</Numero>
      <Descripcion>${item.name}</Descripcion>
      <Cantidad>${item.quantity}</Cantidad>
      <PrecioUnitario>${item.unitPrice.toFixed(2)}</PrecioUnitario>
      <Subtotal>${(item.quantity * item.unitPrice).toFixed(2)}</Subtotal>
      <ITBMS>${(item.quantity * item.unitPrice * (item.vatRate || 0) / 100).toFixed(2)}</ITBMS>
      <Total>${(item.quantity * item.unitPrice * (1 + (item.vatRate || 0) / 100)).toFixed(2)}</Total>
    </Item>`).join('')}
  </DetalleItems>
  <Totales>
    <SubtotalSinITBMS>${total.toFixed(2)}</SubtotalSinITBMS>
    <ITBMS>${totalIVA.toFixed(2)}</ITBMS>
    <Total>${(total + totalIVA).toFixed(2)}</Total>
  </Totales>
</DocumentoFiscal>
<!-- TODO: CUFE (código único de factura electrónica) + signature + DGI/PAC -->`;
    }

    /**
     * Paraguay — e-Kuatia Documento Electrónico (DE).
     * Schema: SIFEN DE v150
     * TODO: compute CDC (44-char control code); sign with ANDE-accredited certificate;
     *   POST to https://sifen.set.gov.py/de/ws/sync/recibe.wsdl (SOAP).
     */
    private _buildPyDe(data: InvoiceRenderData): string {
        const issueDt = (data.issuedAt ?? data.createdAt).toISOString().split('.')[0];
        const ruc = getIdentifier(data.company, 'VAT') || '';
        const total = data.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
        const totalIVA = data.items.reduce((s, i) => s + i.quantity * i.unitPrice * (i.vatRate || 0) / 100, 0);
        return `<!-- TODO: Paraguay e-Kuatia DE (SIFEN) — requires CDC + digital signature + SIFEN SOAP -->
<DE xmlns="http://ekuatia.set.gov.py/sifen/xsd"
    xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
  <Id>TODO-CDC-44-CHARS</Id>
  <gDtipDE>
    <iTiDE>1</iTiDE>
    <dDesTiDE>Factura electrónica</dDesTiDE>
    <dNumTim>12345678</dNumTim>
    <dEst>001</dEst>
    <dPunExp>001</dPunExp>
    <dNumDoc>${data.rawNumber || '0000001'}</dNumDoc>
    <dSerieNum>TODO</dSerieNum>
    <dFeIniT>${issueDt}</dFeIniT>
  </gDtipDE>
  <gDatGralOpe>
    <dFecFirma>${issueDt}</dFecFirma>
    <dSisFact>1</dSisFact>
    <gOpeCom>
      <iTipTra>1</iTipTra>
      <iTImp>1</iTImp>
      <cMoneOpe>${data.company.currency || 'PYG'}</cMoneOpe>
      <dCondTipCam>1</dCondTipCam>
    </gOpeCom>
    <gEmis>
      <dRucEm>${ruc}</dRucEm>
      <dNomEmi>${data.company.name}</dNomEmi>
      <dNomFanEmi>${data.company.name}</dNomFanEmi>
    </gEmis>
    <gDatRec>
      <iNatRec>1</iNatRec>
      <iTiOpe>1</iTiOpe>
      <cPaisRec>PRY</cPaisRec>
      <dRucRec>${getIdentifier(data.client, 'VAT') || ''}</dRucRec>
      <dNomRec>${data.client.name}</dNomRec>
    </gDatRec>
  </gDatGralOpe>
  <gDtipDEFe>
    <gCamFE>
      <iIndPres>1</iIndPres>
    </gCamFE>
    <gCamItem>${data.items.map((item, i) => `
      <cUniMed>77</cUniMed>
      <dDesProSer>${item.name}</dDesProSer>
      <dCantProSer>${item.quantity}</dCantProSer>
      <dUniMed>${item.quantity}</dUniMed>
      <gValorItem>
        <dPUniProSer>${item.unitPrice.toFixed(8)}</dPUniProSer>
        <dTotBruOpeItem>${(item.quantity * item.unitPrice).toFixed(8)}</dTotBruOpeItem>
        <dDescItem>0</dDescItem>
        <dPorcDesIt>0</dPorcDesIt>
        <dDescGloItem>0</dDescGloItem>
        <dAntGloPreUniIt>0</dAntGloPreUniIt>
        <dTotNeto>${(item.quantity * item.unitPrice).toFixed(8)}</dTotNeto>
        <gValorRestaItem>
          <dDescuento>0</dDescuento>
          <dAnticipo>0</dAnticipo>
          <dRecargoInc>0</dRecargoInc>
          <dTotOpeItem>${(item.quantity * item.unitPrice).toFixed(8)}</dTotOpeItem>
          <dTotOpeGs>0</dTotOpeGs>
        </gValorRestaItem>
      </gValorItem>
      <gCamIVA>
        <iAfecIVA>${i + 1}</iAfecIVA>
        <dPropIVA>100</dPropIVA>
        <dTasaIVA>${item.vatRate || 0}</dTasaIVA>
        <dBasGravIVA>${(item.quantity * item.unitPrice).toFixed(8)}</dBasGravIVA>
        <dLiqIVAItem>${(item.quantity * item.unitPrice * (item.vatRate || 0) / 100).toFixed(8)}</dLiqIVAItem>
      </gCamIVA>`).join('')}
    </gCamItem>
  </gDtipDEFe>
  <gTotSub>
    <dSubExe>0</dSubExe>
    <dSubExo>0</dSubExo>
    <dSub5>0</dSub5>
    <dSub10>${total.toFixed(8)}</dSub10>
    <dSumSubTot>${total.toFixed(8)}</dSumSubTot>
    <dSumDescTot>0</dSumDescTot>
    <dSumAntTot>0</dSumAntTot>
    <dTotGralOpe>${(total + totalIVA).toFixed(8)}</dTotGralOpe>
    <dIVA5>0</dIVA5>
    <dIVA10>${totalIVA.toFixed(8)}</dIVA10>
    <dTotIVA>${totalIVA.toFixed(8)}</dTotIVA>
    <dBaseGrav5>0</dBaseGrav5>
    <dBaseGrav10>${total.toFixed(8)}</dBaseGrav10>
    <dTBasGraIVA>${total.toFixed(8)}</dTBasGraIVA>
  </gTotSub>
</DE>
<!-- TODO: CDC (control code) + XAdES-BES signature + SIFEN SOAP submission -->`;
    }

    /**
     * El Salvador — Documento Tributario Electrónico (DTE) — JSON format (not XML).
     * Schema: MH DTE v1 (JSON)
     * TODO: generate real códigoGeneración UUID; sign JSON (JWS); POST to
     *   https://apitest.dtes.mh.gob.sv/fesv/recepciondte (test) or
     *   https://api.dtes.mh.gob.sv/fesv/recepciondte (prod)
     *
     * NOTE: SV DTE is JSON — this method returns a JSON string, not XML.
     */
    private _buildSvDte(data: InvoiceRenderData): string {
        const issueDt = (data.issuedAt ?? data.createdAt).toISOString().split('.')[0];
        const issueDate = issueDt.split('T')[0];
        const issueTime = issueDt.split('T')[1] || '00:00:00';
        const nit = getIdentifier(data.company, 'VAT') || '';
        const total = data.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
        const totalIVA = data.items.reduce((s, i) => s + i.quantity * i.unitPrice * (i.vatRate || 0) / 100, 0);
        const dte = {
            nit,
            activo: true,
            passwordPri: 'TODO-PRIVATE-KEY-HASH',
            dteJson: {
                identificacion: {
                    version: 1,
                    ambiente: '00', // 00=test, 01=prod
                    tipoDte: '01', // 01=Factura
                    numeroControl: `DTE-01-${data.rawNumber || 'DRAFT'}-${String(Date.now()).slice(-15)}`,
                    codigoGeneracion: 'TODO-UUID-V4',
                    tipoModelo: 1,
                    tipoOperacion: 1,
                    tipoContingencia: null,
                    motivoContigencia: null,
                    fecEmi: issueDate,
                    horEmi: issueTime,
                    tipoMoneda: data.company.currency || 'USD',
                },
                emisor: {
                    nit,
                    nrc: 'TODO-NRC',
                    nombre: data.company.name,
                    codActividad: '620100',
                    descActividad: 'Servicios de TI',
                    nombreComercial: data.company.name,
                    tipoEstablecimiento: '01',
                    direccion: { departamento: '06', municipio: '23', complemento: data.company.address || '' },
                    telefono: (data.company as any).phone || '2200-0000',
                    correo: (data.company as any).email || 'info@empresa.sv',
                },
                receptor: {
                    tipoDocumento: '36',
                    numDocumento: getIdentifier(data.client, 'VAT') || '',
                    nrc: null,
                    nombre: data.client.name,
                    codActividad: null,
                    descActividad: null,
                    direccion: null,
                    telefono: null,
                    correo: null,
                },
                cuerpoDocumento: data.items.map((item, i) => ({
                    numItem: i + 1,
                    tipoItem: 2, // 2=servicio
                    numeroDocumento: null,
                    cantidad: item.quantity,
                    codigo: String(i + 1).padStart(6, '0'),
                    codTributo: null,
                    uniMedida: 59, // 59=unidad
                    descripcion: item.name,
                    precioUni: item.unitPrice,
                    montoDescu: 0,
                    ventaNoSuj: 0,
                    ventaExenta: 0,
                    ventaGravada: parseFloat((item.quantity * item.unitPrice).toFixed(2)),
                    tributos: ['20'], // 20=IVA
                    psv: 0,
                    noGravado: 0,
                    ivaItem: parseFloat((item.quantity * item.unitPrice * (item.vatRate || 0) / 100).toFixed(2)),
                })),
                resumen: {
                    totalNoSuj: 0,
                    totalExenta: 0,
                    totalGravada: parseFloat(total.toFixed(2)),
                    subTotalVentas: parseFloat(total.toFixed(2)),
                    descuNoSuj: 0,
                    descuExenta: 0,
                    descuGravada: 0,
                    porcentajeDescuento: 0,
                    totalDescu: 0,
                    tributos: [{ codigo: '20', descripcion: 'IVA', valor: parseFloat(totalIVA.toFixed(2)) }],
                    subTotal: parseFloat(total.toFixed(2)),
                    ivaRete1: 0,
                    reteRenta: 0,
                    montoTotalOperacion: parseFloat((total + totalIVA).toFixed(2)),
                    totalNoGravado: 0,
                    totalPagar: parseFloat((total + totalIVA).toFixed(2)),
                    totalLetras: 'TODO',
                    totalIva: parseFloat(totalIVA.toFixed(2)),
                    saldoFavor: 0,
                    condicionOperacion: 1,
                    pagos: [{ codigo: '01', montoPago: parseFloat((total + totalIVA).toFixed(2)), referencia: null, plazo: null, periodo: null }],
                    numPagoElectronico: null,
                },
                extension: null,
                apendice: null,
            },
        };
        return `<!-- TODO: El Salvador DTE (MH) — JSON format; requires JWS signature + MH submission -->
<!-- SV DTE is JSON, not XML. The actual payload is below: -->
${JSON.stringify(dte, null, 2)}
<!-- TODO: selloRecibido (received timestamp from MH) + real códigoGeneración UUID -->`;
    }

    /**
     * Uruguay — Comprobante Fiscal Electrónico (CFE / e-Factura / e-Ticket).
     * Schema: DGI CFE e-Factura (RES 798/2012 + updates)
     * TODO: generate CAE (Constancia de Autorización Electrónica) number from DGI;
     *   sign with XAdES-BES; POST via WS to DGI.
     */
    private _buildUyCfe(data: InvoiceRenderData): string {
        const issueDt = (data.issuedAt ?? data.createdAt).toISOString().split('.')[0];
        const issueDate = issueDt.split('T')[0];
        const rut = getIdentifier(data.company, 'VAT') || '';
        const total = data.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
        const totalIVA = data.items.reduce((s, i) => s + i.quantity * i.unitPrice * (i.vatRate || 0) / 100, 0);
        return `<!-- TODO: Uruguay CFE e-Factura (DGI) — requires CAE numbering + XAdES-BES signature -->
<CFE xmlns="http://www.dgi.gub.uy"
     xmlns:ds="http://www.w3.org/2000/09/xmldsig#"
     version="1.0">
  <eFact>
    <TmstFirma>${issueDt}</TmstFirma>
    <Encabezado>
      <IdDoc>
        <TipoCFE>111</TipoCFE>
        <Serie>A</Serie>
        <Nro>${data.rawNumber || 'TODO'}</Nro>
        <FechEmis>${issueDate}</FechEmis>
        <FchVenc>TODO</FchVenc>
        <MntBruto>1</MntBruto>
        <FmaPago>1</FmaPago>
        <MdosPago>
          <MdoPago>
            <FmaPago>1</FmaPago>
            <MontoMP>${(total + totalIVA).toFixed(2)}</MontoMP>
            <CodMnpMP>${data.company.currency || 'UYU'}</CodMnpMP>
          </MdoPago>
        </MdosPago>
      </IdDoc>
      <Emisor>
        <RUCEmisor>${rut}</RUCEmisor>
        <RznSoc>${data.company.name}</RznSoc>
        <NomFantasia>${data.company.name}</NomFantasia>
        <CdgDGISucur>001</CdgDGISucur>
        <DomFiscal>${data.company.address || ''}</DomFiscal>
        <Ciudad>${data.company.city || ''}</Ciudad>
        <Departamento>TODO</Departamento>
      </Emisor>
      <Receptor>
        <TipoDocRecep>2</TipoDocRecep>
        <CodPaisRecep>UY</CodPaisRecep>
        <DocRecep>${getIdentifier(data.client, 'VAT') || ''}</DocRecep>
        <RznSocRecep>${data.client.name}</RznSocRecep>
        <DirRecep>${data.client.address || ''}</DirRecep>
        <CiudadRecep>${data.client.city || ''}</CiudadRecep>
      </Receptor>
      <Totales>
        <TpoMoneda>${data.company.currency || 'UYU'}</TpoMoneda>
        <MntNetoIvaTasaMin>0</MntNetoIvaTasaMin>
        <MntNetoIVATasaBasica>${total.toFixed(2)}</MntNetoIVATasaBasica>
        <IVATasaMin>0</IVATasaMin>
        <IVATasaBasica>${totalIVA.toFixed(2)}</IVATasaBasica>
        <MntTotal>${(total + totalIVA).toFixed(2)}</MntTotal>
        <CantLinDet>${data.items.length}</CantLinDet>
        <MontoNF>${(total + totalIVA).toFixed(2)}</MontoNF>
      </Totales>
    </Encabezado>
    <Detalle>${data.items.map((item, i) => `
      <Item>
        <NroLinDet>${i + 1}</NroLinDet>
        <IndFact>3</IndFact>
        <NomItem>${item.name}</NomItem>
        <Cantidad>${item.quantity}</Cantidad>
        <UniMed>unit</UniMed>
        <PrecioUnitario>${item.unitPrice.toFixed(6)}</PrecioUnitario>
        <MontoItem>${(item.quantity * item.unitPrice).toFixed(2)}</MontoItem>
      </Item>`).join('')}
    </Detalle>
  </eFact>
</CFE>
<!-- TODO: CAE (Constancia de Autorización Electrónica) from DGI + XAdES-BES + WS submission -->`;
    }

    /**
     * Venezuela — Factura Electrónica (SENIAT).
     * Schema: SENIAT XML v1.0 (Resolución SNAT/2011/0071)
     * TODO: sign; submit to SENIAT portal (currently unstable; system uses SIVEF).
     */
    private _buildVeFe(data: InvoiceRenderData): string {
        const issueDate = (data.issuedAt ?? data.createdAt).toISOString().split('T')[0];
        const rif = getIdentifier(data.company, 'VAT') || '';
        const total = data.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
        const totalIVA = data.items.reduce((s, i) => s + i.quantity * i.unitPrice * (i.vatRate || 0) / 100, 0);
        return `<!-- TODO: Venezuela Factura Electrónica (SENIAT/SIVEF) — submission system currently in flux -->
<FacturaElectronica xmlns="http://www.seniat.gob.ve/namespace/factura_electronica/v1.0">
  <EncabezadoFactura>
    <NumeroFactura>${data.rawNumber || 'DRAFT'}</NumeroFactura>
    <FechaEmision>${issueDate}</FechaEmision>
    <TipoDocumento>01</TipoDocumento>
    <Moneda>${data.company.currency || 'VES'}</Moneda>
  </EncabezadoFactura>
  <Emisor>
    <RIF>${rif}</RIF>
    <RazonSocial>${data.company.name}</RazonSocial>
    <Direccion>${data.company.address || ''}</Direccion>
  </Emisor>
  <Receptor>
    <RIFReceptor>${getIdentifier(data.client, 'VAT') || ''}</RIFReceptor>
    <RazonSocialReceptor>${data.client.name}</RazonSocialReceptor>
  </Receptor>
  <Detalles>${data.items.map((item, i) => `
    <Linea>
      <Numero>${i + 1}</Numero>
      <Descripcion>${item.name}</Descripcion>
      <Cantidad>${item.quantity}</Cantidad>
      <PrecioUnitario>${item.unitPrice.toFixed(2)}</PrecioUnitario>
      <Monto>${(item.quantity * item.unitPrice).toFixed(2)}</Monto>
      <AlicuotaIVA>${item.vatRate || 0}</AlicuotaIVA>
      <IVA>${(item.quantity * item.unitPrice * (item.vatRate || 0) / 100).toFixed(2)}</IVA>
    </Linea>`).join('')}
  </Detalles>
  <Totales>
    <BaseImponible>${total.toFixed(2)}</BaseImponible>
    <MontoIVA>${totalIVA.toFixed(2)}</MontoIVA>
    <MontoTotal>${(total + totalIVA).toFixed(2)}</MontoTotal>
  </Totales>
</FacturaElectronica>
<!-- TODO: digital signature (SUSCERTE-accredited CA) + SENIAT/SIVEF submission -->`;
    }

    /**
     * Bolivia — Facturación Electrónica SIN (Sistema Integral de Facturación).
     * Schema: SIN XML (Resolución Normativa de Directorio 101800000011)
     * TODO: compute CUF (Código Único de Facturación); compute CUFD (Código Único
     *   de Facturación Diaria); sign; submit to SIN API.
     */
    private _buildBoFe(data: InvoiceRenderData): string {
        const issueDt = (data.issuedAt ?? data.createdAt).toISOString().split('.')[0];
        const nit = getIdentifier(data.company, 'VAT') || '';
        const total = data.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
        const totalIVA = data.items.reduce((s, i) => s + i.quantity * i.unitPrice * (i.vatRate || 0) / 100, 0);
        return `<!-- TODO: Bolivia Facturación Electrónica SIN — requires CUF/CUFD + digital signature -->
<facturaComputarizadaCompraVenta xmlns="urn:siat:facturaelectronica:v2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <cabecera>
    <nitEmisor>${nit}</nitEmisor>
    <razonSocialEmisor>${data.company.name}</razonSocialEmisor>
    <municipio>TODO</municipio>
    <telefono>${(data.company as any).phone || ''}</telefono>
    <numeroFactura>${data.rawNumber || 'DRAFT'}</numeroFactura>
    <cuf>TODO-CUF-64-CHARS</cuf>
    <cufd>TODO-CUFD</cufd>
    <codigoSucursal>0</codigoSucursal>
    <direccion>${data.company.address || ''}</direccion>
    <codigoPuntoVenta xsi:nil="true"/>
    <fechaEmision>${issueDt}</fechaEmision>
    <nombreRazonSocial>${data.client.name}</nombreRazonSocial>
    <codigoTipoDocumentoIdentidad>5</codigoTipoDocumentoIdentidad>
    <numeroDocumento>${getIdentifier(data.client, 'VAT') || ''}</numeroDocumento>
    <complemento xsi:nil="true"/>
    <codigoCliente>${getIdentifier(data.client, 'VAT') || ''}</codigoCliente>
    <codigoMetodoPago>1</codigoMetodoPago>
    <importeTotal>${(total + totalIVA).toFixed(2)}</importeTotal>
    <importeTotalSujetoIva>${total.toFixed(2)}</importeTotalSujetoIva>
    <codigoMoneda>1</codigoMoneda>
    <tipoCambio>1</tipoCambio>
    <importeTotalMoneda>${(total + totalIVA).toFixed(2)}</importeTotalMoneda>
    <leyenda>Ley 453: el proveedor no está obligado a emitir nota fiscal.</leyenda>
    <usuario>${(data.company as any).email || ''}</usuario>
    <codigoDocumentoSector>1</codigoDocumentoSector>
  </cabecera>
  <detalle>${data.items.map((item, i) => `
    <detalleFactura>
      <actividadEconomica>TODO</actividadEconomica>
      <codigoProductoSin>83111</codigoProductoSin>
      <codigoProducto>${String(i + 1).padStart(6, '0')}</codigoProducto>
      <descripcion>${item.name}</descripcion>
      <cantidad>${item.quantity}</cantidad>
      <unidadMedida>57</unidadMedida>
      <precioUnitario>${item.unitPrice.toFixed(2)}</precioUnitario>
      <montoDescuento>0.00</montoDescuento>
      <subTotal>${(item.quantity * item.unitPrice).toFixed(2)}</subTotal>
    </detalleFactura>`).join('')}
  </detalle>
</facturaComputarizadaCompraVenta>
<!-- TODO: CUF (Código Único de Facturación) algorithm + CUFD + SIN API submission -->`;
    }

    // ─── Asia skeletons ──────────────────────────────────────────────────

    /**
     * Indonesia e-Faktur (Faktur Pajak Elektronik) — DGT Coretax.
     * Schema: DGT e-Faktur XML (SPT PPN Lampiran A1/A2).
     * TODO: pre-assign NSFP (Nomor Seri Faktur Pajak) from DGT;
     *   compute PPN (11%); sign with NPWP certificate; submit to Coretax API.
     */
    private _buildIdEfaktur(data: InvoiceRenderData): string {
        const issueDate = (data.issuedAt ?? data.createdAt).toISOString().split('T')[0];
        const npwp = getIdentifier(data.company, 'VAT') || '';
        const total = data.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
        const ppn = total * 0.11; // PPN 11%
        return `<!-- TODO: Indonesia e-Faktur (DGT Coretax) — requires NSFP pre-assignment + digital signature -->
<FakturPajak xmlns="urn:dgip:efaktur:v1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <TanggalFaktur>${issueDate}</TanggalFaktur>
  <JenisFaktur>01</JenisFaktur>
  <KodeFaktur>TODO-NSFP-16-DIGIT</KodeFaktur>
  <Penjual>
    <NPWP>${npwp}</NPWP>
    <Nama>${data.company.name}</Nama>
    <Alamat>${data.company.address || 'TODO'}</Alamat>
  </Penjual>
  <Pembeli>
    <NPWP>${getIdentifier(data.client, 'VAT') || '000000000000000'}</NPWP>
    <Nama>${data.client.name}</Nama>
    <Alamat>${data.client.address || 'TODO'}</Alamat>
  </Pembeli>
  <BarangJasa>${data.items.map((item, i) => `
    <Item>
      <No>${i + 1}</No>
      <NamaBarangJasa>${item.name}</NamaBarangJasa>
      <Jumlah>${item.quantity}</Jumlah>
      <HargaSatuan>${item.unitPrice.toFixed(2)}</HargaSatuan>
      <DPP>${(item.quantity * item.unitPrice).toFixed(2)}</DPP>
      <PPN>${(item.quantity * item.unitPrice * 0.11).toFixed(2)}</PPN>
    </Item>`).join('')}
  </BarangJasa>
  <Jumlah>
    <DPP>${total.toFixed(2)}</DPP>
    <PPN>${ppn.toFixed(2)}</PPN>
    <Total>${(total + ppn).toFixed(2)}</Total>
  </Jumlah>
</FakturPajak>
<!-- TODO: NSFP + kodeOtorisasi (Coretax API) + e-Meterai (if > IDR 5M) -->`;
    }

    /**
     * Taiwan eGUI / unified invoice (統一發票) — MoF MIG XML.
     * Schema: MoF 電子發票整合服務平台 MIG (Message Implementation Guide) v3.2.
     * TODO: allocate invoice-number track from MoF; include InvoiceNumber (A1234567890 format);
     *   random number; QR code (left + right concatenation); upload to MoF.
     */
    private _buildTwEgui(data: InvoiceRenderData): string {
        const issueDate = (data.issuedAt ?? data.createdAt).toISOString().split('T')[0];
        const taxId = getIdentifier(data.company, 'VAT') || ''; // 統一編號 (8 digits)
        const total = data.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
        const tax = data.items.reduce((s, i) => s + i.quantity * i.unitPrice * (i.vatRate || 5) / 100, 0);
        return `<!-- TODO: Taiwan eGUI (MoF 電子發票) — requires invoice-number track + random number + QR code -->
<Invoice xmlns="urn:tw:gov:mof:einvoice:v1">
  <Main>
    <InvoiceNumber>TODO-TW-INVOICE-NO</InvoiceNumber>
    <InvoiceDate>${issueDate.replace(/-/g, '')}</InvoiceDate>
    <InvoiceTime>120000</InvoiceTime>
    <RandomNumber>TODO-4-DIGIT</RandomNumber>
    <SalesAmount>${total.toFixed(0)}</SalesAmount>
    <TaxType>1</TaxType>
    <TaxRate>5</TaxRate>
    <TaxAmount>${tax.toFixed(0)}</TaxAmount>
    <TotalAmount>${(total + tax).toFixed(0)}</TotalAmount>
    <SellerID>${taxId}</SellerID>
    <SellerName>${data.company.name}</SellerName>
    <BuyerID>${getIdentifier(data.client, 'VAT') || '0000000000'}</BuyerID>
    <BuyerName>${data.client.name}</BuyerName>
    <CarrierType/>
    <CarrierID1/>
    <NPOBAN/>
    <PrintMark>N</PrintMark>
  </Main>
  <Details>${data.items.map((item, i) => `
    <ProductItem>
      <SequenceNumber>${i + 1}</SequenceNumber>
      <Description>${item.name}</Description>
      <Quantity>${item.quantity}</Quantity>
      <UnitPrice>${item.unitPrice.toFixed(0)}</UnitPrice>
      <Amount>${(item.quantity * item.unitPrice).toFixed(0)}</Amount>
    </ProductItem>`).join('')}
  </Details>
</Invoice>
<!-- TODO: InvoiceNumber allocation (track A/B/...) + random + QR (left: 35 chars, right: 34 chars) -->`;
    }

    /**
     * Kazakhstan IS ESF (Электронные счета-фактуры).
     * Schema: IS ESF XML (Приказ НК МФ РК №391).
     * TODO: sign with GOST or RSA (ЭЦП); supply virtual-warehouse linkage (склад);
     *   include currency rate if not KZT; submit to IS ESF API.
     */
    private _buildKzEsf(data: InvoiceRenderData): string {
        const issueDate = (data.issuedAt ?? data.createdAt).toISOString().split('T')[0];
        const bin = getIdentifier(data.company, 'VAT') || ''; // БИН (12 digits)
        const total = data.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
        const vat = data.items.reduce((s, i) => s + i.quantity * i.unitPrice * (i.vatRate || 12) / 100, 0);
        return `<!-- TODO: Kazakhstan IS ESF — requires ЭЦП signature + БИН registration + virtual-warehouse linkage -->
<ESF xmlns="urn:esf:gov:kz:v2">
  <Num>${data.rawNumber || 'DRAFT'}</Num>
  <DateDoc>${issueDate}</DateDoc>
  <Supplier>
    <BIN>${bin}</BIN>
    <Name>${data.company.name}</Name>
    <Address>${data.company.address || 'TODO'}</Address>
  </Supplier>
  <Recipient>
    <BIN>${getIdentifier(data.client, 'VAT') || 'TODO'}</BIN>
    <Name>${data.client.name}</Name>
  </Recipient>
  <Products>${data.items.map((item, i) => `
    <ProductsTable>
      <Num>${i + 1}</Num>
      <NameRu>${item.name}</NameRu>
      <Unit>796</Unit>
      <Count>${item.quantity}</Count>
      <Price>${item.unitPrice.toFixed(2)}</Price>
      <NDS>${(item.vatRate || 12).toFixed(0)}</NDS>
      <AmountNDS>${(item.quantity * item.unitPrice * (item.vatRate || 12) / 100).toFixed(2)}</AmountNDS>
      <TurnoverSize>${(item.quantity * item.unitPrice).toFixed(2)}</TurnoverSize>
    </ProductsTable>`).join('')}
  </Products>
  <Totals>
    <TotalTurnoverSize>${total.toFixed(2)}</TotalTurnoverSize>
    <TotalNDS>${vat.toFixed(2)}</TotalNDS>
    <TotalSize>${(total + vat).toFixed(2)}</TotalSize>
  </Totals>
</ESF>
<!-- TODO: ЭЦП (qualified electronic signature) + IS ESF API submission -->`;
    }

    /**
     * Philippines BIR EIS (Electronic Invoicing System).
     * Schema: BIR EIS JSON (Revenue Regulations 8-2022).
     * TODO: sign with BIR-registered digital signature; include ORN (Official Receipt Number);
     *   submit to BIR EIS API.
     * Note: PH EIS uses JSON, wrapped in XML comment for the pipeline.
     */
    private _buildPhEis(data: InvoiceRenderData): string {
        const issueDate = (data.issuedAt ?? data.createdAt).toISOString().split('T')[0];
        const tin = getIdentifier(data.company, 'VAT') || ''; // TIN (9-12 digits)
        const total = data.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
        const vat = data.items.reduce((s, i) => s + i.quantity * i.unitPrice * (i.vatRate || 12) / 100, 0);
        const eisJson = {
            schemaVersion: '1.0',
            invoiceNumber: data.rawNumber || 'DRAFT',
            invoiceDate: issueDate,
            sellerTIN: tin,
            sellerName: data.company.name,
            sellerAddress: data.company.address || 'TODO',
            buyerTIN: getIdentifier(data.client, 'VAT') || 'N/A',
            buyerName: data.client.name,
            buyerAddress: data.client.address || 'TODO',
            items: data.items.map((item, i) => ({
                lineNo: i + 1,
                description: item.name,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                amount: item.quantity * item.unitPrice,
                vatRate: item.vatRate || 12,
                vatAmount: item.quantity * item.unitPrice * (item.vatRate || 12) / 100,
            })),
            totalSales: total,
            totalVAT: vat,
            totalAmount: total + vat,
            digitalSignature: 'TODO', // TODO: BIR-registered DSA signature
        };
        return `<!-- TODO: Philippines BIR EIS (Revenue Regulations 8-2022) — requires digital signature + BIR API -->
${JSON.stringify(eisJson, null, 2)}`;
    }

    /**
     * Thailand RD e-Tax Invoice & e-Receipt.
     * Schema: RD XML (Notification of the Revenue Department on the criteria, procedure,
     *   and conditions for the preparation, delivery and storage of e-Tax Invoice and e-Receipt).
     * TODO: PKCS#7 / digital signature (ETDA-certified CA); submit via RD-approved service provider.
     */
    private _buildThEtax(data: InvoiceRenderData): string {
        const issueDate = (data.issuedAt ?? data.createdAt).toISOString().split('T')[0];
        const tin = getIdentifier(data.company, 'VAT') || ''; // เลขประจำตัวผู้เสียภาษี (13 digits)
        const total = data.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
        const vat = data.items.reduce((s, i) => s + i.quantity * i.unitPrice * (i.vatRate || 7) / 100, 0);
        return `<!-- TODO: Thailand RD e-Tax Invoice — requires PKCS#7 signature + ETDA-certified CA -->
<TaxInvoice xmlns="urn:th:go:rd:etax:v2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <InvoiceNumber>${data.rawNumber || 'DRAFT'}</InvoiceNumber>
  <InvoiceDate>${issueDate}</InvoiceDate>
  <InvoiceType>T01</InvoiceType>
  <Seller>
    <TaxID>${tin}</TaxID>
    <Name>${data.company.name}</Name>
    <Address>${data.company.address || 'TODO'}</Address>
  </Seller>
  <Buyer>
    <TaxID>${getIdentifier(data.client, 'VAT') || 'N/A'}</TaxID>
    <Name>${data.client.name}</Name>
  </Buyer>
  <LineItems>${data.items.map((item, i) => `
    <LineItem>
      <No>${i + 1}</No>
      <Description>${item.name}</Description>
      <Quantity>${item.quantity}</Quantity>
      <UnitPrice>${item.unitPrice.toFixed(2)}</UnitPrice>
      <Amount>${(item.quantity * item.unitPrice).toFixed(2)}</Amount>
      <VATRate>${item.vatRate || 7}</VATRate>
      <VATAmount>${(item.quantity * item.unitPrice * (item.vatRate || 7) / 100).toFixed(2)}</VATAmount>
    </LineItem>`).join('')}
  </LineItems>
  <Totals>
    <SubTotal>${total.toFixed(2)}</SubTotal>
    <VATAmount>${vat.toFixed(2)}</VATAmount>
    <GrandTotal>${(total + vat).toFixed(2)}</GrandTotal>
  </Totals>
</TaxInvoice>
<!-- TODO: PKCS#7 digital signature (ETDA-certified) + RD service provider submission -->`;
    }

    /**
     * Nepal IRD CBMS (Central Billing Monitoring System).
     * Schema: IRD CBMS payload (fiscal device integration).
     * TODO: fiscal device serial; real-time online verification; QR code generation.
     */
    private _buildNpCbms(data: InvoiceRenderData): string {
        const issueDate = (data.issuedAt ?? data.createdAt).toISOString().split('T')[0];
        const pan = getIdentifier(data.company, 'VAT') || ''; // PAN (9 digits)
        const total = data.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
        const vat = data.items.reduce((s, i) => s + i.quantity * i.unitPrice * (i.vatRate || 13) / 100, 0);
        return `<!-- TODO: Nepal IRD CBMS — requires fiscal device + real-time online verification -->
<CBMSInvoice xmlns="urn:np:gov:ird:cbms:v1">
  <InvoiceNo>${data.rawNumber || 'DRAFT'}</InvoiceNo>
  <InvoiceDate>${issueDate}</InvoiceDate>
  <FiscalYear>TODO</FiscalYear>
  <Taxpayer>
    <PAN>${pan}</PAN>
    <Name>${data.company.name}</Name>
    <Address>${data.company.address || 'TODO'}</Address>
  </Taxpayer>
  <Customer>
    <PAN>${getIdentifier(data.client, 'VAT') || 'N/A'}</PAN>
    <Name>${data.client.name}</Name>
  </Customer>
  <Items>${data.items.map((item, i) => `
    <Item>
      <SN>${i + 1}</SN>
      <Particulars>${item.name}</Particulars>
      <Unit>Unit</Unit>
      <Quantity>${item.quantity}</Quantity>
      <Rate>${item.unitPrice.toFixed(2)}</Rate>
      <Amount>${(item.quantity * item.unitPrice).toFixed(2)}</Amount>
    </Item>`).join('')}
  </Items>
  <Summary>
    <TaxableAmount>${total.toFixed(2)}</TaxableAmount>
    <VATAmount>${vat.toFixed(2)}</VATAmount>
    <TotalAmount>${(total + vat).toFixed(2)}</TotalAmount>
  </Summary>
</CBMSInvoice>
<!-- TODO: fiscal device serial + CBMS real-time sync + verification QR -->`;
    }

    /**
     * Bangladesh NBR e-invoice.
     * Schema: NBR e-invoice payload (VAT Registration).
     * TODO: BIN (Business Identification Number); NBR API integration.
     */
    private _buildBdNbr(data: InvoiceRenderData): string {
        const issueDate = (data.issuedAt ?? data.createdAt).toISOString().split('T')[0];
        const bin = getIdentifier(data.company, 'VAT') || ''; // BIN (9 digits)
        const total = data.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
        const vat = data.items.reduce((s, i) => s + i.quantity * i.unitPrice * (i.vatRate || 15) / 100, 0);
        return `<!-- TODO: Bangladesh NBR e-invoice — requires BIN + NBR API integration -->
<NBRInvoice xmlns="urn:bd:gov:nbr:einvoice:v1">
  <InvoiceNo>${data.rawNumber || 'DRAFT'}</InvoiceNo>
  <InvoiceDate>${issueDate}</InvoiceDate>
  <Supplier>
    <BIN>${bin}</BIN>
    <Name>${data.company.name}</Name>
    <Address>${data.company.address || 'TODO'}</Address>
  </Supplier>
  <Recipient>
    <BIN>${getIdentifier(data.client, 'VAT') || 'N/A'}</BIN>
    <Name>${data.client.name}</Name>
  </Recipient>
  <LineItems>${data.items.map((item, i) => `
    <LineItem>
      <Sl>${i + 1}</Sl>
      <Description>${item.name}</Description>
      <Quantity>${item.quantity}</Quantity>
      <UnitValue>${item.unitPrice.toFixed(2)}</UnitValue>
      <TaxableValue>${(item.quantity * item.unitPrice).toFixed(2)}</TaxableValue>
      <VATRate>${item.vatRate || 15}</VATRate>
      <VATAmount>${(item.quantity * item.unitPrice * (item.vatRate || 15) / 100).toFixed(2)}</VATAmount>
    </LineItem>`).join('')}
  </LineItems>
  <Totals>
    <TaxableAmount>${total.toFixed(2)}</TaxableAmount>
    <VATAmount>${vat.toFixed(2)}</VATAmount>
    <Total>${(total + vat).toFixed(2)}</Total>
  </Totals>
</NBRInvoice>
<!-- TODO: NBR BIN validation + NBR e-invoice API submission -->`;
    }

    /**
     * Pakistan FBR XIR (XML Invoice Reporting) / ESP (Electronic Sales Portal).
     * Schema: FBR XIR payload (Sales Tax Act 1990, SRO 1098).
     * TODO: STRN (Sales Tax Registration Number); FBR API key; digital signature (SCA).
     */
    private _buildPkFbr(data: InvoiceRenderData): string {
        const issueDate = (data.issuedAt ?? data.createdAt).toISOString().split('T')[0];
        const strn = getIdentifier(data.company, 'VAT') || ''; // STRN (7 or more digits)
        const total = data.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
        const vat = data.items.reduce((s, i) => s + i.quantity * i.unitPrice * (i.vatRate || 18) / 100, 0);
        return `<!-- TODO: Pakistan FBR XIR — requires STRN + FBR API key + SCA signature -->
<FBRInvoice xmlns="urn:pk:fbr:xir:v1">
  <InvoiceNo>${data.rawNumber || 'DRAFT'}</InvoiceNo>
  <InvoiceDate>${issueDate}</InvoiceDate>
  <InvoiceType>SI</InvoiceType>
  <Seller>
    <STRN>${strn}</STRN>
    <Name>${data.company.name}</Name>
    <Address>${data.company.address || 'TODO'}</Address>
  </Seller>
  <Buyer>
    <STRN>${getIdentifier(data.client, 'VAT') || 'N/A'}</STRN>
    <Name>${data.client.name}</Name>
  </Buyer>
  <Items>${data.items.map((item, i) => `
    <Item>
      <Sr>${i + 1}</Sr>
      <Description>${item.name}</Description>
      <Qty>${item.quantity}</Qty>
      <Rate>${item.unitPrice.toFixed(2)}</Rate>
      <Value>${(item.quantity * item.unitPrice).toFixed(2)}</Value>
      <SalesTaxRate>${item.vatRate || 18}</SalesTaxRate>
      <SalesTaxAmt>${(item.quantity * item.unitPrice * (item.vatRate || 18) / 100).toFixed(2)}</SalesTaxAmt>
    </Item>`).join('')}
  </Items>
  <Totals>
    <TaxableValue>${total.toFixed(2)}</TaxableValue>
    <SalesTax>${vat.toFixed(2)}</SalesTax>
    <TotalBillAmt>${(total + vat).toFixed(2)}</TotalBillAmt>
  </Totals>
</FBRInvoice>
<!-- TODO: FBR XIR API submission + IRN + QR code (FBR POS/Invoice System) -->`;
    }

    /**
     * Vietnam TT78 / Decree-123 e-invoice.
     * Schema: TT78 XML (Thông tư 78/2021/TT-BTC; Nghị định 123/2020/NĐ-CP).
     * TODO: digital signature (token/HSM); mã CQT (tax authority code) from GDT;
     *   signed XML per PKCS#7.
     */
    private _buildVnTt78(data: InvoiceRenderData): string {
        const issueDt = (data.issuedAt ?? data.createdAt).toISOString();
        const mst = getIdentifier(data.company, 'VAT') || ''; // Mã số thuế (10 or 13 digits)
        const total = data.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
        const vat = data.items.reduce((s, i) => s + i.quantity * i.unitPrice * (i.vatRate || 10) / 100, 0);
        return `<!-- TODO: Vietnam TT78 e-invoice (Decree 123/2020) — requires PKCS#7 signature + GDT code (mã CQT) -->
<HDon xmlns="http://lanhdalieu.gdt.gov.vn/HD"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  Version="1.0">
  <DLHDon>
    <TTChung>
      <MaHDon>${data.rawNumber || 'DRAFT'}</MaHDon>
      <THDon>Hóa đơn giá trị gia tăng</THDon>
      <KHMSHDon>1</KHMSHDon>
      <KHHDon>TODO-SERIES</KHHDon>
      <SHDon>TODO-SEQUENCE</SHDon>
      <NLap>${issueDt}</NLap>
      <DDan>TODO: company description</DDan>
      <MaCQTCap>TODO-MA-CQT</MaCQTCap>
    </TTChung>
    <NDHDon>
      <NBan>
        <MST>${mst}</MST>
        <Ten>${data.company.name}</Ten>
        <DChi>${data.company.address || 'TODO'}</DChi>
      </NBan>
      <NMua>
        <Ten>${data.client.name}</Ten>
        <MST>${getIdentifier(data.client, 'VAT') || ''}</MST>
        <DChi>${data.client.address || 'TODO'}</DChi>
      </NMua>
      <DSHHDVu>${data.items.map((item, i) => `
        <HHDVu>
          <STT>${i + 1}</STT>
          <THHDVu>${item.name}</THHDVu>
          <DVTinh>Dịch vụ</DVTinh>
          <SLuong>${item.quantity}</SLuong>
          <DGia>${item.unitPrice.toFixed(2)}</DGia>
          <ThTien>${(item.quantity * item.unitPrice).toFixed(2)}</ThTien>
          <TSuat>${item.vatRate || 10}%</TSuat>
          <TThueTGTGT>${(item.quantity * item.unitPrice * (item.vatRate || 10) / 100).toFixed(2)}</TThueTGTGT>
        </HHDVu>`).join('')}
      </DSHHDVu>
      <TToan>
        <THTTLTSuat>
          <LTSuat>${data.items[0]?.vatRate || 10}%</LTSuat>
          <ThTien>${total.toFixed(2)}</ThTien>
          <TThue>${vat.toFixed(2)}</TThue>
        </THTTLTSuat>
        <TgTCThue>${total.toFixed(2)}</TgTCThue>
        <TgTThue>${vat.toFixed(2)}</TgTThue>
        <TgTTTBChu>TODO: amount in words</TgTTTBChu>
        <TgTTT>${(total + vat).toFixed(2)}</TgTTT>
      </TToan>
    </NDHDon>
  </DLHDon>
</HDon>
<!-- TODO: PKCS#7 XML digital signature + GDT mã CQT + TT78 schema validation -->`;
    }

    /**
     * Malaysia MyInvois (LHDNM) — UBL 2.1 skeleton with LHDNM mandatory extensions.
     * Schema: UBL 2.1 + LHDNM e-Invoice Schema v1.0 (cbc:ProfileID mandatory).
     * TODO: cbc:ProfileID = "reporting:1.0" (B2C) or "billing:1.0" (B2B/B2G);
     *   cac:Signature block (signed by MyInvois platform on clearance);
     *   SHA-256 hash of the document for the submission envelope;
     *   SST registration (if applicable).
     */
    private _buildMyInvois(data: InvoiceRenderData): string {
        const issueDate = (data.issuedAt ?? data.createdAt).toISOString().split('T')[0];
        const tin = getIdentifier(data.company, 'VAT') || ''; // TIN (C/P/D + 12-14 digits)
        const total = data.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
        const vat = data.items.reduce((s, i) => s + i.quantity * i.unitPrice * (i.vatRate || 8) / 100, 0);
        return `<!-- TODO: Malaysia MyInvois (LHDNM) — UBL 2.1 + LHDNM extensions; submit to MyInvois for clearance -->
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
  xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
  <cbc:ID>${data.rawNumber || 'DRAFT'}</cbc:ID>
  <cbc:IssueDate>${issueDate}</cbc:IssueDate>
  <cbc:IssueTime>12:00:00</cbc:IssueTime>
  <cbc:InvoiceTypeCode listVersionID="1.0">01</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${data.company.currency || 'MYR'}</cbc:DocumentCurrencyCode>
  <cbc:ProfileID>billing:1.0</cbc:ProfileID>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cbc:IndustryClassificationCode>TODO-MSIC</cbc:IndustryClassificationCode>
      <cac:PartyIdentification><cbc:ID schemeID="TIN">${tin}</cbc:ID></cac:PartyIdentification>
      <cac:PartyLegalEntity><cbc:RegistrationName>${data.company.name}</cbc:RegistrationName></cac:PartyLegalEntity>
      <cac:PostalAddress>
        <cbc:CityName>${data.company.city || 'TODO'}</cbc:CityName>
        <cbc:PostalZone>${data.company.postalCode || 'TODO'}</cbc:PostalZone>
        <cac:Country><cbc:IdentificationCode>MY</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyIdentification><cbc:ID schemeID="TIN">${getIdentifier(data.client, 'VAT') || 'EI00000000010'}</cbc:ID></cac:PartyIdentification>
      <cac:PartyLegalEntity><cbc:RegistrationName>${data.client.name}</cbc:RegistrationName></cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${data.company.currency || 'MYR'}">${vat.toFixed(2)}</cbc:TaxAmount>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:TaxExclusiveAmount currencyID="${data.company.currency || 'MYR'}">${total.toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${data.company.currency || 'MYR'}">${(total + vat).toFixed(2)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${data.company.currency || 'MYR'}">${(total + vat).toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  ${data.items.map((item, i) => `<cac:InvoiceLine>
    <cbc:ID>${i + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">${item.quantity}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${data.company.currency || 'MYR'}">${(item.quantity * item.unitPrice).toFixed(2)}</cbc:LineExtensionAmount>
    <cac:Item><cbc:Description>${item.name}</cbc:Description></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="${data.company.currency || 'MYR'}">${item.unitPrice.toFixed(2)}</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>`).join('\n  ')}
</Invoice>
<!-- TODO: SHA-256 documentHash for MyInvois submission envelope + LHDNM validation + longId QR -->`;
    }

    private _buildGenericNationalXml(data: InvoiceRenderData, cc: string): string {
        const issueDate = (data.issuedAt ?? data.createdAt).toISOString().split('T')[0];
        const total = data.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
        const totalIVA = data.items.reduce((s, i) => s + i.quantity * i.unitPrice * (i.vatRate || 0) / 100, 0);
        return `<!-- TODO: ${cc} national e-invoice — schema and submission service TBD -->
<NationalInvoice>
  <Header><CountryCode>${cc}</CountryCode><InvoiceNumber>${data.rawNumber || 'DRAFT'}</InvoiceNumber><IssueDate>${issueDate}</IssueDate><Currency>${data.company.currency}</Currency></Header>
  <Seller><Name>${data.company.name}</Name><Identifier>${getIdentifier(data.company, 'VAT') || ''}</Identifier><Country>${data.company.country || ''}</Country></Seller>
  <Buyer><Name>${data.client.name}</Name><Identifier>${getIdentifier(data.client, 'VAT') || ''}</Identifier><Country>${data.client.country || ''}</Country></Buyer>
  <Lines>${data.items.map((item, i) => `<Line><Number>${i + 1}</Number><Description>${item.name}</Description><Quantity>${item.quantity}</Quantity><UnitPrice>${item.unitPrice}</UnitPrice><VATRate>${item.vatRate || 0}</VATRate></Line>`).join('')}</Lines>
  <Totals><SubTotal>${total.toFixed(2)}</SubTotal><Tax>${totalIVA.toFixed(2)}</Tax><Total>${(total + totalIVA).toFixed(2)}</Total></Totals>
</NationalInvoice>
<!-- TODO: Country-specific schema validation + digital signature + submission -->`;
    }
}
