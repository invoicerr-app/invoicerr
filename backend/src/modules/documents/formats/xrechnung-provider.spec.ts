/**
 * THE MASTER PROOF for `xrechnung-provider.ts` (root TODO item 26, "Peppol/Allemagne") — same
 * discipline as `providers.spec.ts`/`peppol-bis-provider.spec.ts`: a hand-computed fixture goes
 * through the REAL build pipeline and the REAL vendored base EN 16931 Schematron PLUS the REAL
 * vendored KoSIT XRechnung delta (`vendored/de/XRechnung-UBL-validation-preprocessed.sch`) — never
 * mocked. See `xrechnung-provider.ts`'s own header for exactly which BR-DE-* rules this fixture was
 * built to satisfy, read from the ruleset itself, not invented.
 */
import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { DocumentTypeDescriptor } from '../descriptors/types';
import { DocumentFormatParty } from './format-provider';
import { xrechnungFormatProvider } from './xrechnung-provider';
import { EN16931_UBL_SCH, validateSchematron, XRECHNUNG_UBL_SCH } from './vendored/validate-schematron';
import { newEuInvoiceService, buildEuInvoiceForDocument } from './shared-build';

const descriptor: DocumentTypeDescriptor = buildInvoiceDescriptor();

/** ISO 13616's own published example IBAN (Deutsche Bundesbank) — checksum-valid, never a real
 *  account: the SAME category of clearly-fictitious-but-format-valid fixture value
 *  `providers.spec.ts`'s own 'FR12345678901' VAT number already is. Never used as a stand-in for a
 *  REAL company with no IBAN on file — see `xrechnung-provider.ts`'s own header, "JAMAIS un IBAN
 *  fabriqué", which is about production data, not a test fixture. */
const TEST_IBAN = 'DE89370400440532013000';

/** A COMPLETE German seller — Leitweg-ID-capable buyer reference, contact (phone/email already on
 *  every real Company), and an IBAN on file. Every BR-DE-* fact this delta demands, satisfied
 *  honestly by data actually present, never invented. */
const SELLER_DE_COMPLETE: DocumentFormatParty = {
  name: 'Muster GmbH',
  address: 'Musterstraße 1',
  city: 'Berlin',
  postalCode: '10117',
  country: 'Germany',
  email: 'contact@muster.example',
  phone: '+49301234567',
  iban: TEST_IBAN,
  partyIdentifiers: [{ scheme: 'VAT', value: 'DE123456789' }],
};

/** A German PUBLIC-SECTOR buyer — city/postalCode are non-nullable on the real Client model, so
 *  always present; BR-DE-8/9 need nothing more than that. */
const BUYER_DE_PUBLIC: DocumentFormatParty = {
  name: 'Stadt Musterstadt',
  address: 'Rathausplatz 1',
  city: 'Musterstadt',
  postalCode: '12345',
  country: 'Germany',
  partyIdentifiers: [],
};

/** Hand-computed, chiffrée à la main: one line at 19% VAT.
 *   line: 3 × 500.00 = 1500.00 ; VAT (19%) = 285.00 ; gross = 1785.00 */
const DOCUMENT_DATA = {
  client: 'client-1',
  issueDate: '2026-08-30',
  dueDate: '2026-09-30',
  currency: 'EUR',
  notes: 'Vielen Dank für Ihren Auftrag.',
  // BT-10 — a plausible Leitweg-ID SHAPE (region-participant-appendix), never asserted as a real,
  // registered one: the same "pattern-valid but clearly a fixture" discipline `providers.spec.ts`'s
  // own 'FR12345678901' already holds. Wired via the DE country-fields overlay's own `buyerReference`
  // field (`country-fields/data/de.json`) when a real DE company fills it in on screen; set directly
  // here because this spec builds `data` by hand, exactly like every other master-proof fixture in
  // this directory does for `notes`/`supplyType`.
  buyerReference: '04011000-1234512345-06',
  lines: [{ description: 'Beratungsleistung', quantity: 3, unit: 'hour', unitPrice: 500, vatRate: '19' }],
};

const DOCUMENT = { id: 'doc-1', data: DOCUMENT_DATA, displayNumber: 'INV-2026-0003', status: 'sent' };

