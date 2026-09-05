/**
 * SI-UBL 2.0 / NLCIUS (Peppol Autoriteit NL) — the UBL syntax `ubl-provider.ts` already builds,
 * judged by the SAME base EN 16931 Schematron PLUS the vendored NLCIUS delta
 * (`vendored/nl/si-ubl-2.0-nlcius-preprocessed.sch`) RUNNING ON TOP OF IT — never instead of it, the
 * exact same shape `xrechnung-provider.ts` (DE) and `peppol-bis-provider.ts` already hold for their
 * own national/generic deltas. See that vendored file's own header for the full provenance (origin
 * repo, tag, MIT license, what was and was not vendored) and for the XPST0017 check (this delta
 * declares ZERO `xsl:function`s — nothing to register in `vendored/validate-schematron.ts`).
 *
 * ## MANDANT DECISION (root TODO, "NLCIUS vendorable" — "Go" 2026-09-05)
 *
 * `TODO_DOCUMENTS.md`'s own pending-decision entry recorded that the NL agent had established the
 * official repo (github.com/peppolautoriteit-nl/validation, Peppol Autoriteit NL / Stichting
 * Simplerinvoicing) ships `si-ubl-2.0.sch` (incl. the NLCIUS rules) under an MIT `LICENSE.txt` — this
 * REOPENS `B2G_COVERAGE.md`'s prior "🟡 pas livrable" verdict for the Netherlands (its ONLY blocker
 * was "CIUS NL — NLCIUS ... non [vendorable]"). This provider, plus `b2g-routing/data/nl.json` and
 * the `formatOverrides` wiring in `documents-core.module.ts`, is what makes it livrable — the SAME
 * three-piece mechanism DE's own XRechnung wiring established (fe61e3e8): a format provider, a B2G
 * routing rule, and a Peppol transport format override.
 *
 * ## COUNTRY-NEUTRAL BY DESIGN — read this before assuming a NL seller check belongs here
 *
 * Same discipline as `xrechnung-provider.ts`'s own header: NLCIUS is a FORMAT, not a residency
 * requirement — any seller may issue one to a Dutch government buyer. This provider never inspects
 * `company.country` itself; the vendored delta's OWN rules are what condition most of their
 * assertions on the SUPPLIER actually being Dutch (`$s` in the vendored `.sch`, `supplierIsNL`) —
 * exactly the same `[$s]`-gated shape the GENERIC Peppol BIS delta already carries for its own
 * `NL-R-*` siblings (`vendored/peppol/PEPPOL-EN16931-UBL.sch:860-920`).
 *
 * ## What BR-NL-* actually demanded, read from the vendored .sch's own fatal `<assert>`s
 *
 *  - `[SI-V20-INV-R000]` (fatal, unconditional): `cbc:CustomizationID` must start with
 *    `urn:cen.eu:en16931:2017#compliant#urn:fdc:nen.nl:nlcius:v1.0` — comblé directly below,
 *    `NLCIUS_CUSTOMIZATION_ID`, the SAME override mechanism `xrechnung-provider.ts`/
 *    `peppol-bis-provider.ts` already use for their own profile ids.
 *  - BR-NL-1 (fatal, supplier-in-NL only): the supplier's `cac:PartyLegalEntity/cbc:CompanyID` must
 *    carry ISO 6523 schemeID `0106` (KVK) or `0190` (OIN), non-empty. Comblé by
 *    `semantic/build-semantic-invoice.ts`'s own `LEGAL_ID_SCHEME_BY_COUNTRY` map (NEW: `NL` → `0106`,
 *    the same "country is data" mechanism FR's own SIRET→SIREN/`0002` derivation already holds),
 *    itself fed by the EXISTING generic `LEGAL_ID` party identifier
 *    (`country-identifiers/data/nl.json`'s own KVK-nummer scheme — already `required: true` for every
 *    Dutch company/client). A Dutch seller with no KVK number on file → refused, NAMED, by BR-NL-1.
 *  - BR-NL-2 (fatal, supplier-in-NL only): `cbc:BuyerReference` (BT-10) OR `cac:OrderReference/cbc:ID`
 *    (BT-13) — comblé by the SAME generic `data.buyerReference` mechanism DE's own Leitweg-ID uses
 *    (`shared-build.ts#extractBuyerReference`); no NL-specific screen field is added by this task (no
 *    `country-fields/data/nl.json` overlay exists yet — a Dutch seller has no dedicated input for this
 *    field today, the identical, already-documented UX gap `country-fields/data/de.json`'s own header
 *    calls out for a foreign seller invoicing a German public body).
 *  - BR-NL-3/4/5 (fatal, supplier-in-NL only, conditionally for BR-NL-4/5): supplier/customer/fiscal-
 *    representative address must carry street/city/postal zone — ALREADY always satisfied by the
 *    existing model (`postalAddress()`'s own `Company`/`Client` `address`/`city`/`postalCode`, the
 *    SAME non-nullable columns `xrechnung-provider.ts`'s own header already cites for its BR-DE-3/4).
 *  - BR-NL-7 (fatal, supplier-in-NL only): `cbc:InvoiceTypeCode` must be one of 380/381/384/389 —
 *    ALREADY always satisfied: this bridge only ever emits `'380'` (Commercial invoice) for the
 *    INVOICE document type (`build-semantic-invoice.ts`'s own header, "BT-3").
 *  - BR-NL-10 (fatal, supplier-in-NL only, conditionally when the CUSTOMER is also in NL): mirrors
 *    BR-NL-1 for the BUYER's own `cac:PartyLegalEntity/cbc:CompanyID` — comblé by the SAME
 *    `LEGAL_ID_SCHEME_BY_COUNTRY` map, now keyed on the BUYER's own country (see that file's own
 *    header for why the buyer's gate was fixed to read the buyer's OWN country rather than the
 *    seller's).
 *  - BR-NL-11/12 (fatal, supplier-in-NL only): a means of payment is required whenever
 *    `cac:LegalMonetaryTotal/cbc:PayableAmount` is positive, and its `cbc:PaymentMeansCode` must be
 *    one of 30/48/49/57/58/59 — comblé by the EXISTING `sellerPaymentMeans()` (emitted whenever
 *    `Company.iban` is on file, ALWAYS with code `'30'` — "Credit transfer", already in that allowed
 *    set — see that function's own header). A Dutch seller with no IBAN on file and a positive total
 *    → refused, NAMED, by BR-NL-11 — exactly the same shape `xrechnung-provider.ts`'s own BR-DE-1
 *    already documents for the IBAN-less case.
 *  - Every OTHER BR-NL-* (8, 9, 13, 19-35) is either a non-fatal `warning` (never blocks — this
 *    provider's own gate only ever inspects `flag="fatal"` failures, same as every sibling provider),
 *    or a fatal rule this bridge structurally never triggers (BR-NL-8/9 concern credit notes and
 *    corrective invoices, neither of which this provider builds; BR-NL-13 concerns an order LINE
 *    reference this bridge never emits without a matching order reference).
 *
 * ## DÉCISION : le delta est BLOQUANT (même discipline que XRechnung, jamais un avertissement avalé)
 *
 * Same reasoning as `xrechnung-provider.ts`'s own "DÉCISION" section: every field BR-NL-1/2/11 demand
 * (a KVK/OIN-tagged legal id, a buyer reference or order reference, an IBAN) already exists on the
 * model today — a refusal NAMES exactly which one is missing and where to fill it in. Running this
 * delta non-blocking would serve a Dutch government buyer an artifact that LOOKS like a valid NLCIUS
 * invoice while failing the very rules that make it one — precisely what this codebase refuses
 * elsewhere (`format-registry.ts`, `structural-check.ts`, `xrechnung-provider.ts`'s own precedent).
 */
