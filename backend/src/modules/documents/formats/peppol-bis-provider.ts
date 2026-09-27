/**
 * OpenPEPPOL BIS Billing 3.0 — the UBL syntax `ubl-provider.ts` already builds, judged by the SAME
 * base EN 16931 Schematron PLUS the vendored Peppol delta (`vendored/peppol/PEPPOL-EN16931-UBL.sch`)
 * RUNNING ON TOP OF IT — never instead of it (see `vendored/validate-schematron.ts`'s own header:
 * the base ruleset is the ONE thing every EN 16931 syntax provider already runs; a delta only ever
 * adds MORE rules a document must also satisfy). Both gates are blocking: an artifact that fails
 * EITHER is never served, exactly the "real ruleset, real gate" discipline `ubl-provider.ts` already
 * holds for the base standard alone.
 *
 * ## What the delta actually demanded, read from its own fatal `<assert>`s, not invented
 *
 *  - PEPPOL-EN16931-R004: `cbc:CustomizationID` must equal (a prefix of)
 *    `'urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0'` — the base
 *    bridge's own plain `'urn:cen.eu:en16931:2017'` fails this every time, so this provider is the
 *    ONE caller (besides `xrechnung-provider.ts`) that overrides
 *    `SemanticInvoiceInput.customizationId`.
 *  - PEPPOL-EN16931-R001/R007: `cbc:ProfileID` (BT-23) must be a genuine
 *    `urn:fdc:peppol.eu:2017:poacc:billing:NN:1.0` business-process URN. For a seller
 *    `business-process.ts` does not derive a code for, `@e-invoice-eu/core`'s OWN default ProfileID
 *    already IS that exact URN (verified in `providers.spec.ts`'s `LIBRARY_DEFAULT_PROFILE_ID`) — no
 *    action needed there. But GH-448 is the case where it DOES derive one: a mandated French seller
 *    (issueDate on or after 2026-09-01) has `resolveFrenchBusinessProcessCode` write a French CGI
 *    code (B1/S1/M1/...) into the SAME `cbc:ProfileID` element `build-semantic-invoice.ts` sets
 *    directly (see its own header, "BT-23") — a value that is never a `urn:fdc:...` string, so it
 *    always fails R007 here. BT-23 has different homes per SYNTAX, not per seller: on the CII/
 *    Factur-X channel it is the French "cadre de facturation" category
 *    (CGI ann. II art. 242 nonies A) `business-process.ts` derives; on Peppol BIS it is the fixed
 *    Peppol Billing profile identifier the BIS spec itself defines (Peppol BIS Billing 3.0 §13.2,
 *    "Profile 01 - Billing": `urn:fdc:peppol.eu:2017:poacc:billing:01:1.0` for invoice/credit note —
 *    profile 02, billing-with-invoice-response, does not apply here). This bridge therefore passes
 *    `businessProcessCodeOverride: PEPPOL_BIS_BILLING_PROFILE_ID` below — the SAME override slot
 *    `facturx-provider.ts`'s Chorus Pro instance already uses for its own, unrelated reason — so the
 *    French derivation still RUNS (cheap, side-effect-free) but is always discarded on THIS syntax,
 *    exactly the "one code path, override wins" contract that field's own doc comment establishes.
 *    The French CII/Factur-X channel is untouched: it does not set this option, so its own derived
 *    code still reaches `cbc:ProfileID`/`BusinessProcessSpecifiedDocumentContextParameter` there (see
 *    `peppol-bis-provider.spec.ts`'s GH-448 regression guard).
 *  - PEPPOL-EN16931-R003: `cbc:BuyerReference` or `cac:OrderReference/cbc:ID` MUST be provided — the
 *    SAME country-neutral BT-10 mechanism `build-semantic-invoice.ts` already wires generically (see
 *    its own header) satisfies this; no Peppol-specific code needed.
 *  - PEPPOL-EN16931-R010/R020: buyer/seller `cbc:EndpointID` MUST be provided — already always
 *    emitted by the base bridge's own `endpointFor` (item 10's own PEPPOL_ENDPOINT wiring), a
 *    fallback email/legal-id/VAT-EAS derivation good enough to never be empty.
 *  - PEPPOL-EN16931-R002: no more than one `cbc:Note` at document level UNLESS BOTH parties are
 *    German. FIXED (was a known, documented limitation — see git history for the original wording):
 *    a French seller's THREE mandatory C. com. mentions (`mentions/data/fr.json`) already emit three
 *    separate `cbc:Note` elements for every OTHER syntax, so a French-seller Peppol BIS export
 *    against a non-German buyer used to fail this rule outright. `semantic/peppol-post-process.ts`'s
 *    `mergePeppolNotesInObject` — wired below as `@e-invoice-eu/core`'s own `postProcessor` extension
 *    point, the SAME channel `facturx-provider.ts` uses for its own note-shape fix — collapses
 *    whatever `cbc:Note` array `build-semantic-invoice.ts`'s shared note mechanism produced into ONE
 *    multi-line note, VERBATIM (a lossless `\n` join, never a truncation or a summary), CONFINED to
 *    this Peppol BIS bridge alone: CII, plain UBL, Factur-X, FatturaPA, FA(3) and Facturae all still
 *    emit their notes separately, unmodified (see `legal-mentions.spec.ts`'s own regression
 *    assertions). The DE↔DE exception in R002's own test is deliberately never reproduced here —
 *    merging down to exactly one note satisfies R002's left branch (`count(cbc:Note) <= 1`)
 *    unconditionally, so the right branch (both parties German) never needs evaluating; see
 *    `peppol-post-process.ts`'s own header for why this is the simpler, always-conformant choice,
 *    not a shortcut. XRechnung's own vendored KoSIT delta
 *    (`vendored/de/XRechnung-UBL-validation-preprocessed.sch`) was checked directly and carries NO
 *    equivalent note-count rule at all — `xrechnung-provider.ts` is therefore untouched by this fix.
 *    See this file's own spec for the master proof (a French seller × non-German buyer, now passing,
 *    with all three legal texts present verbatim in the merged note) — the SAME test that used to
 *    demonstrate the failure, returned, not weakened.
 *
 * `PEPPOL-EN16931-R008` ("Document MUST not contain empty elements") is why every optional field this
 * bridge threads through (`buyerReference`, `iban`, `addressLine2`, ...) is ALWAYS omitted rather than
 * emitted empty — already true of the base bridge before this provider existed.
 */
