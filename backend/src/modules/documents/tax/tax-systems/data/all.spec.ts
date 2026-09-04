/**
 * Coverage + content guard for the shipped tax-system catalog — same role
 * `vat-rates/data/all.spec.ts` plays for its own files. Root TODO item 16's own OSS follow-up
 * ("sourcer les tables de taux par pays de destination") added the 26 OTHER EU member states'
 * standard VAT rate — this file pins BOTH that the loader still enforces provenance on every file
 * (mutation target #2: a country file with no `provenance` must fail to load, not silently ship) AND
 * that a handful of notorious rates actually LOADED with the value this task's own TEDB reading
 * produced (mutation target: a copy/paste error swapping two countries' rates, or the seller's own
 * rate leaking into a destination file, would slip past a purely structural "does it load" check).
 */
import { assertValidTaxSystemProvenance, InvalidTaxSystemProvenanceError } from '../schema';
import { ALL_TAX_SYSTEM_FILES } from './all';

describe('tax-systems/data — coverage', () => {
  it('loads exactly the 7 non-EU jurisdictions plus all 27 EU member states (FR + the 26 read for item 16)', () => {
    const codes = ALL_TAX_SYSTEM_FILES.map((f) => f.countryCode).sort();
    const nonEu = ['AE', 'IN', 'IT', 'QA', 'SA', 'US']; // IT is EU but was already shipped pre-item-16
    const eu27 = [
      'AT',
      'BE',
      'BG',
      'CY',
      'CZ',
      'DE',
      'DK',
      'EE',
      'ES',
      'FI',
      'FR',
      'GR',
      'HR',
      'HU',
      'IE',
      'IT',
      'LT',
      'LU',
      'LV',
      'MT',
      'NL',
      'PL',
      'PT',
      'RO',
      'SE',
      'SI',
      'SK',
    ];
    expect(eu27.length).toBe(27); // sanity on the fixture itself
    const expected = [...new Set([...nonEu, ...eu27])].sort();
    expect(codes).toEqual(expected);
  });

  it('every shipped file carries a real provenance (already enforced at load time by data/all.ts — this just makes the property explicit)', () => {
    for (const file of ALL_TAX_SYSTEM_FILES) {
      expect(['legal', 'unverified']).toContain(file.provenance.kind);
    }
  });
});

