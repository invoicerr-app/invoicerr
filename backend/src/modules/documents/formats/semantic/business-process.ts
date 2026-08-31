/**
 * BT-23 (Business process type / "cadre de facturation") — REPRISE VERBATIM (only the import paths
 * changed) from `compliance/providers/format/providers.ts` at git tag `avant-refonte-documents`.
 *
 * ## NOW WIRED — the country-conditional trigger this header used to say was missing
 *
 * BT-23 is a legitimate EN 16931 BASE field (UBL `cbc:ProfileID`, CII
 * `BusinessProcessSpecifiedDocumentContextParameter/ID`, cardinality 0..1) — but the LIMITATIVE
 * VALUE SET this function derives (`B1 S1 M1 B2 S2 M2 B4 S4 M4 S5 S6 B7 S7`) is a FRENCH refinement:
 * the machine translation of CGI ann. II art. 242 nonies A, I, 8° bis (verbatim: "L'information selon
 * laquelle les opérations donnant lieu à facture sont constituées exclusivement de livraisons de
 * biens ou exclusivement de prestations de services ou sont constituées de ces deux catégories
 * d'opérations"), mandatory on a French invoice from 2026-09-01. Neither the vendored EN 16931
 * Schematron (`../vendored/validate-schematron.ts`) nor `@e-invoice-eu/core`'s own generator requires
 * BT-23 to be present AT ALL for a document to validate — the field is entirely optional at the
 * base-standard layer.
 *
 * This header used to say wiring `frenchBusinessProcessCode` unconditionally into the generic CII/UBL
 * bridge would assert a French legal category on every invoice regardless of the seller's country,
 * and that a country-conditional gate had nowhere sourced to live yet. It now does:
 * `../../content-requirements/` is the SAME "country is data" mechanism `mentions/` already uses for
 * BG-1, scaled to a structured FIELD rather than free text — `resolveFrenchBusinessProcessCode` below
 * is the ONE function that reads it, and the ONLY caller of `frenchBusinessProcessCode` itself
 * outside a test: every other consumer below (`build-semantic-invoice.ts`, `cii-provider.ts`,
 * `facturx-provider.ts`) reads its RESULT, never re-derives the code. `applyFrenchBusinessProcess`/
 * `applyFrenchBusinessProcessInObject` are called directly by `cii-provider.ts`/`facturx-provider.ts`
 * themselves (belt-and-suspenders reuse on the rendered CII, see below) — the gate is centralized,
 * the STRING-level application is not, by design. The wiring itself, end to end:
 *
 *  - `build-semantic-invoice.ts` calls `resolveFrenchBusinessProcessCode` and, when it returns a
 *    code, sets `euInvoice['ubl:Invoice']['cbc:ProfileID']` directly on the semantic object BEFORE it
 *    reaches `@e-invoice-eu/core` — this is UBL's own native field for BT-23 (confirmed against the
 *    vendored dependency's own mapping table: `ubl:Invoice.cbc:ProfileID` maps STRAIGHT onto CII's
 *    `BusinessProcessSpecifiedDocumentContextParameter/ram:ID`, and the library's own
 *    `fillInvoiceDefaults` only ever fills a DEFAULT when the key is absent — never overrides a value
 *    already set), which is what makes this the honest "cbc:ProfileID équivalent" for UBL the old
 *    providers.ts never actually had (see below).
 *  - `cii-provider.ts`/`facturx-provider.ts`'s own plain-CII gate additionally runs
 *    `applyFrenchBusinessProcess` on the RENDERED CII string when a code was resolved — belt-and-
 *    suspenders reuse of this exact, already-tested function, so the plain CII this bridge validates
 *    carries the correct value even if the object-level route above ever stopped propagating for some
 *    library-internal reason this codebase does not control.
 *  - `facturx-provider.ts`'s Factur-X embed step ALSO chains `applyFrenchBusinessProcessInObject`
 *    (below) into its `postProcessor`, the exact same public extension point item 15's own
 *    `splitCiiIncludedNotesInObject` already uses for the SAME reason: `@e-invoice-eu/core`
 *    regenerates CII internally for that step from the SAME `euInvoice` input, but there is no API to
 *    hand it pre-built XML text instead, so the string-based fix above never reaches that copy.
 *
 * A non-French seller: NOTHING changes. `resolveFrenchBusinessProcessCode` returns `undefined`
 * whenever `../../content-requirements/`'s `activeContentRequirementFor` does (no file for that
 * seller's country, or a `mandatedFrom` still in the future relative to the invoice's own issue
 * date) — the object never gets a `cbc:ProfileID` key from this codebase at all, and
 * `@e-invoice-eu/core` falls back to exactly the default it always has (the Peppol BIS URN) — byte-
 * for-byte the pre-existing behaviour for every non-FR fixture.
 *
 * ## The old providers.ts's own UBL gap (checked, not assumed)
 *
 * The old, removed `compliance/providers/format/providers.ts` (git tag `avant-refonte-documents`)
 * NEVER wrote a French-derived value into UBL's `cbc:ProfileID` at all — its only `cbc:ProfileID`
 * string-replace targeted `PEPPOL_BIS` specifically, hardcoding a FIXED Peppol profile URN
 * (`urn:fdc:peppol.eu:2017:poacc:billing:01:1.0`), an unrelated Peppol-BIS-onboarding concern, not
 * BT-23's goods/services/mixed category. `applyFrenchBusinessProcess` itself was only ever called
 * for `EN16931_CII`/`FACTURX` there. So there was no old UBL fix to "look at and reuse" for the base
 * EN16931_UBL syntax — the direct `cbc:ProfileID` object write above is genuinely new wiring, not a
 * port.
 *
 * ## The `M1` defect, for the record
 *
 * `@e-invoice-eu/core` defaults BT-23 (both syntaxes) to the Peppol BIS billing profile URN when the
 * caller sets nothing — NOT the literal string `"M1"` in the currently-vendored version (checked
 * directly in `node_modules/@e-invoice-eu/core/dist/e-invoice-eu.cjs.js`, `FormatUBLService`/
 * `FormatCIIService#profileID`). Either way, that default is not one of the French limitative BT-23
 * values, so a French PDP's conformity check reports it exactly as this header's own poll excerpt
 * says: "absente ou n'est pas autorisée". `applyFrenchBusinessProcess`'s own "rewrite when present,
 * insert when absent" contract handles both shapes identically, which is why it needed no change here.
 */
