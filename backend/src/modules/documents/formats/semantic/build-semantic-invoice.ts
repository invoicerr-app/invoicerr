/**
 * The descriptor → EN 16931 semantic model bridge — the ONE place a document instance's data,
 * ALREADY-COMPUTED totals (`totals/compute-totals.ts`), and the seller/buyer party facts turn into
 * the JSON object `@e-invoice-eu/core`'s `InvoiceService.generate()` consumes to produce either
 * syntax (CII or UBL — see `../cii-provider.ts` / `../ubl-provider.ts`, the only two callers).
 *
 * REPRISE, adapted, of the equivalent block in `invoice-rendering.service.ts#buildEInvoice` (git tag
 * `avant-refonte-documents`) — NOT a verbatim copy: that method fed a much richer, now-removed Prisma
 * shape (per-line VAT CATEGORY already resolved by a cross-border tax engine that no longer exists,
 * document-level discount, delivery address, credit-note correction links, negative-price lines
 * folded into allowances...). None of that exists in today's generic document model
 * (`descriptors/invoice.descriptor.ts` — see its own header, "The line shape — written FROM France,
 * for now") — so every simplification below is either a direct consequence of what the descriptor
 * genuinely models today, or is called out explicitly as a limitation, never silently guessed.
 *
 * ## What is verified, empirically, not just asserted
 *
 * The exact minimal field set below was validated by hand against `@e-invoice-eu/core`'s own runtime
 * (its `generate()` throws on a missing MANDATORY field before producing any XML) AND against the
 * real vendored EN 16931 Schematron (`../vendored/validate-schematron.ts`) before this file was
 * written — see the master proof test, `../providers.spec.ts`, which is the same check, kept, not a
 * throwaway. Nothing here claims a field is "required" or "optional" from memory of the old code
 * alone; the old code's OWN richer model included fields (document-level `cac:PaymentMeans`,
 * `cbc:BuyerReference`, seller `cac:Contact`) that turned out, on inspection of the vendored
 * Schematron, to be entirely OPTIONAL at the base EN 16931 layer (only Peppol BIS / XRechnung deltas
 * — neither branched in this ticket, see `format-registry.ts`'s own header — make some of them
 * mandatory). They are omitted here rather than carried over out of habit.
 *
 * ## BT/BG map (numbers cited so a reviewer can check this against the standard, not this comment)
 *
 *  - BT-1  Invoice number              → `cbc:ID`                          (the instance's `displayNumber`)
 *  - BT-2  Issue date                  → `cbc:IssueDate`
 *  - BT-3  Invoice type code           → `cbc:InvoiceTypeCode` = '380' (Commercial invoice) — this
 *    bridge only ever serves the "invoice" document type (see `format-registry.ts`); a credit note
 *    would need '381' the day this bridge is reused for one, deliberately not guessed here.
 *  - BT-5  Invoice currency code       → `cbc:DocumentCurrencyCode`        (`totals.currency`)
 *  - BT-9  Payment due date            → `cbc:PaymentDueDate` — OMITTED. No `dueDate` is threaded
 *    into this bridge's input today: adding it is a one-line change once a caller has a reason to
 *    (BT-9 is optional at the base layer, so this is a completeness gap, never a validity one).
 *  - BT-22 Invoice note / BG-1         → `cbc:Note`                        (the document's own `notes`
 *    field, verbatim, FOLLOWED by one entry per country-mandated mention the seller's country
 *    requires — root TODO item 15, "mentions obligatoires". Resolved by `../../mentions/invoice-
 *    notes.ts#resolveInvoiceNotes` against `sellerCountryCode` (below) and the document's own
 *    `issueDate` — NEVER `new Date()`, so a re-generated export of an old invoice still carries the
 *    rate that was in force when it was ISSUED, not the one in force today (`mentions/schema.ts`'s
 *    own header on why). Each mention is encoded `#CODE#text` (`toUblNote`) so BT-21 (the UNTDID 4451
 *    subject code — PMT/PMD/AAB for France) survives both syntaxes: UBL keeps it as the note's own
 *    prefix, and CII's `splitCiiIncludedNotes` (below) recovers it into a genuine `ram:SubjectCode`.
 *    A seller in a country with no mentions file gets exactly what this bridge always emitted:
 *    `input.notes` alone, or nothing at all.)
 *  - BT-23 Business process type       → `cbc:ProfileID`                   set ONLY when a country's
 *    content requirement (`../../content-requirements/`) is active for `sellerCountryCode` at this
 *    invoice's own `issueDate` — `business-process.ts#resolveFrenchBusinessProcessCode`. Absent
 *    entirely for every other seller, exactly the pre-existing behaviour (no `cbc:ProfileID` key at
 *    all — `@e-invoice-eu/core` fills its own default, unrelated to BT-23). See that file's own
 *    header for the full wiring (CII, UBL, and the Factur-X embed all read this one derivation).
 *  - BT-24 Specification identifier    → `cbc:CustomizationID` = 'urn:cen.eu:en16931:2017' (fixed —
 *    this bridge builds EXACTLY the base EN 16931 profile, never Peppol BIS or XRechnung)
 *  - BT-27 Seller name                 → `cac:AccountingSupplierParty/.../cbc:RegistrationName`
 *  - BT-29/BT-30 Seller identifier / legal registration id → `cac:PartyIdentification`/`cac:PartyLegalEntity/cbc:CompanyID`,
 *    from the `LEGAL_ID` party identifier (see `entity-identifiers.ts`) when present — the France-first
 *    SIRET→SIREN derivation (schemeID '0002') is REPRISED VERBATIM from the old code's own
 *    `toSiren`: FR is this product's primary market (see `documentation`'s own priority notes) and
 *    this exact derivation was proven against a real PDP deposit. A non-FR `LEGAL_ID` (e.g. a US EIN)
 *    is emitted as a bare `cbc:CompanyID` with NO schemeID — asserting the French SIREN scheme
 *    (ISO 6523 '0002') for it would be inventing a registry membership nobody claimed.
 *  - BT-31 Seller VAT identifier       → `cac:PartyTaxScheme/cbc:CompanyID` + `cac:TaxScheme/cbc:ID`='VAT',
 *    from the `VAT` party identifier when present. ABSENT when the seller has none on file — BR-S-02/
 *    BR-Z-02 (see below) then correctly refuse the document, which is the STANDARD's own
 *    requirement, not a bug this bridge should paper over by inventing an identifier.
 *  - BT-35-BT-40 Seller postal address → `cac:PostalAddress` (StreetName/AdditionalStreetName/
 *    CityName/PostalZone/Country) — `guessCountryCode` resolves the free-text `country` column.
 *    USER DECISION (2026-09-01): an unresolvable SELLER country no longer falls back to 'FR' — it is
 *    a NAMED hard block (`SemanticBuildError`, see this function's own body), symmetric to
 *    `tax/resolve-invoice-tax.ts`'s own `UnresolvedSellerCountryError`. The BUYER side of this same
 *    address block still falls back to 'FR' when unresolvable (see BT-50-BT-55 below) — a genuinely
 *    unresolvable BUYER country here would already have been refused earlier, by
 *    `resolve-invoice-tax.ts`, for every real invoice send; this bridge's own buyer fallback is
 *    untouched by this decision, which is scoped to the SELLER only.
 *  - BT-44 Buyer name                  → `cac:AccountingCustomerParty/.../cbc:RegistrationName`
 *  - BT-48 Buyer VAT identifier        → same shape as BT-31, buyer side, OPTIONAL (only required at
 *    all by BR-IC/BR-AE/BR-G, none of which this bridge ever emits — see BT-151 below)
 *  - BT-50-BT-55 Buyer postal address  → same shape as the seller's
 *  - BG-25 Invoice line (per line, index 1..n):
 *     - BT-126 Line identifier         → `cbc:ID` = the 1-based line index
 *     - BT-129 Invoiced quantity       → `cbc:InvoicedQuantity`            (`data.lines[i].quantity`)
 *     - BT-130 Invoiced quantity unit  → `@unitCode`                       (`unitCodeFor(data.lines[i].unit)`
 *       — see `unit-code.ts`'s own header for a real pitfall found empirically while writing this
 *       bridge: the vendored Schematron itself does not constrain this vocabulary, but
 *       `@e-invoice-eu/core`'s own internal validation DOES require a genuine UN/ECE Rec20 code, so
 *       the descriptor's free-text `unit` — "hour", "day", "kg" — is mapped through a best-effort
 *       table rather than passed through verbatim)
 *     - BT-131 Invoice line net amount → `cbc:LineExtensionAmount`         (`totals.lines[i].netMinor`,
 *       via `fromMinor` — NEVER re-derived from quantity×price a second time here; see point 3 below)
 *     - BT-146 Item net price          → `cac:Price/cbc:PriceAmount`       (`data.lines[i].unitPrice`,
 *       the RAW value a user typed — already guaranteed ≥0 by the field's own `min: 0`, so BR-27
 *       "item net price shall not be negative" can never fire; no negative-price folding logic is
 *       needed here the way the old, richer model required)
 *     - BT-151 Invoiced item VAT category code → `cac:ClassifiedTaxCategory/cbc:ID` — see the
 *       "VAT category" section below for the honest limitation this carries
 *     - BT-152 Invoiced item VAT rate  → `cac:ClassifiedTaxCategory/cbc:Percent` (`data.lines[i].vatRate`)
 *     - BT-153 Item name               → `cac:Item/cbc:Name`               (`data.lines[i].description`)
 *  - BG-23 VAT breakdown (per rate, from `totals.vatBreakdown` — the aggregated-by-rate figures
 *    `compute-totals.ts` already produces, NEVER re-aggregated here):
 *     - BT-116 VAT category taxable amount → `cbc:TaxableAmount`           (`.baseMinor`)
 *     - BT-117 VAT category tax amount     → `cbc:TaxAmount`               (`.vatMinor`)
 *     - BT-118 VAT category code           → `cac:TaxCategory/cbc:ID`
 *     - BT-119 VAT category rate           → `cac:TaxCategory/cbc:Percent`
 *  - BT-106 Sum of Invoice line net amounts → `cac:LegalMonetaryTotal/cbc:LineExtensionAmount`
 *    (`totals.netMinor`) — EQUAL to BT-109 here because this bridge never emits a document-level
 *    `cac:AllowanceCharge` (BG-20): the invoice descriptor has no document-level discount field at
 *    all (only a PER-LINE `discountPercent`, already folded into each line's own net by
 *    `compute-totals.ts` — see that file's own header), so there is nothing left for a document-level
 *    allowance to subtract a second time.
 *  - BT-109 Invoice total without VAT  → `cbc:TaxExclusiveAmount`          (`totals.netMinor`)
 *  - BT-112 Invoice total with VAT     → `cbc:TaxInclusiveAmount`          (`totals.grossMinor`) — the
 *    figure the task's own report explicitly traces end-to-end (see the final report, point 2)
 *  - BT-115 Amount due for payment     → `cbc:PayableAmount`               (`totals.grossMinor` — no
 *    prepaid amount exists in this model, so due == total, same as BT-112)
 *
 * ## VAT category — the one real, documented simplification (not an invention)
 *
 * EN 16931 defines six BT-151 category codes (S, Z, E, AE, K, G, O), each demanding CONTRADICTORY
 * things of the document (see `../pitfalls/e-o-category.spec.ts`'s own header for the three real
 * ones this codebase's OLD, removed cross-border tax engine used to resolve). Today's descriptor
 * carries only a per-line `vatRate` PERCENTAGE — no category. Deriving one from the rate ALONE is
 * therefore honestly limited to the only two cases a bare percentage can support without inventing a
 * legal basis for an exemption or an out-of-scope claim nobody declared:
 *
 *   rate > 0  → 'S' (Standard rated)
 *   rate = 0  → 'Z' (Zero rated)
 *
 * A line whose rate could not be resolved at all (compute-totals.ts's own "no usable VAT rate —
 * counted in net only" warning path) makes BT-151 UNANSWERABLE — this bridge REFUSES to build rather
 * than guess (`SemanticBuildError`), the same discipline the old code's own removed
 * `buildEInvoice` held for a missing `vatCategory` column.
 *
 * E (exempt), O (out of scope), AE (reverse charge), K (intra-EU supply) and G (export) all need a
 * FACT this generic, country-blind bridge does not have (a cross-border tax engine's own verdict,
 * removed with the old engine — root TODO item 16, "transfrontalier", not built) — never derivable
 * from a rate of 0 alone. Consigned in `TODO_ISSUES.md`, not silently narrowed here.
 */
