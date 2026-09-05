/**
 * THE MASTER PROOF for `nlcius-provider.ts` (root TODO, "NLCIUS vendorable" — mandant "Go",
 * 2026-09-05) — same discipline as `xrechnung-provider.spec.ts`/`providers.spec.ts`: a hand-computed
 * fixture goes through the REAL build pipeline and the REAL vendored base EN 16931 Schematron PLUS
 * the REAL vendored NLCIUS delta (`vendored/nl/si-ubl-2.0-nlcius-preprocessed.sch`) — never mocked.
 * See `nlcius-provider.ts`'s own header for exactly which BR-NL-* rules this fixture was built to
 * satisfy, read from the ruleset itself, not invented.
 */
import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { DocumentTypeDescriptor } from '../descriptors/types';
import { DocumentFormatParty } from './format-provider';
import { nlciusFormatProvider } from './nlcius-provider';
import { EN16931_UBL_SCH, NLCIUS_UBL_SCH, validateSchematron } from './vendored/validate-schematron';
import { newEuInvoiceService, buildEuInvoiceForDocument } from './shared-build';

const descriptor: DocumentTypeDescriptor = buildInvoiceDescriptor();

/** ISO 13616's own published example IBAN (ABN AMRO) — checksum-valid, never a real account, the SAME
 *  "clearly-fictitious-but-format-valid" discipline `xrechnung-provider.spec.ts`'s own `TEST_IBAN`
 *  already holds. */
const TEST_IBAN_NL = 'NL91ABNA0417164300';

/** A COMPLETE Dutch seller — an 8-digit KVK-nummer as `LEGAL_ID` (tagged schemeID `0106` for BR-NL-1
 *  by `semantic/build-semantic-invoice.ts#LEGAL_ID_SCHEME_BY_COUNTRY`), a full address (BR-NL-3), and
 *  an IBAN on file (BR-NL-11/12, `sellerPaymentMeans()`, ALWAYS code `'30'` — already in BR-NL-12's
 *  own allowed set). Every BR-NL-* fact this delta demands from the SUPPLIER, satisfied honestly by
 *  data actually present, never invented. */
const SELLER_NL_COMPLETE: DocumentFormatParty = {
  name: 'Voorbeeld B.V.',
  address: 'Damrak 1',
  city: 'Amsterdam',
  postalCode: '1012 LG',
  country: 'Netherlands',
  email: 'contact@voorbeeld.example',
  phone: '+31201234567',
  iban: TEST_IBAN_NL,
  partyIdentifiers: [
    { scheme: 'VAT', value: 'NL123456789B01' },
    { scheme: 'LEGAL_ID', value: '12345678' },
  ],
};

/** A Dutch PUBLIC-SECTOR buyer — a full address (BR-NL-4, "if the customer is in the Netherlands")
 *  AND its OWN KVK-nummer (BR-NL-10, the SAME rule, for the customer's own legal entity identifier —
 *  a DIFFERENT fact from the seller's own KVK above). `country-identifiers/data/nl.json` only models
 *  the KVK-nummer scheme (never the OIN some real Dutch public bodies carry instead — see
 *  `b2g-routing/data/nl.json`'s own header on this named, honest limitation), so a KVK-shaped value is
 *  used here too. */
const BUYER_NL_GOV: DocumentFormatParty = {
  name: 'Gemeente Teststad',
  address: 'Stadhuisplein 1',
  city: 'Teststad',
  postalCode: '1234 AB',
  country: 'Netherlands',
  partyIdentifiers: [{ scheme: 'LEGAL_ID', value: '87654321' }],
};

/** Hand-computed, chiffrée à la main: one line at 21% VAT (the Dutch standard rate).
 *   line: 4 × 250.00 = 1000.00 ; VAT (21%) = 210.00 ; gross = 1210.00 */
const DOCUMENT_DATA = {
  client: 'client-1',
  issueDate: '2026-09-05',
  dueDate: '2026-10-05',
  currency: 'EUR',
  notes: 'Bedankt voor uw opdracht.',
  // BT-10/BR-NL-2 — set directly here because this spec builds `data` by hand, exactly like every
  // other master-proof fixture in this directory does for `notes`/`supplyType`/`buyerReference`
  // (`xrechnung-provider.spec.ts`'s own identical convention) — no `country-fields/data/nl.json`
  // overlay exists yet, a named, honest gap (`nlcius-provider.ts`'s own header, BR-NL-2 bullet).
  buyerReference: 'PO-2026-00042',
  lines: [{ description: 'Adviesdiensten', quantity: 4, unit: 'hour', unitPrice: 250, vatRate: '21' }],
};

