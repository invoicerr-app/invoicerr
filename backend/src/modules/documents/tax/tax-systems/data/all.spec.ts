/**
 * Coverage + content guard for the shipped tax-system catalog — same role
 * `vat-rates/data/all.spec.ts` plays for its own files. The OSS follow-up
 * ("sourcer les tables de taux par pays de destination") added the 26 OTHER EU member states'
 * standard VAT rate — this file pins BOTH that the loader still enforces provenance on every file
 * (mutation target #2: a country file with no `provenance` must fail to load, not silently ship) AND
 * that a handful of notorious rates actually LOADED with the value the TEDB reading
 * produced (mutation target: a copy/paste error swapping two countries' rates, or the seller's own
 * rate leaking into a destination file, would slip past a purely structural "does it load" check).
 *
 * Re-pinned by the 5-country prune (2026-09-10): this mechanism now
 * ships DE/FR/IT/PL/PT only — the other 25 EU member states plus AE/IN/QA/SA/US read for the
 * OSS follow-up were all `git rm`'d along with their data/xx.json. The superlative
 * "highest/lowest in the EU" claims this file used to pin (HU 27%, LU 17%) no longer have an honest
 * basis — this catalog can no longer see the full EU-27 to make that claim — so they were re-scoped
 * to "highest/lowest AMONG THE KEPT COUNTRIES" instead of deleted outright, since PL/PT/DE's own real
 * rates still support a narrower, still-true version of the same observation.
 */
import { assertValidTaxSystemProvenance, InvalidTaxSystemProvenanceError } from '../schema';
import { ALL_TAX_SYSTEM_FILES } from './all';

describe('tax-systems/data — coverage', () => {
  it('loads exactly the five kept countries (DE/FR/IT/PL/PT)', () => {
    const codes = ALL_TAX_SYSTEM_FILES.map((f) => f.countryCode).sort();
    expect(codes).toEqual(['DE', 'FR', 'IT', 'PL', 'PT']);
  });

  it('every shipped file carries a real provenance (already enforced at load time by data/all.ts — this just makes the property explicit)', () => {
    for (const file of ALL_TAX_SYSTEM_FILES) {
      expect(['legal', 'unverified']).toContain(file.provenance.kind);
    }
  });
});

describe('tax-systems/data — the kept standard rates read from TEDB, content-pinned', () => {
  const byCode = (cc: string) => ALL_TAX_SYSTEM_FILES.find((f) => f.countryCode === cc);

  it('DE (Germany): 19% — the rate the OSS gate used to name as missing', () => {
    const de = byCode('DE');
    expect(de?.kind).toBe('VAT');
    expect(de?.standardRate).toBe(19);
    expect(de?.provenance.kind).toBe('legal');
  });

  // PL and PT tie for the highest standard rate AMONG THE KEPT COUNTRIES (23%), DE the lowest (19%)
  // — a narrower, still-true replacement for the "highest/lowest in the EU" claim this test used to
  // pin on HU (27%) and LU (17%), both removed by the 5-country prune (2026-09-10).
  it('PL and PT share the highest standard rate among the kept countries (23%); DE has the lowest (19%)', () => {
    const rates = ALL_TAX_SYSTEM_FILES.filter(
      (f) => f.kind === 'VAT' && typeof f.standardRate === 'number',
    ).map((f) => f.standardRate as number);
    expect(Math.max(...rates)).toBe(23);
    expect(byCode('PL')?.standardRate).toBe(23);
    expect(byCode('PT')?.standardRate).toBe(23);
    expect(Math.min(...rates)).toBe(19);
    expect(byCode('DE')?.standardRate).toBe(19);
  });

  // Spot-checks across the kept set — each value is the one the TEDB reading returned
  // (see each file's own `provenance.sourceText`), not a value recalled from memory.
  it.each([
    ['DE', 19],
    ['IT', 22],
    ['PL', 23],
    ['PT', 23],
  ])('%s standard rate is %s%%', (cc, rate) => {
    expect(byCode(cc)?.standardRate).toBe(rate);
  });

  it('FR still derives its rate from vat-rates/, not one of the TEDB-sourced files', () => {
    const fr = byCode('FR');
    expect(fr?.standardRate).toBeUndefined(); // FR derives its rate from vat-rates/registry.ts, see schema.ts's own header
  });

  it('FR is PROMOTED to `legal` — the resolutionNote already documented a DIRECT reading of CGI art. 293 B, I confirming FRANCHISE_BASE verbatim, so the envelope is promoted with exactly that citation, never a fact the note did not already establish as read', () => {
    const fr = byCode('FR');
    expect(fr?.provenance.kind).toBe('legal');
    if (fr?.provenance.kind === 'legal') {
      // The exact CGI art. 293 B, I sentence, already cited as `legal` on vat-rates/data/fr.json's
      // own 'fr-exempt-293b' entry — reused here verbatim, not a new, unverified citation.
      expect(fr.provenance.sourceText).toContain(
        'franchise qui les dispense du paiement de la taxe sur la valeur ajoutée',
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

  it('none of the TEDB-sourced files (DE/IT/PL/PT) invent a reducedRates table — the OSS branch this work unblocks reads only standardRate, and DocumentLine has no per-line product category to select a reduced rate against', () => {
    for (const cc of ['DE', 'IT', 'PL', 'PT']) {
      expect(byCode(cc)?.reducedRates).toBeUndefined();
    }
  });

  it('every one of the TEDB-sourced files (DE/IT/PL/PT) claims "legal" provenance citing the actual TEDB HTTP response, checked 2026-09-01', () => {
    for (const cc of ['DE', 'IT', 'PL', 'PT']) {
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

  it('rejects a fact claiming "legal" provenance but missing sourceText — the exact shape a careless copy/paste of the shipped files could produce', () => {
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

// Drop-in invariant (readdir-discovery conversion) — proves all.ts's own `discoverCountryCodes()`
// really does pick up every `<cc>.json` sitting in this directory: this test re-reads the directory
// with the IDENTICAL pattern, independently of all.ts's own implementation, so a regression that
// silently drops a file from discovery (a typo'd pattern, a change that stops sorting, anything) goes
// red here — the whole point of "adding a country = dropping a file" is only true if this holds.
describe('tax-systems/data — every *.json on disk is actually loaded (drop-in invariant)', () => {
  it('ALL_TAX_SYSTEM_FILES covers exactly the country files present in this directory, no more, no fewer', () => {
    const { readdirSync } = require('node:fs');
    const onDisk = readdirSync(__dirname)
      .filter((name: string) => /^[a-z]{2}\.json$/.test(name))
      .map((name: string) => name.replace(/\.json$/, '').toUpperCase())
      .sort();
    const loaded = ALL_TAX_SYSTEM_FILES.map((f) => f.countryCode).sort();
    expect(loaded).toEqual(onDisk);
  });
});