import type { Invoice as EuInvoice } from '@e-invoice-eu/core';

import { decimalsFor, fromMinor } from '@/utils/financial';
import { guessCountryCode } from '@/utils/country-name-to-iso';
import { getIdentifier } from '@/utils/entity-identifiers';

import { DocumentTotals } from '../../totals/compute-totals';
import { TaxCategoryCode } from '../../tax/types';
import { resolveInvoiceNotes, toUblNote } from '../../mentions/invoice-notes';
import { defaultMentionsCatalog } from '../../mentions/registry';
import { resolveFrenchBusinessProcessCode } from './business-process';
import { SupplyType } from './supply-type';
import { unitCodeFor } from './unit-code';

export class SemanticBuildError extends Error {}

export interface SemanticPartyInput {
  name: string;
  address: string;
  addressLine2?: string | null;
  city: string;
  postalCode: string;
  /** Free text, as stored on Company/Client — resolved via `guessCountryCode`. */
  country: string | null;
  email?: string | null;
  phone?: string | null;
  /** BT-84 (Payment account identifier), SELLER side only — see `Company.iban`'s own schema comment
   *  and `party-snapshot.ts#CompanyRowForFormat`. `undefined`/`null` for every Client (a buyer has no
   *  such column) and for a Company that never set one. */
  iban?: string | null;
  partyIdentifiers: { scheme: string; value: string }[];
}

