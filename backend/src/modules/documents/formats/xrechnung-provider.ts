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

async function build(
  descriptor: DocumentTypeDescriptor,
  document: Pick<DocumentInstanceResult, 'id' | 'data' | 'displayNumber' | 'status'>,
  company: DocumentFormatParty,
  client: DocumentFormatParty,
): Promise<DocumentFormatBuildResult> {
  const euInvoice = buildEuInvoiceForDocument(descriptor, document, company, client, {
    customizationId: XRECHNUNG_CUSTOMIZATION_ID,
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
