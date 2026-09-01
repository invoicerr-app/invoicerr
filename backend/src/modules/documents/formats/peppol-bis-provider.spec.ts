/**
 * THE MASTER PROOF for `peppol-bis-provider.ts` (root TODO item 26, "Peppol/Allemagne") — same
 * discipline as `providers.spec.ts`: a hand-computed fixture goes through the REAL build pipeline and
 * the REAL vendored base EN 16931 Schematron PLUS the REAL vendored Peppol BIS delta
 * (`vendored/peppol/PEPPOL-EN16931-UBL.sch`) — never mocked, never a hand-asserted opinion of what
 * the ruleset would say.
 */
import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { DocumentTypeDescriptor } from '../descriptors/types';
import { DocumentFormatParty } from './format-provider';
import { peppolBisFormatProvider } from './peppol-bis-provider';
import { EN16931_UBL_SCH, PEPPOL_BIS_UBL_SCH, validateSchematron } from './vendored/validate-schematron';
import { newEuInvoiceService, buildEuInvoiceForDocument } from './shared-build';

const descriptor: DocumentTypeDescriptor = buildInvoiceDescriptor();

/** A German seller with NO country mentions file (`mentions/data/all.ts` ships only 'fr' today) —
 *  deliberately NOT the French seller `providers.spec.ts` uses, for the documented reason this
 *  file's own last `describe` block demonstrates: a French seller's three mandatory C. com. mentions
 *  would trip PEPPOL-EN16931-R002 ("no more than one note...") against a non-German buyer. */
const SELLER: DocumentFormatParty = {
  name: 'Muster GmbH',
  address: 'Musterstraße 1',
  city: 'Berlin',
  postalCode: '10117',
  country: 'Germany',
  email: 'contact@muster.example',
  phone: '+49301234567',
  partyIdentifiers: [{ scheme: 'VAT', value: 'DE123456789' }],
};

const BUYER: DocumentFormatParty = {
  name: 'Dupont Consulting SARL',
  address: '12 Rue de la Paix',
  city: 'Paris',
  postalCode: '75002',
  country: 'France',
  partyIdentifiers: [{ scheme: 'VAT', value: 'FR12345678901' }],
};

/** Hand-computed, chiffrée à la main: one line at 19% VAT (DE's own standard rate — used only as a
 *  plausible number, never asserted as a legal fact this bridge relies on).
 *   line: 5 × 200.00 = 1000.00 ; VAT (19%) = 190.00 ; gross = 1190.00 */
const DOCUMENT_DATA = {
  client: 'client-1',
  issueDate: '2026-08-30',
  dueDate: '2026-09-30',
  currency: 'EUR',
  notes: 'Danke für Ihr Vertrauen.',
  // PEPPOL-EN16931-R003 ("a buyer reference or purchase order reference MUST be provided") — the
  // SAME country-neutral BT-10 mechanism `xrechnung-provider.ts` also relies on
  // (`build-semantic-invoice.ts`'s own header). A purchase-order-style reference here, not a
  // Leitweg-ID — this buyer is not a German public body.
  buyerReference: 'PO-2026-00042',
  lines: [{ description: 'Beratungsleistung', quantity: 5, unit: 'hour', unitPrice: 200, vatRate: '19' }],
};

const DOCUMENT = { id: 'doc-1', data: DOCUMENT_DATA, displayNumber: 'INV-2026-0002', status: 'sent' };

