/**
 * The WIRING for root TODO item 16 ("transfrontalier") — the ONE place the pure `tax-engine.ts`
 * (reprise du repère) meets an actual invoice, at the moment it enters "sending" (`actions/
 * async-send.ts` phase 1, before numbering/enqueue — see `invoice-actions.ts`'s own `preflight`) and
 * again whenever the ACTUAL delivery/export is built (`invoice-actions.ts#deliver`,
 * `documents.service.ts#downloadDocumentFormat`) — deterministic and cheap enough to simply
 * RECOMPUTE rather than persist (see this file's own "never a blind store" section below).
 *
 * ## Domestic vs. cross-border — two entirely different postures
 *
 * DOMESTIC (seller country === buyer country): the user's own chosen `vatRate` per line stays the
 * truth — this function does not call the tax engine at all for these lines. It only CONFIRMS the
 * chosen rate actually belongs to the seller's own known rate table (`vat-rates/registry.ts`) —
 * a rate foreign to the country is refused, named (`ForeignVatRateError`). A country with no known
 * rate catalog is left alone entirely (the same "no known list blocks nobody" permissiveness
 * `vat-rates/registry.ts`'s own header documents) — this is NOT a regression risk for any existing
 * domestic test: every rate any shipped fixture ever chooses for a cataloged country is, by
 * construction, IN that country's own catalog.
 *
 * CROSS-BORDER (seller country !== buyer country): the engine DECIDES. The user's chosen `vatRate`
 * is IGNORED entirely and REPLACED by whatever `tax-engine.ts#determineLineTax` resolves (0% reverse
 * charge, 0% intra-Community supply, 0% export, a US destination-state rate, …). The buyer's ROLE
 * (B2B/B2C) is derived from a REAL, ALREADY-STORED VAT-validation verdict
 * (`PartyIdentifier.validationStatus`, written by `modules/clients/clients.service.ts` — see that
 * file's own header for why validation happens when the VAT number is entered, never at send time),
 * never from the client's own `type` field and never from a value typed into this call — the exact
 * "TrustFlagVatValidator" contract the repère's own engine holds: only `validationStatus === 'VALID'`
 * unlocks B2B. A VAT number that fails ITS OWN SYNTAX CHECK (`vat-syntax.ts`, reprised from the
 * repère) is treated as B2C before VIES is even consulted, with a NAMED warning — never a silent B2B.
 *
 * ## The two hard blocks this product's own history required
 *
 * - **Unresolved buyer country**: this is the exact bug the product paid for once — "B2C pays inconnu
 *   → 0% de TVA silencieux" (see the root TODO item 16 brief, and `vat-unknown-country-undercharge`
 *   in this codebase's own project memory). `buildSemanticInvoice`'s own `guessCountryCode(...) ??
 *   'FR'` fallback is FINE for a document that merely needs SOME jurisdiction to print an address
 *   under — it would be catastrophic here, where an unresolved buyer country would silently look
 *   "domestic" (or silently OSS at the seller's own rate) instead of refusing. This function never
 *   applies that fallback to the BUYER: unresolved buyer country is `UnresolvedBuyerCountryError`,
 *   always, before anything else runs.
 * - **OSS with no destination rate table**: the repère's own `ossDestinationVat` silently fell back to
 *   the SELLER's own rate when the destination profile was unknown (kept, verbatim, in
 *   `tax-engine.ts` — a PURE-ENGINE property `tax-engine.spec.ts` still tests). This wiring never lets
 *   a real send reach that fallback: an EU-union B2C sale of goods to a country with no known
 *   `tax-systems/data/*.json` is `UnsupportedOssDestinationError`, named, before `determineLineTax` is
 *   even called for that line.
 *
 * ## Never a blind store
 *
 * The rewritten `Record<string, unknown>` this function returns is a DEEP CLONE, computed fresh on
 * every call — the draft's own stored `data` (what the user actually typed, `vatRate` included) is
 * NEVER touched. Two sidecar keys carry the engine's verdict to `formats/semantic/build-
 * semantic-invoice.ts` for this call only: `lines[i].__crossBorderCategory` (the resolved BT-151
 * category, since a 0% rate alone cannot distinguish AE/K/G/O — see that file's own header, "VAT
 * category") and `__crossBorderMentions` (document-level, appended to BG-1 via the EXISTING
 * `mentions/invoice-notes.ts#toUblNote` mechanism, never a parallel one). Both are internal, in-memory
 * conventions between this file and `formats/shared-build.ts` — never persisted, never a descriptor
 * field a user could see or edit.
 */