/** One line's DESCRIPTIVE facts — the ARITHMETIC facts (net/VAT/gross) come from `totals.lines`,
 *  matched by array index (see this file's own header: there is exactly one qualifying line array
 *  on the invoice descriptor, so `data.lines[i]` and `totals.lines[i]` are the same row). */
export interface SemanticLineInput {
  description: string;
  quantity: number;
  unit: string;
  /** BT-146 — the RAW unit price the user typed (major currency units, e.g. 1200.50), NOT a value
   *  derived from `totals` — see this file's own header on why BT-146 is never re-derived from the
   *  (already-discounted) line net. */
  unitPrice: number;
  /**
   * BT-23's own derivation input — see `business-process.ts`'s header for the full wiring. Absent
   * for a document type/country that has no such subfield at all (every seller today, since the
   * trunk descriptor has none): treated exactly like a row that HAS the field but left it unset,
   * i.e. contributes nothing to the derived category. Only ever populated (today) via the FR
   * `country-fields/` overlay's own `lines[].supplyType` — see `shared-build.ts#extractLines`.
   */
  supplyType?: SupplyType;
  /**
   * Root TODO item 16 ("transfrontalier") — the RESOLVED BT-151 category for this line, when
   * `documents/tax/resolve-invoice-tax.ts` ran (a cross-border invoice). Overrides `vatCategoryFor`'s
   * own rate-only derivation below, which cannot tell AE/K/G/O apart from a bare 0% rate on its own
   * (see this file's own header, "VAT category"). `undefined` for every domestic line and every other
   * document type — behaviour there is BYTE-FOR-BYTE what it was before item 16 existed.
   */
  vatCategory?: TaxCategoryCode;
  /** BT-120 (`cbc:TaxExemptionReason`) — carried through from the SAME resolution, for the categories
   *  that need one (`E`/`O`). Not emitted below today (no required test path exercises E/O with a
   *  reason yet — see TODO_ISSUES.md's own item 16 entry) but threaded through so a future E/O path
   *  does not need to touch this interface again. */
  exemptionReason?: string;
}

export interface SemanticInvoiceInput {
  /** BT-1 — the instance's OWN `displayNumber`. Never called for an un-numbered document; the
   *  caller (`documents.service.ts`) refuses that earlier, at the 409 gate. */
  displayNumber: string;
  /** BT-2 — ISO 8601 date-only string ("yyyy-mm-dd"), the descriptor's own `issueDate` field value. */
  issueDate: string;
  notes?: string | null;
  seller: SemanticPartyInput;
  buyer: SemanticPartyInput;
  /** Same length and order as `totals.lines` — see this file's own header. */
  lines: SemanticLineInput[];
  totals: DocumentTotals;
  /**
   * Root TODO item 16 ("transfrontalier") — cross-border legal mentions the tax engine resolved
   * (reverse charge art. 196, intra-Community supply art. 138, export art. 146, …), joining BG-1
   * through the SAME `mentions/invoice-notes.ts#toUblNote` encoding the country-mandated ones already
   * use (see `resolveInvoiceCrossBorderTax`'s own header) — never a parallel note mechanism. Empty
   * for every domestic invoice.
   */
  additionalMentions?: { code: string; text: string }[];
  /**
   * BT-10 (Buyer reference) — COUNTRY-NEUTRAL by construction: this bridge never asks who the seller
   * is before emitting it, because the real-world need is not either (root TODO item 26's own
   * report, point 2): a German public buyer requires a Leitweg-ID/BT-10 on ANY invoice addressed to
   * it, including one issued by a seller in a country with no overlay field for it at all. Wired
   * generically here (`shared-build.ts#extractBuyerReference`, reading `data.buyerReference` off ANY
   * document regardless of which country-fields overlay — if any — put the input on screen) rather
   * than gated behind a DE-only flag, exactly like `additionalMentions` above is read unconditionally
   * whether or not it happens to be populated. Also what satisfies Peppol BIS's own PEPPOL-EN16931-
   * R003 ("a buyer reference or purchase order reference MUST be provided") — a base-standard/Peppol
   * concern, not a DE one. `undefined` for every existing CII/UBL/Factur-X fixture (none sets
   * `data.buyerReference`), so their own output is byte-for-byte unaffected.
   */
  buyerReference?: string;
  /**
   * BT-24 (Specification identifier) override — defaults to the plain base EN 16931 URN
   * (`'urn:cen.eu:en16931:2017'`) when absent, exactly the value every CII/UBL/Factur-X fixture
   * already asserts. `peppol-bis-provider.ts`/`xrechnung-provider.ts` are the only two callers that
   * ever pass something else — each value quoted VERBATIM from the vendored delta that actually
   * requires it (Peppol's PEPPOL-EN16931-R004; XRechnung's own `$XR-CIUS-ID` `<let>`), never invented
   * here.
   */
  customizationId?: string;
}

