/**
 * Reprise, adaptée et CHIFFRÉE, de `compliance/engine/tax-engine.spec.ts` (git tag
 * `avant-refonte-documents`) — le reste de la couverture du moteur pur, au-delà des dix cas de
 * `tax-matrix.spec.ts`: le domestique français, le franchissement de frontière intra-UE (B2B validé/
 * non validé), l'export hors UE, la sales tax américaine, et l'agrégation document-level. La branche
 * OSS "FR→DE, DE has no full profile yet" (avant-dernier bloc) est un test du MOTEUR PUR — il exerce
 * le fallback historique du repère quand `buyerProfile` est absent, un chemin `resolve-invoice-tax.ts`
 * (la couche de câblage, testée séparément) empêche délibérément d'atteindre en production — voir ce
 * fichier's own header pour pourquoi ce fallback reste correct à tester ici, sans jamais être exécuté
 * par le vrai flux d'envoi.
 */
import { DocumentLine, PartyTaxProfile, SupplyType, TaxScheme } from './types';
import { defaultTaxSystemRegistry } from './tax-systems/registry';
import { TrustFlagVatValidator } from './classification';
import { determineLineTax, determineTax } from './tax-engine';

const vat = new TrustFlagVatValidator();
const prof = (cc: string) => defaultTaxSystemRegistry.resolve(cc);

type VatMode = 'valid' | 'invalid' | 'unchecked' | 'none';

function party(
  country: string,
  role: PartyTaxProfile['role'],
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
  it('FR→FR B2B services: standard VAT 20%, category S, seller-jurisdiction, no self-assess', () => {
    const t = determineLineTax(
      party('FR', 'B2B'),
      party('FR', 'B2B'),
      line('SERVICES'),
      prof('FR')!,
      vat,
      prof('FR'),
    );
    expect(t.components[0].category).toBe('S');
    expect(t.components[0].rate).toBe(20);
    expect(t.components[0].jurisdiction).toBe('FR');
    expect(t.buyerSelfAssess).toBe(false);
  });

  it('FR→FR franchise en base (293 B): exempt, 0%, legal mention art. 293 B du CGI', () => {
    const supplier = party('FR', 'B2B', { scheme: 'FRANCHISE_BASE' });
    const t = determineLineTax(supplier, party('FR', 'B2C'), line('SERVICES'), prof('FR')!, vat, prof('FR'));
    expect(t.components[0].category).toBe('E');
    expect(t.components[0].rate).toBe(0);
    expect(t.mentions.map((m) => m.code)).toContain('FR_293B');
    expect(t.mentions.map((m) => m.text)).toContain('TVA non applicable, art. 293 B du CGI');
  });

  it('uses a reduced-rate hint (5.5%) when the line declared one', () => {
    const t = determineLineTax(
      party('FR', 'B2C'),
      party('FR', 'B2C'),
      line('GOODS', { rate: 5.5 }),
      prof('FR')!,
      vat,
      prof('FR'),
    );
    expect(t.components[0].rate).toBe(5.5);
  });
});

describe('TaxEngine — cross-border within the EU', () => {
  it('FR→IT B2B services (valid VAT): reverse charge, 0%, category AE, jurisdiction IT, EC Sales List, art. 196', () => {
    const t = determineLineTax(
      party('FR', 'B2B'),
      party('IT', 'B2B', { vat: 'valid' }),
      line('SERVICES'),
      prof('FR')!,
      vat,
    );
    expect(t.components[0].category).toBe('AE');
    expect(t.components[0].rate).toBe(0);
    expect(t.components[0].jurisdiction).toBe('IT');
    expect(t.buyerSelfAssess).toBe(true);
    expect(t.reportingFlags).toContain('EC_SALES_LIST');
    expect(t.mentions.map((m) => m.code)).toContain('REVERSE_CHARGE');
    expect(t.mentions.map((m) => m.text)).toContain(
      'Autoliquidation / Reverse charge — Art. 196 Directive 2006/112/EC',
    );
  });

  it('FR→IT B2B goods (valid VAT): intra-Community supply, 0%, category K, art. 138', () => {
    const t = determineLineTax(
      party('FR', 'B2B'),
      party('IT', 'B2B', { vat: 'valid' }),
      line('GOODS'),
      prof('FR')!,
      vat,
    );
    expect(t.components[0].category).toBe('K');
    expect(t.components[0].rate).toBe(0);
    expect(t.reportingFlags).toEqual(expect.arrayContaining(['EC_SALES_LIST', 'INTRASTAT']));
    expect(t.mentions.map((m) => m.text)).toContain(
      'Intra-Community supply — Art. 138 Directive 2006/112/EC',
    );
  });

  it('FR→IT B2B services with UNVALIDATED VAT: safe default charges 20% domestic VAT, category S', () => {
    const t = determineLineTax(
      party('FR', 'B2B'),
      party('IT', 'B2B', { vat: 'invalid' }),
      line('SERVICES'),
      prof('FR')!,
      vat,
    );
    expect(t.components[0].category).toBe('S');
    expect(t.components[0].rate).toBe(20);
    expect(t.buyerSelfAssess).toBe(false);
  });
});

