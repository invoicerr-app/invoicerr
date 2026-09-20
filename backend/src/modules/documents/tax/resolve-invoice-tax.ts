/**
 * The WIRING for cross-border tax — the ONE place the pure `tax-engine.ts`
 * (carried over from the reference) meets an actual invoice, at the moment it enters "sending" (`actions/
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
 * ONE exception (2026-09-13, `applyDomesticTaxScheme` below): a seller under a non-STANDARD
 * `taxScheme` (`FRANCHISE_BASE` today — `Company.exemptVat`, see `load-and-resolve.ts`'s own mapping
 * comment) DOES reach the engine even though domestic, because a small-business VAT exemption is
 * exactly the kind of fact the user's own typed `vatRate` cannot express — nothing on the invoice
 * form lets someone pick "0%, exempt, art. 293 B"; the whole point of the company-level checkbox is
 * that they never have to. This was the THIRD of the three independent breaks that let an exempt
 * company be charged full VAT regardless of the checkbox: `taxScheme` was declared but never
 * assigned, and even once assigned, THIS function's own domestic fast path never looked at it. Every
 * OTHER domestic invoice — no scheme, or `STANDARD` — is completely unaffected by this exception,
 * including the SAME OBJECT REFERENCE guarantee on `ResolveInvoiceCrossBorderTaxResult.data` below.
 *
 * CROSS-BORDER (seller country !== buyer country): the engine DECIDES. The user's chosen `vatRate`
 * is REPLACED by whatever `tax-engine.ts#determineLineTax` resolves (0% reverse charge, 0%
 * intra-Community supply, 0% export, a US destination-state rate, …) on every branch where the place
 * of taxation is NOT the seller's own country. On the two branches where it IS (a non-digital B2C
 * service sold across the same union — `determineLineTax`'s own "default to taxing where the supplier
 * is" case; and, since 2026-09-21, an intra-Community distance sale of goods by a seller that declared
 * the ORIGIN regime — both `domesticVat` under the hood), the user's chosen rate is resolved against the SELLER's own
 * catalog (`vat-rates/registry.ts#resolveVatRatePercentage`, same lookup `assertDomesticRatesKnown`
 * above already uses) and threaded through as `DocumentLine.taxRateHint` — read, never ignored,
 * because a reduced/exempt rate is a fact about the seller's OWN law that a bare `sys.standardRate`
 * fallback would otherwise silently overwrite (see `resolveInvoiceCrossBorderTax`'s own
 * `taxRateHints`). Unresolvable against that catalog degrades to the SAME `sys.standardRate` fallback,
 * with a named warning rather than a silent one. The buyer's ROLE
 * (B2B/B2C) is derived from a REAL, ALREADY-STORED VAT-validation verdict
 * (`PartyIdentifier.validationStatus`, written by `modules/clients/clients.service.ts` — see that
 * file's own header for why validation happens when the VAT number is entered, never at send time),
 * never from the client's own `type` field and never from a value typed into this call — the exact
 * "TrustFlagVatValidator" contract the reference's own engine holds: only `validationStatus === 'VALID'`
 * unlocks B2B. A VAT number that fails ITS OWN SYNTAX CHECK (`vat-syntax.ts`, carried over from the
 * reference) is treated as B2C before VIES is even consulted, with a NAMED warning — never a silent B2B.
 *
 * ## The four hard blocks this product's own history required
 *
 * - **Unresolved buyer country**: this is the exact bug the product paid for once — "B2C unknown
 *   country -> silent 0% VAT" (see `vat-unknown-country-undercharge`
 *   in this codebase's own project memory). `buildSemanticInvoice`'s own `guessCountryCode(...) ??
 *   'FR'` fallback is FINE for a document that merely needs SOME jurisdiction to print an address
 *   under — it would be catastrophic here, where an unresolved buyer country would silently look
 *   "domestic" (or silently OSS at the seller's own rate) instead of refusing. This function never
 *   applies that fallback to the BUYER: unresolved buyer country is `UnresolvedBuyerCountryError`,
 *   always, before anything else runs.
 * - **Unresolved SELLER country** (USER DECISION, 2026-09-01, symmetric to the buyer block above —
 *   "the seller's own unresolved country used to silently fall back to 'FR'", now RESOLVED):
 *   this function used to fall back to `'FR'` for an unresolvable seller country — the SAME class of
 *   silent-wrong-tax bug the buyer block above already exists to prevent, just on the other party. A
 *   company whose own country cannot be resolved (never configured, or a free-text value
 *   `guessCountryCode` cannot map) would silently be treated as FRENCH: a genuinely foreign seller
 *   could see its cross-border sale misjudged as domestic (or judged cross-border against the WRONG
 *   home jurisdiction's own rate catalog/mentions), never refused. `resolveCountryCode(input.seller)`
 *   with no fallback, `UnresolvedSellerCountryError` when it comes back empty — same posture as the
 *   buyer's own block, always before anything else runs. `formats/semantic/build-semantic-invoice.ts`
 *   holds the exact same block independently (see that file's own header) for the one path that can
 *   reach it without going through this function first.
 * - **OSS with no destination rate table**: the reference's own `ossDestinationVat` silently fell back to
 *   the SELLER's own rate when the destination profile was unknown (kept, verbatim, in
 *   `tax-engine.ts` — a PURE-ENGINE property `tax-engine.spec.ts` still tests). This wiring never lets
 *   a real send reach that fallback: an EU-union B2C sale of goods to a country with no known
 *   `tax-systems/data/*.json` is `UnsupportedOssDestinationError`, named, before `determineLineTax` is
 *   even called for that line. Since 2026-09-21 this block is asked ONLY of a seller that actually
 *   taxes at destination (see the next block): a seller under the art. 59c threshold charges its OWN
 *   country's rate and needs no destination rate table at all, so blocking it over a missing one would
 *   be refusing an invoice this module can answer perfectly well.
 * - **Undeclared intra-Community distance-sales regime** (2026-09-21): a cross-border B2C sale of
 *   GOODS (or of the telecommunications/broadcasting/electronic services art. 58 treats the same way)
 *   inside the EU is taxed EITHER in the buyer's member state (Directive 2006/112/EC art. 33(a)) or in
 *   the seller's own (art. 32, once art. 59c(1) disapplies art. 33(a) below the EUR 10 000
 *   per-seller, per-calendar-year, all-member-states-combined threshold). This module used to apply
 *   the destination rule to everyone from the first euro — silently, `warnings` empty, a reporting
 *   flag the seller may never have asked for. Which rule applies depends on a running total this
 *   instance cannot see and on an option only the seller can exercise (art. 59c(3)), so the seller
 *   DECLARES it once in Settings (`Company.distanceSalesRegime`) and an undeclared seller is
 *   `UndeclaredDistanceSalesRegimeError`, named, before `determineTax` runs — the same posture
 *   `Company.invoiceTransportId` already holds ("No default, deliberately: a company that has never
 *   chosen one gets a clear, loud block when it tries to send an invoice"). Only the branch that
 *   actually turns on it is gated: domestic invoices, every B2B branch, exports, and B2C SERVICES
 *   (taxed where the supplier is regardless) are completely unaffected.
 *
 * ## Never a blind store
 *
 * The rewritten `Record<string, unknown>` this function returns is a DEEP CLONE, computed fresh on
 * every call — the draft's own stored `data` (what the user actually typed, `vatRate` included) is
 * NEVER touched. Two sidecar keys carry the engine's verdict to `formats/shared-build.ts`:
 * `lines[i].__crossBorderCategory` (the resolved BT-151 category, since a 0% rate alone cannot
 * distinguish AE/K/G/O — see `formats/semantic/build-semantic-invoice.ts`'s own header, "VAT
 * category") and `__crossBorderMentions` (document-level, appended to BG-1 via the EXISTING
 * `mentions/invoice-notes.ts#toUblNote` mechanism, never a parallel one — and, since 2026-09-13, ALSO
 * read by `rendering/render-instance-pdf.ts#legalMentionsFor`, through the SAME exported
 * `shared-build.ts#extractCrossBorderMentions`, so the PRINTED PDF's own footer carries the same
 * mention the downloaded XML does). Both are internal, in-memory conventions between this file and
 * its readers — never a descriptor field a user could see or edit. Written for a CROSS-BORDER
 * invoice OR a DOMESTIC invoice from a seller under a non-STANDARD tax scheme
 * (`applyDomesticTaxScheme` below, added 2026-09-13) — the "cross-border" name predates the second
 * case and stays as-is rather than being renamed across every file that reads it (`shared-build.ts`,
 * `field-kinds.ts`, `render-instance-pdf.ts`) for what all three already document as the SAME sidecar
 * convention, never a parallel one.
 */
