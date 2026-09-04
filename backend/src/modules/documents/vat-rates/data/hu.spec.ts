/**
 * HU — direct-load content spec, added by the HU-COMPLEMENT country agent (TODO_DOCUMENTS.md, vague
 * B, lot 4). Same rationale as vat-rates/data/gr.spec.ts: reads `hu.json` straight off disk rather
 * than through `data/all.ts` (still FR/NL/AT/… only — wiring "hu" in is a mandataire decision), and
 * re-runs the exact load-time gate (`assertValidVatRateProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidVatRateProvenance, CountryVatRatesFile } from '../schema';

function loadHu(): CountryVatRatesFile {
  const raw = readFileSync(join(__dirname, 'hu.json'), 'utf-8');
  return JSON.parse(raw) as CountryVatRatesFile;
}

describe('HU — vat-rates/data/hu.json', () => {
  const hu = loadHu();

  it('declares countryCode HU with exactly five rates — 27 / 18 / 5 / 0 / 0(exempt) — every one "legal"', () => {
    expect(hu.countryCode).toBe('HU');
    const rates = hu.rates.map((r) => r.rate).sort((a, b) => a - b);
    expect(rates).toEqual([0, 0, 5, 18, 27]);
    for (const rate of hu.rates) {
      expect(rate.provenance.kind).toBe('legal');
      if (rate.provenance.kind === 'legal') {
        expect(rate.provenance.sourceCheckedAt).toBe('2026-09-04');
      }
    }
  });

  it('every rate passes the load-time provenance gate', () => {
    for (const rate of hu.rates) {
      expect(() => assertValidVatRateProvenance(rate, 'hu.json (test)')).not.toThrow();
    }
  });

  it('pins each rate to its own Áfa tv. 82. § sub-paragraph, by id — never one generic citation reused', () => {
    const byId = (id: string) => hu.rates.find((r) => r.id === id);

    const standard = byId('hu-standard')!;
    expect(standard.category).toBe('STANDARD');
    if (standard.provenance.kind === 'legal') {
      expect(standard.provenance.sourceText).toMatch(/27 százaléka/);
    }

    const reduced = byId('hu-reduced')!;
    expect(reduced.category).toBe('REDUCED');
    if (reduced.provenance.kind === 'legal') {
      expect(reduced.provenance.sourceText).toMatch(/18 százaléka/);
    }

    const superReduced = byId('hu-super-reduced')!;
    expect(superReduced.category).toBe('SUPER_REDUCED');
    if (superReduced.provenance.kind === 'legal') {
      expect(superReduced.provenance.sourceText).toMatch(/5 százaléka/);
    }

    const zero = byId('hu-zero')!;
    expect(zero.category).toBe('ZERO');
    if (zero.provenance.kind === 'legal') {
      expect(zero.provenance.sourceText).toMatch(/0 százaléka/);
    }

    const texts = [standard, reduced, superReduced, zero].map((r) =>
      r.provenance.kind === 'legal' ? r.provenance.sourceText : '',
    );
    expect(new Set(texts).size).toBe(4);
  });

  it('hu-exempt is category EXEMPT (not ZERO) — the alanyi adómentesség small-business threshold, distinct from the statutory 0% rate', () => {
    const exempt = hu.rates.find((r) => r.id === 'hu-exempt')!;
    expect(exempt.category).toBe('EXEMPT');
    expect(exempt.rate).toBe(0);
    if (exempt.provenance.kind === 'legal') {
      expect(exempt.provenance.sourceText).toMatch(/20 000 000 forintnak/);
    }
    expect(exempt.notes).toMatch(/EXEMPT/);
    expect(exempt.notes).toMatch(/hu-zero/);
  });

  it("cross-checks all four positive-rate tiers against tax/tax-systems/data/hu.json's own TEDB reading and a fresh TEDB re-query", () => {
    expect(hu.notes ?? '').toMatch(/tax\/tax-systems\/data\/hu\.json/);
    expect(hu.notes ?? '').toMatch(/TEDB/);
  });

  it('documents the net.jogtar.hu access-method workaround for the njt.hu connection resets', () => {
    expect(hu.notes ?? '').toMatch(/net\.jogtar\.hu/);
    expect(hu.notes ?? '').toMatch(/njt\.hu/);
  });

  it('every rate id is unique', () => {
    const ids = hu.rates.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