const DOCUMENT = { id: 'doc-1', data: DOCUMENT_DATA, displayNumber: 'INV-2026-0004', status: 'sent' };

describe('nlcius-provider — the master proof (fixture computed by hand)', () => {
  it('a COMPLETE NL-seller × NL-government-buyer invoice (KVK on both sides, buyer reference, IBAN) builds an artifact BOTH the base Schematron AND the NLCIUS delta accept — 0 error', async () => {
    const result = await nlciusFormatProvider.build(descriptor, DOCUMENT, SELLER_NL_COMPLETE, BUYER_NL_GOV);

    // A failing assertion here prints EVERY BR-NL-* rule the vendored delta actually fired — never
    // swallowed, per this ticket's own "a gate, not a report" requirement.
    expect(result.validation.errors).toEqual([]);
    expect(result.validation.valid).toBe(true);

    const xml = Buffer.from(result.bytes).toString('utf-8');
    expect(xml).toContain(
      '<cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:nen.nl:nlcius:v1.0</cbc:CustomizationID>',
    );
    // BT-10 (BR-NL-2).
    expect(xml).toContain('<cbc:BuyerReference>PO-2026-00042</cbc:BuyerReference>');
    // BT-30 (BR-NL-1) — the SELLER's own KVK-nummer, schemeID 0106.
    expect(xml).toMatch(/cbc:CompanyID schemeID="0106">12345678<\/cbc:CompanyID>/);
    // BT-47-equivalent (BR-NL-10) — the BUYER's own KVK-nummer, schemeID 0106.
    expect(xml).toMatch(/cbc:CompanyID schemeID="0106">87654321<\/cbc:CompanyID>/);
    // BG-16/BG-17 (BR-NL-11/12) — PaymentMeansCode 30 + the IBAN, never fabricated.
    expect(xml).toContain('<cbc:PaymentMeansCode>30</cbc:PaymentMeansCode>');
    expect(xml).toContain(`<cbc:ID>${TEST_IBAN_NL}</cbc:ID>`);
    // The figures compute-totals.ts produced — never a re-sum.
    expect(xml).toContain('1210.00');
  }, 30_000);

  it('THE NAMED REFUSAL: the SAME invoice with the seller carrying NO KVK/OIN number refuses, citing BR-NL-1 — never a fabricated identifier', async () => {
    const sellerNoKvk: DocumentFormatParty = {
      ...SELLER_NL_COMPLETE,
      partyIdentifiers: [{ scheme: 'VAT', value: 'NL123456789B01' }], // LEGAL_ID removed — the ONE fact missing
    };
    const result = await nlciusFormatProvider.build(descriptor, DOCUMENT, sellerNoKvk, BUYER_NL_GOV);

    expect(result.validation.valid).toBe(false);
    const joined = result.validation.errors.join(' | ');
    expect(joined).toContain('BR-NL-1');
    expect(joined).toContain('KVK');
    // MUTATION TARGET 2 — if a future change ever served the bytes despite `valid: false` (e.g. the
    // caller stops checking `validation.valid` before writing the response), this is the assertion
    // that would need to start failing to hide it: the artifact must never be usable-looking just
    // because bytes exist.
    expect(result.bytes.length).toBeGreaterThan(0); // bytes ARE produced (for diagnostics)...
    expect(result.validation.valid).not.toBe(true); // ...but MUST NEVER be reported as valid.
  }, 30_000);

  it('MUTATION TARGET 1 — with the delta disconnected (base alone), the no-KVK artifact is wrongly accepted; the delta is what actually catches it', async () => {
    const sellerNoKvk: DocumentFormatParty = {
      ...SELLER_NL_COMPLETE,
      partyIdentifiers: [{ scheme: 'VAT', value: 'NL123456789B01' }],
    };
    const euInvoice = buildEuInvoiceForDocument(descriptor, DOCUMENT, sellerNoKvk, BUYER_NL_GOV, {
      customizationId: 'urn:cen.eu:en16931:2017#compliant#urn:fdc:nen.nl:nlcius:v1.0',
    });
    const xml = (await newEuInvoiceService().generate(euInvoice, { format: 'UBL', lang: 'en' })) as string;

    const base = validateSchematron(xml, EN16931_UBL_SCH);
    expect(base.valid).toBe(true); // base EN 16931 has no opinion on a KVK/OIN scheme — BR-NL-1 is NL-only

    const delta = validateSchematron(xml, NLCIUS_UBL_SCH);
    expect(delta.valid).toBe(false);
    expect(delta.errors.map((e) => e.id)).toContain('BR-NL-1');

    // The provider's own full build must agree with the delta alone, not with the base alone — if
    // `nlcius-provider.ts#build` ever stopped running the delta, THIS is the assertion that would
    // start failing (the document would be silently served).
    const result = await nlciusFormatProvider.build(descriptor, DOCUMENT, sellerNoKvk, BUYER_NL_GOV);
    expect(result.validation.valid).toBe(false);
  }, 30_000);

  it('buyer reference present → BT-10 is emitted; absent (and no order reference either) → BR-NL-2 refuses, naming the buyer/order reference — the rule applied exactly as written', async () => {
    const { buyerReference: _omitted, ...dataWithoutReference } = DOCUMENT_DATA;
    const documentWithoutReference = { ...DOCUMENT, data: dataWithoutReference };

    const result = await nlciusFormatProvider.build(
      descriptor,
      documentWithoutReference,
      SELLER_NL_COMPLETE,
      BUYER_NL_GOV,
    );
    expect(result.validation.valid).toBe(false);
    const joined = result.validation.errors.join(' | ');
    expect(joined).toContain('BR-NL-2');
    expect(joined).toContain('buyer reference');
  }, 30_000);

  // THE GENUINE STRUCTURAL DIFFERENCE FROM XRECHNUNG (see `nlcius-provider.ts`'s own header,
  // "COUNTRY-NEUTRAL BY DESIGN"): EVERY BR-NL-* rule is scoped to `[$s]` — the SUPPLIER being Dutch —
  // unlike BR-DE-*, which applies to any seller alike. A French seller therefore builds a valid NLCIUS
  // document for this SAME Dutch government buyer (KVK included) WITHOUT itself needing a KVK/OIN
  // number, a Dutch-shaped address, a buyer reference, or even an IBAN — none of BR-NL-1/2/3/11/12
  // ever fire for it. Only the base EN 16931 rules (VAT etc.) and the unconditional CustomizationID
  // gate (`[SI-V20-INV-R000]`) still apply — proven here, not assumed by analogy with XRechnung.
  it('a FRENCH seller can build a valid NLCIUS document for a Dutch government buyer — none of the BR-NL-* rules fire for a non-Dutch supplier', async () => {
    const frenchSellerMinimal: DocumentFormatParty = {
      name: 'Dupont Consulting SARL',
      address: '12 Rue de la Paix',
      city: 'Paris',
      postalCode: '75002',
      country: 'France',
      partyIdentifiers: [{ scheme: 'VAT', value: 'FR12345678901' }],
      // Deliberately NO iban, NO LEGAL_ID, NO phone/email — none of BR-NL-1/3/11/12 apply to a
      // non-Dutch supplier, so none of that data is needed for this to validate.
    };
    const result = await nlciusFormatProvider.build(descriptor, DOCUMENT, frenchSellerMinimal, BUYER_NL_GOV);
    expect(result.validation.errors).toEqual([]);
    expect(result.validation.valid).toBe(true);

    const xml = Buffer.from(result.bytes).toString('utf-8');
    // Still tagged as NLCIUS content (the unconditional CustomizationID gate), even though none of
    // the Dutch-supplier-specific rules had anything to check for THIS seller.
    expect(xml).toContain('urn:cen.eu:en16931:2017#compliant#urn:fdc:nen.nl:nlcius:v1.0');

    // Mandataire tripwire (validation NLCIUS, 2026-09-05): the buyer's LEGAL_ID scheme is keyed on
    // the BUYER's OWN country — build-semantic-invoice.ts's fix of the latent seller-gated defect.
    // Every other fixture in this file has seller and buyer BOTH Dutch, where the two gatings are
    // indistinguishable; THIS one (French seller, Dutch buyer) is the only place they diverge.
    // Proven to bite: re-gating on the seller's country stamps the Dutch KVK with '0002' (the
    // French SIREN scheme — an invented registry membership) and this assertion fails.
    expect(xml).toMatch(/schemeID="0106">87654321</);
  }, 30_000);
});
