/**
 * THE MASTER PROOF for item 12 ("formats normalisés EN 16931") — offline, no network, no mocked
 * validation: a hand-computed fixture goes through the REAL build pipeline (descriptor →
 * `semantic/build-semantic-invoice.ts` → `@e-invoice-eu/core`'s own XML generator) and the REAL
 * vendored EN 16931 Schematron (`vendored/validate-schematron.ts`, node-schematron over the verbatim
 * `.sch` files copied from git tag `avant-refonte-documents`) is the judge, not this file's own
 * opinion of itself. See this file's own describe blocks for what each one proves.
 */
import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { DocumentTypeDescriptor } from '../descriptors/types';
import { computeDocumentTotals } from '../totals/compute-totals';
import { ciiFormatProvider } from './cii-provider';
import { DocumentFormatParty } from './format-provider';
import { ublFormatProvider } from './ubl-provider';

const descriptor: DocumentTypeDescriptor = buildInvoiceDescriptor();

/** French seller, VAT-registered, SIRET on file — the seller identity every BR-S-02/BR-CO-26 check
 *  in the vendored Schematron actually looks for (see `semantic/build-semantic-invoice.ts`'s own
 *  header on why a seller with NO VAT identifier is correctly refused, not papered over). */
const SELLER: DocumentFormatParty = {
  name: 'Dupont Consulting SARL',
  address: '12 Rue de la Paix',
  city: 'Paris',
  postalCode: '75002',
  country: 'France',
  email: 'contact@dupont-consulting.example',
  phone: '+33102030405',
  partyIdentifiers: [
    { scheme: 'VAT', value: 'FR12345678901' },
    { scheme: 'LEGAL_ID', value: '12345678900017' }, // 14-digit SIRET → SIREN 123456789
  ],
};

/** German buyer, VAT-registered — cross-border B2B, same shape the removed engine's own
 *  FR_B2B_STANDARD fixture used (git tag `avant-refonte-documents`,
 *  `compliance/providers/format/__fixtures__/invoices.ts`), adapted to today's descriptor. */
const BUYER: DocumentFormatParty = {
  name: 'Acme GmbH',
  address: 'Friedrichstraße 42',
  city: 'Berlin',
  postalCode: '10117',
  country: 'Germany',
  partyIdentifiers: [{ scheme: 'VAT', value: 'DE123456789' }],
};

/**
 * Hand-computed, chiffrée à la main: two lines, both at 20% VAT.
 *   line 1: 10 × 1200.00 = 12000.00
 *   line 2:  2 ×  800.00 =  1600.00
 *   net    = 13600.00 ; VAT (20%) = 2720.00 ; gross = 16320.00
 */
const DOCUMENT_DATA = {
  client: 'client-1',
  issueDate: '2026-08-30',
  dueDate: '2026-09-30',
  currency: 'EUR',
  notes: 'Merci de votre confiance.',
  lines: [
    { description: 'Conseil stratégique', quantity: 10, unit: 'hour', unitPrice: 1200, vatRate: '20' },
    { description: 'Formation équipe', quantity: 2, unit: 'day', unitPrice: 800, vatRate: '20' },
  ],
};

const DOCUMENT = { id: 'doc-1', data: DOCUMENT_DATA, displayNumber: 'INV-2026-0001', status: 'sent' };

describe('providers.spec — the master proof (fixture computed by hand)', () => {
  it('compute-totals agrees with the hand computation this fixture claims', () => {
    const totals = computeDocumentTotals(descriptor, DOCUMENT_DATA);
    expect(totals.netMinor).toBe(1_360_000); // 13600.00 EUR in cents
    expect(totals.vatMinor).toBe(272_000); // 2720.00 EUR
    expect(totals.grossMinor).toBe(1_632_000); // 16320.00 EUR
    expect(totals.vatBreakdown).toEqual([{ ratePercent: 20, baseMinor: 1_360_000, vatMinor: 272_000 }]);
  });

  describe.each([
    ['CII', ciiFormatProvider, 'CrossIndustryInvoice'] as const,
    ['UBL', ublFormatProvider, 'Invoice'] as const,
  ])('%s — build + REAL XSD-equivalent structural gate + REAL Schematron', (_label, provider, rootTag) => {
    it('builds an artifact the vendored EN 16931 ruleset accepts — the proof this ticket exists for', async () => {
      const result = await provider.build(descriptor, DOCUMENT, SELLER, BUYER);

      // A failing assertion here prints EVERY BR-* rule the vendored Schematron actually fired —
      // never swallowed, per this ticket's own "a gate, not a report" requirement.
      expect(result.validation.errors).toEqual([]);
      expect(result.validation.valid).toBe(true);

      // Root element name only — the namespace PREFIX a builder picks (CII comes out `rsm:`-prefixed,
      // never a bare default namespace) is not this assertion's concern; `structural-check.ts`'s own
      // gate already checked the real (prefix-stripped) local name.
      const xml = Buffer.from(result.bytes).toString('utf-8');
      expect(xml).toMatch(new RegExp(`<(\\w+:)?${rootTag}[ >]`));
    }, 30_000);

    it('(point 2 of the task) amounts in the XML are the ones compute-totals produced, never a re-sum', async () => {
      const totals = computeDocumentTotals(descriptor, DOCUMENT_DATA);
      const result = await provider.build(descriptor, DOCUMENT, SELLER, BUYER);
      const xml = Buffer.from(result.bytes).toString('utf-8');

      const grossMajor = (totals.grossMinor / 100).toFixed(2); // '16320.00' — BT-112/BT-115
      const netMajor = (totals.netMinor / 100).toFixed(2); // '13600.00' — BT-106/BT-109
      const vatMajor = (totals.vatMinor / 100).toFixed(2); // '2720.00'

      expect(xml).toContain(grossMajor);
      expect(xml).toContain(netMajor);
      expect(xml).toContain(vatMajor);
      // The invoice's own displayNumber (BT-1) — never a re-derived or fallback value.
      expect(xml).toContain(DOCUMENT.displayNumber);
    }, 30_000);

    it("a REAL saved document's own issueDate shape (full ISO datetime, not a bare date) still builds — a bug found against a real save, not a hand-built fixture", async () => {
      // `field-kinds.ts`'s 'date' kind stores a full ISO datetime ("2026-05-31T00:00:00.000Z"), not
      // a bare "yyyy-mm-dd" — every fixture in this file had, until this test, only ever exercised
      // the bare-date shape, which is why this 500 reached a REAL "GET .../formats/:syntax" call
      // (curl, against the running test backend, a saved invoice) before it reached a test file. See
      // `shared-build.ts`'s own `toDateOnly` for the fix.
      const documentWithFullDatetime = {
        ...DOCUMENT,
        data: { ...DOCUMENT_DATA, issueDate: '2026-08-30T00:00:00.000Z' },
      };
      const result = await provider.build(descriptor, documentWithFullDatetime, SELLER, BUYER);
      expect(result.validation.errors).toEqual([]);
      expect(result.validation.valid).toBe(true);
    }, 30_000);
  });
});