import { DocumentInstanceResult } from '../actions/action-registry';
import { DocumentTypeDescriptor } from '../descriptors/types';
import { DocumentFormatBuildResult, DocumentFormatParty, DocumentFormatProvider } from './format-provider';
import { mergePeppolNotesInObject } from './semantic/peppol-post-process';
import { buildEuInvoiceForDocument, newEuInvoiceService } from './shared-build';
import { validateStructural } from './structural-check';
import { EN16931_UBL_SCH, PEPPOL_BIS_UBL_SCH, validateSchematron } from './vendored/validate-schematron';

/** Read VERBATIM from the vendored delta's own `<let name="profile">`/R004 test — see this file's
 *  own header. Not a made-up convention: it is the literal string the Schematron itself asserts. */
const PEPPOL_BIS_CUSTOMIZATION_ID =
  'urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0';

/** Peppol BIS Billing 3.0 §13.2, "Profile 01 - Billing": the fixed `cbc:ProfileID` (BT-23) value for
 *  an invoice or credit note on this profile (profile 02, billing-with-invoice-response, is not what
 *  this bridge builds). See this file's own header, "PEPPOL-EN16931-R001/R007", for why this must
 *  override whatever `business-process.ts` would otherwise derive for a mandated French seller. */
const PEPPOL_BIS_BILLING_PROFILE_ID = 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0';

async function build(
  descriptor: DocumentTypeDescriptor,
  document: Pick<DocumentInstanceResult, 'id' | 'data' | 'displayNumber' | 'status'>,
  company: DocumentFormatParty,
  client: DocumentFormatParty,
): Promise<DocumentFormatBuildResult> {
  const euInvoice = buildEuInvoiceForDocument(descriptor, document, company, client, {
    customizationId: PEPPOL_BIS_CUSTOMIZATION_ID,
    businessProcessCodeOverride: PEPPOL_BIS_BILLING_PROFILE_ID,
  });

  const service = newEuInvoiceService();
  // PEPPOL-EN16931-R002 — see this file's own header and `semantic/peppol-post-process.ts`'s own
  // header for the full reasoning. `postProcessor` is `@e-invoice-eu/core`'s own public extension
  // point, called on the intermediate UBL object right before XML rendering — the SAME channel
  // `facturx-provider.ts` already uses for its own, different note-shape fix.
  const xml = (await service.generate(euInvoice, {
    format: 'UBL',
    lang: 'en',
    postProcessor: async (data) => mergePeppolNotesInObject(data as Record<string, unknown>),
  })) as string;

  const structural = validateStructural(xml, 'ubl');
  if (!structural.valid) {
    return { bytes: new TextEncoder().encode(xml), validation: { valid: false, errors: structural.errors } };
  }

  // BOTH gates run, and BOTH must pass — the delta is BLOCKING, exactly like every other ruleset this
  // registry judges an artifact by (base EN 16931 for cii/ubl, the national XSDs for fa3/fatturapa).
  const base = validateSchematron(xml, EN16931_UBL_SCH);
  const delta = validateSchematron(xml, PEPPOL_BIS_UBL_SCH);
  const errors = [
    ...base.errors.map((e) => `${e.id}: ${e.message}`),
    ...delta.errors.map((e) => `${e.id}: ${e.message}`),
  ];

  return {
    bytes: new TextEncoder().encode(xml),
    validation: { valid: base.valid && delta.valid, errors },
  };
}

export const peppolBisFormatProvider: DocumentFormatProvider = {
  id: 'peppol-bis',
  syntax: 'PEPPOL_BIS_BILLING_3',
  mime: 'application/xml',
  build,
};
