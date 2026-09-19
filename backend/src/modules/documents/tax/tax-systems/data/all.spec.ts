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

describe('tax-systems/data — the kept standard rates, content-pinned', () => {
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

  // Spot-checks across the kept set — each value is the one the underlying reading returned
  // (see each file's own `provenance.sourceText`), not a value recalled from memory. All four of
  // DE/IT/PL/PT had their citation replaced 2026-09-13 (TEDB JSON body → statute — UStG § 12 Abs. 1,
  // DPR 633/1972 art. 16, ustawa o VAT art. 41/146ef, CIVA art. 18.º respectively; see the dedicated
  // byte-identity tests below), but the figures themselves are unchanged — every statute agrees with
  // the TEDB reading it replaces.
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

  it('none of DE/IT/PL/PT invent a reducedRates table — the OSS branch this work unblocks reads only standardRate, and DocumentLine has no per-line product category to select a reduced rate against', () => {
    for (const cc of ['DE', 'IT', 'PL', 'PT']) {
      expect(byCode(cc)?.reducedRates).toBeUndefined();
    }
  });

  it("DE is PROMOTED off the TEDB HTTP body onto the statute itself — the same UStG § 12 Abs. 1 quote already `legal` on vat-rates/data/de.json's own 'de-standard' entry, copied byte-for-byte (2026-09-13): a citation a reader can check in the law beats a reproduced JSON payload", () => {
    const de = byCode('DE');
    const deVatStandard = require('../../../vat-rates/data/de.json').rates.find(
      (r: { id: string }) => r.id === 'de-standard',
    );
    expect(de?.provenance.kind).toBe('legal');
    if (de?.provenance.kind === 'legal') {
      expect(de.provenance.sourceText).not.toMatch(/"isoCode"/); // no longer the TEDB JSON body
      expect(de.provenance.sourceText).toBe(deVatStandard.provenance.sourceText);
      expect(de.provenance.sourceCheckedAt).toBe(deVatStandard.provenance.sourceCheckedAt);
      expect(de.provenance.sourceCheckedAt).toBe('2026-09-13');
    }
  });

  // The following three mirror the DE test above exactly — same shape, same byte-identity claim —
  // for the three files this task's own swap touched. They REPLACE the old
  // 'IT/PL/PT still claim "legal" provenance citing the actual TEDB HTTP response' test: that
  // assertion's subject (the TEDB JSON body) no longer exists in any of these three files, and
  // weakening or deleting the assertion to make the suite green would have hidden the swap instead
  // of proving it. This is the stronger replacement — it proves the NEW citation is real and
  // byte-identical to its vat-rates source, not merely that the old one is gone.

  it("IT is PROMOTED off the TEDB HTTP body onto the statute itself — the same DPR 633/1972 art. 16 quote already `legal` on vat-rates/data/it.json's own 'it-standard' entry, copied byte-for-byte (2026-09-13): a citation a reader can check in the law beats a reproduced JSON payload", () => {
    const it_ = byCode('IT');
    const itVatStandard = require('../../../vat-rates/data/it.json').rates.find(
      (r: { id: string }) => r.id === 'it-standard',
    );
    expect(it_?.provenance.kind).toBe('legal');
    if (it_?.provenance.kind === 'legal') {
      expect(it_.provenance.sourceText).not.toMatch(/"isoCode"/); // no longer the TEDB JSON body
      expect(it_.provenance.sourceText).toBe(itVatStandard.provenance.sourceText);
      expect(it_.provenance.sourceCheckedAt).toBe(itVatStandard.provenance.sourceCheckedAt);
      expect(it_.provenance.sourceCheckedAt).toBe('2026-09-13');
    }
  });

  it("PL is PROMOTED off the TEDB HTTP body onto the statute itself — the same art. 41 / art. 146ef quote already `legal` on vat-rates/data/pl.json's own 'pl-standard' entry, copied byte-for-byte (2026-09-13): a citation a reader can check in the law beats a reproduced JSON payload", () => {
    const pl = byCode('PL');
    const plVatStandard = require('../../../vat-rates/data/pl.json').rates.find(
      (r: { id: string }) => r.id === 'pl-standard',
    );
    expect(pl?.provenance.kind).toBe('legal');
    if (pl?.provenance.kind === 'legal') {
      expect(pl.provenance.sourceText).not.toMatch(/"isoCode"/); // no longer the TEDB JSON body
      expect(pl.provenance.sourceText).toBe(plVatStandard.provenance.sourceText);
      expect(pl.provenance.sourceCheckedAt).toBe(plVatStandard.provenance.sourceCheckedAt);
      expect(pl.provenance.sourceCheckedAt).toBe('2026-09-13');
      // Poland's statutory basis is split (see vat-rates/data/pl.json's own notes): art. 41 alone
      // sets a 22% BASE rate, and it is art. 146ef that raises it to the 23% actually in force. The
      // quotation must carry BOTH provisions — citing art. 41 alone would misleadingly read as if
      // 22% were today's rate.
      expect(pl.provenance.sourceText).toContain('Art. 41');
      expect(pl.provenance.sourceText).toContain('146ef');
      expect(pl.provenance.sourceText).toContain('23 %');
    }
  });

  it("PT is PROMOTED off the TEDB HTTP body onto the statute itself — the same CIVA art. 18.º quote already `legal` on vat-rates/data/pt.json's own 'pt-standard' entry, copied byte-for-byte (that entry's own check date, 2026-09-04): a citation a reader can check in the law beats a reproduced JSON payload", () => {
    const pt = byCode('PT');
    const ptVatStandard = require('../../../vat-rates/data/pt.json').rates.find(
      (r: { id: string }) => r.id === 'pt-standard',
    );
    expect(pt?.provenance.kind).toBe('legal');
    if (pt?.provenance.kind === 'legal') {
      expect(pt.provenance.sourceText).not.toMatch(/"isoCode"/); // no longer the TEDB JSON body
      expect(pt.provenance.sourceText).toBe(ptVatStandard.provenance.sourceText);
      expect(pt.provenance.sourceCheckedAt).toBe(ptVatStandard.provenance.sourceCheckedAt);
      // PT's vat-rates reading predates the 2026-09-13 swap date the other three share — carried
      // over as-is, per this task's own instruction, rather than bumped to match them.
      expect(pt.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
  });

  it('every `legal` standard-rate provenance in this catalog quotes a statute, never an API response body — the positive invariant that replaces the old TEDB-citation assertion now that IT/PL/PT no longer have one', () => {
    const filesWithStandardRate = ALL_TAX_SYSTEM_FILES.filter(
      (f) => f.kind === 'VAT' && typeof f.standardRate === 'number' && f.provenance.kind === 'legal',
    );
    // Guards the guard: this only proves something if it actually has files to check (today
    // DE/IT/PL/PT) — an empty filter passing vacuously would be exactly the kind of assertion this
    // task's own brief warns against.
    expect(filesWithStandardRate.length).toBe(4);
    for (const file of filesWithStandardRate) {
      const sourceText = (file.provenance as { sourceText: string }).sourceText;
      // A TEDB (or any similarly-shaped REST) response body always carries these literal JSON keys
      // verbatim — a statutory quotation never does. Where the old assertion REQUIRED this shape,
      // this one FORBIDS it, for every file that carries a standard rate, not just the three the
      // 2026-09-13 swap touched.
      expect(sourceText).not.toMatch(/"isoCode"/);
      expect(sourceText).not.toMatch(/"situationOn"/);
      expect(sourceText).not.toMatch(/"countryName"/);
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