import { DocumentInstanceResult } from '../actions/action-registry';
import { DocumentTypeDescriptor } from '../descriptors/types';
import { DocumentFormatBuildResult, DocumentFormatParty, DocumentFormatProvider } from './format-provider';
import { buildEuInvoiceForDocument, newEuInvoiceService } from './shared-build';
import { validateStructural } from './structural-check';
import { EN16931_UBL_SCH, NLCIUS_UBL_SCH, validateSchematron } from './vendored/validate-schematron';

/**
 * Read VERBATIM from the vendored delta's own `[SI-V20-INV-R000]` fatal assert
 * (`vendored/nl/si-ubl-2.0-nlcius-preprocessed.sch`, pattern `SI-UBL-VERSION`) — the plain "base"
 * NLCIUS profile (`#compliant#...:nlcius:v1.0`), never the separate, optional g-account extension
 * profile (`#conformant#...:gaccount:v1.0`) that same vendored file's own "nlcius" pattern also
 * recognizes but this bridge builds nothing for — see that file's own header, point 1.
 */
const NLCIUS_CUSTOMIZATION_ID = 'urn:cen.eu:en16931:2017#compliant#urn:fdc:nen.nl:nlcius:v1.0';

async function build(
  descriptor: DocumentTypeDescriptor,
  document: Pick<DocumentInstanceResult, 'id' | 'data' | 'displayNumber' | 'status'>,
  company: DocumentFormatParty,
  client: DocumentFormatParty,
): Promise<DocumentFormatBuildResult> {
  const euInvoice = buildEuInvoiceForDocument(descriptor, document, company, client, {
    customizationId: NLCIUS_CUSTOMIZATION_ID,
  });

  const service = newEuInvoiceService();
  const xml = (await service.generate(euInvoice, { format: 'UBL', lang: 'en' })) as string;

  const structural = validateStructural(xml, 'ubl');
  if (!structural.valid) {
    return { bytes: new TextEncoder().encode(xml), validation: { valid: false, errors: structural.errors } };
  }

  // BOTH gates run, and BOTH must pass — see this file's own header, "DÉCISION : le delta est
  // BLOQUANT". An artifact that trips a single BR-NL-* fatal rule is never served.
  const base = validateSchematron(xml, EN16931_UBL_SCH);
  const delta = validateSchematron(xml, NLCIUS_UBL_SCH);
  const errors = [
    ...base.errors.map((e) => `${e.id}: ${e.message}`),
    ...delta.errors.map((e) => `${e.id}: ${e.message}`),
  ];

  return {
    bytes: new TextEncoder().encode(xml),
    validation: { valid: base.valid && delta.valid, errors },
  };
}

export const nlciusFormatProvider: DocumentFormatProvider = {
  id: 'nlcius',
  syntax: 'NLCIUS_UBL',
  mime: 'application/xml',
  build,
};
