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
  /**
   * What the user DECLARED, and it lands in `InvoiceItem.requestedVatCategory` — exactly the
   * relationship `vatRate` already has with `requestedVatRate`. Absent, the engine derives.
   */
  vatCategory?: string | null;
  /** Why, for the categories that must say why (BR-E-10, BR-O-10). */
  vatExemptionReason?: string | null;
}

/**
 * Resolve invoice tax with the supplier/buyer profile derived from the
 * company and client rows (country, VAT exemption, VAT numbers, B2B/B2C role).
 */
/**
 * C4 — has this identifier actually been verified against the issuing authority?
 *
 * `validationStatus === 'VALID'` and nothing else. `UNAVAILABLE` (we could not ask) and `null`
 * (never asked) both mean "not verified", and neither may unlock reverse charge — that is the
 * under-charge guard the previous hardcoded `false` existed to provide, preserved.
 *
 * What changes is that a number someone DID verify now counts, which is what makes an intra-EU
 * reverse charge reachable from the invoice path at all.
 */
export function isIdentifierValidated(
  party: { partyIdentifiers?: { scheme: string; value: string; validationStatus?: string | null }[] },
  scheme: string,
): boolean {
  const id = party.partyIdentifiers?.find((pi) => pi.scheme === scheme && !!pi.value);
  return id?.validationStatus === 'VALID';
}