import { guessCountryCode } from '@/utils/country-name-to-iso';

import { defaultVatRateCatalog, resolveVatRatePercentage, VatRateCatalog } from '../vat-rates/registry';
import { TrustFlagVatValidator, VatValidator, taxUnionOf } from './classification';
import { determineTax, DocumentTaxResult } from './tax-engine';
import { defaultTaxSystemRegistry, TaxSystemRegistry } from './tax-systems/registry';
import {
  DistanceSalesRegime,
  DocumentLine,
  LegalMention,
  PartyTaxProfile,
  SupplyType,
  TaxScheme,
} from './types';
import { validateVat } from './vat-syntax';

export class UnresolvedBuyerCountryError extends Error {}
export class UnresolvedSellerCountryError extends Error {}
export class UnresolvedSellerTaxSystemError extends Error {}
export class UnsupportedOssDestinationError extends Error {}
export class UndeclaredDistanceSalesRegimeError extends Error {}
export class ForeignVatRateError extends Error {}

/** Every NAMED hard-block this module can throw — callers (`invoice-actions.ts`'s preflight,
 *  `documents.service.ts#downloadDocumentFormat`) turn any of these into a 400: a data problem the
 *  user can fix (an unresolved country, a foreign rate, an uncatalogued OSS destination), never a
 *  500. */
