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
import { BadRequestException } from '@nestjs/common';
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

/**
 * Resolve the buyer's country the same way `resolveTax` does, but HARD-BLOCK when it cannot be
 * determined (empty/unrecognized `client.country{,Code}`). `resolveTax` itself must stay
 * non-throwing — it also backs DRAFT creation/editing, where a country-less client is a legitimate,
 * saveable state (only a non-blocking warning). ISSUANCE is different: `taxUnionOf('')` resolves to
 * null for an unresolved country, which the compliance engine then treats like a non-EU export —
 * i.e. a silent 0% VAT under-charge. Call this ONLY at a point where an invoice is about to become,
 * or remain, ISSUED — initial issuance, a directly-ISSUED document (e.g. a standalone deposit), or
 * re-editing an already-ISSUED invoice whose tax must be recomputed — so that state can never be
 * reached, or kept, with an undetermined VAT treatment.
 */
export function resolveBuyerCountryOrThrow(client: BuyerParty): string {
  const countryCode = client.countryCode ?? guessCountryCode(client.country);
  if (!countryCode) {
    throw new BadRequestException(
      "The client's country is required to determine the VAT treatment. Set the client's country first.",
    );
  }
  return countryCode;
}

/**
 * P2-T01 (A3) — the SUPPLIER's side of the same guard, which did not exist.
 *
 * `resolveBuyerCountryOrThrow` above blocks issuance when the BUYER's country is unresolved; the
 * supplier's was never checked, and `buildComplianceContext` silently fell back to `'FR'` for both.
 * That fallback is not a default, it is a verdict: it puts an operation inside the French mandate.
 *
 * CGI art. 289 bis I makes the attachment of BOTH parties the trigger (Légifrance, consulted
 * 2026-08-28 — see docs/compliance/FR-RATTACHEMENT.md), so a company with no resolved country was
 * being told it must issue through a PDP on the strength of a `??`. The predicate models this as
 * undecidable rather than false precisely so it can block here instead of guessing.
 */
export function resolveSupplierCountryOrThrow(company: SupplierParty): string {
  const countryCode = company.countryCode ?? guessCountryCode(company.country);
  if (!countryCode) {
    throw new BadRequestException(
      "The company's country is required to determine which national e-invoicing rules apply. " +
        "Set the company's country in its settings first.",
    );
  }
  return countryCode;
}

/**
 * C1 — a zero-rated line on a domestic French invoice requires the seller's VAT identifier.
 *
 * EN 16931 **BR-Z-02**: "An Invoice that contains an Invoice line where the Invoiced item VAT
 * category code (BT-151) is 'Zero rated' shall contain the Seller VAT Identifier (BT-31), the
 * Seller tax registration identifier (BT-32) and/or the Seller tax representative VAT identifier
 * (BT-63)."
 *
 * Observed on a full e2e run, not deduced: two French sends were blocked by BR-Z-02 inside an
 * otherwise green suite. The product let a French company exist with NO VAT identifier, let an
 * invoice be issued at 0%, and only said so at SEND — as a Schematron error in a server log, with
 * nothing the user could act on. The suite passed because no spec asserts that a send succeeds.
 *
 * The guard belongs at issuance, next to the country guards above and for the same reason: an
 * invoice that cannot be transmitted must not reach a state where the user believes it was issued.
 *
 * Deliberately NARROW — domestic France, rate 0, no seller VAT id. Exports (category G/K) and
 * reverse charge (AE) also carry a 0 rate and are governed by BR-IC-02 / BR-AE-02, whose conditions
 * differ; blocking on "rate is 0" alone would refuse invoices that are perfectly valid. Widening
 * this to the other zero-rate categories needs their own rules read, not an extrapolation.
 */
export function resolveZeroRatedSellerVatOrThrow(
  company: SupplierParty,
  client: BuyerParty,
  itemVatRates: number[],
): void {
  const supplierCountry = company.countryCode ?? guessCountryCode(company.country);
  const buyerCountry = client.countryCode ?? guessCountryCode(client.country);
  if (supplierCountry !== 'FR' || buyerCountry !== 'FR') return;
  if (!itemVatRates.some((rate) => rate === 0)) return;
  const hasVatId = company.partyIdentifiers?.some((pi) => pi.scheme === 'VAT' && !!pi.value);
  if (hasVatId) return;

  throw new BadRequestException(
    'This invoice has a zero-rated line, which requires the company\'s VAT identifier ' +
      '(EN 16931 rule BR-Z-02). Add the VAT number to the company, or use a non-zero VAT rate. ' +
      'Without it the invoice would be refused at transmission.',
  );
}