import { guessCountryCode } from '@/utils/country-name-to-iso';

import { defaultVatRateCatalog, VatRateCatalog } from '../vat-rates/registry';
import { TrustFlagVatValidator, VatValidator, taxUnionOf } from './classification';
import { determineTax } from './tax-engine';
import { defaultTaxSystemRegistry, TaxSystemRegistry } from './tax-systems/registry';
import { DocumentLine, LegalMention, PartyTaxProfile, SupplyType } from './types';
import { validateVat } from './vat-syntax';

export class UnresolvedBuyerCountryError extends Error {}
export class UnresolvedSellerTaxSystemError extends Error {}
export class UnsupportedOssDestinationError extends Error {}
export class ForeignVatRateError extends Error {}

/** Every NAMED hard-block this module can throw — callers (`invoice-actions.ts`'s preflight,
 *  `documents.service.ts#downloadDocumentFormat`) turn any of these into a 400: a data problem the
 *  user can fix (an unresolved country, a foreign rate, an uncatalogued OSS destination), never a
 *  500. */
export function isInvoiceTaxBlockError(error: unknown): error is Error {
  return (
    error instanceof UnresolvedBuyerCountryError ||
    error instanceof UnresolvedSellerTaxSystemError ||
    error instanceof UnsupportedOssDestinationError ||
    error instanceof ForeignVatRateError
  );
}

export interface InvoiceTaxPartyInput {
  /** Explicit ISO override, same field/priority as `country-policy.ts#resolveCompanyCountryCode`. */
  countryCode?: string | null;
  /** Free-text fallback, resolved via `guessCountryCode`. */
  country?: string | null;
}

export interface BuyerVatIdentifierInput {
  value: string;
  /** `PartyIdentifier.validationStatus` as stored — `'VALID' | 'INVALID' | 'UNAVAILABLE' | null`. */
  validationStatus: string | null;
}

export interface ResolveInvoiceCrossBorderTaxInput {
  seller: InvoiceTaxPartyInput;
  buyer: InvoiceTaxPartyInput;
  buyerVat?: BuyerVatIdentifierInput;
  /** The instance's raw descriptor `data` — NEVER mutated in place (see this file's own header,
   *  "Never a blind store"). Only `data.lines` (array) is read/rewritten; every other key survives
   *  in the returned clone untouched. */
  data: Record<string, unknown>;
}

export interface ResolveInvoiceCrossBorderTaxResult {
  /** The SAME object reference as the input for a pure-domestic invoice (nothing to rewrite — no
   *  clone needed); a deep clone with `lines[].vatRate` replaced, plus the two sidecar keys this
   *  file's own header documents, for a cross-border one. */
  data: Record<string, unknown>;
  crossBorder: boolean;
  /** Non-fatal, user-visible facts — e.g. "this buyer's VAT number is not syntactically valid, so
   *  this invoice is being treated as a B2C sale". Never blocks a send on its own. */
  warnings: string[];
}

function resolveCountryCode(party: InvoiceTaxPartyInput): string | undefined {
  const explicit = (party.countryCode ?? '').trim().toUpperCase();
  if (explicit) return explicit;
  return guessCountryCode(party.country ?? undefined);
}

function extractSupplyType(value: unknown): SupplyType | undefined {
  return value === 'GOODS' || value === 'SERVICES' ? value : undefined;
}

