/**
 * Loads every shipped B2G routing file the same way `documents-core.module.ts` does at boot (via
 * `data/all.ts`) — proves each one is well-formed AND that the countries this wave actually shipped
 * (fr, de, it — see this task's own explicit scope) are exactly what's there, no more, no less.
 *
 * A LATER audit task (2026-09-02) added TEN more countries after reading all 23 remaining EU member
 * states — see `data/all.ts`'s own header and `B2G_COVERAGE.md` at the repo root for the full audit.
 * Nine (be/cy/ee/gr/lt/lu/lv/mt/se) share the exact same shape — `transportId: "peppol"`,
 * `formatSyntax: "peppol-bis"`, no country-specific required identifiers/fields — so they get ONE
 * pinned, looped test rather than nine near-duplicate ones; pl is structurally different (its own
 * national channel/format) and gets its own dedicated test, same treatment as fr/de/it/es above.
 *
 * `nl` is added by a LATER task still (root TODO, "NLCIUS vendorable" — mandant "Go", 2026-09-05) —
 * structurally closer to DE (its own vendored national CIUS, `formatOverride`-carried over the SAME
 * `"peppol"` transport) than to the nine generic `"peppol-bis"` countries above, so it gets its own
 * dedicated test too, same treatment as DE's below.
 */
import { peppolBisFormatProvider } from '../../formats/peppol-bis-provider';
import { fa3FormatProvider } from '../../formats/national/fa3-provider';
import { nlciusFormatProvider } from '../../formats/nlcius-provider';
import { ALL_B2G_ROUTING_FILES } from './all';

/** The nine countries read as "generic Peppol BIS, no national CIUS" — see each file's own header
 *  for its own citation (EC eInvoicing Country Factsheet, checked 2026-09-02). */
const PEPPOL_BIS_COUNTRIES = ['BE', 'CY', 'EE', 'GR', 'LT', 'LU', 'LV', 'MT', 'SE'];

describe('b2g-routing/data/all.ts', () => {
  it('loads every shipped file without throwing', () => {
    expect(ALL_B2G_ROUTING_FILES.length).toBeGreaterThan(0);
  });

  it("ships exactly 15 countries: the original FR/DE/IT/ES wave, the 2026-09-02 B2G audit's ten, plus NL (NLCIUS)", () => {
    const countries = ALL_B2G_ROUTING_FILES.map((f) => f.countryCode).sort();
    expect(countries).toEqual([
      'BE',
      'CY',
      'DE',
      'EE',
      'ES',
      'FR',
      'GR',
      'IT',
      'LT',
      'LU',
      'LV',
      'MT',
      'NL',
      'PL',
      'SE',
    ]);
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

  // NL (NLCIUS) — root TODO, "NLCIUS vendorable" (mandant "Go", 2026-09-05). Structurally closer to
  // DE (its own vendored national CIUS, format-overridden over the SAME "peppol" transport) than to
  // the nine generic peppol-bis countries above — see `data/nl.json`'s own header for the full
  // citation and for why NO `requiredClientIdentifiers`/mandatory `requiredDocumentFields` are added
  // (every NLCIUS BR-NL-* rule is scoped to a DUTCH supplier, unlike BR-DE-*'s own unconditional
  // Leitweg-ID requirement).
  it('NL routes through the IMPLEMENTED "peppol" channel, carrying "nlcius" CONTENT (never Peppol BIS), matching the registered nlciusFormatProvider id, and adds NO unconditional required identifier/field (every BR-NL-* rule is scoped to a Dutch supplier)', () => {
    const nl = ALL_B2G_ROUTING_FILES.find((f) => f.countryCode === 'NL')!;
    expect(nl.transportId).toBe('peppol');
    expect(nl.formatSyntax).toBe('nlcius');
    expect(nl.formatSyntax).toBe(nlciusFormatProvider.id);
    expect(nl.requiredClientIdentifiers ?? []).toEqual([]);
    // The one document field this rule names (buyerReference/BR-NL-2) is informational only —
    // `required: false` — precisely because it is NOT unconditional (see `data/nl.json`'s own note).
    const buyerRef = nl.requiredDocumentFields?.find((f) => f.field === 'buyerReference');
    expect(buyerRef?.required).toBe(false);
    expect(nl.notes).toContain('0106');
    expect(nl.notes).toContain('0190');
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

  // The 2026-09-02 B2G audit wave — see this file's own header. All nine read as "generic Peppol
  // BIS, no national CIUS" (EC eInvoicing Country Factsheets) — pinned together, plus each one's own
  // EAS (Peppol codelist v9.7) named in its own `notes`, so a citation drifting silently to the wrong
  // scheme would still show up as a content change here.
  it.each([
    ['BE', '0208'],
    ['CY', '9928'],
    ['EE', '0191'],
    ['GR', '9933'],
    ['LT', '0200'],
    ['LU', '0240'],
    ['LV', '0218'],
    ['MT', '9943'],
    ['SE', '0007'],
  ])('%s routes to the ALREADY IMPLEMENTED "peppol" channel with generic "peppol-bis" (no CIUS), EAS %s named in its own notes, and adds NO country-specific required identifier/field', (countryCode, eas) => {
    const rule = ALL_B2G_ROUTING_FILES.find((f) => f.countryCode === countryCode)!;
    expect(rule).toBeDefined();
    expect(rule.transportId).toBe('peppol');
    expect(rule.formatSyntax).toBe('peppol-bis');
    // `formatSyntax` really is the registered Peppol BIS provider's own id — never a typo that
    // would only surface later as a runtime `UnknownFormatError` at send time.
    expect(rule.formatSyntax).toBe(peppolBisFormatProvider.id);
    expect(rule.requiredClientIdentifiers ?? []).toEqual([]);
    expect(rule.requiredDocumentFields ?? []).toEqual([]);
    expect(rule.notes).toContain(eas);
  });

  it('every peppol-bis rule in this wave is covered by PEPPOL_BIS_COUNTRIES — the loop above is exhaustive, never a silent extra', () => {
    const actualPeppolBis = ALL_B2G_ROUTING_FILES.filter((f) => f.formatSyntax === 'peppol-bis')
      .map((f) => f.countryCode)
      .sort();
    expect(actualPeppolBis).toEqual([...PEPPOL_BIS_COUNTRIES].sort());
  });

  it('PL routes to the ALREADY IMPLEMENTED "ksef" channel with its OWN national "fa3" format (never a generic Peppol BIS substitute for PEF), and requires the NIP', () => {
    const pl = ALL_B2G_ROUTING_FILES.find((f) => f.countryCode === 'PL')!;
    expect(pl.transportId).toBe('ksef');
    expect(pl.formatSyntax).toBe('fa3');
    expect(pl.formatSyntax).toBe(fa3FormatProvider.id);
    expect(pl.requiredClientIdentifiers?.some((i) => i.scheme === 'VAT')).toBe(true);
  });
});
