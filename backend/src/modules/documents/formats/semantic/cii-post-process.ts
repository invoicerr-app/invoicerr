/**
 * PARTIAL REPRISE from `compliance/schemas/cii-post-process.ts` (git tag `avant-refonte-documents`) —
 * only `splitCiiIncludedNotes` survives here, verbatim. `normalizeCiiNamespaces` and
 * `postProcessCiiForCtc` are NOT reprised: both existed for the needs of one specific transport (the
 * French PDP "superpdp", which requires a default namespace style rather than a prefixed one, and a
 * routing address rewritten after the fact) — a TRANSMISSION concern, not a FORMAT one.
 * This module builds a generic EN 16931 CII/UBL document, never addressed to a particular transport;
 * reintroducing that post-processing here would anticipate a decision that belongs to the FR transport
 * reprise, not to this one.
 */

import type { Invoice as EuInvoice } from '@e-invoice-eu/core';

import { applyFrenchBusinessProcess, applyFrenchBusinessProcessInObject } from './business-process';

/**
 * Split the one-note-many-contents block the generator emits into one note per mention.
 *
 * `@e-invoice-eu/core` maps an array of `cbc:Note` onto a SINGLE `ram:IncludedNote` holding several
 * `ram:Content`. That is invalid CII — `Content` occurs at most once in a note. Measured against a
 * real French PDP rejection at the reference, not deduced: several mentions in, one note with several
 * contents out.
 *
 * The same pass recovers BT-21: EN 16931 UBL carries a subject code as a `#CODE#` prefix on the note
 * text; CII wants it as its own `ram:SubjectCode`, and the generator does not translate between the
 * two, so the prefix travels into CII as literal text otherwise.
 *
 * A no-op when there is nothing to split, so it is safe to run on any CII document.
 */
