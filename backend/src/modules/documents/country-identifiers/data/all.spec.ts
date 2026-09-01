/**
 * Coverage guard for the SHIPPED identifier-requirements files — the same role
 * country-policy/data/all.spec.ts plays for the action-policy files, scaled to this concern.
 */
import { ALL_COUNTRY_IDENTIFIER_FILES } from './all';

function fileFor(countryCode: string) {
  const file = ALL_COUNTRY_IDENTIFIER_FILES.find((f) => f.countryCode === countryCode);
  if (!file) throw new Error(`No identifier-requirements file loaded for "${countryCode}"`);
  return file;
}

describe('country-identifiers/data — the shipped FR and US files', () => {
  it('loads exactly the two countries this task asked for, at minimum', () => {
    const codes = ALL_COUNTRY_IDENTIFIER_FILES.map((f) => f.countryCode).sort();
    expect(codes).toEqual(expect.arrayContaining(['FR', 'US']));
  });

  it('every fact in every shipped file carries a real provenance (already enforced at load time by data/all.ts — this just makes the property explicit here)', () => {
    for (const file of ALL_COUNTRY_IDENTIFIER_FILES) {
      for (const fact of file.schemes) {
        expect(['legal', 'unverified']).toContain(fact.provenance.kind);
      }
    }
  });

  // Honest state check, not an aspiration: this is a MIXED-grade check, not a blanket
  // "everything is unverified" one — root TODO item 19's research pass (gesetze-im-internet.de,
  // legislation.gov.uk) upgraded the GB VAT fact to "legal", the first shipped fact in this catalog
  // to clear that bar; see the DE/GB-specific describe block below for what exactly was and wasn't
  // settled. Every OTHER shipped fact is still honestly "unverified" (see each fact's own
  // resolutionNote for what was tried and why it fell short) — see this module's schema.ts header.
  // A future research pass that upgrades another fact to "legal" should EDIT this test, not be
  // blocked by it.
  it('every shipped fact carries a substantive, non-shared provenance — "legal" facts cite real source text, "unverified" ones say what would settle them', () => {
    const facts = ALL_COUNTRY_IDENTIFIER_FILES.flatMap((f) => f.schemes);
    expect(facts.length).toBeGreaterThan(0);
    const seenNotes = new Set<string>();
    for (const fact of facts) {
      expect(['legal', 'unverified']).toContain(fact.provenance.kind);
      if (fact.provenance.kind === 'unverified') {
        const note = fact.provenance.resolutionNote;
        expect(note.length).toBeGreaterThan(40);
        expect(seenNotes.has(note)).toBe(false); // no fact borrows another's note verbatim
        seenNotes.add(note);
      } else {
        expect(fact.provenance.sourceText.length).toBeGreaterThan(40);
        expect(fact.provenance.sourceCheckedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it('FR requires a LEGAL_ID for BOTH party types and also declares a VAT scheme — US does not', () => {
    const fr = fileFor('FR');
    const frLegalId = fr.schemes.find((s) => s.scheme === 'LEGAL_ID');
    expect(frLegalId?.appliesTo).toBe('BOTH');
    expect(frLegalId?.required).toBe(true);
    expect(fr.schemes.some((s) => s.scheme === 'VAT')).toBe(true);

    const us = fileFor('US');
    expect(us.schemes.some((s) => s.scheme === 'VAT')).toBe(false);
  });

  it('FR and US genuinely differ — not a copy of one another with only the label swapped', () => {
    const fr = fileFor('FR');
    const us = fileFor('US');
    const frLegalId = fr.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    const usLegalId = us.schemes.find((s) => s.scheme === 'LEGAL_ID')!;

    expect(frLegalId.label).not.toBe(usLegalId.label);
    expect(frLegalId.appliesTo).not.toBe(usLegalId.appliesTo);
    expect(frLegalId.required).not.toBe(usLegalId.required);
    expect(fr.schemes.length).not.toBe(us.schemes.length);
  });

  it('every `scheme` used by a shipped file is one of the two the frontend actually special-cases ("LEGAL_ID", "VAT") — a third scheme would silently render with no dedicated data-cy', () => {
    const knownSchemes = new Set(['LEGAL_ID', 'VAT']);
    for (const file of ALL_COUNTRY_IDENTIFIER_FILES) {
      for (const fact of file.schemes) {
        expect(knownSchemes.has(fact.scheme)).toBe(true);
      }
    }
  });
});

// Root TODO item 19 — DE and GB, added so a German or British CLIENT has a country-specific
// identifiers section on the client screen at all (05-clients.cy.ts's Germany/United Kingdom
// scenarios had no `client-identifier-LEGAL_ID` field to type into before this task: gb.json did
// not exist, and de.json had only a VAT scheme). Sourced this time at the primary text —
// gesetze-im-internet.de for Germany, legislation.gov.uk for the UK — see each fact's own
// provenance for exactly what was read and what it does and doesn't settle.
describe('country-identifiers/data — the shipped DE and GB files', () => {
  it('DE declares a VAT scheme applying to BOTH party types and a LEGAL_ID (Handelsregisternummer) scheme applying to COMPANY only', () => {
    const de = fileFor('DE');
    const vat = de.schemes.find((s) => s.scheme === 'VAT');
    expect(vat?.appliesTo).toBe('BOTH'); // § 14 Abs. 4 Nr. 2 UStG binds "der leistende Unternehmer",
    // not companies specifically — a German sole trader is bound exactly like a company.
    expect(vat?.required).toBe(false);

    const legalId = de.schemes.find((s) => s.scheme === 'LEGAL_ID');
    expect(legalId?.appliesTo).toBe('COMPANY');
    expect(legalId?.label).toBe('Handelsregisternummer');
    expect(legalId?.required).toBe(false);
    expect(legalId?.pattern).toBeUndefined(); // no fixed shape sourced — see resolutionNote
  });

  it('GB declares a VAT scheme applying to BOTH party types and a LEGAL_ID (Companies House number) scheme applying to COMPANY only', () => {
    const gb = fileFor('GB');
    const vat = gb.schemes.find((s) => s.scheme === 'VAT');
    expect(vat?.appliesTo).toBe('BOTH'); // reg. 14(1) VAT Regulations 1995 binds "a registered
    // person", not companies specifically — a VAT-registered sole trader is bound the same way.
    expect(vat?.required).toBe(false);

    const legalId = gb.schemes.find((s) => s.scheme === 'LEGAL_ID');
    expect(legalId?.appliesTo).toBe('COMPANY');
    expect(legalId?.label).toBe('Companies House registered number');
    expect(legalId?.required).toBe(false);
  });

  it("neither GB scheme declares a `pattern` — the read texts require the identifiers without ever specifying their shape, and no other primary/official text describing the shape was found (see each fact's resolutionNote for the URLs tried) — permissive, not invented", () => {
    const gb = fileFor('GB');
    for (const fact of gb.schemes) {
      expect(fact.pattern).toBeUndefined();
    }
  });

  it('GB VAT is the one shipped fact graded "legal" — reg. 14(1)(d) of the VAT Regulations 1995 was read directly and names the supplier\'s registration number as a mandatory VAT-invoice particular', () => {
    const gb = fileFor('GB');
    const vat = gb.schemes.find((s) => s.scheme === 'VAT')!;
    expect(vat.provenance.kind).toBe('legal');
    if (vat.provenance.kind === 'legal') {
      expect(vat.provenance.sourceText).toMatch(/registration number of the supplier/);
      expect(vat.provenance.sourceCheckedAt).toBe('2026-09-01');
    }
  });

  it('the DE VAT pattern accepts a well-formed USt-IdNr and rejects a malformed one, naming the expected format in helpText', () => {
    const de = fileFor('DE');
    const vat = de.schemes.find((s) => s.scheme === 'VAT')!;
    const regex = new RegExp(vat.pattern!);
    expect(regex.test('DE123456789')).toBe(true); // DE + 9 digits
    expect(regex.test('DE12345')).toBe(false); // too short
    expect(regex.test('FR123456789')).toBe(false); // wrong country prefix
    expect(vat.helpText).toMatch(/DE \+ 9 digits/);
  });

  it('the FR LEGAL_ID pattern is untouched by this task — still SIRET (14 digits), still required for BOTH party types', () => {
    const fr = fileFor('FR');
    const legalId = fr.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    const regex = new RegExp(legalId.pattern!);
    expect(regex.test('12345678901234')).toBe(true); // 14 digits
    expect(regex.test('12345')).toBe(false); // the exact value 05-clients.cy.ts's format-error test types
    expect(legalId.appliesTo).toBe('BOTH');
    expect(legalId.required).toBe(true);
  });

  it('DE and GB genuinely differ from each other — not one copied onto the other with only labels swapped', () => {
    const de = fileFor('DE');
    const gb = fileFor('GB');
    const deLegalId = de.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    const gbLegalId = gb.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    expect(deLegalId.label).not.toBe(gbLegalId.label);
    expect(de.schemes.find((s) => s.scheme === 'VAT')!.provenance.kind).not.toBe(
      gb.schemes.find((s) => s.scheme === 'VAT')!.provenance.kind,
    );
  });
});