function parseVatRate(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * DOMESTIC guard: a rate foreign to the seller's own known catalog is refused, named. A seller
 * country with NO known catalog at all is left alone — same permissiveness `vat-rates/registry.ts`
 * already documents for `allowCustomValue` countries.
 */
function assertDomesticRatesKnown(
  sellerCountryCode: string,
  rows: Record<string, unknown>[],
  catalog: VatRateCatalog,
): void {
  if (!catalog.has(sellerCountryCode)) return;
  const known = catalog.ratesFor(sellerCountryCode).map((r) => r.rate);
  rows.forEach((row, index) => {
    const rate = parseVatRate(row.vatRate);
    if (rate === null) return; // compute-totals.ts already warns for this — not this function's job
    if (!known.includes(rate)) {
      throw new ForeignVatRateError(
        `The VAT rate ${rate}% chosen on line ${index + 1} is not one of ${sellerCountryCode}'s known ` +
          `VAT rates (${known.map((r) => `${r}%`).join(', ')}) — refusing to send an invoice with a ` +
          `rate foreign to ${sellerCountryCode}.`,
      );
    }
  });
}

/** Buyer role derivation — "numéro TVA valide → B2B ; sinon B2C" (root TODO item 16's own contract,
 *  the repère's `TrustFlagVatValidator`). A syntactically invalid number never even reaches the
 *  stored VIES verdict: it is B2C immediately, with a named warning. */
function resolveBuyerRole(
  buyerCountryCode: string,
  buyerVat: BuyerVatIdentifierInput | undefined,
  warnings: string[],
): { role: 'B2B' | 'B2C'; validated: boolean } {
  if (!buyerVat?.value?.trim()) return { role: 'B2C', validated: false };

  const syntax = validateVat(buyerVat.value, buyerCountryCode);
  if (!syntax.valid) {
    warnings.push(
      `Buyer VAT number "${buyerVat.value}" is not syntactically valid for ${buyerCountryCode} ` +
        `(${syntax.reason ?? 'failed format check'}) — treating this buyer as B2C, never a silent B2B.`,
    );
    return { role: 'B2C', validated: false };
  }

  if (buyerVat.validationStatus === 'VALID') {
    return { role: 'B2B', validated: true };
  }

  warnings.push(
    `Buyer VAT number "${buyerVat.value}" has not been confirmed valid yet ` +
      `(status: ${buyerVat.validationStatus ?? 'not checked'}) — treating this buyer as B2C until it ` +
      'is verified, never a silent B2B.',
  );
  return { role: 'B2C', validated: false };
}

export function resolveInvoiceCrossBorderTax(
  input: ResolveInvoiceCrossBorderTaxInput,
  deps: {
    vatValidator?: VatValidator;
    taxSystemRegistry?: TaxSystemRegistry;
    vatRateCatalog?: VatRateCatalog;
  } = {},
): ResolveInvoiceCrossBorderTaxResult {
  const vatValidator = deps.vatValidator ?? new TrustFlagVatValidator();
  const taxSystemRegistry = deps.taxSystemRegistry ?? defaultTaxSystemRegistry;
  const vatRateCatalog = deps.vatRateCatalog ?? defaultVatRateCatalog;

  // The SAME fallback-to-FR convention `build-semantic-invoice.ts` already applies to a seller whose
  // own country cannot be resolved (a company-settings data-quality issue this function cannot fix
  // by refusing every send) — see that file's own header on BT-35-BT-40.
  const sellerCC = resolveCountryCode(input.seller) ?? 'FR';
  // NEVER the same fallback for the BUYER — see this file's own header, "unresolved buyer country".
  const buyerCC = resolveCountryCode(input.buyer);
  if (!buyerCC) {
    throw new UnresolvedBuyerCountryError(
      "Cannot resolve this invoice's cross-border VAT treatment: the buyer's country could not be " +
        'determined — refusing to guess a tax treatment (an unresolved buyer country silently ' +
        'charging 0% VAT is a real bug this product already paid for once, never again). Set a ' +
        'valid, resolvable country on this client before sending.',
    );
  }

  const rows = Array.isArray(input.data.lines) ? (input.data.lines as Record<string, unknown>[]) : [];

  if (sellerCC === buyerCC) {
    assertDomesticRatesKnown(sellerCC, rows, vatRateCatalog);
    return { data: input.data, crossBorder: false, warnings: [] };
  }

  const sellerProfile = taxSystemRegistry.resolve(sellerCC);
  if (!sellerProfile) {
    throw new UnresolvedSellerTaxSystemError(
      `Cannot resolve this invoice's cross-border VAT treatment: no tax-system profile is known for ` +
        `the seller's own country (${sellerCC}) — add one to documents/tax/tax-systems/data/ before ` +
        'sending cross-border invoices from this country.',
    );
  }
  const buyerProfile = taxSystemRegistry.resolve(buyerCC);

  const warnings: string[] = [];
  const { role, validated } = resolveBuyerRole(buyerCC, input.buyerVat, warnings);

  const sUnion = taxUnionOf(sellerCC);
  const inSameUnion = !!sUnion && sUnion === taxUnionOf(buyerCC);

  const supplyTypes = rows.map((row, index) => {
    const declared = extractSupplyType(row.supplyType);
    if (declared) return declared;
    warnings.push(
      `Line ${index + 1} has no declared supply type (goods/services) — treated as SERVICES for ` +
        'cross-border VAT purposes; declare it explicitly if this line is actually a delivery of goods.',
    );
    return 'SERVICES' as SupplyType;
  });

  // The OSS guard — BEFORE `determineTax` ever runs, so the engine's own historic
  // seller-rate-fallback (kept verbatim in `tax-engine.ts`, still tested there as a pure-engine
  // property) is structurally unreachable from a real send. Only the branch that actually NEEDS a
  // destination rate table (EU-union B2C goods) is guarded — B2B reverse-charge/intra-Community
  // (always 0%), export/out-of-scope (always 0%), and non-digital B2C services (seller's own rate)
  // never consult a destination table at all, matching `tax-engine.ts`'s own branching exactly.
  if (inSameUnion && role === 'B2C' && !buyerProfile) {
    const anyGoodsLine = supplyTypes.some((s) => s === 'GOODS' || s === 'DIGITAL');
    if (anyGoodsLine) {
      throw new UnsupportedOssDestinationError(
        `This invoice is a cross-border B2C sale of goods from ${sellerCC} to ${buyerCC}, which falls ` +
          `under the EU One-Stop-Shop (OSS) scheme — but no VAT rate table is known for ${buyerCC} yet. ` +
          `Refusing to invent a rate or to silently apply ${sellerCC}'s own rate: source a real ` +
          `${buyerCC} VAT rate table (documents/tax/tax-systems/data/${buyerCC.toLowerCase()}.json) ` +
          'before this invoice can be sent.',
      );
    }
  }

  const buyer: PartyTaxProfile = {
    legalName: 'buyer',
    countryCode: buyerCC,
    role,
    identifiers: input.buyerVat?.value ? [{ scheme: 'VAT', value: input.buyerVat.value, validated }] : [],
  };
  const supplier: PartyTaxProfile = {
    legalName: 'seller',
    countryCode: sellerCC,
    role: 'B2B',
    identifiers: [],
  };

  const lines: DocumentLine[] = rows.map((_row, index) => ({
    id: String(index),
    description: '',
    quantity: 1,
    unitNetMinor: 0,
    supplyType: supplyTypes[index],
  }));

  const result = determineTax(
    { supplier, buyer, lines, issueDate: new Date(), currency: 'EUR' },
    sellerProfile,
    vatValidator,
    buyerProfile,
  );

  const clonedRows = rows.map((row, index) => {
    const { components, mentions: _lineMentions } = result.lines[index].treatment;
    const component = components[0];
    return {
      ...row,
      vatRate: String(component.rate),
      __crossBorderCategory: component.category,
      ...(component.reason ? { __crossBorderExemptionReason: component.reason } : {}),
    };
  });

  const mentions: LegalMention[] = result.mentions;

  return {
    data: { ...input.data, lines: clonedRows, __crossBorderMentions: mentions },
    crossBorder: true,
    warnings,
  };
}
