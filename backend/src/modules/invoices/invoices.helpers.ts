/**
 * Shared helpers for InvoicesService's create/edit/correct flows.
 *
 * The five giant functions (createInvoice, editInvoice, correctInvoice,
 * createDepositInvoice, createFinalInvoice) — plus the proforma and
 * cancel-and-replace flows — each repeated the same blocks: party-aware tax
 * resolution, compliance TransactionContext construction, and the Prisma
 * item-create data mapping. These helpers are extractions of those blocks,
 * value-for-value identical to the inline originals.
 */
import type { TransactionContext } from '@/compliance/canonical/canonical-document';
import { resolveInvoiceTax, InvoiceTaxResult } from '@/compliance/integration/invoice-tax';
import type { SupplyType } from '@/compliance/types';
import { guessCountryCode } from '@/utils/country-name-to-iso';
import { getIdentifier } from '@/utils/entity-identifiers';
import { toMinor } from '@/utils/financial';

/** Structural view of the Company row as used by these helpers. */
export interface SupplierParty {
    id: string;
    name: string;
    countryCode?: string | null;
    country?: string | null;
    exemptVat?: boolean | null;
    partyIdentifiers?: { scheme: string; value: string }[];
}

/** Structural view of the Client row as used by these helpers. */
export interface BuyerParty {
    name: string;
    countryCode?: string | null;
    country?: string | null;
    /** ClientType — 'INDIVIDUAL' maps to B2C, anything else to B2B. */
    type?: string | null;
    partyIdentifiers?: { scheme: string; value: string }[];
}

interface TaxItemInput {
    quantity: number;
    unitPrice: number;
    vatRate?: number | null;
    /** ItemType — 'PRODUCT' maps to GOODS, anything else to SERVICES. */
    type?: string | null;
    /** Pre-resolved supply type wins over the ItemType mapping. */
    supplyType?: SupplyType;
}

/**
 * Resolve invoice tax with the supplier/buyer profile derived from the
 * company and client rows (country, VAT exemption, VAT numbers, B2B/B2C role).
 */
export function resolveTax(
    company: SupplierParty,
    client: BuyerParty,
    opts: { currency: string; discountRate: number; items: TaxItemInput[] },
): InvoiceTaxResult {
    return resolveInvoiceTax({
        supplierCountryCode: company.countryCode ?? guessCountryCode(company.country),
        supplierExemptVat: !!company.exemptVat,
        supplierVatNumber: getIdentifier(company, 'VAT'),
        buyerCountryCode: client.countryCode ?? guessCountryCode(client.country),
        buyerRole: client.type === 'INDIVIDUAL' ? 'B2C' : 'B2B',
        buyerVatNumber: getIdentifier(client, 'VAT'),
        currency: opts.currency,
        issueDate: new Date(),
        discountRate: opts.discountRate,
        items: opts.items.map((item) => ({
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            vatRate: item.vatRate,
            supplyType: item.supplyType ?? ((item.type === 'PRODUCT' ? 'GOODS' : 'SERVICES') as SupplyType),
        })),
    });
}

/** Map invoice/DTO items to compliance DocumentLines. */
export function toComplianceLines(
    items: Array<{ order?: number | null; description?: string | null; quantity: number; unitPrice: number; type?: string | null }>,
    currency: string,
): TransactionContext['lines'] {
    return items.map((item) => ({
        id: `item-${item.order ?? 0}`,
        description: item.description ?? '',
        quantity: item.quantity,
        unitNetMinor: toMinor(item.unitPrice, currency),
        supplyType: (item.type === 'PRODUCT' ? 'GOODS' : 'SERVICES') as SupplyType,
    }));
}

/**
 * Build the compliance TransactionContext for a document: supplier/buyer
 * profiles derived from the company/client rows, plus the per-call specifics.
 */
export function buildComplianceContext(
    company: SupplierParty,
    client: BuyerParty,
    opts: { lines: TransactionContext['lines']; issueDate: Date; currency: string; externalRef: string },
): TransactionContext {
    return {
        supplier: {
            legalName: company.name,
            countryCode: company.countryCode ?? guessCountryCode(company.country) ?? 'FR',
            role: 'B2B',
            identifiers: company.partyIdentifiers?.map((pi) => ({ scheme: pi.scheme, value: pi.value })) ?? [],
        },
        buyer: {
            legalName: client.name,
            countryCode: client.countryCode ?? guessCountryCode(client.country) ?? 'FR',
            role: client.type === 'INDIVIDUAL' ? 'B2C' : 'B2B',
            identifiers: client.partyIdentifiers?.map((pi) => ({ scheme: pi.scheme, value: pi.value })) ?? [],
        },
        lines: opts.lines,
        issueDate: opts.issueDate,
        currency: opts.currency,
        supplierCompanyId: company.id,
        externalRef: opts.externalRef,
    };
}

/**
 * Prisma create/update data for one invoice item — the monetary core shared by
 * every flow (minor-unit conversions, discount/charge fields, C62 default).
 * Callers add their own flow-specific fields (`name`, `quoteItemId`, `order`
 * overrides) on top of the returned object.
 */
export function invoiceItemData<TType>(
    item: {
        description?: string | null;
        quantity: number;
        unitPrice: number;
        type: TType;
        order?: number | null;
        discountRate?: number | null;
        discountAmount?: number | null;
        chargeAmount?: number | null;
        chargeDescription?: string | null;
        unitOfMeasure?: string | null;
    },
    currency: string,
    vatRate: number,
) {
    return {
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        unitPriceMinor: toMinor(item.unitPrice, currency),
        vatRate,
        type: item.type,
        order: item.order || 0,
        discountRate: item.discountRate ?? 0,
        discountAmount: item.discountAmount ?? null,
        discountAmountMinor: item.discountAmount ? toMinor(item.discountAmount, currency) : null,
        chargeAmount: item.chargeAmount ?? null,
        chargeAmountMinor: item.chargeAmount ? toMinor(item.chargeAmount, currency) : null,
        chargeDescription: item.chargeDescription ?? null,
        unitOfMeasure: item.unitOfMeasure ?? 'C62',
    };
}