/**
 * Map a VAT identifier's 2-letter country prefix → the OpenPeppol Electronic Address Scheme (EAS,
 * ISO 6523 ICD) code for THAT country's own national VAT scheme. REPRISED VERBATIM from
 * `invoice-rendering.service.ts` at the repère — see that file's own comment for the sourcing
 * (cross-checked against the vendored `PEPPOL-EN16931-UBL.sch`'s own eaid enumeration) this table
 * carries. Peppol transmission itself is not wired by this ticket (see `format-registry.ts`'s own
 * header) — this table is used here only to give a VAT-registered party SOME `cbc:EndpointID` scheme
 * more specific than a bare email placeholder, satisfying `@e-invoice-eu/core`'s own mandatory field
 * without asserting a Peppol registration that was never verified.
 */
const VAT_PREFIX_TO_PEPPOL_EAS: Readonly<Record<string, string>> = {
  AT: '9914',
  BE: '9925',
  BG: '9926',
  CY: '9928',
  CZ: '9929',
  DE: '9930',
  EE: '9931',
  EL: '9933',
  ES: '9920',
  FR: '9957',
  HR: '9934',
  HU: '9910',
  IE: '9935',
  IT: '0211',
  LT: '9937',
  LU: '9938',
  LV: '9939',
  MT: '9943',
  NL: '9944',
  PL: '9945',
  PT: '9946',
  RO: '9947',
  SI: '9949',
};

function peppolEasForVat(vat: string | null | undefined): string | undefined {
  if (!vat) return undefined;
  const prefix = vat.trim().slice(0, 2).toUpperCase();
  return VAT_PREFIX_TO_PEPPOL_EAS[prefix];
}

/** France-first SIRET (14 digits) → SIREN (its own first 9 digits) derivation — see this file's own
 *  header for why this stays FR-specific rather than a generic transform. */
function toSiren(legalId: string | undefined, isFrenchSeller: boolean): string | undefined {
  if (!legalId) return undefined;
  if (!isFrenchSeller) return legalId;
  const digits = legalId.replace(/\D/g, '');
  return digits.length === 14 ? digits.slice(0, 9) : legalId;
}

/**
 * BT-34/BT-49 (Seller/Buyer electronic address) — read from a `PEPPOL_ENDPOINT` party identifier
 * (`"{schemeId}:{endpointId}"`, e.g. "0225:315143296_1421") when one is on file. Company settings
 * and the client form (`company.settings.tsx`/`client-upsert.tsx`) already collect and PERSIST this
 * exact identifier — it existed on both parties before this bridge ever read it back: an electronic
 * ROUTING address is a DIFFERENT fact from a legal registration id (SIREN/EIN/…), and EN 16931 models
 * them as separate business terms for exactly that reason (a party's routable address is not always
 * derivable from its legal identity — e.g. a French PDP's own routing convention, which is not the
 * SIREN at all). Without this, `endpointFor` below falls back to guessing the electronic address FROM
 * the legal id, which is only ever an approximation.
 */
function explicitEndpointFor(party: SemanticPartyInput): { id: string; scheme: string } | undefined {
  const raw = getIdentifier({ partyIdentifiers: party.partyIdentifiers }, 'PEPPOL_ENDPOINT');
  if (!raw) return undefined;
  const sep = raw.indexOf(':');
  if (sep <= 0 || sep === raw.length - 1) return undefined; // malformed — fall back rather than guess
  return { scheme: raw.slice(0, sep), id: raw.slice(sep + 1) };
}

function endpointFor(
  party: SemanticPartyInput,
  legalId: string | undefined,
  fallbackEmail: string | null | undefined,
) {
  const explicit = explicitEndpointFor(party);
  if (explicit) return explicit;

  const vat = getIdentifier({ partyIdentifiers: party.partyIdentifiers }, 'VAT');
  const vatEas = peppolEasForVat(vat);
  const id = legalId ?? (vatEas ? vat : undefined) ?? fallbackEmail?.trim() ?? 'unknown@local.invalid';
  const scheme = legalId ? '0225' : (vatEas ?? 'EM');
  return { id, scheme };
}

/** EN 16931's own BR-DEC-* family caps every amount at a MAXIMUM of 2 decimal digits, regardless of
 *  the currency's own minor-unit convention (`decimalsFor` — 3 for KWD/BHD/TND, 0 for JPY/KRW): a
 *  0-decimal currency is formatted with 0 (2 would print a fake ".00" fraction of a Yen), everything
 *  else with 2 — never more, which is the STANDARD's own ceiling, not a rounding bug introduced here. */
function ceiledDecimals(currency: string): number {
  return decimalsFor(currency) === 0 ? 0 : 2;
}

