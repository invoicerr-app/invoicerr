import { Injectable, BadRequestException } from '@nestjs/common';
import * as Handlebars from 'handlebars';
import { EInvoice, ExportFormat } from '@fin.cx/einvoice';
import { finance } from '@fin.cx/einvoice/dist_ts/plugins';
import { business } from '@tsclass/tsclass/dist_ts';
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
    partyIdentifiers?: { scheme: string; value: string }[];
  };
  client: {
    type: string;
    name: string;
    description: string | null;
    foundedAt: Date | null;
    contactFirstname: string | null;
    contactLastname: string | null;
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

    /** Pure construction — no DB access. Builds an EInvoice from a plain data object. */
    buildEInvoice(data: InvoiceRenderData): EInvoice {
        const inv = new EInvoice();

        const companyFoundedDate = new Date(data.company.foundedAt || new Date());
        const clientFoundedDate = new Date(data.client.foundedAt || new Date());

        inv.id = data.rawNumber || (data.number?.toString() ?? 'DRAFT');
        inv.issueDate = new Date((data.issuedAt ?? data.createdAt).toISOString().split('T')[0]);
        inv.currency = data.company.currency as finance.TCurrency || 'EUR';

        let fromAdress;
        try {
            fromAdress = parseAddress(data.company.address || '');
        } catch (error) {
            fromAdress = {
                streetName: data.company.address || 'N/A',
                houseNumber: 'N/A',
            };
        }

        inv.from = {
            name: data.company.name,
            description: data.company.description || "N/A",
            status: 'active',
            foundedDate: { day: companyFoundedDate.getDay(), month: companyFoundedDate.getMonth() + 1, year: companyFoundedDate.getFullYear() },
            type: 'company',
            address: {
                streetName: fromAdress.streetName,
                houseNumber: fromAdress.houseNumber,
                city: data.company.city || '',
                postalCode: data.company.postalCode || '',
                country: data.company.country || '',
                countryCode: data.company.country || ''
            },
            registrationDetails: { vatId: getIdentifier(data.company, 'VAT') || "N/A", registrationId: getIdentifier(data.company, 'LEGAL_ID') || "N/A", registrationName: data.company.name }
        };

        let toAdress;
        try {
            toAdress = parseAddress(data.client.address || '');
        } catch (error) {
            toAdress = {
                streetName: data.client.address || 'N/A',
                houseNumber: 'N/A',
            };
        }

        if (data.client.type === 'COMPANY') {
            const companyContact: business.TCompany = {
                type: 'company',
                name: data.client.name || "N/A",
                description: data.client.description || "N/A",
                status: data.client.isActive ? 'active' : 'planned',
                foundedDate: { day: clientFoundedDate.getDay(), month: clientFoundedDate.getMonth() + 1, year: clientFoundedDate.getFullYear() },
                address: {
                    streetName: toAdress.streetName,
                    houseNumber: toAdress.houseNumber,
                    city: data.client.city || '',
                    postalCode: data.client.postalCode || '',
                    country: data.client.country || 'FR',
                    countryCode: (data.client.country || 'FR').slice(0, 2).toUpperCase()
                },
                registrationDetails: { vatId: getIdentifier(data.client, 'VAT') || 'N/A', registrationId: getIdentifier(data.client, 'LEGAL_ID') || 'N/A', registrationName: data.client.name }
            };

            inv.to = companyContact;
        } else {
            const personContact: business.TPerson = {
                type: 'person',
                name: `${data.client.contactFirstname} ${data.client.contactLastname}` || "N/A",
                description: data.client.description || "N/A",
                surname: data.client.contactLastname || 'N/A',
                salutation: data.client.salutation as "Mr" | "Ms" | "Mrs",
                sex: data.client.sex as "male" | "female" | "other",
                title: data.client.title as "Doctor" | "Professor",
                address: {
                    streetName: toAdress.streetName,
                    houseNumber: toAdress.houseNumber,
                    city: data.client.city || '',
                    postalCode: data.client.postalCode || '',
                    country: data.client.country || 'FR',
                    countryCode: (data.client.country || 'FR').slice(0, 2).toUpperCase()
                },
            };

            inv.to = personContact;
        }

        data.items.forEach((item) => {
            inv.addItem({
                name: item.name,
                unitQuantity: item.quantity,
                unitNetPrice: item.unitPrice,
                vatPercentage: item.vatRate || 0,
                unitType: item.type === 'HOUR' ? 'HUR' : item.type === 'DAY' ? 'DAY' : item.type === 'DEPOSIT' ? 'SET' : item.type === 'SERVICE' ? 'C62' : item.type === 'PRODUCT' ? 'C62' : 'C62',
            });
        });

        return inv;
    }

    async renderXml(id: string): Promise<EInvoice> {
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

        const inv = this.buildEInvoice(invRec);

        const validation = await inv.validate()

        logger.info('E-Invoice validation result: ' + (validation.valid ? 'valid' : 'invalid'), { category: 'invoice' });
        logger.info('E-Invoice validation warnings: ' + (validation.warnings ? validation.warnings.length : '0'), { category: 'invoice' });
        logger.info('E-Invoice validation errors: ' + (validation.errors ? validation.errors.length : '0'), { category: 'invoice' });

        if (!validation.valid) {
            if (validation.warnings) {
                logger.warn('Validation warnings:', { category: 'invoice', details: { warnings: validation.warnings } });
            }

            logger.error('Validation errors:', { category: 'invoice', details: { errors: validation.errors } });
        }

        return inv;
    }

    async renderXmlFormat(invoiceId: string, format: 'ubl' | 'cii' | 'xrechnung'): Promise<string> {
        const inv = await this.renderXml(invoiceId);
        return inv.exportXml(format);
    }

    // ─── National XML format builders (cycle-safe, no DB) ────────────────

    /** FatturaPA 1.2 XML (IT/SM) via @digitalia/fatturapa — JSON→XML. */
    async buildFatturaPa(data: InvoiceRenderData): Promise<string> {
        const { fpa2xml } = await import('@digitalia/fatturapa');

        const vatId = getIdentifier(data.company, 'VAT') || '';
        const vatCountry = (data.company.country || 'IT').slice(0, 2).toUpperCase();
        const cf = getIdentifier(data.company, 'LEGAL_ID') || '';

        const clienteVatId = getIdentifier(data.client, 'VAT') || '';
        const clienteVatCountry = (data.client.country || '').slice(0, 2).toUpperCase();
        const clienteCf = getIdentifier(data.client, 'LEGAL_ID') || '';

        const issueDate = (data.issuedAt ?? data.createdAt).toISOString().split('T')[0];

        const dettaglioLinee = data.items.map((item, idx) => ({
            NumeroLinea: idx + 1,
            Descrizione: item.name,
            Quantita: item.quantity,
            PrezzoUnitario: item.unitPrice,
            PrezzoTotale: item.quantity * item.unitPrice,
            AliquotaIVA: item.vatRate || 0,
            ...(item.vatRate === 0 ? { Natura: 'N1' as const } : {}),
        }));

        const totaleImponibile = data.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
        const totaleIVA = data.items.reduce((s, i) => s + i.quantity * i.unitPrice * (i.vatRate || 0) / 100, 0);

        const datiRiepilogo = data.items.reduce<Record<number, { imponibile: number; imposta: number; rate: number }>>((acc, item) => {
            const rate = item.vatRate || 0;
            if (!acc[rate]) acc[rate] = { imponibile: 0, imposta: 0, rate };
            acc[rate].imponibile += item.quantity * item.unitPrice;
            acc[rate].imposta += item.quantity * item.unitPrice * rate / 100;
            return acc;
        }, {});

        const riepilogoList = Object.values(datiRiepilogo).map(g => ({
            AliquotaIVA: g.rate,
            ImponibileImporto: Math.round(g.imponibile * 100) / 100,
            Imposta: Math.round(g.imposta * 100) / 100,
            ...(g.rate === 0 ? { Natura: 'N1' as const } : {}),
        }));

        const fattura = {
            'p:FatturaElettronica': {
                '@': { versione: 'FPR12' },
                'FatturaElettronicaHeader': {
                    DatiTrasmissione: {
                        IdTrasmittente: { IdPaese: vatCountry, IdCodice: cf || vatId },
                        ProgressivoInvio: '00001',
                        FormatoTrasmissione: 'FPR12',
                        CodiceDestinatario: '0000000',
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
                        ...(data.client.contactFirstname ? {
                            Contatti: {
                                Telefono: undefined,
                                Email: undefined,
                            },
                        } : {}),
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
                    },
                },
                'FatturaElettronicaBody': {
                    DatiGenerali: {
                        DatiGeneraliDocumento: {
                            TipoDocumento: 'TD01',
                            Divisa: data.company.currency || 'EUR',
                            Data: issueDate,
                            Numero: data.rawNumber || (data.number?.toString() ?? 'DRAFT'),
                            ImportoTotaleDocumento: Math.round((totaleImponibile + totaleIVA) * 100) / 100,
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
                            ImportoPagamento: Math.round((totaleImponibile + totaleIVA) * 100) / 100,
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

    /** FA_VAT (PL/KSeF) XML skeleton — FA(2) structure. */
    async buildFaVat(data: InvoiceRenderData): Promise<string> {
        const issueDate = (data.issuedAt ?? data.createdAt).toISOString().split('T')[0];
        const total = data.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
        const totalIVA = data.items.reduce((s, i) => s + i.quantity * i.unitPrice * (i.vatRate || 0) / 100, 0);
        const nip = getIdentifier(data.company, 'VAT') || '';

        const fa = {
            Fa: {
                '@': { xmlns: 'http://www.faktury.gov.pl/schemat/FA' },
                WersjaSchematu: 'FA(2)',
                DataWytworzeniaFa: issueDate + 'T12:00:00',
                SystemInfo: 'invoicerr',
                IdentyfikatorSystemowy: data.rawNumber || (data.number?.toString() ?? 'DRAFT'),
                IdentyfikatorNIP: nip,
                FaWiersz: data.items.map((item, idx) => ({
                    NrWierszaFa: idx + 1,
                    NazwaProdukty: item.name,
                    PKWiU: '00',
                    StawkaPodatku: item.vatRate > 0 ? item.vatRate : 0,
                    KwotaPodatku: Math.round(item.quantity * item.unitPrice * (item.vatRate || 0) / 100 * 100) / 100,
                    CenaJednostkowaNetto: item.unitPrice,
                    Ilosc: item.quantity,
                    WartoscRazem: item.quantity * item.unitPrice,
                })),
                Podsumowanie: {
                    LiczbaWierszyFa: data.items.length,
                    WartoscRazemNetto: total,
                    WartoscRazemPodatek: totalIVA,
                    WartoscRazemBrutto: total + totalIVA,
                },
                Stopka: {
                    OznaczenieFa: data.rawNumber || (data.number?.toString() ?? 'DRAFT'),
                    DataWystawienia: issueDate,
                },
            },
        };

        const builder = await import('xmlbuilder2');
        const doc = builder.create(fa as any, { format: 'fragment' });
        return doc.end({ prettyPrint: true });
    }

    async renderPdfFormat(invoiceId: string, format: '' | 'pdf' | ExportFormat): Promise<Uint8Array> {
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

    async renderFatturaPa(data: InvoiceRenderData): Promise<string> {
        return this.buildFatturaPa(data);
    }

    async renderCfdi(data: InvoiceRenderData): Promise<string> {
        return this.buildCfdi(data);
    }

    async renderFacturae(data: InvoiceRenderData): Promise<string> {
        return this.buildFacturae(data);
    }

    async renderKsaUbl(data: InvoiceRenderData): Promise<string> {
        return this.buildKsaUbl(data);
    }

    async renderFaVat(data: InvoiceRenderData): Promise<string> {
        return this.buildFaVat(data);
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

    async renderNationalXml(data: InvoiceRenderData, countryCode: string): Promise<string> {
        return this.buildNationalXml(data, countryCode);
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
