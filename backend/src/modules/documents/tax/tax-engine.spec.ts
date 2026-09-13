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
 *
 * Re-anchored by the 5-country prune (2026-09-10): `tax-systems/data/
 * us.json` was removed along with every country outside FR/PL/IT/PT/DE, so `defaultTaxSystemRegistry.
 * resolve('US')` no longer resolves. The "United States sales tax" describe block below tests
 * GENERIC, data-driven SALES_TAX dispatch in `tax-engine.ts#salesTax` (never a US-specific branch),
 * so it is re-anchored on a hand-built synthetic profile (`usSalesTaxProfile`) instead of the removed
 * registry entry — this keeps the exact same mechanical coverage (nexus/no-nexus, cross-border
 * export) without depending on any shipped country file. The two FR→US export tests above it don't
 * read `buyerProfile` at all on this code path (`determineLineTax`'s own "buyer outside the union"
 * branch only reads the buyer's `countryCode`) — their now-stale `prof('US')` sixth argument is
 * simply dropped rather than replaced.
 *
 * APPENDED (2026-09-13) — the "localized reverse-charge / intra-Community wording" describe block,
 * plus one test each in the domestic-VAT and export-out-of-the-EU blocks above, cover
 * `tax-engine.ts#LOCALIZED_MENTION`: a member state whose OWN statute names the exact wording an
 * invoice must carry (PT/IT/PL/DE) gets that text instead of the generic Directive-citing one, and a
 * country with no entry (FR, for this situation) is proven unchanged even though the situation itself
 * now has overrides for other countries — see that constant's own header for the sourcing and for why
 * this is a plain TS table rather than a `data/*.json` catalog.
 */
import { CountryTaxSystemProfile, DocumentLine, PartyTaxProfile, SupplyType, TaxScheme } from './types';
import { defaultTaxSystemRegistry } from './tax-systems/registry';
import { TrustFlagVatValidator } from './classification';
import { determineLineTax, determineTax } from './tax-engine';

const vat = new TrustFlagVatValidator();
const prof = (cc: string) => defaultTaxSystemRegistry.resolve(cc);

const usSalesTaxProfile: CountryTaxSystemProfile = {
  countryCode: 'US',
  taxSystem: { kind: 'SALES_TAX', stateRates: { CA: 7.25 }, nexusSubdivisions: ['CA'] },
};

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

  it('PT→PT small-business exemption: exempt, 0%, the CIVA art. 57.º n.º 2 wording, never the generic FR/EN one', () => {
    const supplier = party('PT', 'B2B', { scheme: 'FRANCHISE_BASE' });
    const t = determineLineTax(supplier, party('PT', 'B2C'), line('SERVICES'), prof('PT')!, vat, prof('PT'));
    expect(t.components[0].category).toBe('E');
    expect(t.components[0].rate).toBe(0);
    expect(t.mentions.map((m) => m.code)).toContain('PT_REGIME_ISENCAO');
    expect(t.mentions.map((m) => m.text)).toContain('IVA - regime de isenção');
  });

  it('DE→DE small-business exemption: exempt, 0%, the GENERIC mention — no sourced German wording yet', () => {
    const supplier = party('DE', 'B2B', { scheme: 'FRANCHISE_BASE' });
    const t = determineLineTax(supplier, party('DE', 'B2C'), line('SERVICES'), prof('DE')!, vat, prof('DE'));
    expect(t.components[0].category).toBe('E');
    expect(t.components[0].rate).toBe(0);
    expect(t.mentions.map((m) => m.code)).toContain('FRANCHISE');
    expect(t.mentions.map((m) => m.text)).toContain('VAT exempt — small business scheme');
  });

  it(
    'PL→PL small-business exemption: exempt, 0%, the GENERIC mention — ustawa o VAT art. 106e pkt 18 ' +
      'names a wording for REVERSE CHARGE only, not for this franchise scheme, so Poland has no entry ' +
      'here and this stays untouched by the new per-country reverse-charge table below',
    () => {
      const supplier = party('PL', 'B2B', { scheme: 'FRANCHISE_BASE' });
      const t = determineLineTax(
        supplier,
        party('PL', 'B2C'),
        line('SERVICES'),
        prof('PL')!,
        vat,
        prof('PL'),
      );
      expect(t.components[0].category).toBe('E');
      expect(t.components[0].rate).toBe(0);
      expect(t.mentions.map((m) => m.code)).toContain('FRANCHISE');
      expect(t.mentions.map((m) => m.text)).toContain('VAT exempt — small business scheme');
    },
  );

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

describe('TaxEngine — localized reverse-charge / intra-Community wording (per-country prescribed text)', () => {
  it(
    'PT→FR B2B services (valid VAT): reverse charge carries the CIVA art. 36.º n.º 13 wording, ' +
      "'IVA - autoliquidação' — not the generic Directive text",
    () => {
      const t = determineLineTax(
        party('PT', 'B2B'),
        party('FR', 'B2B', { vat: 'valid' }),
        line('SERVICES'),
        prof('PT')!,
        vat,
      );
      expect(t.components[0].category).toBe('AE');
      expect(t.mentions.map((m) => m.code)).toContain('PT_IVA_AUTOLIQUIDACAO');
      expect(t.mentions.map((m) => m.text)).toContain('IVA - autoliquidação');
      expect(t.mentions.map((m) => m.code)).not.toContain('REVERSE_CHARGE');
    },
  );

  it(
    'IT→FR B2B services (valid VAT): reverse charge carries the DPR 633/1972 art. 21 co. 6-bis lett. ' +
      "a) wording, 'inversione contabile'",
    () => {
      const t = determineLineTax(
        party('IT', 'B2B'),
        party('FR', 'B2B', { vat: 'valid' }),
        line('SERVICES'),
        prof('IT')!,
        vat,
      );
      expect(t.components[0].category).toBe('AE');
      expect(t.mentions.map((m) => m.code)).toContain('IT_INVERSIONE_CONTABILE');
      expect(t.mentions.map((m) => m.text)).toContain('inversione contabile');
    },
  );

  it(
    'IT→FR B2B goods (valid VAT): intra-Community supply carries the D.L. 331/1993 art. 46 co. 2 ' +
      "wording, 'operazione non imponibile', under its OWN code (not the export one, even though the " +
      'text happens to match)',
    () => {
      const t = determineLineTax(
        party('IT', 'B2B'),
        party('FR', 'B2B', { vat: 'valid' }),
        line('GOODS'),
        prof('IT')!,
        vat,
      );
      expect(t.components[0].category).toBe('K');
      expect(t.mentions.map((m) => m.code)).toContain('IT_OPERAZIONE_NON_IMPONIBILE_ICS');
      expect(t.mentions.map((m) => m.text)).toContain('operazione non imponibile');
      expect(t.mentions.map((m) => m.code)).not.toContain('IT_OPERAZIONE_NON_IMPONIBILE_EXPORT');
    },
  );

  it(
    'PL→FR B2B services (valid VAT): reverse charge carries the ustawa o VAT art. 106e ust. 1 pkt 18 ' +
      "wording, 'odwrotne obciążenie'",
    () => {
      const t = determineLineTax(
        party('PL', 'B2B'),
        party('FR', 'B2B', { vat: 'valid' }),
        line('SERVICES'),
        prof('PL')!,
        vat,
      );
      expect(t.components[0].category).toBe('AE');
      expect(t.mentions.map((m) => m.code)).toContain('PL_ODWROTNE_OBCIAZENIE');
      expect(t.mentions.map((m) => m.text)).toContain('odwrotne obciążenie');
    },
  );

  it(
    'DE→FR B2B services (valid VAT): reverse charge carries the UStG § 14a Abs. 1 wording, ' +
      "'Steuerschuldnerschaft des Leistungsempfängers' — NOT the generic mention, unlike DE's own " +
      'franchise case above (§ 14 Abs. 4 Nr. 8 prescribes no wording for that one)',
    () => {
      const t = determineLineTax(
        party('DE', 'B2B'),
        party('FR', 'B2B', { vat: 'valid' }),
        line('SERVICES'),
        prof('DE')!,
        vat,
      );
      expect(t.components[0].category).toBe('AE');
      expect(t.mentions.map((m) => m.code)).toContain('DE_STEUERSCHULDNERSCHAFT');
      expect(t.mentions.map((m) => m.text)).toContain('Steuerschuldnerschaft des Leistungsempfängers');
    },
  );

  it(
    'FR→IT B2B services (valid VAT) still gets the GENERIC reverse-charge mention — proves a country ' +
      'with no entry in the new per-country table is byte-for-byte unaffected by it, even though this ' +
      'exact situation now HAS overrides for other countries (PT/IT/PL/DE above)',
    () => {
      const t = determineLineTax(
        party('FR', 'B2B'),
        party('IT', 'B2B', { vat: 'valid' }),
        line('SERVICES'),
        prof('FR')!,
        vat,
      );
      expect(t.mentions.map((m) => m.code)).toContain('REVERSE_CHARGE');
      expect(t.mentions.map((m) => m.text)).toContain(
        'Autoliquidation / Reverse charge — Art. 196 Directive 2006/112/EC',
      );
    },
  );
});

describe('TaxEngine — export out of the EU (FR→US)', () => {
  it('FR→US B2B services: outside scope (0%, category O), buyer self-assesses, art. hors-champ', () => {
    const t = determineLineTax(party('FR', 'B2B'), party('US', 'B2B'), line('SERVICES'), prof('FR')!, vat);
    expect(t.components[0].category).toBe('O');
    expect(t.components[0].rate).toBe(0);
    expect(t.buyerSelfAssess).toBe(true);
    expect(t.mentions.map((m) => m.text)).toContain(
      'VAT not applicable — supply outside the scope of EU VAT',
    );
  });

  it('FR→US goods: export, zero-rated (0%, category G), customs export, art. 146', () => {
    const t = determineLineTax(party('FR', 'B2B'), party('US', 'B2B'), line('GOODS'), prof('FR')!, vat);
    expect(t.components[0].category).toBe('G');
    expect(t.components[0].rate).toBe(0);
    expect(t.reportingFlags).toContain('CUSTOMS_EXPORT');
    expect(t.mentions.map((m) => m.text)).toContain('Export — zero-rated, Art. 146 Directive 2006/112/EC');
  });

  it(
    'IT→US goods: export carries the DPR 633/1972 art. 21 co. 6 lett. b) wording, ' +
      "'operazione non imponibile' — a DIFFERENT statute from the intra-Community case above, even " +
      'though the two share identical wording, so this must carry its OWN, EXPORT-specific code',
    () => {
      const t = determineLineTax(party('IT', 'B2B'), party('US', 'B2B'), line('GOODS'), prof('IT')!, vat);
      expect(t.components[0].category).toBe('G');
      expect(t.mentions.map((m) => m.code)).toContain('IT_OPERAZIONE_NON_IMPONIBILE_EXPORT');
      expect(t.mentions.map((m) => m.text)).toContain('operazione non imponibile');
      expect(t.mentions.map((m) => m.code)).not.toContain('IT_OPERAZIONE_NON_IMPONIBILE_ICS');
    },
  );
});

describe('TaxEngine — United States sales tax (no VAT)', () => {
  it('US→FR B2B services: no US tax on export (0%), FR buyer self-assesses import VAT', () => {
    const t = determineLineTax(
      party('US', 'B2B', { state: 'CA' }),
      party('FR', 'B2B'),
      line('SERVICES'),
      usSalesTaxProfile,
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
      usSalesTaxProfile,
      vat,
      usSalesTaxProfile,
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
      usSalesTaxProfile,
      vat,
      usSalesTaxProfile,
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
