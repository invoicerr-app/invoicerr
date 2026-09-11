/**
 * Loads every shipped B2G routing file the same way `documents-core.module.ts` does at boot (via
 * `data/all.ts`) — proves each one is well-formed AND that the countries actually shipped
 * are exactly what's there, no more, no less.
 *
 * Re-pinned by the 5-country prune (2026-09-10): this mechanism now ships
 * DE/FR/IT/PL only. ES (its own "face"/facturae/DIR3 triad), NL (NLCIUS), and the nine countries the
 * 2026-09-02 B2G audit added as "generic Peppol BIS, no national CIUS"
 * (BE/CY/EE/GR/LT/LU/LV/MT/SE) were all `git rm`'d along with their data/xx.json — none of the four
 * kept countries shares that generic peppol-bis shape (DE overrides to "xrechnung", FR routes to
 * "chorus-pro", IT to "fatturapa" via "sdi", PL to its own "fa3" via "ksef"), so the peppol-bis-only
 * cases below have no honest re-anchor and are deleted rather than weakened.
 */
import { fa3FormatProvider } from '../../formats/national/fa3-provider';
import { ALL_B2G_ROUTING_FILES } from './all';

describe('b2g-routing/data/all.ts', () => {
  it('loads every shipped file without throwing', () => {
    expect(ALL_B2G_ROUTING_FILES.length).toBeGreaterThan(0);
  });

  it('ships exactly the four kept countries (DE/FR/IT/PL)', () => {
    const countries = ALL_B2G_ROUTING_FILES.map((f) => f.countryCode).sort();
    expect(countries).toEqual(['DE', 'FR', 'IT', 'PL']);
  });

  it('every shipped rule carries LEGAL provenance with a real citation', () => {
    for (const rule of ALL_B2G_ROUTING_FILES) {
      expect(rule.provenance.kind).toBe('legal');
      if (rule.provenance.kind === 'legal') {
        expect(rule.provenance.sourceText.length).toBeGreaterThan(20);
        expect(rule.provenance.sourceCheckedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it('FR routes to the deliberately unimplemented "chorus-pro" channel', () => {
    const fr = ALL_B2G_ROUTING_FILES.find((f) => f.countryCode === 'FR')!;
    expect(fr.transportId).toBe('chorus-pro');
    expect(fr.requiredClientIdentifiers?.some((i) => i.scheme === 'LEGAL_ID')).toBe(true);
  });

  // "Le trou allemand du B2G" — CLOSED: DE now routes through the ALREADY IMPLEMENTED "peppol"
  // channel, carrying "xrechnung" CONTENT via that transport's own format override
  // (`transports/peppol-transport.ts`'s own header, "THE FORMAT OVERRIDE") — never Peppol BIS. See
  // `b2g-routing/data/de.json`'s own ADDENDUM for the full, sourced resolution (the federal portal
  // accepts Peppol as a CHANNEL; XRechnung remains the CONTENT the law names, regardless of channel).
  it('DE routes through the IMPLEMENTED "peppol" channel, carrying "xrechnung" CONTENT (never Peppol BIS), and REQUIRES buyerReference (Leitweg-ID)', () => {
    const de = ALL_B2G_ROUTING_FILES.find((f) => f.countryCode === 'DE')!;
    expect(de.transportId).toBe('peppol');
    expect(de.formatSyntax).toBe('xrechnung');
    const buyerRef = de.requiredDocumentFields?.find((f) => f.field === 'buyerReference');
    expect(buyerRef?.required).toBe(true);
  });

  // NL (NLCIUS) and ES (its own "face"/facturae/DIR3 triad) were removed by the 5-country prune
  // (2026-09-10) along with their data/xx.json — neither case has a re-anchor among DE/FR/IT/PL.

  it('IT routes to the ALREADY IMPLEMENTED "sdi" channel with "fatturapa" and requires the IPA code', () => {
    const it = ALL_B2G_ROUTING_FILES.find((f) => f.countryCode === 'IT')!;
    expect(it.transportId).toBe('sdi');
    expect(it.formatSyntax).toBe('fatturapa');
    expect(it.requiredClientIdentifiers?.some((i) => i.scheme === 'IT_PA_CODE')).toBe(true);
  });

  // The 2026-09-02 B2G audit's nine "generic Peppol BIS, no national CIUS" countries
  // (BE/CY/EE/GR/LT/LU/LV/MT/SE) were all removed by the 5-country prune (2026-09-10) — none of the
  // four kept countries shares that shape (see this file's own header), so no rule in the kept set
  // has `formatSyntax === 'peppol-bis'` any more; this is asserted directly rather than deleted
  // outright, so a future rule silently reintroducing an untested peppol-bis shape would be caught.
  it('no kept country uses the generic "peppol-bis" format any more — DE/FR/IT/PL each have their own channel/format', () => {
    const peppolBisRules = ALL_B2G_ROUTING_FILES.filter((f) => f.formatSyntax === 'peppol-bis');
    expect(peppolBisRules).toEqual([]);
  });

  it('PL routes to the ALREADY IMPLEMENTED "ksef" channel with its OWN national "fa3" format (never a generic Peppol BIS substitute for PEF), and requires the NIP', () => {
    const pl = ALL_B2G_ROUTING_FILES.find((f) => f.countryCode === 'PL')!;
    expect(pl.transportId).toBe('ksef');
    expect(pl.formatSyntax).toBe('fa3');
    expect(pl.formatSyntax).toBe(fa3FormatProvider.id);
    expect(pl.requiredClientIdentifiers?.some((i) => i.scheme === 'VAT')).toBe(true);
  });
});

// Drop-in invariant (readdir-discovery conversion) — proves all.ts's own `discoverCountryCodes()`
// really does pick up every `<cc>.json` sitting in this directory: this test re-reads the directory
// with the IDENTICAL pattern, independently of all.ts's own implementation, so a regression that
// silently drops a file from discovery (a typo'd pattern, a change that stops sorting, anything) goes
// red here — the whole point of "adding a country = dropping a file" is only true if this holds.
describe('b2g-routing/data — every *.json on disk is actually loaded (drop-in invariant)', () => {
  it('ALL_B2G_ROUTING_FILES covers exactly the country files present in this directory, no more, no fewer', () => {
    const { readdirSync } = require('node:fs');
    const onDisk = readdirSync(__dirname)
      .filter((name: string) => /^[a-z]{2}\.json$/.test(name))
      .map((name: string) => name.replace(/\.json$/, '').toUpperCase())
      .sort();
    const loaded = ALL_B2G_ROUTING_FILES.map((f) => f.countryCode).sort();
    expect(loaded).toEqual(onDisk);
  });
});
