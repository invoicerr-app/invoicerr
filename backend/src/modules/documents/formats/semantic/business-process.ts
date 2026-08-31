/**
 * BT-23 (Business process type / "cadre de facturation") — REPRISE VERBATIM (only the import paths
 * changed) from `compliance/providers/format/providers.ts` at git tag `avant-refonte-documents`.
 *
 * ## Why this lives here, unused by `build-semantic-invoice.ts`
 *
 * BT-23 is a legitimate EN 16931 BASE field (UBL `cbc:ProfileID`, CII
 * `BusinessProcessSpecifiedDocumentContextParameter/ID`, cardinality 0..1) — but the LIMITATIVE
 * VALUE SET this function derives (`B1 S1 M1 B2 S2 M2 B4 S4 M4 S5 S6 B7 S7`) is a FRENCH refinement:
 * the machine translation of CGI ann. II art. 242 nonies A 8° bis, mandatory on a French invoice
 * from 2026-09-01. Neither the vendored EN 16931 Schematron (checked before writing this file — see
 * `../vendored/validate-schematron.ts`) nor `@e-invoice-eu/core`'s own generator requires BT-23 to be
 * present AT ALL for a document to validate; the field is entirely optional at the base-standard
 * layer this ticket (item 12, "formats normalisés") covers.
 *
 * Wiring `frenchBusinessProcessCode` unconditionally into the generic CII/UBL bridge would mean
 * asserting a French legal category on EVERY invoice regardless of the seller's country — exactly
 * the "no business code names a country" principle this codebase holds everywhere else. Deciding
 * WHICH countries require BT-23, and with what values, is item 11 ("canal imposé par pays") or item
 * 15 ("mentions obligatoires")'s job — a country-conditional decision this ticket's country-blind
 * `invoice.descriptor.ts` has no country flag to gate on today, and inventing one here would be
 * scope creep into a `⚖`-marked item this ticket was not asked to source.
 *
 * Kept here, exported and unit-tested (see `business-process.spec.ts`, reprised from the repère's
 * own `bt23-business-process.spec.ts`) so the day item 11/15 wires a country-conditional BT-23, the
 * pure logic is already proven rather than rewritten from scratch.
 *
 * The defect this used to fix, for the record: `@e-invoice-eu/core` emits `M1` HARDCODED from the
 * UBL ProfileID it derives internally. Every invoice built through it therefore declares itself
 * "mixte" whatever it actually contains — a pure-services invoice claiming to carry goods, and vice
 * versa — which is exactly why a bare PRESENCE check on BT-23 would never have caught it.
 */
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