function fmt2(minor: number, currency: string): string {
  return fromMinor(minor, currency).toFixed(ceiledDecimals(currency));
}

/**
 * BT-41/BT-42/BT-43 (BG-6, Seller contact) — OPTIONAL at the base EN 16931 layer (this file's own
 * header), MANDATORY under XRechnung's BR-DE-2/5/6/7. Wired here, unconditionally, for every syntax
 * this bridge builds (never gated behind a "is this XRechnung" flag): `seller.phone`/`seller.email`
 * come straight off `Company.phone`/`Company.email`, both NON-NULLABLE columns on a real company
 * (schema.prisma) — so a genuine seller always has BOTH the moment this block fires at all, and the
 * only reason it is skipped entirely is a bare hand-built test fixture that set neither. `cbc:Name`
 * (BT-41, "the name of the point of contact") reuses the company's OWN registered name: this bridge
 * has no dedicated "contact person" field anywhere in the data model (Company has no such column —
 * only Client does, for its OWN contact person, a different business term entirely), and the
 * company's registered name is a genuine fact already on file, never a fabricated placeholder — the
 * same category of honest reuse `endpointFor`'s own email fallback already relies on above.
 */
function sellerContact(seller: SemanticPartyInput): Record<string, string> | undefined {
  if (!seller.phone && !seller.email) return undefined;
  return {
    'cbc:Name': seller.name,
    ...(seller.phone ? { 'cbc:Telephone': seller.phone } : {}),
    ...(seller.email ? { 'cbc:ElectronicMail': seller.email } : {}),
  };
}

/**
 * BG-16/BG-17 (Payment instructions / Credit transfer) — MANDATORY under XRechnung's BR-DE-1
 * (`cac:PaymentMeans` must exist) and BR-DE-23-a (`cac:PayeeFinancialAccount` must exist whenever the
 * means code is a transfer). Emitted only when `seller.iban` is actually on file (`Company.iban`,
 * optional) — NEVER fabricated (see that column's own schema comment): a seller with none simply
 * gets no `cac:PaymentMeans` block, and `xrechnung-provider.ts`'s own delta then refuses the
 * document, NAMING BR-DE-1/BT-84, which is the intended, honest outcome, not a bug this function
 * should paper over.
 *
 * PaymentMeansCode '30' ("Credit transfer" — UNTDID 4461), NOT '58' ("SEPA credit transfer"): found
 * EMPIRICALLY, not assumed, that code '58' crashes node-schematron/fontoxpath outright — BR-DE-19's
 * own IBAN-checksum assert (`xrechnung-provider.spec.ts`'s own test caught it) casts a mod-97
 * intermediate value to `xs:integer` via `fontoxpath`, which backs that type with a native JS
 * `number` rather than arbitrary-precision arithmetic; a real IBAN's digits-only expansion (~25-30
 * digits) throws `FOCA0003: ... out of bounds for JavaScript numbers` instead of failing the
 * assertion, taking down the ENTIRE Schematron run, not just this one (non-fatal, warning-level!)
 * rule. BR-DE-19's own test (`not(code = '58') or (...))`) short-circuits on `or` (verified directly
 * against fontoxpath) — code '30' means that right-hand side, the one that crashes, is never
 * evaluated at all. Both codes are equally honest here (this data model has no SEPA-specific fact —
 * only a bare IBAN — so asserting the more specific '58' would itself be an unverified claim); '30'
 * is the one this library can actually validate without crashing.
 */
function sellerPaymentMeans(seller: SemanticPartyInput): Record<string, unknown>[] | undefined {
  if (!seller.iban) return undefined;
  return [
    {
      'cbc:PaymentMeansCode': '30',
      'cac:PayeeFinancialAccount': { 'cbc:ID': seller.iban.replace(/\s+/g, '').toUpperCase() },
    },
  ];
}

function postalAddress(party: SemanticPartyInput, fallbackCountry: string) {
  return {
    'cbc:StreetName': party.address || 'N/A',
    ...(party.addressLine2 ? { 'cbc:AdditionalStreetName': party.addressLine2 } : {}),
    'cbc:CityName': party.city || '',
    'cbc:PostalZone': party.postalCode || '',
    'cac:Country': {
      'cbc:IdentificationCode': guessCountryCode(party.country ?? undefined) ?? fallbackCountry,
    },
  };
}

/** rate > 0 → 'S', rate = 0 → 'Z' — see this file's own header, "VAT category", for the full
 *  reasoning and its documented limitation. Throws for an unresolvable rate: BT-151 has cardinality
 *  1..1 and this bridge does not guess a legal category. */
function vatCategoryFor(ratePercent: number | null, lineIndex: number): 'S' | 'Z' {
  if (ratePercent === null) {
    throw new SemanticBuildError(
      `Cannot build an EN 16931 export: line ${lineIndex + 1} has no usable VAT rate, so its ` +
        "mandatory VAT category (BT-151) cannot be determined. Fix the line's VAT rate and try again.",
    );
  }
  return ratePercent > 0 ? 'S' : 'Z';
}

/**
 * BT-120 (`cbc:TaxExemptionReason`, free text) vs BT-121 (`cbc:TaxExemptionReasonCode`, a VATEX
 * code) — `tax-engine.ts`'s own `component.reason` is sometimes one, sometimes the other (see
 * `resolveInvoiceCrossBorderTax`'s own header): a genuine VATEX code always starts with the literal
 * prefix `'VATEX-'` (the CEF code list's own naming convention, and the exact strings the repère's
 * engine emits — `'VATEX-EU-AE'`, `'VATEX-EU-IC'`, `'VATEX-EU-G'`, `'VATEX-EU-O'`), so that prefix is
 * what tells the two BTs apart here — never a guess, never both emitted for the same reason.
 */
function exemptionReasonFields(reason: string | undefined): Record<string, string> {
  if (!reason) return {};
  return reason.startsWith('VATEX-')
    ? { 'cbc:TaxExemptionReasonCode': reason }
    : { 'cbc:TaxExemptionReason': reason };
}