import { activeContentRequirementFor } from '../../content-requirements/active-requirement';
import { SupplyType } from './supply-type';

const LIMITATIVE = ['B1', 'S1', 'M1', 'B2', 'S2', 'M2', 'B4', 'S4', 'M4', 'S5', 'S6', 'B7', 'S7'] as const;
export type FrenchBusinessProcessCode = (typeof LIMITATIVE)[number];

/**
 * The letter is the category: B = biens (goods), S = services, M = mixte. The digit is the invoicing
 * frame — only frame 1 (a direct sale, the ordinary case) is derivable from supply type alone; frames
 * 2 (auto-facturation), 4 (mandat de facturation) and 5/6/7 depend on WHO issues the invoice for
 * WHOM, which no part of this codebase models. Inventing a frame would be worse than always
 * returning frame 1 — recorded as an open point, not guessed.
 */
export function frenchBusinessProcessCode(supplyTypes: readonly SupplyType[]): FrenchBusinessProcessCode {
  const hasGoods = supplyTypes.includes('GOODS');
  const hasServices = supplyTypes.includes('SERVICES');
  if (hasGoods && hasServices) return 'M1';
  if (hasGoods) return 'B1';
  if (hasServices) return 'S1';
  // No supply type at all: the category cannot be derived, and 'mixte' is the only value that does
  // not assert something false about the content.
  return 'M1';
}

/** Rewrite BT-23 in a CII document — cardinality 1..1 once France requires it, so an absent element
 *  is INSERTED rather than silently left out. */