export function splitCiiIncludedNotes(ciiXml: string): string {
  return ciiXml.replace(/<ram:IncludedNote>([\s\S]*?)<\/ram:IncludedNote>/g, (whole, inner: string) => {
    const contents = [...String(inner).matchAll(/<ram:Content>([\s\S]*?)<\/ram:Content>/g)].map((m) => m[1]);
    // Leave a well-formed note alone — including one that already carries a SubjectCode.
    if (contents.length <= 1 && !/^#[A-Z0-9]{3}#/.test(contents[0] ?? '')) return whole;

    return contents
      .map((raw) => {
        const m = raw.match(/^#([A-Z0-9]{3})#([\s\S]*)$/);
        const text = m ? m[2] : raw;
        const code = m ? m[1] : undefined;
        return code
          ? `<ram:IncludedNote><ram:Content>${text}</ram:Content><ram:SubjectCode>${code}</ram:SubjectCode></ram:IncludedNote>`
          : `<ram:IncludedNote><ram:Content>${text}</ram:Content></ram:IncludedNote>`;
      })
      .join('');
  });
}

/**
 * The SAME fix as `splitCiiIncludedNotes` above, but applied to the library's own INTERMEDIATE JS
 * object rather than the rendered XML string — found necessary, live, by mandatory legal
 * mentions: `facturx-provider.ts`'s Factur-X embed step asks `@e-invoice-eu/core` to
 * REGENERATE the CII internally from `EuInvoice` (there is no way to hand it a pre-built XML string
 * instead — the library takes the semantic model, not text — see that file's own header), so the
 * string-based fix above, which only ever runs on the PLAIN CII this bridge builds for the structural
 * gate, never reaches the copy that ends up embedded in the PDF. A REAL superpdp deposit surfaced
 * this the moment a French invoice carried more than one note (the three mandatory mentions): the
 * conformity check came back `fr:213`, still citing every mention as ABSENT, with the platform's own
 * XML-schema error underneath — "Element 'ram:Content' must occur exactly 1 times" — the exact defect
 * this function exists to prevent, not a new one.
 *
 * `@e-invoice-eu/core`'s `InvoiceServiceOptions.postProcessor` is the library's OWN, public extension
 * point (`(data: ExpandObject) => Promise<void>`, called on the intermediate object right before it
 * is rendered to XML — verified directly against the vendored dependency, not assumed) — passing this
 * function as `postProcessor` for BOTH the plain 'CII' generate call and the 'Factur-X-EN16931' embed
 * call (the latter internally re-runs the exact same CII generation step) applies the identical split
 * to whichever copy is actually produced, using a channel the library ships for exactly this kind of
 * mutation rather than a second regex pass over text that, for the embed call, was never exposed.
 *
 * The shape this mutates: `@e-invoice-eu/core` maps an array of `cbc:Note` onto
 * `rsm:ExchangedDocument['ram:IncludedNote'] = { 'ram:Content': [<one string per note>] }` — verified
 * empirically against the vendored dependency,
 * including for a SINGLE note (`ram:Content` is still a one-element array, which is why this function
 * runs unconditionally whenever the array exists at all, never gated on `.length > 1` the way it might
 * look like it should be — a lone `#CODE#text` note still needs its SubjectCode recovered). A no-op
 * whenever there is no note at all (`ram:IncludedNote` absent) — safe to pass unconditionally.
 */
export function splitCiiIncludedNotesInObject(cii: Record<string, unknown>): void {
  const invoiceRoot = cii?.['rsm:CrossIndustryInvoice'] as Record<string, unknown> | undefined;
  const exchangedDocument = invoiceRoot?.['rsm:ExchangedDocument'] as Record<string, unknown> | undefined;
  const includedNote = exchangedDocument?.['ram:IncludedNote'];
  if (!exchangedDocument || !includedNote) return; // nothing to split: safe no-op

  // Newer generator releases already emit one note per mention; only the `#CODE#` prefix is left.
  if (Array.isArray(includedNote)) {
    for (const note of includedNote as Record<string, unknown>[]) {
      if (note['ram:SubjectCode'] !== undefined) continue;
      const m = /^#([A-Z0-9]{3})#([\s\S]*)$/.exec(String(note['ram:Content'] ?? ''));
      if (m) {
        note['ram:Content'] = m[2];
        note['ram:SubjectCode'] = m[1];
      }
    }
    return;
  }

  const contents = (includedNote as Record<string, unknown>)['ram:Content'];
  if (!Array.isArray(contents)) return;

  exchangedDocument['ram:IncludedNote'] = contents.map((raw) => {
    const m = /^#([A-Z0-9]{3})#([\s\S]*)$/.exec(String(raw));
    return m ? { 'ram:Content': m[2], 'ram:SubjectCode': m[1] } : { 'ram:Content': raw };
  });
}

/** XML text escaping for the one element this file injects itself. */
function escapeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * BT-33 for CII: `@e-invoice-eu/core` maps the seller's `cbc:CompanyLegalForm` to
 * `ram:SellerTradeParty/ram:Description`, but only on its UBL mapping: the CII mapping reads
 * `cbc:LegalForm`, a semantic field the library's own schema does not declare. The line is therefore
 * inserted here, after `ram:Name` (the position the UN/CEFACT TradePartyType sequence gives
 * `Description`), instead of silently dropping the seller's company-law mentions from every CII and
 * Factur-X export.
 *
 * A no-op when there is no description, so every existing caller keeps its byte-for-byte output.
 */
export function applyCiiSellerLegalDescription(ciiXml: string, description: string | undefined): string {
  if (!description) return ciiXml;
  const seller = /<ram:SellerTradeParty>([\s\S]*?)<\/ram:SellerTradeParty>/.exec(ciiXml);
  // Newer generator releases map BT-33 themselves: never emit a second Description.
  if (seller?.[1].includes('<ram:Description>')) return ciiXml;
  return ciiXml.replace(
    /(<ram:SellerTradeParty>[\s\S]*?<ram:Name>[^<]*<\/ram:Name>)/,
    `$1<ram:Description>${escapeXmlText(description)}</ram:Description>`,
  );
}

/**
 * The same BT-33 insertion, on the library's intermediate CII object: needed by Factur-X, whose
 * embedded CII is regenerated from the semantic model and never passes through the string helper
 * above (the same gap `splitCiiIncludedNotesInObject` documents for notes). A no-op when there is no
 * description or no seller party.
 */
export function applyCiiSellerLegalDescriptionInObject(
  cii: Record<string, unknown>,
  description: string | undefined,
): void {
  if (!description) return;
  const root = cii?.['rsm:CrossIndustryInvoice'] as Record<string, unknown> | undefined;
  const transaction = root?.['rsm:SupplyChainTradeTransaction'] as Record<string, unknown> | undefined;
  const agreement = transaction?.['ram:ApplicableHeaderTradeAgreement'] as
    | Record<string, unknown>
    | undefined;
  const seller = agreement?.['ram:SellerTradeParty'] as Record<string, unknown> | undefined;
  if (!seller || 'ram:Description' in seller) return;
  // Rebuild in place so `ram:Description` keeps the position the UN/CEFACT TradePartyType sequence
  // gives it (right after `ram:Name`): the renderer serialises object keys in insertion order.
  const rebuilt: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(seller)) {
    rebuilt[key] = value;
    if (key === 'ram:Name') rebuilt['ram:Description'] = description;
  }
  if (!('ram:Description' in rebuilt)) rebuilt['ram:Description'] = description;
  for (const key of Object.keys(seller)) delete seller[key];
  Object.assign(seller, rebuilt);
}

/**
 * The two values the CII post-processing chain reads off the semantic `EuInvoice`: the seller's BT-33
 * company-law line (the CII mapping of `@e-invoice-eu/core` ignores `cbc:CompanyLegalForm`, see
 * `applyCiiSellerLegalDescription`) and the BT-23 code `build-semantic-invoice.ts` sets only when a
 * country's content requirement resolved one (see `business-process.ts`'s own header) - `undefined`
 * for every other seller.
 */
export interface CiiPostProcessContext {
  sellerLegalInformation: string | undefined;
  businessProcessCode: string | undefined;
}

export function ciiPostProcessContext(euInvoice: EuInvoice): CiiPostProcessContext {
  return {
    sellerLegalInformation:
      euInvoice['ubl:Invoice']['cac:AccountingSupplierParty']['cac:Party']['cac:PartyLegalEntity'][
        'cbc:CompanyLegalForm'
      ],
    businessProcessCode: euInvoice['ubl:Invoice']['cbc:ProfileID'],
  };
}

/**
 * The full post-processing of a CII string rendered by `@e-invoice-eu/core`, shared by
 * `cii-provider.ts` and the plain-CII gate of `facturx-provider.ts`: note split (and BT-21), then
 * BT-33, then BT-23. The BT-23 step is belt-and-suspenders: the object-level `cbc:ProfileID` already
 * reaches the rendered string (verified against the vendored dependency's own mapping, see
 * `business-process.ts`'s header), but re-asserting it costs nothing and survives even if that
 * propagation ever stopped holding for a library-internal reason this codebase does not control.
 */
export function postProcessCii(ciiXml: string, context: CiiPostProcessContext): string {
  let xml = splitCiiIncludedNotes(ciiXml);
  xml = applyCiiSellerLegalDescription(xml, context.sellerLegalInformation);
  if (context.businessProcessCode) xml = applyFrenchBusinessProcess(xml, context.businessProcessCode);
  return xml;
}

/**
 * The same chain on the library's intermediate CII object, for the `postProcessor` of the Factur-X
 * embed call, whose internal CII regeneration never sees the string `postProcessCii` fixes (see
 * `facturx-provider.ts`'s own header).
 */
export function postProcessCiiInObject(cii: Record<string, unknown>, context: CiiPostProcessContext): void {
  splitCiiIncludedNotesInObject(cii);
  applyCiiSellerLegalDescriptionInObject(cii, context.sellerLegalInformation);
  if (context.businessProcessCode) applyFrenchBusinessProcessInObject(cii, context.businessProcessCode);
}
