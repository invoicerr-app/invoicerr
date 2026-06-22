import { DocumentLine, PartyTaxProfile } from '../canonical/canonical-document';
import { PartyRole, SupplyType, TaxScheme } from '../types';
import { FR } from '../profiles/data/fr';
import { US } from '../profiles/data/us';
import { TrustFlagVatValidator } from './classification';
import { determineLineTax, determineTax } from './tax-engine';

const vat = new TrustFlagVatValidator();

type VatMode = 'valid' | 'invalid' | 'unchecked' | 'none';

function party(
  country: string,
  role: PartyRole,
  o: { scheme?: TaxScheme; state?: string; vat?: VatMode } = {},
): PartyTaxProfile {
  const mode: VatMode = o.vat ?? (role === 'B2B' ? 'valid' : 'none');
  const identifiers =
    mode === 'none'
      ? []
      : [
          {
            scheme: 'VAT',
            value: `${country}123456789`,
            validated: mode === 'valid' ? true : mode === 'invalid' ? false : undefined,
          },
        ];
  return {
    legalName: `${country} Co`,
    countryCode: country,
    role,
    identifiers,
    taxScheme: o.scheme,
    address: o.state
      ? { line1: '1 St', postalCode: '00000', city: 'City', subdivision: o.state, countryCode: country }
      : undefined,
  };
}

function line(supplyType: SupplyType, o: { id?: string; rate?: number } = {}): DocumentLine {
  return {
    id: o.id ?? 'l1',
    description: 'item',
    quantity: 1,
    unitNetMinor: 10000,
    supplyType,
    taxRateHint: o.rate,
  };
}

describe('TaxEngine — domestic VAT (France)', () => {
  it('FR→FR B2B services: standard VAT 20%', () => {
    const t = determineLineTax(party('FR', 'B2B'), party('FR', 'B2B'), line('SERVICES'), FR, vat, FR);
    expect(t.components[0].category).toBe('S');
    expect(t.components[0].rate).toBe(20);
    expect(t.components[0].jurisdiction).toBe('FR');
    expect(t.buyerSelfAssess).toBe(false);
  });

  it('FR→FR franchise en base (293 B): exempt, 0%, legal mention', () => {
    const supplier = party('FR', 'B2B', { scheme: 'FRANCHISE_BASE' });
    const t = determineLineTax(supplier, party('FR', 'B2C'), line('SERVICES'), FR, vat, FR);
    expect(t.components[0].category).toBe('E');
    expect(t.components[0].rate).toBe(0);
    expect(t.mentions.map((m) => m.code)).toContain('FR_293B');
  });

  it('uses a reduced-rate hint when provided', () => {
    const t = determineLineTax(party('FR', 'B2C'), party('FR', 'B2C'), line('GOODS', { rate: 5.5 }), FR, vat, FR);
    expect(t.components[0].rate).toBe(5.5);
  });
});

describe('TaxEngine — cross-border within the EU', () => {
  it('FR→IT B2B services (valid VAT): reverse charge, 0%, EC Sales List', () => {
    const t = determineLineTax(party('FR', 'B2B'), party('IT', 'B2B', { vat: 'valid' }), line('SERVICES'), FR, vat);
    expect(t.components[0].category).toBe('AE');
    expect(t.components[0].rate).toBe(0);
    expect(t.components[0].jurisdiction).toBe('IT');
    expect(t.buyerSelfAssess).toBe(true);
    expect(t.reportingFlags).toContain('EC_SALES_LIST');
    expect(t.mentions.map((m) => m.code)).toContain('REVERSE_CHARGE');
  });

  it('FR→IT B2B goods (valid VAT): intra-Community supply, EC Sales List + Intrastat', () => {
    const t = determineLineTax(party('FR', 'B2B'), party('IT', 'B2B', { vat: 'valid' }), line('GOODS'), FR, vat);
    expect(t.components[0].category).toBe('K');
    expect(t.reportingFlags).toEqual(expect.arrayContaining(['EC_SALES_LIST', 'INTRASTAT']));
    expect(t.mentions.map((m) => m.code)).toContain('INTRA_COMMUNITY');
  });

  it('FR→IT B2B services with UNVALIDATED VAT: safe default charges domestic VAT', () => {
    const t = determineLineTax(party('FR', 'B2B'), party('IT', 'B2B', { vat: 'invalid' }), line('SERVICES'), FR, vat);
    expect(t.components[0].category).toBe('S');
    expect(t.components[0].rate).toBe(20);
    expect(t.buyerSelfAssess).toBe(false);
  });
});

