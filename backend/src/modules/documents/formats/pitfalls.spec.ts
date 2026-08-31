/**
 * The three per-category pitfalls the old, removed cross-border tax engine's own format layer paid
 * for in production (`compliance/providers/format/{br-z-02-reproduction,e-category-schematron,
 * o-category-schematron}.spec.ts` at git tag `avant-refonte-documents`) — ADAPTED, not copy-pasted,
 * to what this ticket's bridge can actually produce today. See each `describe` block's own header
 * for exactly how each one is adapted and why.
 */
import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { computeDocumentTotals } from '../totals/compute-totals';
import { buildSemanticInvoice, SemanticBuildError } from './semantic/build-semantic-invoice';
import { newEuInvoiceService } from './shared-build';
import { validateSchematron, EN16931_UBL_SCH } from './vendored/validate-schematron';

const descriptor = buildInvoiceDescriptor();

const BUYER = {
  name: 'Acme GmbH',
  address: 'Friedrichstraße 42',
  city: 'Berlin',
  postalCode: '10117',
  country: 'Germany',
  partyIdentifiers: [{ scheme: 'VAT', value: 'DE123456789' }],
};

function frSeller(withVat: boolean) {
  return {
    name: 'Dupont Consulting SARL',
    address: '12 Rue de la Paix',
    city: 'Paris',
    postalCode: '75002',
    country: 'France',
    partyIdentifiers: withVat ? [{ scheme: 'VAT', value: 'FR12345678901' }] : [],
  };
}

const DATA_ZERO_RATE = {
  client: 'client-1',
  issueDate: '2026-08-30',
  dueDate: '2026-09-30',
  currency: 'EUR',
  lines: [{ description: 'Prestation exonérée', quantity: 1, unit: 'unit', unitPrice: 1000, vatRate: '0' }],
};

/**
 * BR-Z-02 — REPRISED via the REAL bridge (unlike the E/O blocks below, this one needs no manual
 * semantic-model construction: a rate-0 line is exactly what `vatCategoryFor` maps to 'Z' today —
 * see `semantic/build-semantic-invoice.ts`'s own header, "VAT category").
 */
describe('BR-Z-02 reproduced — a zero-rated line without the seller VAT id', () => {
  function buildUbl(withVat: boolean) {
    const totals = computeDocumentTotals(descriptor, DATA_ZERO_RATE);
    const euInvoice = buildSemanticInvoice({
      displayNumber: 'INV-Z-01',
      issueDate: DATA_ZERO_RATE.issueDate,
      seller: frSeller(withVat),
      buyer: BUYER,
      lines: DATA_ZERO_RATE.lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        unitPrice: l.unitPrice,
      })),
      totals,
    });
    return newEuInvoiceService().generate(euInvoice, { format: 'UBL', lang: 'en' }) as Promise<string>;
  }

  it('without the seller VAT identifier: the UBL is INVALID, and the rule names itself', async () => {
    const xml = await buildUbl(false);
    const report = validateSchematron(xml, EN16931_UBL_SCH);
    expect(report.valid).toBe(false);
    expect(report.errors.map((e) => e.id)).toContain('BR-Z-02');
  }, 30_000);

  it('with the seller VAT identifier: the same zero-rated document validates', async () => {
    const xml = await buildUbl(true);
    const report = validateSchematron(xml, EN16931_UBL_SCH);
    expect(report.errors.map((e) => e.id)).not.toContain('BR-Z-02');
    expect(report.valid).toBe(true);
  }, 30_000);
});

/**
 * A minimal, hand-built EuInvoice — the header/party/totals machinery `build-semantic-invoice.ts`
 * itself proves in `providers.spec.ts` — with ONE line whose VAT category is set DIRECTLY, bypassing
 * `vatCategoryFor` entirely. This is deliberate: today's descriptor has no VAT-category field (see
 * `build-semantic-invoice.ts`'s own header, "VAT category"), so the bridge can never actually emit
 * 'E' or 'O' — these two blocks prove the GATE (the vendored Schematron) still reacts correctly to
 * them, which is what matters the day a future ticket teaches the bridge to derive a real category.
 */