export function isInvoiceTaxBlockError(error: unknown): error is Error {
  return (
    error instanceof UnresolvedBuyerCountryError ||
    error instanceof UnresolvedSellerCountryError ||
    error instanceof UnresolvedSellerTaxSystemError ||
    error instanceof UnsupportedOssDestinationError ||
    error instanceof UndeclaredDistanceSalesRegimeError ||
    error instanceof ForeignVatRateError
  );
}

/**
 * Narrows a STORED `Company.distanceSalesRegime` (a plain nullable column — see its own
 * `schema.prisma` comment for why it is not a Prisma enum) to the engine's own union. Anything that is
 * not exactly one of the two declared values — `null` for the many companies that predate the column,
 * an empty string the settings form cleared, a stale value from some future rename — comes back
 * `undefined`, i.e. "not declared", which is the NAMED BLOCK below and never a silent DESTINATION.
 * Exported and shared by BOTH Prisma-aware call sites (`load-and-resolve.ts` and
 * `documents.service.ts#downloadDocumentFormat`, which reads its own company row — see
 * `load-and-resolve.ts`'s own header on that hand-kept duplication) so the two can never drift into
 * disagreeing about what a stored value means.
 */
export function parseDistanceSalesRegime(value: unknown): DistanceSalesRegime | undefined {
  return value === 'ORIGIN' || value === 'DESTINATION' ? value : undefined;
}