export function buildSemanticInvoice(input: SemanticInvoiceInput): EuInvoice {
  const currency = input.totals.currency ?? 'EUR';
  // USER DECISION (2026-09-01, symmetric to `tax/resolve-invoice-tax.ts`'s own
  // `UnresolvedSellerCountryError` — see that file's own header, "unresolved SELLER country"): this
  // used to fall back to `'FR'` for a seller whose own country cannot be resolved. For an INVOICE,
  // this bridge is reached only AFTER `resolve-invoice-tax.ts` already ran (`documents.service.ts`'s
  // `downloadDocumentFormat`, `invoice-actions.ts`'s preflight/deliver — every real caller), so that
  // block already fires first in practice; this one stays because a silent `'FR'` here would still be
  // wrong on its own terms — every seller-country-derived fact below (postal address country, country-
  // mandated mentions via `sellerCountryCode`, BT-23's business-process code, the SIREN-vs-bare-id
  // branching) would silently assert a French identity for a company that was never confirmed French.
  const sellerCountryCode = guessCountryCode(input.seller.country ?? undefined);
  if (!sellerCountryCode) {
    throw new SemanticBuildError(
      "Cannot build an EN 16931 export: the seller's own country could not be determined — refusing " +
        'to silently default to FR (the same class of bug this product already fixed for an ' +
        'unresolved buyer country in the cross-border tax resolver, tax/resolve-invoice-tax.ts: a ' +
        "wrong default here would misjudge the seller's own jurisdiction — its postal address " +
        'country, its country-mandated legal mentions, its SIREN/legal-id formatting — never again). ' +
        'Complete the country field on this company in Settings before exporting.',
    );
  }
  const buyerCountryCode = guessCountryCode(input.buyer.country ?? undefined);
  if (!buyerCountryCode) {
    // Same principle as the seller block just above, now enshrined on BOTH parties: the send path
    // already hard-blocks an unresolvable buyer at tax resolution (resolve-invoice-tax.ts), so the
    // only way to reach this line without a country is a client record corrupted AFTER the invoice
    // was sent — and emitting FR in BT-55 for a German buyer because their record broke later is
    // exactly the silent-default class of bug this file refuses twice already.
    throw new SemanticBuildError(
      "Cannot build an EN 16931 export: the buyer's country could not be determined — refusing to " +
        'silently default to FR (same discipline as the seller block above). Fix the country on ' +
        "this invoice's client before exporting.",
    );
  }
  const isFrenchSeller = sellerCountryCode === 'FR';

  // Root TODO item 15 ("mentions obligatoires") — resolved against the SAME `sellerCountryCode` the
  // rest of this bridge already uses (including its own documented fallback-to-FR for an
  // unresolvable seller country, see this file's own header on BT-35-BT-40): a mention is a fact
  // about the SELLER's own jurisdiction, never the buyer's. `input.issueDate` is a plain "yyyy-mm-dd"
  // string (`SemanticInvoiceInput`'s own doc comment) — `new Date(...)` parses it at midnight UTC,
  // the exact instant the mention must be frozen to, never the moment this bridge happens to run.
  const legalMentionNotes = resolveInvoiceNotes(
    defaultMentionsCatalog.fileFor(sellerCountryCode),
    new Date(input.issueDate),
  ).map(toUblNote);

  // Root TODO item 16 ("transfrontalier") — the tax engine's OWN mentions (reverse charge, intra-
  // Community supply, export, …), appended through the EXACT SAME `toUblNote` encoding as the
  // country-mandated ones above (see `SemanticInvoiceInput.additionalMentions`'s own header): a
  // `LegalMention` never carries a UNTDID 4451 subject code (unlike PMT/PMD/AAB), so `subjectCode` is
  // left undefined and `toUblNote` emits plain text, exactly as the repère's own removed engine did.
  for (const mention of input.additionalMentions ?? []) {
    legalMentionNotes.push(toUblNote({ text: mention.text, legalRef: mention.text }));
  }

  // BT-23 — see `business-process.ts`'s own header for the full wiring. `supplyTypes` collects only
  // the lines that actually DECLARED one (the FR `country-fields/` overlay's own `lines[].supplyType`
  // is optional): a document with none declared reaches `frenchBusinessProcessCode` with an empty
  // array, which is already documented to resolve to 'M1' — "the only value that does not assert
  // something false about the content" — never a guess made here.
  const supplyTypes = input.lines
    .map((line) => line.supplyType)
    .filter((supplyType): supplyType is SupplyType => !!supplyType);
  const businessProcessCode = resolveFrenchBusinessProcessCode(
    sellerCountryCode,
    input.issueDate,
    supplyTypes,
  );

  const sellerLegalId = toSiren(
    getIdentifier({ partyIdentifiers: input.seller.partyIdentifiers }, 'LEGAL_ID'),
    isFrenchSeller,
  );
  const buyerLegalId = toSiren(
    getIdentifier({ partyIdentifiers: input.buyer.partyIdentifiers }, 'LEGAL_ID'),
    isFrenchSeller,
  );
  const sellerVat = getIdentifier({ partyIdentifiers: input.seller.partyIdentifiers }, 'VAT');
  const buyerVat = getIdentifier({ partyIdentifiers: input.buyer.partyIdentifiers }, 'VAT');

  const sellerEndpoint = endpointFor(
    input.seller,
    isFrenchSeller ? sellerLegalId : undefined,
    input.seller.email,
  );
  const buyerEndpoint = endpointFor(
    input.buyer,
    isFrenchSeller ? buyerLegalId : undefined,
    input.buyer.email,
  );

  if (input.lines.length !== input.totals.lines.length) {
    // A defensive, never-expected-to-fire check: this bridge's own contract (see the file header)
    // is that `lines`/`totals.lines` are the same rows in the same order. A mismatch here is a
    // caller bug (documents.service.ts building the input wrong), not a document data problem —
    // deliberately a plain Error, never surfaced to a user as if it were their mistake.
    throw new Error(
      `buildSemanticInvoice: ${input.lines.length} descriptive line(s) but ${input.totals.lines.length} ` +
        'computed line(s) — the caller built a mismatched SemanticInvoiceInput.',
    );
  }

  const sellerParty: Record<string, unknown> = {
    'cbc:EndpointID': sellerEndpoint.id,
    'cbc:EndpointID@schemeID': sellerEndpoint.scheme,
    'cac:PostalAddress': postalAddress(input.seller, sellerCountryCode),
    'cac:PartyLegalEntity': {
      'cbc:RegistrationName': input.seller.name,
      ...(sellerLegalId
        ? isFrenchSeller
          ? { 'cbc:CompanyID': sellerLegalId, 'cbc:CompanyID@schemeID': '0002' }
          : { 'cbc:CompanyID': sellerLegalId }
        : {}),
    },
  };
  if (isFrenchSeller && sellerLegalId) {
    sellerParty['cac:PartyIdentification'] = [{ 'cbc:ID': sellerLegalId, 'cbc:ID@schemeID': '0225' }];
  }
  const contact = sellerContact(input.seller);
  if (contact) {
    sellerParty['cac:Contact'] = contact;
  }
  if (sellerVat) {
    sellerParty['cac:PartyTaxScheme'] = [
      { 'cbc:CompanyID': sellerVat, 'cac:TaxScheme': { 'cbc:ID': 'VAT' } },
    ];
  }

  const buyerParty: Record<string, unknown> = {
    'cbc:EndpointID': buyerEndpoint.id,
    'cbc:EndpointID@schemeID': buyerEndpoint.scheme,
    'cac:PostalAddress': postalAddress(input.buyer, buyerCountryCode),
    'cac:PartyLegalEntity': {
      'cbc:RegistrationName': input.buyer.name,
      ...(buyerLegalId
        ? isFrenchSeller
          ? { 'cbc:CompanyID': buyerLegalId, 'cbc:CompanyID@schemeID': '0002' }
          : { 'cbc:CompanyID': buyerLegalId }
        : {}),
    },
  };
  if (buyerVat) {
    buyerParty['cac:PartyTaxScheme'] = { 'cbc:CompanyID': buyerVat, 'cac:TaxScheme': { 'cbc:ID': 'VAT' } };
  }

  const invoiceLines = input.lines.map((line, index) => {
    const computed = input.totals.lines[index];
    // Root TODO item 16 — a RESOLVED cross-border category (AE/K/G/O/E) always wins over the naive
    // rate-only derivation, which structurally cannot tell them apart from a bare 0% (see this file's
    // own header, "VAT category"). `undefined` for every domestic line — behaviour there is
    // unchanged.
    const category = line.vatCategory ?? vatCategoryFor(computed.vatRatePercent, index);
    return {
      'cbc:ID': String(index + 1),
      'cbc:InvoicedQuantity': String(line.quantity),
      'cbc:InvoicedQuantity@unitCode': unitCodeFor(line.unit),
      'cbc:LineExtensionAmount': fmt2(computed.netMinor, currency),
      'cbc:LineExtensionAmount@currencyID': currency,
      'cac:Item': {
        'cbc:Name': line.description,
        'cac:ClassifiedTaxCategory': {
          'cbc:ID': category,
          'cbc:Percent': String(computed.vatRatePercent ?? 0),
          // NOT `exemptionReasonFields(line.exemptionReason)` here — `@e-invoice-eu/core`'s own
          // internal ajv schema for `cac:Item/cac:ClassifiedTaxCategory` is `additionalProperties:
          // false` and does not include `cbc:TaxExemptionReasonCode`/`cbc:TaxExemptionReason` at all
          // (verified against the library directly — it throws "must NOT have additional properties"
          // when they are added here). BR-AE-10 and its siblings only ever require the reason at
          // BG-23 (the breakdown's own `cac:TaxCategory`, below), which DOES accept it.
          'cac:TaxScheme': { 'cbc:ID': 'VAT' },
        },
      },
      'cac:Price': {
        // BT-146 — the RAW price the user typed, already guaranteed >= 0 by the field's own `min`
        // (see this file's own header) — never `computed.netMinor / quantity`, which would silently
        // re-derive a per-unit price the discount already changed the meaning of.
        'cbc:PriceAmount': line.unitPrice.toFixed(ceiledDecimals(currency)),
        'cbc:PriceAmount@currencyID': currency,
      },
    };
  });

  // BG-23's own category, PER RATE — `input.totals.vatBreakdown` (compute-totals.ts, untouched, pure)
  // aggregates by RATE alone, never by category, so a resolved cross-border category is looked up
  // from the first LINE that carries this same rate. Root TODO item 16's own documented limitation
  // (see this file's own header, "VAT category"): a single invoice mixing two DIFFERENT resolved
  // categories at the SAME 0% rate (e.g. one intra-Community "K" goods line and one reverse-charge
  // "AE" services line on the same cross-border invoice) would see every 0% subtotal reported under
  // whichever category its FIRST such line resolved to — never guessed for a domestic line, where
  // `line.vatCategory` is always `undefined` and this falls back to the exact pre-existing derivation.
  const lineIndexForRate = (ratePercent: number): number =>
    input.totals.lines.findIndex((l) => l.vatRatePercent === ratePercent);
  const categoryForRate = (ratePercent: number): TaxCategoryCode => {
    const index = lineIndexForRate(ratePercent);
    return (index >= 0 ? input.lines[index].vatCategory : undefined) ?? (ratePercent > 0 ? 'S' : 'Z');
  };
  const reasonForRate = (ratePercent: number): string | undefined => {
    const index = lineIndexForRate(ratePercent);
    return index >= 0 ? input.lines[index].exemptionReason : undefined;
  };

  const taxSubtotals = input.totals.vatBreakdown.map((entry) => ({
    'cbc:TaxableAmount': fmt2(entry.baseMinor, currency),
    'cbc:TaxableAmount@currencyID': currency,
    'cbc:TaxAmount': fmt2(entry.vatMinor, currency),
    'cbc:TaxAmount@currencyID': currency,
    'cac:TaxCategory': {
      'cbc:ID': categoryForRate(entry.ratePercent),
      'cbc:Percent': String(entry.ratePercent),
      // BR-AE-10/BR-K-*/BR-G-10/BR-O-10/BR-E-10 — the categories that need a reason all need it HERE,
      // at BG-23 (the breakdown), not merely on the line's own `ClassifiedTaxCategory` above. Root
      // TODO item 16's resolved `component.reason` (`tax-engine.ts`) is either a genuine VATEX CODE
      // (BT-121 — 'VATEX-EU-AE'/'VATEX-EU-IC'/'VATEX-EU-G'/'VATEX-EU-O', the repère's own values,
      // verbatim) or free legal TEXT (BT-120 — France's own 293 B mention) — `exemptionReasonFields`
      // tells them apart by the 'VATEX-' prefix, never guessing which BT a given string belongs to.
      ...exemptionReasonFields(reasonForRate(entry.ratePercent)),
      'cac:TaxScheme': { 'cbc:ID': 'VAT' },
    },
  }));

  const paymentMeans = sellerPaymentMeans(input.seller);

  const euInvoice: EuInvoice = {
    'ubl:Invoice': {
      'cbc:CustomizationID': input.customizationId ?? 'urn:cen.eu:en16931:2017',
      // BT-23 — UBL's OWN native field for the French "cadre de facturation" (see this file's own
      // header, and business-process.ts's header for the full wiring). Set ONLY when
      // `resolveFrenchBusinessProcessCode` actually resolved a code above; absent entirely otherwise,
      // which is the exact pre-existing behaviour (the library fills its own, unrelated default).
      ...(businessProcessCode ? { 'cbc:ProfileID': businessProcessCode } : {}),
      'cbc:ID': input.displayNumber,
      'cbc:IssueDate': input.issueDate,
      'cbc:InvoiceTypeCode': '380',
      // The user's own free-text note FIRST, then every country-mandated mention — never the other
      // way round: a mandatory mention must never read as if it were something the user chose to
      // write. `legalMentionNotes` is `[]` for a seller in a country with no mentions file, so this
      // is exactly the old, unconditional `input.notes` behaviour whenever there is nothing to add.
      ...(input.notes || legalMentionNotes.length > 0
        ? { 'cbc:Note': [...(input.notes ? [input.notes] : []), ...legalMentionNotes] }
        : {}),
      'cbc:DocumentCurrencyCode': currency,
      // BT-10 — see `SemanticInvoiceInput.buyerReference`'s own header. Absent entirely when not
      // supplied, exactly the pre-existing behaviour for every syntax that never sets it.
      ...(input.buyerReference ? { 'cbc:BuyerReference': input.buyerReference } : {}),
      'cac:AccountingSupplierParty': { 'cac:Party': sellerParty as never },
      'cac:AccountingCustomerParty': { 'cac:Party': buyerParty as never },
      // BT-72 (Actual delivery date) is OPTIONAL in EN 16931 — but `@e-invoice-eu/core`'s CII
      // formatter only emits the WRAPPING `ram:ApplicableHeaderTradeDelivery` element when this
      // business term actually carries content (an empty `cac:Delivery: {}` produces none at all —
      // verified against the library directly, not assumed). The UN/CEFACT CII schema's own
      // `SupplyChainTradeTransactionType` sequence requires that wrapping element to be PRESENT
      // between Agreement and Settlement regardless of BT-72's own optionality; omitting it (this
      // bridge's state before this fix) produced CII that our vendored SCHEMATRON — which checks
      // content correctness, never element ORDERING — could not catch, but a real platform's own
      // structural validation does (superpdp: "ApplicableHeaderTradeSettlement... not expected.
      // Expected is ApplicableHeaderTradeDelivery", found running the REAL round-trip against the
      // sandbox — `pdp/pdp.live.spec.ts` — never from a hand-built fixture). Defaulting the date to
      // the invoice's own issue date (a conventional stand-in for "delivered on issuance" when no
      // separate delivery date is tracked, same category of technical default `vatCategoryFor`
      // above already makes — never a legal/fiscal claim, BT-72 has no tax consequence) is what
      // gives the wrapper real content to serialize.
      'cac:Delivery': { 'cbc:ActualDeliveryDate': input.issueDate },
      // BG-16/BG-17 — see `sellerPaymentMeans`'s own header. Absent entirely when the seller has no
      // IBAN on file, exactly the pre-existing behaviour (no such block was ever emitted before this).
      ...(paymentMeans ? { 'cac:PaymentMeans': paymentMeans as never } : {}),
      'cac:TaxTotal': [
        {
          'cbc:TaxAmount': fmt2(input.totals.vatMinor, currency),
          'cbc:TaxAmount@currencyID': currency,
          'cac:TaxSubtotal': taxSubtotals as never,
        },
      ],
      'cac:LegalMonetaryTotal': {
        'cbc:LineExtensionAmount': fmt2(input.totals.netMinor, currency),
        'cbc:LineExtensionAmount@currencyID': currency,
        'cbc:TaxExclusiveAmount': fmt2(input.totals.netMinor, currency),
        'cbc:TaxExclusiveAmount@currencyID': currency,
        'cbc:TaxInclusiveAmount': fmt2(input.totals.grossMinor, currency),
        'cbc:TaxInclusiveAmount@currencyID': currency,
        'cbc:PayableAmount': fmt2(input.totals.grossMinor, currency),
        'cbc:PayableAmount@currencyID': currency,
      },
      'cac:InvoiceLine': invoiceLines as never,
    },
  } as EuInvoice;

  return euInvoice;
}