describe('xrechnung-provider — the master proof (fixture computed by hand)', () => {
  it('a COMPLETE DE-seller invoice (Leitweg-ID, contact, IBAN) builds an artifact BOTH the base Schematron AND the KoSIT delta accept — 0 error', async () => {
    const result = await xrechnungFormatProvider.build(
      descriptor,
      DOCUMENT,
      SELLER_DE_COMPLETE,
      BUYER_DE_PUBLIC,
    );

    // A failing assertion here prints EVERY BR-DE-* rule the vendored delta actually fired — never
    // swallowed, per this ticket's own "a gate, not a report" requirement.
    expect(result.validation.errors).toEqual([]);
    expect(result.validation.valid).toBe(true);

    const xml = Buffer.from(result.bytes).toString('utf-8');
    expect(xml).toContain(
      '<cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0</cbc:CustomizationID>',
    );
    // BT-10 (BR-DE-15).
    expect(xml).toContain('<cbc:BuyerReference>04011000-1234512345-06</cbc:BuyerReference>');
    // BG-6 SELLER CONTACT (BR-DE-2/5/6/7) — Name/Telephone/ElectronicMail all present.
    expect(xml).toContain('<cbc:Name>Muster GmbH</cbc:Name>');
    expect(xml).toContain('<cbc:Telephone>+49301234567</cbc:Telephone>');
    expect(xml).toContain('<cbc:ElectronicMail>contact@muster.example</cbc:ElectronicMail>');
    // BG-16/BG-17 (BR-DE-1/BR-DE-23-a) — PaymentMeansCode 30 + the IBAN, never fabricated (see
    // `sellerPaymentMeans`'s own header for why '30', not '58', is the code this bridge emits).
    expect(xml).toContain('<cbc:PaymentMeansCode>30</cbc:PaymentMeansCode>');
    expect(xml).toContain(`<cbc:ID>${TEST_IBAN}</cbc:ID>`);
    // The figures compute-totals.ts produced — never a re-sum.
    expect(xml).toContain('1785.00');
  }, 30_000);

  it('THE NAMED REFUSAL: the SAME invoice with NO IBAN on file refuses, citing BR-DE-1 — never a fabricated IBAN', async () => {
    const sellerNoIban: DocumentFormatParty = { ...SELLER_DE_COMPLETE, iban: undefined };
    const result = await xrechnungFormatProvider.build(descriptor, DOCUMENT, sellerNoIban, BUYER_DE_PUBLIC);

    expect(result.validation.valid).toBe(false);
    const joined = result.validation.errors.join(' | ');
    expect(joined).toContain('BR-DE-1');
    expect(joined).toContain('PAYMENT INSTRUCTIONS');
    // MUTATION TARGET 2 — if a future change ever served the bytes despite `valid: false` (e.g. the
    // caller stops checking `validation.valid` before writing the response), this is the assertion
    // that would need to start failing to hide it: the artifact must never be usable-looking just
    // because bytes exist.
    expect(result.bytes.length).toBeGreaterThan(0); // bytes ARE produced (for diagnostics)...
    expect(result.validation.valid).not.toBe(true); // ...but MUST NEVER be reported as valid.
  }, 30_000);

  it('MUTATION TARGET 1 — with the delta disconnected (base alone), the no-IBAN artifact is wrongly accepted; the delta is what actually catches it', async () => {
    const sellerNoIban: DocumentFormatParty = { ...SELLER_DE_COMPLETE, iban: undefined };
    const euInvoice = buildEuInvoiceForDocument(descriptor, DOCUMENT, sellerNoIban, BUYER_DE_PUBLIC, {
      customizationId: 'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0',
    });
    const xml = (await newEuInvoiceService().generate(euInvoice, { format: 'UBL', lang: 'en' })) as string;

    const base = validateSchematron(xml, EN16931_UBL_SCH);
    expect(base.valid).toBe(true); // base EN 16931 has no opinion on BG-16 at all — BR-DE-1 is DE-only

    const delta = validateSchematron(xml, XRECHNUNG_UBL_SCH);
    expect(delta.valid).toBe(false);
    expect(delta.errors.map((e) => e.id)).toContain('BR-DE-1');

    // The provider's own full build must agree with the delta alone, not with the base alone — if
    // `xrechnung-provider.ts#build` ever stopped running the delta, THIS is the assertion that would
    // start failing (the document would be silently served).
    const result = await xrechnungFormatProvider.build(descriptor, DOCUMENT, sellerNoIban, BUYER_DE_PUBLIC);
    expect(result.validation.valid).toBe(false);
  }, 30_000);

  it('Leitweg-ID present → BT-10 is emitted; absent → BR-DE-15 refuses, naming BT-10 — the rule applied exactly as written', async () => {
    const { buyerReference: _omitted, ...dataWithoutReference } = DOCUMENT_DATA;
    const documentWithoutReference = { ...DOCUMENT, data: dataWithoutReference };

    const result = await xrechnungFormatProvider.build(
      descriptor,
      documentWithoutReference,
      SELLER_DE_COMPLETE,
      BUYER_DE_PUBLIC,
    );
    expect(result.validation.valid).toBe(false);
    const joined = result.validation.errors.join(' | ');
    expect(joined).toContain('BR-DE-15');
    expect(joined).toContain('Buyer reference');
  }, 30_000);

  // The real-world case XRechnung exists for: a NON-German seller invoicing a German public body.
  // No country lock on this provider (see xrechnung-provider.ts's own header) — the data
  // REQUIREMENTS apply to every seller alike, satisfied here by the SAME mechanisms (a French
  // company can have phone/email/IBAN on file exactly like a German one), and BT-10 flows through the
  // SAME generic `data.buyerReference` regardless of which country-fields overlay (if any) put a
  // screen control in front of it for THIS seller — France's own `fr.json` overlay does not, so this
  // fixture sets it directly, exactly like providers.spec.ts already does for `notes`/`supplyType`.
  it('a FRENCH seller can build a valid XRechnung for a German public buyer — the format is country-neutral', async () => {
    const frenchSellerComplete: DocumentFormatParty = {
      name: 'Dupont Consulting SARL',
      address: '12 Rue de la Paix',
      city: 'Paris',
      postalCode: '75002',
      country: 'France',
      email: 'contact@dupont-consulting.example',
      phone: '+33102030405',
      iban: 'FR7630006000011234567890189', // ISO 13616 published FR example — same discipline as TEST_IBAN
      partyIdentifiers: [{ scheme: 'VAT', value: 'FR12345678901' }],
    };
    const result = await xrechnungFormatProvider.build(
      descriptor,
      DOCUMENT,
      frenchSellerComplete,
      BUYER_DE_PUBLIC,
    );
    expect(result.validation.errors).toEqual([]);
    expect(result.validation.valid).toBe(true);
  }, 30_000);
});