export function resolveTax(
  company: SupplierParty,
  client: BuyerParty,
  opts: { currency: string; discountRate: number; items: TaxItemInput[] },
): InvoiceTaxResult {
  return resolveInvoiceTax({
    supplierCountryCode: company.countryCode ?? guessCountryCode(company.country),
    supplierExemptVat: !!company.exemptVat,
    supplierVatNumber: getIdentifier(company, 'VAT'),
    supplierVatValidated: isIdentifierValidated(company, 'VAT'),
    buyerCountryCode: client.countryCode ?? guessCountryCode(client.country),
    buyerRole: client.type === 'INDIVIDUAL' ? 'B2C' : 'B2B',
    buyerVatNumber: getIdentifier(client, 'VAT'),
    buyerVatValidated: isIdentifierValidated(client, 'VAT'),
    currency: opts.currency,
    issueDate: new Date(),
    discountRate: opts.discountRate,
    items: opts.items.map((item) => ({
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      vatRate: item.vatRate,
      supplyType: item.supplyType ?? ((item.type === 'PRODUCT' ? 'GOODS' : 'SERVICES') as SupplyType),
      vatCategory: item.vatCategory,
      vatExemptionReason: item.vatExemptionReason,
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
 * C1 + C3 — the EN 16931 identifier rules for zero-rate VAT categories, enforced at ISSUANCE.
 *
 * Observed on a full e2e run, not deduced: French sends blocked by BR-Z-02 inside an otherwise
 * green suite. The product let a company exist with no VAT identifier, let a 0% invoice be issued,
 * and only said so at SEND — a Schematron error in a server log, nothing the user could act on.
 *
 * C1 keyed this on "rate is 0", domestic France only. That was too narrow AND would have been
 * wrong if widened naively, because the rules read from
 * `schemas/en16931/EN16931-CII-validation-preprocessed.sch` do not agree with each other:
 *
 *   Z   BR-Z-02   zero rated            seller VAT id, tax registration id, or representative
 *   E   BR-E-02   exempt from VAT       same
 *   AE  BR-AE-02  reverse charge        same, PLUS a buyer VAT id or buyer legal registration id
 *   K   BR-IC-02  intra-community       seller VAT id or representative, PLUS a buyer VAT id
 *   G   BR-G-02   export outside the EU seller VAT id or representative (NOT a tax registration id)
 *   O   BR-O-02   not subject to VAT    shall NOT contain a seller VAT identifier
 *
 * O is the one that makes a rate-based guard indefensible: it carries a 0 rate and FORBIDS what the
 * other five require. So the guard keys on the resolved CATEGORY, which the engine already computes.
 *
 * The buyer-side requirements of AE and K are deliberately not enforced here yet — see the note on
 * `CATEGORIES_REQUIRING_SELLER_ID`.
 */
const CATEGORIES_REQUIRING_SELLER_ID = new Set(['Z', 'E', 'AE', 'K', 'G']);

/**
 * Which identifier satisfies each category. G and K accept only a VAT identifier or a tax
 * representative's; Z, E and AE also accept a plain tax registration identifier. The distinction is
 * in the Schematron and is not cosmetic, so it is encoded rather than flattened.
 */
const CATEGORIES_ACCEPTING_TAX_REGISTRATION = new Set(['Z', 'E', 'AE']);

/**
 * The BUYER-side half of the same rules, read from the same Schematron rather than assumed.
 * Only two categories have one, and they do not ask for the same thing:
 *
 *   AE  BR-AE-02  `BuyerTradeParty/SpecifiedTaxRegistration/ID[@schemeID='VA']`
 *                 OR `BuyerTradeParty/SpecifiedLegalOrganization/ID`
 *                 — a VAT identifier OR a legal registration identifier
 *   K   BR-IC-02  `BuyerTradeParty/SpecifiedTaxRegistration/ID[@schemeID='VA']`
 *                 — the VAT identifier, and nothing else will do
 *
 * Z, E and G ask nothing of the buyer. Requiring an identifier there would refuse invoices the
 * standard accepts, which is the mirror of the mistake C1 made on the seller side.
 */
const BUYER_ID_REQUIRED: Record<string, readonly string[]> = {
  AE: ['VAT', 'LEGAL_ID'],
  K: ['VAT'],
};

/**
 * Which categories must carry an exemption reason, and under which rule.
 *
 * Read from the vendored Schematron rather than assumed, like its neighbours. Note what is NOT
 * here: `Z`. A zero-rated supply is TAXED, at 0, and BR-Z-* asks it for no reason — requiring one
 * would refuse documents the standard accepts, which is the mistake C1 made in the other direction.
 * `AE`, `K` and `G` have the same requirement (BR-AE-10, BR-IC-10, BR-G-10) but the engine already
 * supplies their reason from the cross-border branch, so they cannot reach this guard empty.
 */
const CATEGORIES_REQUIRING_REASON: Record<string, string> = { E: 'BR-E-10', O: 'BR-O-10' };

/**
 * BR-E-10 / BR-O-10 — an exempt or out-of-scope line must state why.
 *
 * This guard is the other half of the correction that stopped deriving the VAT category from the
 * rate. A French domestic 0% line used to be called `Z`, which asks for no reason and so always
 * validated; it is now correctly `E`, which asks for one — and the engine has none to give, because
 * `E` covers a dozen different exemptions with a dozen different VATEX codes and choosing one would
 * be inventing a legal basis for the user's business.
 *
 * So the person issuing the invoice supplies it. Blocked at issuance, not at transmission: the
 * document is refused by the Schematron either way, and the difference is whether the user finds
 * out while they can still act on it.
 */
/**
 * EN 16931 BR-16 — an invoice shall have at least one line.
 *
 * The rule that was missing, and it is the one that produced the worst state this product can
 * reach. An invoice with no lines was issuable: it took a number from the gapless series, moved to
 * ISSUED, and then could never be built — the EN 16931 schema refuses it before any XML exists, so
 * no artifact, no transmission, no authority, ever. The document simply stopped, at a status that
 * a user cannot tell apart from "waiting".
 *
 * Checked at issuance beside the country, BR-Z-02 and BR-E-10 guards, for the reason their own
 * comment gives: an invoice that cannot be transmitted must not reach a state where the user
 * believes it was issued. A draft with no lines stays perfectly legal — that is a document being
 * written.
 */
export function resolveInvoiceLinesOrThrow(items: unknown[] | undefined | null): void {
  if (items && items.length > 0) return;
  throw new BadRequestException(
    'This invoice has no lines. An invoice must have at least one line (EN 16931 rule BR-16). ' +
      'Add a line before issuing it — an invoice issued without one takes a number from the legal ' +
      'series and can never be transmitted.',
  );
}

export function resolveExemptionReasonOrThrow(
  itemVatCategories: string[],
  itemVatExemptionReasons: (string | undefined)[],
): void {
  const offendingIndex = itemVatCategories.findIndex(
    (c, i) => CATEGORIES_REQUIRING_REASON[c] && !itemVatExemptionReasons[i]?.trim(),
  );
  if (offendingIndex === -1) return;

  const category = itemVatCategories[offendingIndex];
  const rule = CATEGORIES_REQUIRING_REASON[category];
  const what = category === 'E' ? 'exempt from VAT' : 'outside the scope of VAT';
  throw new BadRequestException(
    `Line ${offendingIndex + 1} resolves to VAT category "${category}" (${what}), which must state ` +
      `the reason for it (EN 16931 rule ${rule}). Add an exemption reason to that line — the legal ` +
      'basis, or its VATEX code. Without it the invoice would be refused at transmission.',
  );
}

export function resolveZeroRatedSellerVatOrThrow(
  company: SupplierParty,
  client: BuyerParty,
  itemVatCategories: string[],
): void {
  const offending = itemVatCategories.find((c) => CATEGORIES_REQUIRING_SELLER_ID.has(c));
  if (!offending) return;

  // Buyer side first: BR-AE-02 and BR-IC-02 demand it IN ADDITION to the seller's, so an invoice
  // can satisfy the seller half and still be refused. Checking it second would let a user fix the
  // company, retry, and hit a different wall — two round trips for one document.
  const requiredBuyerSchemes = BUYER_ID_REQUIRED[offending];
  if (requiredBuyerSchemes) {
    const buyerIds = client.partyIdentifiers ?? [];
    const satisfied = requiredBuyerSchemes.some((scheme) =>
      buyerIds.some((pi) => pi.scheme === scheme && !!pi.value),
    );
    if (!satisfied) {
      const rule = offending === 'AE' ? 'BR-AE-02' : 'BR-IC-02';
      const wanted =
        offending === 'AE' ? 'VAT identifier or legal registration identifier' : 'VAT identifier';
      throw new BadRequestException(
        `This invoice has a line in VAT category "${offending}", which requires the client's ` +
          `${wanted} (EN 16931 rule ${rule}). Add it to the client, or use a standard-rate VAT ` +
          'treatment. Without it the invoice would be refused at transmission.',
      );
    }
  }

  const ids = company.partyIdentifiers ?? [];
  const hasVat = ids.some((pi) => pi.scheme === 'VAT' && !!pi.value);
  if (hasVat) return;
  // LEGAL_ID stands in for the "seller tax registration identifier" (BT-32) the three lenient
  // categories accept. Not accepted for G/K, per BR-G-02 and BR-IC-02.
  if (CATEGORIES_ACCEPTING_TAX_REGISTRATION.has(offending)) {
    if (ids.some((pi) => pi.scheme === 'LEGAL_ID' && !!pi.value)) return;
  }

  const rule = { Z: 'BR-Z-02', E: 'BR-E-02', AE: 'BR-AE-02', K: 'BR-IC-02', G: 'BR-G-02' }[offending];
  throw new BadRequestException(
    `This invoice has a line in VAT category "${offending}", which requires the company's VAT ` +
      `identifier (EN 16931 rule ${rule}). Add the VAT number to the company, or use a standard-rate ` +
      'VAT treatment. Without it the invoice would be refused at transmission.',
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
    /** Same relationship, one level up: the DECLARED category, against the RESOLVED one passed as
     *  the `vatCategory` parameter below. Both are stored, in different columns. */
    vatCategory?: string | null;
    vatExemptionReason?: string | null;
  },
  currency: string,
  vatRate: number,
  /** BT-151 as the ENGINE resolved it. Stored beside the rate because the rate does not determine
   *  it — six categories share rate 0 and ask contradictory things of the document. Optional only
   *  so callers that have no plan (deposits derived from a stored rate) still compile; those write
   *  null and the renderer refuses them rather than guessing. */
  vatCategory?: string | null,
  vatExemptionReason?: string | null,
) {
  return {
    description: item.description,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    unitPriceMinor: toMinor(item.unitPrice, currency),
    vatRate,
    vatCategory: vatCategory ?? null,
    vatExemptionReason: vatExemptionReason ?? null,
    requestedVatRate: item.vatRate ?? null,
    // The DECLARATION, kept beside the RESOLUTION for the same reason `requestedVatRate` is kept
    // beside `vatRate`: issuance recomputes from the hint, so a hint that is not stored is a hint
    // that silently disappears on the second pass.
    requestedVatCategory: item.vatCategory ?? null,
    requestedVatExemptionReason: item.vatExemptionReason ?? null,
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
 * @param immutableAfter  when the document freezes — 'ISSUE', 'CLEARANCE' or 'NEVER'. Without it
 *                        the flag falls back to "drafts only", which is what it used to hardcode.
 */
export function deriveInvoiceActions(
  invoice: { status: string; kind?: string | null },
  manualActions: ReadonlySet<string> | null,
  correctionModel?: string,
  immutableAfter?: string,
): InvoiceActionFlags {
  const isDraft = invoice.status === 'DRAFT';
  const isProforma = invoice.kind === 'PROFORMA';
  const isDeposit = invoice.kind === 'DEPOSIT';
  const isPlainInvoice = !invoice.kind || invoice.kind === 'INVOICE';
  const isIssued = invoice.status === 'ISSUED' || invoice.status === 'SENT';
  const canCancel = manualActions?.has('cancel') ?? false;

  // A country whose profile says the document NEVER freezes keeps it editable after issuance —
  // the United States and the fallback profile. `editInvoice` has always allowed this
  // (invoices.service.ts:1007 falls through for `immutableAfter === 'NEVER'`); the flag that drives
  // the button did not, so the answer the country profile gave never reached the screen. The
  // showcase caught it: a US invoice is frozen on the screen and editable through the API.
  //
  // Narrower than the API on purpose: the API permits any non-draft, which would offer "edit" on a
  // CANCELLED document. Stricter on the screen than in the service is the safe direction for a
  // mismatch; the reverse is what produced this one.
  const staysEditable = immutableAfter === 'NEVER' && isIssued;

  return {
    edit: !isDeposit && (isDraft || staysEditable),
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
  const fallback = FAILURE_EVENT_FALLBACK[last.type];
  if (!fallback) return null;
  return last.detail ?? fallback;
}

/**
 * The events that mean "this document did not get where it was going", and what to say when the
 * event carries no detail of its own.
 *
 * `WIRING_FAILED` used to be the only one here, which is why a document could be blocked and the
 * screen show nothing at all: `VALIDATION_BLOCKED` is recorded precisely so a user learns their
 * invoice was refused before any transmission, and it was recorded into silence. `BUILD_FAILED` is
 * newer and worse — the artifact could not even be produced.
 *
 * Only the LAST event is consulted, deliberately: a failure followed by a successful retry is not a
 * failure any more, and showing the old one would be its own kind of lie.
 */
const FAILURE_EVENT_FALLBACK: Record<string, string> = {
  WIRING_FAILED: 'Compliance wiring failed',
  VALIDATION_BLOCKED: 'The invoice failed format validation and was not transmitted',
  BUILD_FAILED: 'The compliant document could not be produced, so nothing was transmitted',
};
