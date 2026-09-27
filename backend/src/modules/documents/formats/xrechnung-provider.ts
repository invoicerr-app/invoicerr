/**
 * XRechnung 3.0.x (KoSIT) — the UBL syntax `ubl-provider.ts` already builds, judged by the SAME base
 * EN 16931 Schematron PLUS the vendored KoSIT delta
 * (`vendored/de/XRechnung-UBL-validation-preprocessed.sch`) RUNNING ON TOP OF IT — never instead of
 * it, exactly like `peppol-bis-provider.ts`'s own sibling gate.
 *
 * ## COUNTRY-NEUTRAL BY DESIGN — read this before assuming a DE seller check belongs here
 *
 * XRechnung is a FORMAT, not a residency requirement: a seller in ANY country can issue one to a
 * German public-sector buyer (the real-world case this standard exists for — a Leitweg-ID only makes
 * sense addressed to a German Behörde, but the SENDER need not be German). This provider therefore
 * never inspects `company.country` — the exact same "no business code names a country" discipline
 * `format-registry.ts` already holds for the registry itself. The DATA the delta demands (BT-10,
 * seller contact, an IBAN) is required of EVERY seller that requests this syntax, French or German
 * alike; only the DE `country-fields/` overlay (below) happens to be the one screen that offers a
 * Leitweg-ID input today — a seller from another country can still supply the exact same
 * `data.buyerReference` value some other way (see `build-semantic-invoice.ts`'s own header) and the
 * bridge does not care where it came from.
 *
 * ## What BR-DE-* actually demanded, read from the vendored .sch's own fatal `<assert>`s
 *
 *  - BR-DE-15 (fatal): `cbc:BuyerReference` (BT-10) non-empty. Filled by the GENERIC mechanism
 *    (`build-semantic-invoice.ts`'s `buyerReference`, fed by `data.buyerReference`) — the ONLY
 *    screen input known today is the Leitweg-ID field added by the DE country overlay
 *    (`country-fields/data/de.json`, add, path `''`, optional — never a generic field imposed on
 *    every country on the trunk descriptor). Absent → named refusal BR-DE-15, exactly the gate's
 *    expected behaviour.
 *  - BR-DE-2/5/6/7 (fatal): SELLER CONTACT (name/phone/email) — filled by `sellerContact`
 *    (`build-semantic-invoice.ts`), itself fed by `Company.phone`/`Company.email` (existing
 *    NON-NULLABLE columns) and `Company.name` for the contact point's name. NO new field required:
 *    every real seller already has them.
 *  - BR-DE-1/BR-DE-23-a/BR-DE-23-b (fatal): BG-16/BG-17 (`cac:PaymentMeans`/`PayeeFinancialAccount`).
 *    Filled by `sellerPaymentMeans`, fed by the NEW `Company.iban` column (optional, migrated on
 *    both databases — see schema.prisma). Absent → named refusal BR-DE-1, citing the IBAN field to
 *    fill in (see the message below).
 *  - BR-DE-3/4/8/9/14 (fatal): seller+buyer city/postal code non-empty, VAT rate non-empty — ALREADY
 *    ALWAYS satisfied by the existing model (Company/Client `city`/`postalCode` are non-nullable
 *    columns; `cbc:Percent` is already always emitted by `build-semantic-invoice.ts`).
 *  - BR-DE-16 (fatal, conditional on VAT codes S/Z/E/AE/K/G/L/M): requires BT-31 (seller VAT) or
 *    BG-11 — already covered by the BASE DE layer (BR-S-02/BR-Z-02 of the EN16931 Schematron itself
 *    already refuse a seller with no VAT the moment a line is at a standard/zero rate — see
 *    `build-semantic-invoice.ts`'s own header, "VAT category" section).
 *  - The rest of the fatal BR-DE-* / BR-DEX-* / BR-DE-CVD-* rules (22, DEX-*, CVD-*) only fire for
 *    scenarios this bridge does not build at all (attachments, DEX sub-lines, CVD vehicles) — never
 *    triggered by a normal invoice, so nothing to fill.
 *
 * ## BT-23 (`cbc:ProfileID`): the KoSIT delta is silent, the SPECIFICATION is not
 *
 * The vendored delta contains ZERO assertions on `cbc:ProfileID` (grep it: no `ProfileID`, no
 * `BT-23`, no `PEPPOL-EN16931-*` rule at all), so this gate cannot see that element and never will.
 * The requirement is normative in the XRechnung standard document itself, not in the Schematron:
 *
 *  - "Spezifikation Standard XRechnung CIUS und Extension", Version 3.0.2 (KoSIT, 2024-06-20),
 *    section 11.27 "Gruppe PROCESS CONTROL": `Business process type` BT-23, `Anz. 1`, MANDATORY,
 *    raised from EN 16931's own 0..1 (section 12.5 lists PEPPOL-EN16931-R001, "Das Element
 *    'Business process type' (BT-23) muss uebermittelt werden", among the Peppol BIS Billing 3.0
 *    rules adopted verbatim into the XRechnung CIUS).
 *  - The same section's `Anmerkung`, verbatim: "Die mit diesem Informationselement zu uebermittelnde
 *    Angabe wird vom Erwerber spezifiziert. Innerhalb des Peppol eDelivery Networks ist
 *    PEPPOL-EN16931-R007 ('Business process MUST be in the format
 *    urn:fdc:peppol.eu:2017:poacc:billing:NN:1.0 where NN indicates the process number.') zu
 *    beachten. Wurde keine Vorgabe zur Befuellung des zu uebermittelnden Feldes gemacht, kann als
 *    Default-Wert 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0' uebermittelt werden."
 *
 * So the value belongs to the BUYER's process, with the Peppol billing URN as the documented
 * default, and on the Peppol route (the one German public buyers are reached through) the URN FORMAT
 * is outright mandatory. A mandated French seller (issueDate on or after 2026-09-01) otherwise has
 * `business-process.ts#resolveFrenchBusinessProcessCode` write a French CGI code (B1/S1/M1/...) into
 * this very element: a "cadre de facturation" category from CGI ann. II art. 242 nonies A, which is
 * neither a URN nor anything a German Erwerber specified. BT-23 has different homes per SYNTAX, not
 * per seller, and the French code's home is the CII/Factur-X channel, untouched here. This bridge
 * therefore passes `businessProcessCodeOverride` below, the SAME mechanism `peppol-bis-provider.ts`
 * uses for GH-448 and `facturx-provider.ts`'s Chorus Pro instance for its own reason.
 *
 * READ THIS BEFORE TRUSTING A GREEN RUN: because the delta has no assertion on the element, the
 * KoSIT gate accepts `<cbc:ProfileID>M1</cbc:ProfileID>` and the corrected URN alike. Measured, not
 * assumed. `xrechnung-provider.spec.ts`'s BT-23 test is the ONLY guard on this value.
 *
 * ## DECISION: the delta is BLOCKING (unlike at the reference)
 *
 * At the `avant-refonte-documents` reference (`compliance/providers/format/providers.ts`), the
 * XRechnung delta ran non-blocking — its own written justification was that "the data does not exist
 * in the model" (no Leitweg-ID, no structured seller contact, no IBAN). That justification NO LONGER
 * HOLDS: the three fields now exist (Company.phone/email already there, Company.iban added, Leitweg-ID
 * via the DE overlay) and a refusal NAMES precisely which one is missing and where to fill it in.
 * Running this delta non-blocking today would do exactly what this project refuses elsewhere (see
 * `format-registry.ts`, `structural-check.ts`): serve an artifact that a German partner will reject,
 * while claiming it is valid. The delta is therefore BLOCKING, like every other gate in this registry
 * (structural, base EN16931, Peppol).
 */