export function applyFrenchBusinessProcess(ciiXml: string, code: string): string {
  const existing =
    /(<(?:ram:)?BusinessProcessSpecifiedDocumentContextParameter>\s*<(?:ram:)?ID>)[^<]*(<\/(?:ram:)?ID>)/;
  if (existing.test(ciiXml)) return ciiXml.replace(existing, `$1${code}$2`);

  const ctxOpen = /(<(?:rsm:)?ExchangedDocumentContext>)/;
  if (!ctxOpen.test(ciiXml)) return ciiXml;
  return ciiXml.replace(
    ctxOpen,
    `$1<ram:BusinessProcessSpecifiedDocumentContextParameter><ram:ID>${code}</ram:ID></ram:BusinessProcessSpecifiedDocumentContextParameter>`,
  );
}

export const FRENCH_BUSINESS_PROCESS_LIMITATIVE_VALUES = LIMITATIVE;

/**
 * The country-conditional TRIGGER this file's own header used to say was missing — the ONLY caller
 * of `frenchBusinessProcessCode` from outside a test. Sources "does this seller's country require
 * BT-23, as of this invoice's own issue date" from `../../content-requirements/`
 * (`activeContentRequirementFor`), never from a bare `countryCode === 'FR'` check: a rule with no
 * legal citation cannot even load (`content-requirements/schema.ts#assertValidContentRequirementFact`),
 * and a rule whose `mandatedFrom` has not yet been reached by THIS invoice's own issue date correctly
 * returns `undefined` here — same half-open temporal contract `channel-policy/mandate.ts`'s own
 * channel mandate already holds for the exact same reason (see that file's header): re-deriving BT-23
 * for an old invoice at export time must reproduce what was required the day it was actually issued,
 * never what is required today.
 *
 * Returns `undefined` — never a guessed code — for a seller in a country with no active requirement:
 * `build-semantic-invoice.ts` only sets `cbc:ProfileID` when this returns a real code, so a non-FR
 * seller's document is byte-for-byte unaffected by this whole mechanism.
 */
export function resolveFrenchBusinessProcessCode(
  sellerCountryCode: string | undefined,
  issueDate: string,
  supplyTypes: readonly SupplyType[],
): FrenchBusinessProcessCode | undefined {
  const fact = activeContentRequirementFor(sellerCountryCode ?? '', 'BT-23', issueDate);
  if (!fact) return undefined;
  return frenchBusinessProcessCode(supplyTypes);
}

/**
 * The SAME fix as `applyFrenchBusinessProcess` above, but applied to `@e-invoice-eu/core`'s own
 * intermediate JS object rather than rendered XML — needed for exactly the reason
 * `cii-post-process.ts#splitCiiIncludedNotesInObject`'s own header documents for BG-1: the Factur-X
 * embed step asks the library to REGENERATE CII internally from the `EuInvoice` input, a copy the
 * string-based fix never sees, so a caller wiring BOTH fixes into the SAME `postProcessor` (see
 * `facturx-provider.ts`) needs an object-level counterpart for this one too.
 *
 * The shape this mutates mirrors `splitCiiIncludedNotesInObject`'s own verified-against-the-vendored-
 * dependency path: `rsm:CrossIndustryInvoice.rsm:ExchangedDocumentContext.
 * ram:BusinessProcessSpecifiedDocumentContextParameter.ram:ID` — the exact CII destination
 * `applyFrenchBusinessProcess`'s own regex targets on the rendered string, one level up the object
 * tree instead of through a tag pattern. A no-op whenever `exchangedDocument` itself is missing
 * (nothing to attach BT-23 to) — safe to call unconditionally once a code has been resolved.
 */
export function applyFrenchBusinessProcessInObject(cii: Record<string, unknown>, code: string): void {
  const invoiceRoot = cii?.['rsm:CrossIndustryInvoice'] as Record<string, unknown> | undefined;
  const exchangedDocumentContext = invoiceRoot?.['rsm:ExchangedDocumentContext'] as
    | Record<string, unknown>
    | undefined;
  if (!exchangedDocumentContext) return; // nothing to attach BT-23 to — safe no-op

  exchangedDocumentContext['ram:BusinessProcessSpecifiedDocumentContextParameter'] = { 'ram:ID': code };
}