describe('TaxEngine — export out of the EU (FR→US)', () => {
  it('FR→US B2B services: outside scope, buyer self-assesses', () => {
    const t = determineLineTax(party('FR', 'B2B'), party('US', 'B2B'), line('SERVICES'), FR, vat, US);
    expect(t.components[0].category).toBe('O');
    expect(t.components[0].rate).toBe(0);
    expect(t.buyerSelfAssess).toBe(true);
    expect(t.mentions.map((m) => m.code)).toContain('OUT_OF_SCOPE');
  });

  it('FR→US goods: export, zero-rated, customs export', () => {
    const t = determineLineTax(party('FR', 'B2B'), party('US', 'B2B'), line('GOODS'), FR, vat, US);
    expect(t.components[0].category).toBe('G');
    expect(t.reportingFlags).toContain('CUSTOMS_EXPORT');
    expect(t.mentions.map((m) => m.code)).toContain('EXPORT');
  });
});

describe('TaxEngine — United States sales tax (no VAT)', () => {
  it('US→FR B2B services: no US tax on export, FR buyer self-assesses import VAT', () => {
    const t = determineLineTax(party('US', 'B2B', { state: 'CA' }), party('FR', 'B2B'), line('SERVICES'), US, vat, FR);
    expect(t.components[0].taxSystem).toBe('SALES_TAX');
    expect(t.components[0].category).toBe('O');
    expect(t.components[0].rate).toBe(0);
    expect(t.buyerSelfAssess).toBe(true);
    expect(t.mentions.map((m) => m.code)).toContain('IMPORT_SELF_ASSESS');
  });

  it('US→US domestic with nexus (CA): destination state rate applied', () => {
    const t = determineLineTax(party('US', 'B2B'), party('US', 'B2B', { state: 'CA' }), line('GOODS'), US, vat, US);
    expect(t.components[0].taxSystem).toBe('SALES_TAX');
    expect(t.components[0].category).toBe('S');
    expect(t.components[0].rate).toBe(7.25);
    expect(t.components[0].subdivision).toBe('CA');
  });

  it('US→US domestic without nexus (OR): no tax collected, use-tax note', () => {
    const t = determineLineTax(party('US', 'B2B'), party('US', 'B2B', { state: 'OR' }), line('GOODS'), US, vat, US);
    expect(t.components[0].category).toBe('O');
    expect(t.components[0].rate).toBe(0);
    expect(t.mentions.map((m) => m.code)).toContain('US_NO_NEXUS');
  });
});

describe('TaxEngine — document-level aggregation', () => {
  it('aggregates reporting flags and de-duplicates mentions across lines', () => {
    const result = determineTax(
      {
        supplier: party('FR', 'B2B'),
        buyer: party('IT', 'B2B', { vat: 'valid' }),
        lines: [line('SERVICES', { id: 'a' }), line('SERVICES', { id: 'b' })],
        issueDate: new Date('2027-01-15'),
        currency: 'EUR',
      },
      FR,
      vat,
    );
    expect(result.lines).toHaveLength(2);
    expect(result.buyerSelfAssess).toBe(true);
    expect(result.reportingFlags).toEqual(['EC_SALES_LIST']);
    // Two reverse-charge lines collapse to a single legal mention.
    expect(result.mentions.filter((m) => m.code === 'REVERSE_CHARGE')).toHaveLength(1);
  });
});
