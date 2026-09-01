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
 *    `urn:fdc:peppol.eu:2017:poacc:billing:NN:1.0` business-process URN. Nothing to add here: for a
 *    seller `business-process.ts` does not derive a code for (every seller but a mandated French one
 *    today), `@e-invoice-eu/core`'s OWN default ProfileID already IS that exact URN (verified in
 *    `providers.spec.ts`'s `LIBRARY_DEFAULT_PROFILE_ID`) — this bridge never had to touch it.
 *  - PEPPOL-EN16931-R003: `cbc:BuyerReference` or `cac:OrderReference/cbc:ID` MUST be provided — the
 *    SAME country-neutral BT-10 mechanism `build-semantic-invoice.ts` already wires generically (see
 *    its own header) satisfies this; no Peppol-specific code needed.
 *  - PEPPOL-EN16931-R010/R020: buyer/seller `cbc:EndpointID` MUST be provided — already always
 *    emitted by the base bridge's own `endpointFor` (item 10's own PEPPOL_ENDPOINT wiring), a
 *    fallback email/legal-id/VAT-EAS derivation good enough to never be empty.
 *  - PEPPOL-EN16931-R002: no more than one `cbc:Note` at document level UNLESS BOTH parties are
 *    German. A KNOWN, DOCUMENTED LIMITATION, not silently avoided: a French seller's THREE mandatory
 *    C. com. mentions (`mentions/data/fr.json`) already emit three separate `cbc:Note` elements for
 *    every other syntax, so a French-seller Peppol BIS export against a non-German buyer would fail
 *    this rule today. Fixing it would mean collapsing `build-semantic-invoice.ts`'s own note array
 *    into a single multi-line `cbc:Note` (and teaching `cii-post-process.ts` to split THAT shape
 *    too) — a cross-cutting change to a shared, already-proven mechanism, out of this ticket's scope
 *    (branching two NEW formats). The master proof below therefore uses a seller with NO country
 *    mentions file (any non-FR seller), which is not a dodge of the rule — it is every real seller
 *    this codebase has a mentions file for MINUS the one this specific interaction is not yet built
 *    for; see this file's own spec for the failing case demonstrated, not hidden.
 *
 * `PEPPOL-EN16931-R008` ("Document MUST not contain empty elements") is why every optional field this
 * bridge threads through (`buyerReference`, `iban`, `addressLine2`, ...) is ALWAYS omitted rather than
 * emitted empty — already true of the base bridge before this provider existed.
 */
import { DocumentInstanceResult } from '../actions/action-registry';
import { DocumentTypeDescriptor } from '../descriptors/types';
import { DocumentFormatBuildResult, DocumentFormatParty, DocumentFormatProvider } from './format-provider';
import { buildEuInvoiceForDocument, newEuInvoiceService } from './shared-build';
import { validateStructural } from './structural-check';
import { EN16931_UBL_SCH, PEPPOL_BIS_UBL_SCH, validateSchematron } from './vendored/validate-schematron';

/** Read VERBATIM from the vendored delta's own `<let name="profile">`/R004 test — see this file's
 *  own header. Not a made-up convention: it is the literal string the Schematron itself asserts. */
const PEPPOL_BIS_CUSTOMIZATION_ID =
  'urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0';

async function build(
  descriptor: DocumentTypeDescriptor,
  document: Pick<DocumentInstanceResult, 'id' | 'data' | 'displayNumber' | 'status'>,
  company: DocumentFormatParty,
  client: DocumentFormatParty,
): Promise<DocumentFormatBuildResult> {
  const euInvoice = buildEuInvoiceForDocument(descriptor, document, company, client, {
    customizationId: PEPPOL_BIS_CUSTOMIZATION_ID,
  });

  const service = newEuInvoiceService();
  const xml = (await service.generate(euInvoice, { format: 'UBL', lang: 'en' })) as string;

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