export interface InvoiceTaxPartyInput {
  /** Explicit ISO override, same field/priority as `country-policy.ts#resolveCompanyCountryCode`. */
  countryCode?: string | null;
  /** Free-text fallback, resolved via `guessCountryCode`. */
  country?: string | null;
  /** SELLER side only in practice — nothing sets this on the `buyer` input today (see this brief's
   *  own out-of-scope note on the buyer side of an exemption). `'FRANCHISE_BASE'` is
   *  `Company.exemptVat === true` (see `load-and-resolve.ts`'s own mapping comment for why never
   *  `'EXEMPT'`); `undefined`/`'STANDARD'` is ordinary VAT, the entire pre-existing behaviour of this
   *  module. See `applyDomesticTaxScheme` below for the one place a non-STANDARD value changes
   *  anything for a DOMESTIC invoice, and the cross-border `supplier` construction further down for
   *  why it is threaded there too even though it is currently inert on that branch.
   */
  taxScheme?: TaxScheme;
  /** SELLER side only — `Company.distanceSalesRegime`, the seller's own declaration of where its
   *  intra-Community distance sales to consumers are taxed (`types.ts#DistanceSalesRegime` quotes
   *  Directive 2006/112/EC arts. 32, 33(a) and 59c in full). `undefined` is "never declared", which is
   *  a NAMED HARD BLOCK on the one branch that needs it — see
   *  `UndeclaredDistanceSalesRegimeError` and this file's own header. Nothing sets it on the `buyer`
   *  input: the regime is a fact about the SELLER, never about who it sells to. */
  distanceSalesRegime?: DistanceSalesRegime;
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
  /** Non-fatal facts about how this invoice was resolved — e.g. "this buyer's VAT number is not
   *  syntactically valid, so this invoice is being treated as a B2C sale", or "only the destination's
   *  STANDARD rate could be applied". Never blocks a send on its own.
   *
   *  NOT USER-VISIBLE TODAY, and this comment used to claim otherwise. Every production caller reads
   *  `.data` and drops this array on the floor: `invoice-actions.ts#runInvoiceCrossBorderTaxPreflight`
   *  and its `deliver()` sibling both return `(...).data`, and
   *  `documents.service.ts#downloadDocumentFormat` does the same. So a warning added here is a
   *  warning a DEVELOPER (and any spec) can read, not one the seller ever sees. Surfacing them means
   *  choosing where a non-fatal tax caveat belongs on a document — a product decision, and a separate
   *  piece of work from computing them correctly; until it is made, treat this field as "recorded,
   *  not yet delivered" rather than as a notice anyone has been given. */
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

/**
 * The invoice's OWN `issueDate` (`descriptors/invoice.descriptor.ts`'s required 'date' field,
 * `data.issueDate`) — never the server clock. `tax-engine.ts` does not read `TransactionContext
 * .issueDate` from any branch today (grepped), so this has no observable effect yet — but
 * `determineTax` still REQUIRES a `Date`, and passing `new Date()` there was silently building a
 * `TransactionContext` describing "the moment this function happened to run", never the invoice's own
 * legal date, exactly the class of bug `channel-policy/mandate.ts`'s own header holds a mandate
 * decision to (a worker retrying `deliver()` minutes or hours later must compute the EXACT SAME tax
 * treatment as the original preflight did — a clock-keyed value cannot promise that). A missing or
 * unparseable `issueDate` falls back to `new Date()` rather than a hard block: since nothing reads it
 * yet, refusing a send over an unreadable placeholder value would be inventing a new failure mode this
 * fix's own scope never asked for — promote this to a named hard block (matching the three this file's
 * header already documents) the day a real branch starts keying behaviour on it.
 */
export function extractIssueDate(data: Record<string, unknown>): Date {
  const raw = data.issueDate;
  if (typeof raw === 'string' && raw.trim()) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

/**
 * The invoice's OWN `currency` (`data.currency`, the same top-level field `compute-totals.ts` and
 * `record-payment` already read) — never a hardcoded `'EUR'`. Same "currently inert, still a real
 * landmine" reasoning as `extractIssueDate` above: no branch of `tax-engine.ts` reads
 * `TransactionContext.currency` today, but a PLN or USD invoice was silently being described to the
 * engine as EUR regardless, which would be flatly wrong the day any currency-sensitive branch (a
 * threshold expressed in the seller's own currency, say) is added. Falls back to `'EUR'` for a
 * missing/blank value — the SAME default `compute-totals.ts`'s own header documents ("Missing or not
 * found → currency: null … amounts calculated with default 2 decimals anyway"), not a new posture
 * invented here.
 */
export function extractCurrency(data: Record<string, unknown>): string {
  const raw = data.currency;
  return typeof raw === 'string' && raw.trim() ? raw.trim().toUpperCase() : 'EUR';
}

/**
 * DOMESTIC guard: a rate foreign to the seller's own known catalog is refused, named. A seller
 * country with NO known catalog at all is left alone — same permissiveness `vat-rates/registry.ts`
 * already documents for `allowCustomValue` countries.
 *
 * `row.vatRate` is resolved through `resolveVatRatePercentage` — the catalog `id`
 * `vat-rates/registry.ts#vatRateFieldOptions` now emits as the canonical field value (e.g.
 * "it-esente"), OR the bare percentage string a document saved before that change still carries (e.g.
 * "20") — never a bare `Number(row.vatRate)` on its own, which would silently treat every id-based
 * value as "not a number, not my job" and let this guard go blind on exactly the two-same-percentage
 * regimes (Italy's `it-esente`/`it-non-imponibile`) an `id` exists to tell apart in the first place.
 */
function assertDomesticRatesKnown(
  sellerCountryCode: string,
  rows: Record<string, unknown>[],
  catalog: VatRateCatalog,
): void {
  if (!catalog.has(sellerCountryCode)) return;
  rows.forEach((row, index) => {
    if (typeof row.vatRate !== 'string' || row.vatRate.trim() === '') {
      return; // compute-totals.ts already warns for this — not this function's job
    }
    if (resolveVatRatePercentage(catalog, sellerCountryCode, row.vatRate) !== null) return;

    // Neither the id form nor the legacy percentage form resolved for THIS country. A value that is
    // STILL a bare, parseable number is judged the way this guard always has — a real percentage,
    // just foreign to this country's own list, named as a percentage in the message. Anything else
    // (an id belonging to ANOTHER country's catalog, or plain garbage) is refused the same way, named
    // as the raw string instead, since there is no numeric rate to show.
    const asNumber = Number(row.vatRate);
    const knownPercentages = catalog.ratesFor(sellerCountryCode).map((r) => `${r.rate}%`);
    const shownRate = Number.isFinite(asNumber) ? `${asNumber}%` : `"${row.vatRate}"`;
    throw new ForeignVatRateError(
      `The VAT rate ${shownRate} chosen on line ${index + 1} is not one of ${sellerCountryCode}'s known ` +
        `VAT rates (${knownPercentages.join(', ')}) — refusing to send an invoice with a rate foreign ` +
        `to ${sellerCountryCode}.`,
    );
  });
}

/** Buyer role derivation — "valid VAT number -> B2B; otherwise B2C" (the reference's
 *  `TrustFlagVatValidator`). A syntactically invalid number never even reaches the
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

/** Rewrites each row's `vatRate` and the `__crossBorderCategory`/`__crossBorderExemptionReason`
 *  sidecar keys (see this file's own header, "Never a blind store") from the tax engine's own
 *  per-line `TaxTreatment` — shared by the cross-border branch below and `applyDomesticTaxScheme`, so
 *  the ONE place a `DocumentTaxResult` becomes a rewritten row array never drifts between the two
 *  callers.
 *
 *  Two invariants are asserted rather than assumed, both currently unreachable through
 *  `determineTax` (every branch of `tax-engine.ts#determineLineTax` returns exactly one line per
 *  input line, each with exactly one `components` entry — verified by construction, not merely by
 *  today's fixtures) but neither is enforced by the TYPE system (`TaxComponent[]` is deliberately
 *  plural — see `types.ts`'s own "multi-component jurisdiction" comment — and array length is never
 *  a compile-time guarantee): a `results.lines`/`rows` length mismatch would tax the WRONG row the
 *  moment either array's own construction ever drifts from the other, and a `components` array whose
 *  length is not exactly 1 has no correct way to become the SINGLE `vatRate`/`category` this row
 *  supports today. Silently reading `components[0]` would either under-tax (a second component
 *  dropped without a trace) or throw an unlabelled `TypeError` (an empty array) far from its actual
 *  cause. Refusing loudly, named, is this module's own established posture for "cannot safely guess"
 *  (see the file header's three hard blocks) — not a data problem a user can fix, so a plain `Error`
 *  (never one of the named `is InvoiceTaxBlockError` classes), surfacing as a 500 that points straight
 *  at the engine branch responsible instead of a stack trace inside `.map()`. Exported so
 *  `resolve-invoice-tax.spec.ts` can exercise both guards directly against a crafted
 *  `DocumentTaxResult`, since no real branch of the engine can produce one today. */
export function applyTaxResult(
  rows: Record<string, unknown>[],
  result: DocumentTaxResult,
): { rows: Record<string, unknown>[]; mentions: LegalMention[] } {
  if (result.lines.length !== rows.length) {
    throw new Error(
      `Tax engine returned ${result.lines.length} line result(s) for ${rows.length} invoice line(s) — ` +
        'refusing to apply a misaligned tax result rather than risk taxing the wrong row.',
    );
  }
  const clonedRows = rows.map((row, index) => {
    const { components } = result.lines[index].treatment;
    if (components.length !== 1) {
      throw new Error(
        `Tax engine returned ${components.length} tax component(s) for line ${index + 1} — this ` +
          "wiring only ever writes a SINGLE vatRate/category per row (see this file's own header) " +
          'and has no correct way to combine or pick among multiple components, so it refuses rather ' +
          'than silently under-taxing the line with just the first one.',
      );
    }
    const [component] = components;
    return {
      ...row,
      vatRate: String(component.rate),
      __crossBorderCategory: component.category,
      ...(component.reason ? { __crossBorderExemptionReason: component.reason } : {}),
    };
  });
  return { rows: clonedRows, mentions: result.mentions };
}

/**
 * A DOMESTIC seller under a non-STANDARD tax scheme (`FRANCHISE_BASE` today) never charges VAT:
 * every line is rewritten to 0%, category E, with the scheme's own legal mention (FR gets art. 293 B,
 * PT gets its own CIVA art. 57.º n.º 2 wording, every other country gets the generic small-business
 * mention — see `tax-engine.ts`'s own `LOCALIZED_MENTION.franchise` table). This reuses
 * `determineTax`/`determineLineTax`'s OWN `domesticVat` branch — the SAME one `tax-engine.spec.ts`'s
 * "FR→FR franchise en base" test already exercises — rather than a second, hand-rolled
 * 0%-and-mention rewrite here: the mention TEXT must never be retyped in a second place (see this
 * module's own discipline against inventing a legal citation from memory).
 *
 * This is the fix for the THIRD of the three independent breaks that used to let a company tick
 * "VAT exempt" in Settings and still be charged full VAT on every invoice: `taxScheme` was declared
 * on `PartyTaxProfile` but never assigned (see `load-and-resolve.ts` for where it now IS), and even
 * once assigned, this function's own domestic fast path never looked at it — a French exempt seller
 * invoicing a French customer (by far the common case) would still never reach the engine at all.
 *
 * A seller whose country has NO known VAT/GST tax-system profile at all (`taxSystemRegistry.resolve`
 * returns `undefined`, or resolves to a SALES_TAX/NONE system) is left COMPLETELY UNTOUCHED — same
 * object reference, nothing rewritten — with a NAMED, non-fatal warning rather than either a silent
 * no-op (this defect's own class of bug, just relocated to a different country) or a brand-new hard
 * block this fix never asked for: a small-business VAT exemption is a VAT-system concept, and this
 * catalog simply does not know one for that country yet. Every seller this checkbox actually ships
 * for today (FR/DE/IT/PL/PT — `frontend/src/locales/en/translation.json`'s own description) DOES have
 * a `tax-systems/data/*.json` file, so this branch is a documented limitation for a
 * currently-unreachable case, not a live gap.
 */
function applyDomesticTaxScheme(
  input: ResolveInvoiceCrossBorderTaxInput,
  sellerCC: string,
  rows: Record<string, unknown>[],
  taxSystemRegistry: TaxSystemRegistry,
  vatValidator: VatValidator,
): ResolveInvoiceCrossBorderTaxResult {
  const sellerProfile = taxSystemRegistry.resolve(sellerCC);
  if (!sellerProfile || (sellerProfile.taxSystem.kind !== 'VAT' && sellerProfile.taxSystem.kind !== 'GST')) {
    return {
      data: input.data,
      crossBorder: false,
      warnings: [
        `This company is marked "${input.seller.taxScheme}" (VAT-exempt), but no VAT/GST tax system ` +
          `is known for its own country (${sellerCC}) in this catalog — this invoice was left at the ` +
          'rate the user chose, since a small-business VAT exemption is not something this catalog ' +
          'can safely apply for a country with an unknown or non-VAT tax system, guessed either way.',
      ],
    };
  }

  const supplier: PartyTaxProfile = {
    legalName: 'seller',
    countryCode: sellerCC,
    role: 'B2B',
    identifiers: [],
    taxScheme: input.seller.taxScheme,
  };
  // `tax-engine.ts#determineLineTax`'s `sameCountry` branch (`domesticVat`) only ever reads
  // `line`/`sys`/`supplier` — the buyer's own role/identifiers are never consulted on this branch, so
  // this minimal stand-in is never a guess about the REAL buyer, just a required parameter the
  // engine's shared entry point happens to take.
  const buyer: PartyTaxProfile = { legalName: 'buyer', countryCode: sellerCC, role: 'B2C', identifiers: [] };
  const lines: DocumentLine[] = rows.map((_row, index) => ({
    id: String(index),
    description: '',
    quantity: 1,
    unitNetMinor: 0,
    supplyType: 'SERVICES',
  }));

  const result = determineTax(
    {
      supplier,
      buyer,
      lines,
      issueDate: extractIssueDate(input.data),
      currency: extractCurrency(input.data),
    },
    sellerProfile,
    vatValidator,
  );
  const { rows: clonedRows, mentions } = applyTaxResult(rows, result);

  return {
    data: { ...input.data, lines: clonedRows, __crossBorderMentions: mentions },
    crossBorder: false,
    warnings: [],
  };
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

  // USER DECISION (2026-09-01) — NEVER a fallback-to-FR for the SELLER either: see this file's own
  // header, "unresolved SELLER country". `build-semantic-invoice.ts` holds the symmetric block for
  // the one path that can reach it without going through this function.
  const sellerCC = resolveCountryCode(input.seller);
  if (!sellerCC) {
    throw new UnresolvedSellerCountryError(
      "Cannot resolve this invoice's cross-border VAT treatment: the seller's own country could not " +
        'be determined — refusing to silently default to FR (the exact same class of bug this ' +
        'product already fixed for an unresolved BUYER country: a wrong default here could silently ' +
        "misjudge this invoice as domestic, or as cross-border against the wrong home jurisdiction's " +
        'own rates and mentions, never again). Complete the country field on this company in Settings ' +
        'before sending.',
    );
  }
  // NEVER a fallback for the BUYER either — see this file's own header, "unresolved buyer country".
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
    // A seller under a non-STANDARD tax scheme (FRANCHISE_BASE today — see `load-and-resolve.ts`'s
    // own mapping comment) never charges VAT domestically either: `applyDomesticTaxScheme` reuses the
    // SAME engine branch (`tax-engine.ts#domesticVat`) `tax-engine.spec.ts`'s "FR→FR franchise en
    // base" test already exercises, rather than a second, hand-rolled 0%-and-mention rewrite. A
    // STANDARD (or unset) scheme takes the ORIGINAL, unconditional fast path below — byte-identical
    // to before this scheme existed, including the SAME OBJECT REFERENCE (see this file's own
    // `ResolveInvoiceCrossBorderTaxResult.data` doc comment on why that identity is deliberate).
    if (input.seller.taxScheme && input.seller.taxScheme !== 'STANDARD') {
      return applyDomesticTaxScheme(input, sellerCC, rows, taxSystemRegistry, vatValidator);
    }
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

  // The two guards on the INTRA-COMMUNITY DISTANCE-SALES branch — both BEFORE `determineTax` ever
  // runs, so neither of the pure engine's own permissive fallbacks (an undeclared regime treated as
  // DESTINATION; an unknown destination charged at the SELLER's rate — both kept verbatim in
  // `tax-engine.ts` and still tested there as pure-engine properties) is reachable from a real send.
  // Only the lines that actually take that branch are gated: B2B reverse-charge/intra-Community
  // (always 0%), export/out-of-scope (always 0%), and non-digital B2C services (taxed where the
  // supplier is, Directive 2006/112/EC art. 45, whatever the seller's distance-sales regime) never
  // consult a destination table nor depend on the regime at all — matching `tax-engine.ts`'s own
  // branching exactly.
  const anyDistanceSaleLine = supplyTypes.some((s) => s === 'GOODS' || s === 'DIGITAL');
  const sellerRegime = input.seller.distanceSalesRegime;
  if (inSameUnion && role === 'B2C' && anyDistanceSaleLine) {
    // FIRST, because it decides whether the destination's rate table is even needed: a seller taxing
    // at ORIGIN charges its own country's rate and never consults `buyerProfile`.
    if (!sellerRegime) {
      throw new UndeclaredDistanceSalesRegimeError(
        `This invoice is a cross-border B2C sale of goods from ${sellerCC} to ${buyerCC} — an ` +
          'intra-Community distance sale. It is taxed in ' +
          `${buyerCC} (Directive 2006/112/EC art. 33(a)) once this seller's EU-wide distance sales pass ` +
          'EUR 10 000 in a calendar year, or if it has opted into that regime; below that threshold and ' +
          `without the option it stays taxable in ${sellerCC}, at ${sellerCC}'s own rate (art. 59c(1), ` +
          'which disapplies art. 33(a), leaving art. 32 to govern). That threshold counts every sale ' +
          'this business makes across the EU, including any made outside this application, so this ' +
          'invoice cannot work it out and refuses to guess: declare which regime applies in Settings → ' +
          'Company before sending.',
      );
    }
    if (sellerRegime === 'DESTINATION' && !buyerProfile) {
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
    // Threaded through for completeness — a `PartyTaxProfile` should never assert less than what is
    // actually known about the party — but currently INERT on THIS branch specifically:
    // `determineLineTax`'s `sameCountry` check is always false here (this is the CROSS-BORDER branch,
    // reached only once the domestic early-return above has already ruled that out), and
    // `tax-engine.ts` only ever reads `supplier.taxScheme` from its own `sameCountry` branch
    // (`domesticVat`). See `applyDomesticTaxScheme` above for where this field actually does
    // something for the SAME seller on a domestic invoice.
    taxScheme: input.seller.taxScheme,
    // Read by `determineLineTax`'s intra-union B2C distance-sales branch, and by nothing else. Never
    // `undefined` by the time a real send reaches it for a line that branch governs — the block above
    // has already refused; it can still be `undefined` here for an invoice whose lines are all
    // SERVICES, where the engine never reads it.
    distanceSalesRegime: sellerRegime,
  };

  // The seller's own country is the taxing jurisdiction on exactly TWO cross-border branches, both of
  // which end up in `tax-engine.ts#domesticVat` and therefore read `line.taxRateHint`
  // (`rate = zeroByHint(line) ? 0 : (line.taxRateHint ?? sys.standardRate)`):
  //   - "Other B2C services across the union → default to taxing where the supplier is" (a service
  //     that is not one of the art. 58 ones, Directive 2006/112/EC art. 45); and
  //   - since 2026-09-21, an intra-Community distance sale of GOODS/DIGITAL made by a seller that has
  //     declared the ORIGIN regime (art. 59c(1) disapplying art. 33(a), leaving art. 32) — which is
  //     precisely where the seller's own reduced rate matters most: a French 5.5% book (CGI art. 278-0
  //     bis) sold to a German consumer by a seller under the threshold stays a 5.5% French sale, and
  //     flattening it to 20% would over-charge the consumer just as surely as the destination's 19%
  //     standard rate does.
  // EVERY OTHER branch (B2B reverse charge, intra-Community supply, export, out-of-scope, and a
  // DESTINATION-regime distance sale) computes its own rate independently and never reads
  // `taxRateHint` at all — so resolving it here for every line, unconditionally, changes nothing for
  // them. Without this, the branches above fell back to `sys.standardRate` for every line
  // (`taxRateHint` was never populated at all), silently REPLACING whatever reduced/exempt rate the
  // user actually chose on the invoice with the seller's own STANDARD rate — a real, provable
  // over-charge, never merely a display quirk.
  const isTaxedAtSellerRate = (index: number): boolean => {
    if (!inSameUnion || role !== 'B2C') return false;
    const isDistanceSale = supplyTypes[index] === 'GOODS' || supplyTypes[index] === 'DIGITAL';
    return isDistanceSale ? sellerRegime === 'ORIGIN' : true;
  };

  const taxRateHints = rows.map((row, index) => {
    const stored = row.vatRate;
    if (typeof stored !== 'string' || stored.trim() === '') return undefined;
    const resolved = resolveVatRatePercentage(vatRateCatalog, sellerCC, stored);
    if (resolved !== null) return resolved;
    // Unresolvable against the seller's own catalog — the same "no known rate to cite" situation
    // `assertDomesticRatesKnown` already refuses a DOMESTIC invoice over. A NAMED warning here, never
    // a silent standard-rate substitution, but ONLY when this line will actually reach the ONE branch
    // that would otherwise silently substitute one (see above) — every other line's `vatRate` is
    // simply irrelevant to its own cross-border treatment, and warning about it would be noise.
    if (isTaxedAtSellerRate(index)) {
      warnings.push(
        `Line ${index + 1}'s chosen VAT rate ("${stored}") is not one of ${sellerCC}'s known VAT ` +
          `rates — this cross-border B2C line is taxed in ${sellerCC}, at ${sellerCC}'s own standard ` +
          'rate instead, since there is no known rate on this invoice to honour.',
      );
    }
    return undefined;
  });

  // The DESTINATION regime's own uncloseable half, stated rather than left silent (this branch used to
  // rewrite the rate and say nothing at all — `warnings` came back empty). `tax-engine.ts
  // #ossDestinationVat` can only ever resolve the destination's STANDARD rate: no `tax-systems/
  // data/*.json` carries sourced `reducedRates`, and an invoice line carries no product classification
  // to select one against even if one did. So a product the destination member state taxes at a
  // reduced rate (Germany's 7% on books, UStG § 12 Abs. 2) is invoiced here at 19%, over-charging the
  // consumer. Non-fatal, deliberately — the seller, who knows what it is selling, is the only party
  // that can judge it, and refusing the send outright would block every correctly standard-rated sale
  // too. ONE warning per invoice, naming the destination and the rate actually applied, rather than
  // one per line: every OSS-taxed line on an invoice shares the same destination and the same rate.
  // Read `ResolveInvoiceCrossBorderTaxResult.warnings`'s own doc comment before calling this "the
  // seller has been warned" — no production caller surfaces that array to anyone yet.
  if (inSameUnion && role === 'B2C' && anyDistanceSaleLine && sellerRegime === 'DESTINATION') {
    const destination = buyerProfile?.taxSystem;
    const destinationRate =
      destination && destination.kind !== 'SALES_TAX' && destination.kind !== 'NONE'
        ? destination.standardRate
        : undefined;
    if (destinationRate !== undefined) {
      warnings.push(
        `This invoice is an intra-Community distance sale taxed in ${buyerCC} (EU One-Stop-Shop, ` +
          `Directive 2006/112/EC art. 33(a)), so ${buyerCC}'s STANDARD VAT rate (${destinationRate}%) ` +
          `was applied. ${buyerCC}'s own reduced rates are not modelled here and an invoice line ` +
          'carries nothing that says which products they cover — check the destination rate yourself ' +
          'if what you are selling is reduced-rated there, or this invoice over-charges the customer.',
      );
    }
  }

  const lines: DocumentLine[] = rows.map((_row, index) => ({
    id: String(index),
    description: '',
    quantity: 1,
    unitNetMinor: 0,
    supplyType: supplyTypes[index],
    taxRateHint: taxRateHints[index],
  }));

  const result = determineTax(
    {
      supplier,
      buyer,
      lines,
      issueDate: extractIssueDate(input.data),
      currency: extractCurrency(input.data),
    },
    sellerProfile,
    vatValidator,
    buyerProfile,
  );

  const { rows: clonedRows, mentions } = applyTaxResult(rows, result);

  return {
    data: { ...input.data, lines: clonedRows, __crossBorderMentions: mentions },
    crossBorder: true,
    warnings,
  };
}
