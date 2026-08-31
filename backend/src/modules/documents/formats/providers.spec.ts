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

/** A US seller — carries a (fictional) tax identifier only so BR-S-02/BR-CO-26 (a "Standard rated"
 *  line needs SOME seller tax identifier — this fixture's own DOCUMENT_DATA is 20% VAT) do not fire
 *  for a reason unrelated to what this describe block actually tests. Used only by the BT-23 describe
 *  block below: this bridge's own French-specific checks (SIREN derivation, mentions, BT-23) must
 *  never fire for it. */
const US_SELLER: DocumentFormatParty = {
  name: 'Acme US Inc.',
  address: '1 Main St',
  city: 'Wilmington',
  postalCode: '19801',
  country: 'United States',
  email: 'contact@acme-us.example',
  partyIdentifiers: [{ scheme: 'VAT', value: 'US123456789' }],
};

/** Reads BT-23's own value back out of either syntax's real output — CII's
 *  `BusinessProcessSpecifiedDocumentContextParameter/(ram:)ID` (the exact element
 *  `business-process.ts#applyFrenchBusinessProcess` targets) or UBL's `cbc:ProfileID` (the exact
 *  field `build-semantic-invoice.ts` sets directly) — whichever the syntax actually carries. */
function businessProcessValueFrom(xml: string): string | undefined {
  const cii =
    /<(?:ram:)?BusinessProcessSpecifiedDocumentContextParameter>\s*<(?:ram:)?ID>([^<]*)<\/(?:ram:)?ID>/.exec(
      xml,
    );
  if (cii) return cii[1];
  const ubl = /<cbc:ProfileID>([^<]*)<\/cbc:ProfileID>/.exec(xml);
  return ubl ? ubl[1] : undefined;
}

/** `@e-invoice-eu/core`'s OWN default BT-23/ProfileID value when nothing sets one — the Peppol BIS
 *  billing profile URN (checked directly against the vendored dependency, `FormatUBLService`/
 *  `FormatCIIService#profileID` in `node_modules/@e-invoice-eu/core/dist/e-invoice-eu.cjs.js`), NOT
 *  the literal string "M1" in the currently-vendored version — see `business-process.ts`'s own
 *  header for the full reasoning on why either shape is correctly reported as "absente ou n'est pas
 *  autorisée" by a French PDP's conformity check regardless. Asserted here so a future dependency
 *  bump that silently changes this default is visible as a test failure, not a surprise.
 */
const LIBRARY_DEFAULT_PROFILE_ID = 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0';

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

    /**
     * BT-23 — root TODO item 15's own remainder, now wired via `../content-requirements/` (see
     * `semantic/business-process.ts`'s own header). Every case here is issued ON the shipped content
     * requirement's own `mandatedFrom` (2026-09-01), and every artifact is still judged by the REAL
     * vendored Schematron via `result.validation` — a code that broke the base standard would fail
     * here exactly like any other regression this file's own master proof already catches.
     */
    describe('BT-23 — country-conditional, from what the invoice actually contains', () => {
      const ON_OR_AFTER_MANDATE = '2026-09-01';

      function documentWithSupplyTypes(types: (('GOODS' | 'SERVICES') | undefined)[]) {
        return {
          ...DOCUMENT,
          data: {
            ...DOCUMENT_DATA,
            issueDate: ON_OR_AFTER_MANDATE,
            lines: DOCUMENT_DATA.lines.map((line, i) => ({ ...line, supplyType: types[i] })),
          },
        };
      }

      it('goods-only lines → B1', async () => {
        const result = await provider.build(
          descriptor,
          documentWithSupplyTypes(['GOODS', 'GOODS']),
          SELLER,
          BUYER,
        );
        expect(result.validation.errors).toEqual([]);
        expect(result.validation.valid).toBe(true);
        expect(businessProcessValueFrom(Buffer.from(result.bytes).toString('utf-8'))).toBe('B1');
      }, 30_000);

      it("services-only lines → S1 — the case @e-invoice-eu/core's own default got wrong", async () => {
        const result = await provider.build(
          descriptor,
          documentWithSupplyTypes(['SERVICES', 'SERVICES']),
          SELLER,
          BUYER,
        );
        expect(result.validation.errors).toEqual([]);
        expect(result.validation.valid).toBe(true);
        expect(businessProcessValueFrom(Buffer.from(result.bytes).toString('utf-8'))).toBe('S1');
      }, 30_000);

      it('mixed goods + services lines → M1', async () => {
        const result = await provider.build(
          descriptor,
          documentWithSupplyTypes(['GOODS', 'SERVICES']),
          SELLER,
          BUYER,
        );
        expect(result.validation.errors).toEqual([]);
        expect(businessProcessValueFrom(Buffer.from(result.bytes).toString('utf-8'))).toBe('M1');
      }, 30_000);

      it('no supplyType declared on any line → M1 — the value that asserts nothing false about the content', async () => {
        const result = await provider.build(
          descriptor,
          documentWithSupplyTypes([undefined, undefined]),
          SELLER,
          BUYER,
        );
        expect(result.validation.errors).toEqual([]);
        expect(businessProcessValueFrom(Buffer.from(result.bytes).toString('utf-8'))).toBe('M1');
      }, 30_000);

      // MUTATION TARGET (task's own mutation #2): applying BT-23 regardless of seller country would
      // make this assertion fail — the seller here is American, not French.
      it("a US seller: no BT-23 imposed — the library's own default is left exactly as it is", async () => {
        const result = await provider.build(
          descriptor,
          documentWithSupplyTypes(['GOODS', 'GOODS']),
          US_SELLER,
          BUYER,
        );
        expect(result.validation.errors).toEqual([]);
        expect(result.validation.valid).toBe(true);
        const value = businessProcessValueFrom(Buffer.from(result.bytes).toString('utf-8'));
        expect(value).toBe(LIBRARY_DEFAULT_PROFILE_ID);
        expect(['B1', 'S1', 'M1']).not.toContain(value);
      }, 30_000);
    });
  });
});