describe('tax-systems/data — the 26 EU standard rates read from TEDB (item 16 follow-up), content-pinned', () => {
  const byCode = (cc: string) => ALL_TAX_SYSTEM_FILES.find((f) => f.countryCode === cc);

  it('DE (Germany): 19% — the rate the OSS gate used to name as missing', () => {
    const de = byCode('DE');
    expect(de?.kind).toBe('VAT');
    expect(de?.standardRate).toBe(19);
    expect(de?.provenance.kind).toBe('legal');
  });

  it('HU (Hungary): 27% — the highest standard VAT rate in the EU', () => {
    const hu = byCode('HU');
    expect(hu?.standardRate).toBe(27);
    const allRates = ALL_TAX_SYSTEM_FILES.filter(
      (f) => f.kind === 'VAT' && typeof f.standardRate === 'number',
    );
    const max = Math.max(...allRates.map((f) => f.standardRate as number));
    expect(max).toBe(27);
  });

  it('LU (Luxembourg): 17% — the lowest standard VAT rate in the EU', () => {
    const lu = byCode('LU');
    expect(lu?.standardRate).toBe(17);
    const eu27Codes = new Set([
      'AT',
      'BE',
      'BG',
      'CY',
      'CZ',
      'DE',
      'DK',
      'EE',
      'ES',
      'FI',
      'FR',
      'GR',
      'HR',
      'HU',
      'IE',
      'IT',
      'LT',
      'LU',
      'LV',
      'MT',
      'NL',
      'PL',
      'PT',
      'RO',
      'SE',
      'SI',
      'SK',
    ]);
    const euRates = ALL_TAX_SYSTEM_FILES.filter(
      (f) => eu27Codes.has(f.countryCode) && typeof f.standardRate === 'number',
    );
    const min = Math.min(...euRates.map((f) => f.standardRate as number));
    expect(min).toBe(17);
  });

  // Spot-checks across the rest of the 26 — each value is the one this task's own TEDB reading
  // returned (see each file's own `provenance.sourceText`), not a value recalled from memory.
  it.each([
    ['AT', 20],
    ['BE', 21],
    ['BG', 20],
    ['CY', 19],
    ['CZ', 21],
    ['DK', 25],
    ['EE', 24],
    ['ES', 21], // mainland/general rate — NOT the Canary Islands' own 7% IGIC, see es.json's own notes
    ['FI', 25.5],
    ['GR', 24], // TEDB indexes this under isoCode "EL"; this catalog keeps "GR" — see gr.json's own notes
    ['HR', 25],
    ['IE', 23],
    ['IT', 22],
    ['LT', 21],
    ['LV', 21],
    ['MT', 18],
    ['NL', 21],
    ['PL', 23],
    ['PT', 23],
    ['RO', 21],
    ['SE', 25],
    ['SI', 22],
    ['SK', 23],
  ])('%s standard rate is %s%%', (cc, rate) => {
    expect(byCode(cc)?.standardRate).toBe(rate);
  });

  it('FR still derives its rate from vat-rates/, not one of the 26 hand-sourced TEDB files', () => {
    const fr = byCode('FR');
    expect(fr?.standardRate).toBeUndefined(); // FR derives its rate from vat-rates/registry.ts, see schema.ts's own header
  });

  it('FR is PROMOTED to `legal` (Vague A correction, TODO_DOCUMENTS.md) — the resolutionNote already documented a DIRECT reading of CGI art. 293 B, I confirming FRANCHISE_BASE verbatim, so the envelope is promoted with exactly that citation, never a fact the note did not already establish as read', () => {
    const fr = byCode('FR');
    expect(fr?.provenance.kind).toBe('legal');
    if (fr?.provenance.kind === 'legal') {
      // The exact CGI art. 293 B, I sentence, already cited as `legal` on vat-rates/data/fr.json's
      // own 'fr-exempt-293b' entry — reused here verbatim, not a new, unverified citation.
      expect(fr.provenance.sourceText).toContain(
        "franchise qui les dispense du paiement de la taxe sur la valeur ajoutée",
      );
      expect(fr.provenance.sourceCheckedAt).toBe('2026-09-01');
    }
    // The promotion covers exactly what the note already established as READ (the `schemes`
    // finding) — `hasDomesticZeroRate` is a documented ABSENCE finding, not a citation, and this
    // schema carries one provenance per FILE, not per field, so the caveat must survive the
    // promotion in `notes` rather than being silently dropped now that the envelope reads "legal".
    expect(fr?.notes).toContain('hasDomesticZeroRate');
    expect(fr?.notes).toContain('293 B');
  });

  it('none of the 26 new files invent a reducedRates table — the OSS branch this work unblocks reads only standardRate, and DocumentLine has no per-line product category to select a reduced rate against', () => {
    const newCodes = [
      'AT',
      'BE',
      'BG',
      'CY',
      'CZ',
      'DE',
      'DK',
      'EE',
      'ES',
      'FI',
      'GR',
      'HR',
      'HU',
      'IE',
      'LT',
      'LU',
      'LV',
      'MT',
      'NL',
      'PL',
      'PT',
      'RO',
      'SE',
      'SI',
      'SK',
    ];
    for (const cc of newCodes) {
      expect(byCode(cc)?.reducedRates).toBeUndefined();
    }
  });

  it('every one of the 26 new files claims "legal" provenance citing the actual TEDB HTTP response, checked 2026-09-01', () => {
    const newCodes = [
      'AT',
      'BE',
      'BG',
      'CY',
      'CZ',
      'DE',
      'DK',
      'EE',
      'ES',
      'FI',
      'GR',
      'HR',
      'HU',
      'IE',
      'LT',
      'LU',
      'LV',
      'MT',
      'NL',
      'PL',
      'PT',
      'RO',
      'SE',
      'SI',
      'SK',
    ];
    for (const cc of newCodes) {
      const file = byCode(cc);
      expect(file?.provenance.kind).toBe('legal');
      if (file?.provenance.kind === 'legal') {
        expect(file.provenance.sourceText).toMatch(/"isoCode"/);
        expect(file.provenance.sourceText).toMatch(/"type" : "STANDARD"/);
        expect(file.provenance.sourceCheckedAt).toBe('2026-09-01');
        expect(file.notes).toContain('tedb/rest-api/vatSearch');
      }
    }
  });
});

describe('tax-systems/data — mutation target #2: a file with no provenance must not load', () => {
  it('assertValidTaxSystemProvenance (the exact guard data/all.ts#loadCountryFile calls on every parsed file) rejects a fact with no provenance field at all', () => {
    const broken = { countryCode: 'DE', kind: 'VAT', standardRate: 19 } as unknown as Parameters<
      typeof assertValidTaxSystemProvenance
    >[0];
    expect(() => assertValidTaxSystemProvenance(broken, 'documents/tax/tax-systems/data/de.json')).toThrow(
      InvalidTaxSystemProvenanceError,
    );
  });

  it('rejects a fact claiming "legal" provenance but missing sourceText — the exact shape a careless copy/paste of this task’s own files could produce', () => {
    const broken = {
      countryCode: 'DE',
      kind: 'VAT',
      standardRate: 19,
      provenance: { kind: 'legal', sourceCheckedAt: '2026-09-01' },
    } as unknown as Parameters<typeof assertValidTaxSystemProvenance>[0];
    expect(() => assertValidTaxSystemProvenance(broken, 'documents/tax/tax-systems/data/de.json')).toThrow(
      /missing sourceText/,
    );
  });
});
