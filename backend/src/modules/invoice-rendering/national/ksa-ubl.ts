/**
 * KSA UBL 2.1 + ZATCA FATOORA (SA) builder: TLV QR, invoice hash, PIH chain.
 *
 * Extracted verbatim from InvoiceRenderingService (behaviour-preserving).
 */
import { createHash } from 'crypto';
import { getIdentifier } from '@/utils/entity-identifiers';
import type { InvoiceRenderData } from '../render-data';

// ---------------------------------------------------------------------------
// §51 — ZATCA FATOORA invoice hash + PIH chain (offline-computable)
// ---------------------------------------------------------------------------

/**
 * Compute the ZATCA invoice hash: SHA-256 of the canonical XML bytes, base64-encoded.
 *
 * Per ZATCA FATOORA Phase 1 spec, the hash is computed over the UTF-8 serialized
 * invoice XML.  The result is:
 *   - Stored as the PIH (Previous Invoice Hash) in the *next* invoice.
 *   - Provided to ZATCA's clearance API as the invoice hash during submission.
 *
 * This is fully offline-computable; ZATCA clearance (tag-6 stamp) is live-deferred.
 */
export function computeKsaInvoiceHash(xml: string): string {
  return createHash('sha256').update(xml, 'utf-8').digest('base64');
}

/**
 * ZATCA-specified initialization value for the PIH (Previous Invoice Hash) field of the
 * *first* invoice in a sequence.
 *
 * Per ZATCA FATOORA Business Rules BR-KSA-26: the PIH of the first invoice is the
 * SHA-256 hash of the string "00000000000000000000000000000000000000000000000000000000000000000"
 * (64 ASCII zeros), encoded as base64.
 *
 * This constant is deterministic and allows unit-tests to verify the chain independently.
 */
export const ZATCA_PIH_INIT: string = computeKsaInvoiceHash(
  '0000000000000000000000000000000000000000000000000000000000000000',
);

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

/**
 * KSA UBL 2.1 + TLV QR (SA/ZATCA FATOORA).
 *
 * §51 — PIH chain (offline-computable):
 *   options.pih — the hash of the previous invoice in the sequence.
 *                 Use ZATCA_PIH_INIT for the first invoice.
 *                 Defaults to ZATCA_PIH_INIT when omitted.
 *
 * The returned XML embeds PIH in cac:AdditionalDocumentReference[cbc:ID=PIH].
 * Call computeKsaInvoiceHash(xml) on the result to obtain the hash for
 * the next invoice in the chain.
 *
 * NOTE: ZATCA clearance (digital stamp / tag-6) is live-deferred and NOT
 * included here — this covers the offline Phase-1 hash + PIH fields only.
 */
export async function buildKsaUbl(data: InvoiceRenderData, options?: { pih?: string }): Promise<string> {
        const pih = options?.pih ?? ZATCA_PIH_INIT;
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
                // §51 — ZATCA AdditionalDocumentReferences:
                //   PIH: Previous Invoice Hash (offline-computable hash chain).
                //   QR:  TLV QR (5 pre-clearance fields).
                // NOTE: IH (Invoice Hash) is computed on the final XML and passed to ZATCA
                // during clearance; it is NOT re-embedded here (Phase-1 reporting mode).
                'cac:AdditionalDocumentReference': [
                    {
                        'cbc:ID': 'PIH',
                        'cac:Attachment': {
                            'cbc:EmbeddedDocumentBinaryObject': pih,
                            'cbc:EmbeddedDocumentBinaryObject@mimeCode': 'text/plain',
                        },
                    },
                    {
                        'cbc:ID': 'QR',
                        'cac:Attachment': {
                            'cbc:EmbeddedDocumentBinaryObject': qrTlv,
                            'cbc:EmbeddedDocumentBinaryObject@mimeCode': 'text/plain',
                        },
                    },
                ],
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
