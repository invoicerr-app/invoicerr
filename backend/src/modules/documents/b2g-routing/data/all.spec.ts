/**
 * Loads every shipped B2G routing file the same way `documents-core.module.ts` does at boot (via
 * `data/all.ts`) — proves each one is well-formed AND that the countries this wave actually shipped
 * (fr, de, it — see this task's own explicit scope) are exactly what's there, no more, no less.
 */
import { ALL_B2G_ROUTING_FILES } from './all';

describe('b2g-routing/data/all.ts', () => {
  it('loads every shipped file without throwing', () => {
    expect(ALL_B2G_ROUTING_FILES.length).toBeGreaterThan(0);
  });

  it('ships exactly FR, DE, IT, ES — the original three-country wave plus the ES/FACe follow-up', () => {
    const countries = ALL_B2G_ROUTING_FILES.map((f) => f.countryCode).sort();
    expect(countries).toEqual(['DE', 'ES', 'FR', 'IT']);
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

  it('DE routes to the deliberately unimplemented federal portal and REQUIRES buyerReference (Leitweg-ID)', () => {
    const de = ALL_B2G_ROUTING_FILES.find((f) => f.countryCode === 'DE')!;
    expect(de.transportId).toBe('zre-ozgre');
    expect(de.formatSyntax).toBe('xrechnung');
    const buyerRef = de.requiredDocumentFields?.find((f) => f.field === 'buyerReference');
    expect(buyerRef?.required).toBe(true);
  });

  it('IT routes to the ALREADY IMPLEMENTED "sdi" channel with "fatturapa" and requires the IPA code', () => {
    const it = ALL_B2G_ROUTING_FILES.find((f) => f.countryCode === 'IT')!;
    expect(it.transportId).toBe('sdi');
    expect(it.formatSyntax).toBe('fatturapa');
    expect(it.requiredClientIdentifiers?.some((i) => i.scheme === 'IT_PA_CODE')).toBe(true);
  });

  it('ES routes to the ALREADY IMPLEMENTED "face" channel with "facturae", requires the NIF, and the FULL DIR3 triad', () => {
    const es = ALL_B2G_ROUTING_FILES.find((f) => f.countryCode === 'ES')!;
    expect(es.transportId).toBe('face');
    expect(es.formatSyntax).toBe('facturae');
    expect(es.requiredClientIdentifiers?.some((i) => i.scheme === 'VAT')).toBe(true);
    const dir3Fields = ['dir3OrganoGestor', 'dir3UnidadTramitadora', 'dir3OficinaContable'];
    for (const field of dir3Fields) {
      const entry = es.requiredDocumentFields?.find((f) => f.field === field);
      expect(entry).toBeDefined();
      expect(entry?.required).toBe(true);
    }
  });
});