function minimalUbl(opts: {
  category: 'E' | 'O';
  sellerVat?: string;
  buyerVat?: string;
  exemption?: { code?: string; text?: string };
}) {
  // The line-level category (`cac:Item/cac:ClassifiedTaxCategory`, BT-151/BT-152) and the
  // breakdown-level one (`cac:TaxTotal/cac:TaxSubtotal/cac:TaxCategory`, BT-118/BT-121) are TWO
  // different UBL groups — found empirically while writing this spec: `@e-invoice-eu/core`'s own
  // ajv schema REJECTS `cbc:TaxExemptionReasonCode`/`cbc:TaxExemptionReason` on the LINE category
  // ("must NOT have additional properties") — BT-120/BT-121 only ever belong on the BREAKDOWN
  // (BG-23), never repeated per line, which is exactly what EN 16931 itself says (the exemption is a
  // fact about the RATE'S OWN breakdown, not about each line that happens to use it).
  const lineTaxCategory: Record<string, unknown> = {
    'cbc:ID': opts.category,
    'cac:TaxScheme': { 'cbc:ID': 'VAT' },
  };
  if (opts.category === 'E') lineTaxCategory['cbc:Percent'] = '0';

  const breakdownTaxCategory: Record<string, unknown> = { ...lineTaxCategory };
  if (opts.exemption?.code) breakdownTaxCategory['cbc:TaxExemptionReasonCode'] = opts.exemption.code;
  if (opts.exemption?.text) breakdownTaxCategory['cbc:TaxExemptionReason'] = opts.exemption.text;

  return {
    'ubl:Invoice': {
      'cbc:CustomizationID': 'urn:cen.eu:en16931:2017',
      'cbc:ID': 'INV-CAT-01',
      'cbc:IssueDate': '2026-08-30',
      'cbc:InvoiceTypeCode': '380',
      'cbc:DocumentCurrencyCode': 'EUR',
      'cac:AccountingSupplierParty': {
        'cac:Party': {
          'cbc:EndpointID': 'seller@local.invalid',
          'cbc:EndpointID@schemeID': 'EM',
          'cac:PostalAddress': {
            'cbc:StreetName': '12 Rue de la Paix',
            'cbc:CityName': 'Paris',
            'cbc:PostalZone': '75002',
            'cac:Country': { 'cbc:IdentificationCode': 'FR' },
          },
          // A NON-VAT legal registration id, ALWAYS present regardless of `opts.sellerVat` — needed
          // to satisfy BR-CO-26 ("the Seller identifier, legal registration id and/or VAT identifier
          // shall be present") in the no-VAT (category O) case below WITHOUT reintroducing the VAT
          // identifier BR-O-02 specifically forbids for that case; a generic legal registration id
          // is a different fact BR-O-02 has no opinion on at all.
          'cac:PartyLegalEntity': {
            'cbc:RegistrationName': 'Dupont Consulting SARL',
            'cbc:CompanyID': '123456789',
          },
          ...(opts.sellerVat
            ? {
                'cac:PartyTaxScheme': [
                  { 'cbc:CompanyID': opts.sellerVat, 'cac:TaxScheme': { 'cbc:ID': 'VAT' } },
                ],
              }
            : {}),
        },
      },
      'cac:AccountingCustomerParty': {
        'cac:Party': {
          'cbc:EndpointID': 'buyer@local.invalid',
          'cbc:EndpointID@schemeID': 'EM',
          'cac:PostalAddress': {
            'cbc:StreetName': 'Friedrichstraße 42',
            'cbc:CityName': 'Berlin',
            'cbc:PostalZone': '10117',
            'cac:Country': { 'cbc:IdentificationCode': 'DE' },
          },
          'cac:PartyLegalEntity': { 'cbc:RegistrationName': 'Acme GmbH' },
          ...(opts.buyerVat
            ? {
                'cac:PartyTaxScheme': {
                  'cbc:CompanyID': opts.buyerVat,
                  'cac:TaxScheme': { 'cbc:ID': 'VAT' },
                },
              }
            : {}),
        },
      },
      'cac:TaxTotal': [
        {
          'cbc:TaxAmount': '0.00',
          'cbc:TaxAmount@currencyID': 'EUR',
          'cac:TaxSubtotal': [
            {
              'cbc:TaxableAmount': '1000.00',
              'cbc:TaxableAmount@currencyID': 'EUR',
              'cbc:TaxAmount': '0.00',
              'cbc:TaxAmount@currencyID': 'EUR',
              'cac:TaxCategory': breakdownTaxCategory,
            },
          ],
        },
      ],
      'cac:LegalMonetaryTotal': {
        'cbc:LineExtensionAmount': '1000.00',
        'cbc:LineExtensionAmount@currencyID': 'EUR',
        'cbc:TaxExclusiveAmount': '1000.00',
        'cbc:TaxExclusiveAmount@currencyID': 'EUR',
        'cbc:TaxInclusiveAmount': '1000.00',
        'cbc:TaxInclusiveAmount@currencyID': 'EUR',
        'cbc:PayableAmount': '1000.00',
        'cbc:PayableAmount@currencyID': 'EUR',
      },
      'cac:InvoiceLine': [
        {
          'cbc:ID': '1',
          'cbc:InvoicedQuantity': '1',
          'cbc:InvoicedQuantity@unitCode': 'C62',
          'cbc:LineExtensionAmount': '1000.00',
          'cbc:LineExtensionAmount@currencyID': 'EUR',
          'cac:Item': { 'cbc:Name': 'Prestation', 'cac:ClassifiedTaxCategory': lineTaxCategory },
          'cac:Price': { 'cbc:PriceAmount': '1000.00', 'cbc:PriceAmount@currencyID': 'EUR' },
        },
      ],
    },
  } as never;
}