/** Map invoice/DTO items to compliance DocumentLines. */
export function toComplianceLines(
  items: Array<{
    order?: number | null;
    description?: string | null;
    quantity: number;
    unitPrice: number;
    type?: string | null;
  }>,
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
      // P2-T01 (A3): no `?? 'FR'`. The fallback was not a default — it was a verdict, placing an
      // operation inside the French mandate on the strength of a missing field. Both throws name
      // the field to fix.
      countryCode: resolveSupplierCountryOrThrow(company),
      role: 'B2B',
      identifiers: company.partyIdentifiers?.map((pi) => ({ scheme: pi.scheme, value: pi.value })) ?? [],
    },
    buyer: {
      legalName: client.name,
      countryCode: resolveBuyerCountryOrThrow(client),
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
    /** User's originally-requested per-line VAT hint (DTO/stored value) — distinct from the
     * `vatRate` param below, which is the ENGINE-RESOLVED rate. Persisted verbatim so issuance
     * can recompute tax FROM the original hint instead of the (possibly stale-0) resolved rate. */
    vatRate?: number | null;
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
    requestedVatRate: item.vatRate ?? null,
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

/** Backend-driven per-invoice action flags (single source of truth for list + detail UIs). */
export interface InvoiceActionFlags {
  edit: boolean;
  issue: boolean;
  correct: boolean;
  cancel: boolean;
  cancelAndReplace: boolean;
  send: boolean;
  convertToInvoice: boolean;
  deposit: boolean;
}

/**
 * Derive the action flags exposed by GET /invoices/:id/available-actions.
 *
 * Shared between the detail endpoint and the GET /invoices list mapping so the
 * invoice list never re-implements action availability client-side.
 *
 * @param invoice        status/kind of the invoice row
 * @param manualActions  MANUAL trigger actions available on the lifecycle runtime
 *                       (from LifecycleRuntime.availableActions() or FlowDescriptor.manualActions);
 *                       `null` when the invoice has no compliance plan yet.
 * @param correctionModel lifecycle correction model (e.g. 'CANCEL_AND_REPLACE'), when a plan exists.
 */
export function deriveInvoiceActions(
  invoice: { status: string; kind?: string | null },
  manualActions: ReadonlySet<string> | null,
  correctionModel?: string,
): InvoiceActionFlags {
  const isDraft = invoice.status === 'DRAFT';
  const isProforma = invoice.kind === 'PROFORMA';
  const isDeposit = invoice.kind === 'DEPOSIT';
  const isPlainInvoice = !invoice.kind || invoice.kind === 'INVOICE';
  const isIssued = invoice.status === 'ISSUED' || invoice.status === 'SENT';
  const canCancel = manualActions?.has('cancel') ?? false;

  return {
    edit: isDraft && !isDeposit,
    issue: isDraft && !isProforma,
    correct: manualActions?.has('correct') ?? false,
    cancel: canCancel,
    cancelAndReplace: canCancel && correctionModel === 'CANCEL_AND_REPLACE',
    send: isIssued,
    convertToInvoice: isProforma && isDraft,
    deposit: isPlainInvoice && isIssued,
  };
}

/**
 * M-2: surfaces a compliance wiring failure to the API/UI. A ComplianceDocument's intended
 * transition (issue/send/audit/markPaid/…) can fail on a NON-BLOCKING integration point (see
 * ComplianceService.recordWiringFailure) — the invoice/payment operation itself still succeeds, so
 * nothing throws, but the document can silently sit at its current status forever with no signal.
 *
 * Derives a human-readable `complianceError` from the events timeline: non-null ONLY when the most
 * RECENT event is a WIRING_FAILED (i.e. the document's intended action failed and nothing has
 * advanced/retried since — an older WIRING_FAILED followed by a later successful event is not an
 * active error anymore).
 */
export function deriveComplianceError(
  events: Array<{ type: string; at: Date | string; detail?: string | null }> | undefined,
): string | null {
  if (!events || events.length === 0) return null;
  const sorted = [...events].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const last = sorted[sorted.length - 1];
  if (last.type !== 'WIRING_FAILED') return null;
  return last.detail ?? 'Compliance wiring failed';
}