describe('TaxEngine — export out of the EU (FR→US)', () => {
  it('FR→US B2B services: outside scope (0%, category O), buyer self-assesses, art. hors-champ', () => {
    const t = determineLineTax(
      party('FR', 'B2B'),
      party('US', 'B2B'),
      line('SERVICES'),
      prof('FR')!,
      vat,
      prof('US'),
    );
    expect(t.components[0].category).toBe('O');
    expect(t.components[0].rate).toBe(0);
    expect(t.buyerSelfAssess).toBe(true);
    expect(t.mentions.map((m) => m.text)).toContain(
      'VAT not applicable — supply outside the scope of EU VAT',
    );
  });

  it('FR→US goods: export, zero-rated (0%, category G), customs export, art. 146', () => {
    const t = determineLineTax(
      party('FR', 'B2B'),
      party('US', 'B2B'),
      line('GOODS'),
      prof('FR')!,
      vat,
      prof('US'),
    );
    expect(t.components[0].category).toBe('G');
    expect(t.components[0].rate).toBe(0);
    expect(t.reportingFlags).toContain('CUSTOMS_EXPORT');
    expect(t.mentions.map((m) => m.text)).toContain('Export — zero-rated, Art. 146 Directive 2006/112/EC');
  });
});

describe('TaxEngine — United States sales tax (no VAT)', () => {
  it('US→FR B2B services: no US tax on export (0%), FR buyer self-assesses import VAT', () => {
    const t = determineLineTax(
      party('US', 'B2B', { state: 'CA' }),
      party('FR', 'B2B'),
      line('SERVICES'),
      prof('US')!,
      vat,
      prof('FR'),
    );
    expect(t.components[0].taxSystem).toBe('SALES_TAX');
    expect(t.components[0].category).toBe('O');
    expect(t.components[0].rate).toBe(0);
    expect(t.buyerSelfAssess).toBe(true);
    expect(t.mentions.map((m) => m.code)).toContain('IMPORT_SELF_ASSESS');
  });

  it('US→US domestic with nexus (CA): destination state rate 7.25% applied, category S', () => {
    const t = determineLineTax(
      party('US', 'B2B'),
      party('US', 'B2B', { state: 'CA' }),
      line('GOODS'),
      prof('US')!,
      vat,
      prof('US'),
    );
    expect(t.components[0].taxSystem).toBe('SALES_TAX');
    expect(t.components[0].category).toBe('S');
    expect(t.components[0].rate).toBe(7.25);
    expect(t.components[0].subdivision).toBe('CA');
  });

  it('US→US domestic without nexus (OR): no tax collected (0%, category O), use-tax note', () => {
    const t = determineLineTax(
      party('US', 'B2B'),
      party('US', 'B2B', { state: 'OR' }),
      line('GOODS'),
      prof('US')!,
      vat,
      prof('US'),
    );
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
      prof('FR')!,
      vat,
    );
    expect(result.lines).toHaveLength(2);
    expect(result.buyerSelfAssess).toBe(true);
    expect(result.reportingFlags).toEqual(['EC_SALES_LIST']);
    expect(result.mentions.filter((m) => m.code === 'REVERSE_CHARGE')).toHaveLength(1);
  });
});

describe('TaxEngine — intra-EU B2C distance sales (OSS) — PURE ENGINE fallback, never reached by the real send path', () => {
  it('FR→DE B2C goods: destination VAT via OSS falls back to the seller rate when DE has no profile', () => {
    const t = determineLineTax(party('FR', 'B2C'), party('DE', 'B2C'), line('GOODS'), prof('FR')!, vat);
    expect(t.components[0].category).toBe('S');
    expect(t.components[0].jurisdiction).toBe('DE');
    expect(t.reportingFlags).toContain('OSS');
    expect(t.buyerSelfAssess).toBe(false);
    // The repère's own historic fallback (destination unknown → seller's own standard rate) — kept
    // here, verbatim, as a property of the PURE engine only. `resolve-invoice-tax.ts` (the wiring)
    // never calls `determineLineTax` this way in production: see its own
    // "OSS destination unknown" guard, exercised by resolve-invoice-tax.spec.ts instead.
    expect(t.components[0].rate).toBe(20);
  });
});
