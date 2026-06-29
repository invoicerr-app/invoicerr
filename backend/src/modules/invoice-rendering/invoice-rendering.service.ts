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
    // Hybrid PDF/A-3 formats: embed CII XML into the PDF container
    const fmtName = format === 'zugferd' ? 'Factur-X-EN16931' : 'Factur-X-EN16931';
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

    /** CFDI 4.0 Comprobante XML (MX) — structural skeleton. */
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

        return `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante Version="4.0" Serie="A" Folio="${numId}" Fecha="${issueDate}T12:00:00" FormaPago="03" NoCertificado="30001000000500003416" Certificado="" SubTotal="${total.toFixed(2)}" Moneda="${currency}" Total="${(total + totalIVA).toFixed(2)}" TipoDeComprobante="I" MetodoPago="PUE" LugarExpedicion="${postalCode}" Exportacion="01">
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
                '@': { xmlns: 'http://www.facturae.es/schemas/2014/v3.2.1/Facturae' },
                FileHeader: {
                    SchemaVersion: '3.2.1',
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

    /** KSA UBL 2.1 + QR (SA/ZATCA) — UBL skeleton with QR placeholder. */
    async buildKsaUbl(data: InvoiceRenderData): Promise<string> {
        const issueDate = (data.issuedAt ?? data.createdAt).toISOString().split('T')[0];
        const total = data.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
        const totalIVA = data.items.reduce((s, i) => s + i.quantity * i.unitPrice * (i.vatRate || 0) / 100, 0);

        const inv = {
            'ubl:Invoice': {
                'cbc:CustomizationID': 'urn:cen.biis:en16931:2017#compliant#urn:fdc:zatca.sa:2017:outlook:01:2.1',
                'cbc:ProfileID': 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0',
                'cbc:ID': data.rawNumber || (data.number?.toString() ?? 'DRAFT'),
                'cbc:IssueDate': issueDate,
                'cbc:InvoiceTypeCode': '380',
                'cbc:DocumentCurrencyCode': data.company.currency || 'SAR',
                'cac:AccountingSupplierParty': {
                    'cac:Party': {
                        'cbc:EndpointID': getIdentifier(data.company, 'VAT') || '',
                        'cac:PostalAddress': {
                            'cbc:CityName': data.company.city || '',
                            'cac:Country': { 'cbc:IdentificationCode': (data.company.country || 'SA').slice(0, 2).toUpperCase() },
                        },
                        'cac:PartyLegalEntity': {
                            'cbc:RegistrationName': data.company.name,
                            'cbc:CompanyID': getIdentifier(data.company, 'VAT') || '',
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
        let xml = doc.end({ prettyPrint: true });

        // QR code placeholder (TLV base64 — to be generated by ZATCA on submission)
        const qrPlaceholder = '<!-- TODO: ZATCA QR code TLV payload — generated during FATOORA submission -->';
        xml = xml.replace('</ubl:Invoice>', `${qrPlaceholder}\n</ubl:Invoice>`);
        return xml;
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