describe('peppol-bis-provider — the master proof (fixture computed by hand)', () => {
  it('builds an artifact BOTH the vendored EN 16931 base Schematron AND the Peppol BIS delta accept — 0 error', async () => {
    const result = await peppolBisFormatProvider.build(descriptor, DOCUMENT, SELLER, BUYER);

    // A failing assertion here prints EVERY BR-*/PEPPOL-EN16931-R* rule either ruleset actually
    // fired — never swallowed, per this ticket's own "a gate, not a report" requirement.
    expect(result.validation.errors).toEqual([]);
    expect(result.validation.valid).toBe(true);

    const xml = Buffer.from(result.bytes).toString('utf-8');
    expect(xml).toMatch(/<(\w+:)?Invoice[ >]/);
    // BT-24 — the exact Peppol specification identifier PEPPOL-EN16931-R004 itself requires, quoted
    // verbatim from the vendored delta's own test expression (see peppol-bis-provider.ts's header).
    expect(xml).toContain(
      '<cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>',
    );
    // BT-10 — PEPPOL-EN16931-R003's own requirement, satisfied by the generic buyerReference wiring.
    expect(xml).toContain('<cbc:BuyerReference>PO-2026-00042</cbc:BuyerReference>');
    // The figures compute-totals.ts produced — never a re-sum.
    expect(xml).toContain('1190.00');
  }, 30_000);

  it('MUTATION TARGET 1 — with the delta disconnected (base alone), an artifact missing BT-10 is wrongly accepted; the delta is what actually catches it', async () => {
    // Same document, MINUS the buyer reference PEPPOL-EN16931-R003 requires — built through the
    // EXACT same bridge the provider itself uses (never a hand-built EuInvoice), so this proves the
    // REAL wiring, not a shortcut.
    const { buyerReference: _omitted, ...dataWithoutReference } = DOCUMENT_DATA;
    const documentWithoutReference = { ...DOCUMENT, data: dataWithoutReference };

    const euInvoice = buildEuInvoiceForDocument(descriptor, documentWithoutReference, SELLER, BUYER, {
      customizationId: 'urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0',
    });
    const xml = (await newEuInvoiceService().generate(euInvoice, {
      format: 'UBL',
      lang: 'en',
    })) as string;

    const base = validateSchematron(xml, EN16931_UBL_SCH);
    expect(base.valid).toBe(true); // base EN 16931 has no opinion on BT-10 at all — R003 is Peppol-only

    const delta = validateSchematron(xml, PEPPOL_BIS_UBL_SCH);
    expect(delta.valid).toBe(false);
    expect(delta.errors.map((e) => e.id)).toContain('PEPPOL-EN16931-R003');

    // The provider's own full build (base AND delta) must refuse this exact document, naming R003 —
    // if the delta were ever disconnected from `peppol-bis-provider.ts#build`, this assertion is the
    // one that would start failing (the artifact would be silently served instead of refused).
    const result = await peppolBisFormatProvider.build(descriptor, documentWithoutReference, SELLER, BUYER);
    expect(result.validation.valid).toBe(false);
    expect(result.validation.errors.join(' ')).toContain('PEPPOL-EN16931-R003');
  }, 30_000);

  // A KNOWN, DOCUMENTED LIMITATION — see peppol-bis-provider.ts's own header, "PEPPOL-EN16931-R002".
  // A French seller's THREE mandatory C. com. mentions (`mentions/data/fr.json`) already emit three
  // separate `cbc:Note` elements for every OTHER syntax this codebase builds; Peppol BIS caps that at
  // one (unless BOTH parties are German). Asserted here, failing on purpose, so a future change that
  // silently "fixes" this without updating the delta's own contract does not go unnoticed either way.
  it('a documented gap: a French seller (3 mandatory notes) trips PEPPOL-EN16931-R002 against a non-German buyer', async () => {
    const frenchSeller: DocumentFormatParty = {
      name: 'Dupont Consulting SARL',
      address: '12 Rue de la Paix',
      city: 'Paris',
      postalCode: '75002',
      country: 'France',
      email: 'contact@dupont-consulting.example',
      phone: '+33102030405',
      partyIdentifiers: [{ scheme: 'VAT', value: 'FR12345678901' }],
    };
    const result = await peppolBisFormatProvider.build(descriptor, DOCUMENT, frenchSeller, BUYER);
    expect(result.validation.valid).toBe(false);
    expect(result.validation.errors.join(' ')).toContain('PEPPOL-EN16931-R002');
  }, 30_000);
});