import { DocumentInstanceResult } from '../actions/action-registry';
import { DocumentTypeDescriptor } from '../descriptors/types';
import { DocumentFormatBuildResult, DocumentFormatParty, DocumentFormatProvider } from './format-provider';
import { buildEuInvoiceForDocument, newEuInvoiceService } from './shared-build';
import { validateStructural } from './structural-check';
import { EN16931_UBL_SCH, validateSchematron, XRECHNUNG_UBL_SCH } from './vendored/validate-schematron';

/**
 * Read VERBATIM from the vendored delta's own `<let name="XR-CIUS-ID">` (BR-DE-21, warning-level,
 * accepts this exact value): `concat('urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:
 * xrechnung_', $XR-MAJOR-MINOR-VERSION)` with `$XR-MAJOR-MINOR-VERSION = '3.0'`. The plain "compliant"
 * profile — never the extension (`#conformant#...`) or CVD variants the same `<let>` block also
 * declares, neither of which this bridge builds anything for.
 */
const XRECHNUNG_CUSTOMIZATION_ID = 'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0';

/** BT-23. The Default-Wert the XRechnung 3.0.2 specification itself names for the case no buyer gave
 *  one (section 11.27, `Anmerkung`, quoted in this file's own header), and the one value that also
 *  satisfies PEPPOL-EN16931-R007 when the document travels over the Peppol eDelivery Network. It is
 *  byte-for-byte what `@e-invoice-eu/core` already emitted by default for every seller this codebase
 *  derives NO business process code for, so only a mandated French seller's document changes. */
const XRECHNUNG_BUSINESS_PROCESS_ID = 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0';

async function build(
  descriptor: DocumentTypeDescriptor,
  document: Pick<DocumentInstanceResult, 'id' | 'data' | 'displayNumber' | 'status'>,
  company: DocumentFormatParty,
  client: DocumentFormatParty,
): Promise<DocumentFormatBuildResult> {
  const euInvoice = buildEuInvoiceForDocument(descriptor, document, company, client, {
    customizationId: XRECHNUNG_CUSTOMIZATION_ID,
    businessProcessCodeOverride: XRECHNUNG_BUSINESS_PROCESS_ID,
  });

  const service = newEuInvoiceService();
  const xml = (await service.generate(euInvoice, { format: 'UBL', lang: 'en' })) as string;

  const structural = validateStructural(xml, 'ubl');
  if (!structural.valid) {
    return { bytes: new TextEncoder().encode(xml), validation: { valid: false, errors: structural.errors } };
  }

  // BOTH gates run, and BOTH must pass — see this file's own header, "DECISION: the delta is
  // BLOCKING". An artifact that trips a single BR-DE-* is never served.
  const base = validateSchematron(xml, EN16931_UBL_SCH);
  const delta = validateSchematron(xml, XRECHNUNG_UBL_SCH);
  const errors = [
    ...base.errors.map((e) => `${e.id}: ${e.message}`),
    ...delta.errors.map((e) => `${e.id}: ${e.message}`),
  ];

  return {
    bytes: new TextEncoder().encode(xml),
    validation: { valid: base.valid && delta.valid, errors },
  };
}

export const xrechnungFormatProvider: DocumentFormatProvider = {
  id: 'xrechnung',
  syntax: 'XRECHNUNG_UBL',
  mime: 'application/xml',
  build,
};