describe('category E (exempt) — the gate reacts correctly, even though the bridge cannot emit it today', () => {
  it('with the seller VAT identifier but NO exemption reason: refused — BR-E-10', async () => {
    const xml = (await newEuInvoiceService().generate(
      minimalUbl({ category: 'E', sellerVat: 'FR12345678901' }),
      { format: 'UBL', lang: 'en' },
    )) as string;
    const report = validateSchematron(xml, EN16931_UBL_SCH);
    expect(report.valid).toBe(false);
    expect(report.errors.map((e) => e.id)).toContain('BR-E-10');
  }, 30_000);

  it('with the seller VAT identifier AND an exemption reason: valid — BR-E-02/BR-E-10 satisfied', async () => {
    const xml = (await newEuInvoiceService().generate(
      minimalUbl({
        category: 'E',
        sellerVat: 'FR12345678901',
        exemption: { code: 'VATEX-EU-132', text: 'Exempt — Art. 132 Directive 2006/112/EC' },
      }),
      { format: 'UBL', lang: 'en' },
    )) as string;
    const report = validateSchematron(xml, EN16931_UBL_SCH);
    expect(report.errors.map((e) => e.id)).not.toContain('BR-E-02');
    expect(report.errors.map((e) => e.id)).not.toContain('BR-E-10');
    expect(report.valid).toBe(true);
  }, 30_000);
});

describe('category O (out of scope) — the gate reacts correctly, even though the bridge cannot emit it today', () => {
  it('WITH a seller VAT identifier: refused — BR-O-02 forbids it for an out-of-scope supply', async () => {
    const xml = (await newEuInvoiceService().generate(
      minimalUbl({ category: 'O', sellerVat: 'FR12345678901' }),
      { format: 'UBL', lang: 'en' },
    )) as string;
    const report = validateSchematron(xml, EN16931_UBL_SCH);
    expect(report.valid).toBe(false);
    expect(report.errors.map((e) => e.id)).toContain('BR-O-02');
  }, 30_000);

  it('with NO seller or buyer VAT identifier: valid — the whole-document O mode BR-O-02 requires', async () => {
    // BR-O-10 (found the same way BR-O-02 was: by reading what the REAL Schematron actually fired,
    // not by assuming the old code's own comment was exhaustive) additionally requires a VAT
    // exemption reason on the O breakdown, exactly like category E's own BR-E-10 above.
    const xml = (await newEuInvoiceService().generate(
      minimalUbl({ category: 'O', exemption: { text: 'Not subject to VAT' } }),
      { format: 'UBL', lang: 'en' },
    )) as string;
    const report = validateSchematron(xml, EN16931_UBL_SCH);
    expect(report.errors.map((e) => e.id)).not.toContain('BR-O-02');
    expect(report.errors.map((e) => e.id)).not.toContain('BR-O-10');
    expect(report.valid).toBe(true);
  }, 30_000);
});

describe("today's bridge limitation, stated rather than hidden", () => {
  it('a line with no usable VAT rate refuses to build at all — BT-151 is never guessed', () => {
    const dataWithBadRate = {
      ...DATA_ZERO_RATE,
      lines: [{ description: 'x', quantity: 1, unit: 'unit', unitPrice: 100, vatRate: '' }],
    };
    const totals = computeDocumentTotals(descriptor, dataWithBadRate);
    expect(totals.lines[0].vatRatePercent).toBeNull(); // compute-totals already warns about this

    expect(() =>
      buildSemanticInvoice({
        displayNumber: 'INV-BAD-01',
        issueDate: dataWithBadRate.issueDate,
        seller: frSeller(true),
        buyer: BUYER,
        lines: dataWithBadRate.lines.map((l) => ({
          description: l.description,
          quantity: l.quantity,
          unit: l.unit,
          unitPrice: l.unitPrice,
        })),
        totals,
      }),
    ).toThrow(SemanticBuildError);
  });
});
