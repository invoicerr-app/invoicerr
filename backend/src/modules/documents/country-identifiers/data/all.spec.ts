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

describe('country-identifiers/data — the shipped FR, DE and PT files', () => {
  // Re-pinned by the 5-country prune (2026-09-10): this mechanism ships identifier requirements
  // for DE, FR and PT only — PL and IT never had a country-identifiers file. US, GB and BE (below)
  // were removed by the prune along with every other country outside FR/PL/IT/PT/DE.
  it('loads exactly the three countries this mechanism ships', () => {
    const codes = ALL_COUNTRY_IDENTIFIER_FILES.map((f) => f.countryCode).sort();
    expect(codes).toEqual(['DE', 'FR', 'PT']);
  });

  it('every fact in every shipped file carries a real provenance (already enforced at load time by data/all.ts — this just makes the property explicit here)', () => {
    for (const file of ALL_COUNTRY_IDENTIFIER_FILES) {
      for (const fact of file.schemes) {
        expect(['legal', 'unverified']).toContain(fact.provenance.kind);
      }
    }
  });

  // Honest state check, not an aspiration: this is a MIXED-grade check, not a blanket
  // "everything is unverified" one — a research pass (gesetze-im-internet.de,
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

  it("FR requires a LEGAL_ID for BOTH party types, required — DE's LEGAL_ID (Handelsregisternummer) applies to COMPANY only and is not required", () => {
    const fr = fileFor('FR');
    const frLegalId = fr.schemes.find((s) => s.scheme === 'LEGAL_ID');
    expect(frLegalId?.appliesTo).toBe('BOTH');
    expect(frLegalId?.required).toBe(true);
    expect(fr.schemes.some((s) => s.scheme === 'VAT')).toBe(true);

    const de = fileFor('DE');
    const deLegalId = de.schemes.find((s) => s.scheme === 'LEGAL_ID');
    expect(deLegalId?.appliesTo).toBe('COMPANY');
    expect(deLegalId?.required).toBe(false);
  });

  it('FR and DE genuinely differ — not a copy of one another with only the label swapped', () => {
    const fr = fileFor('FR');
    const de = fileFor('DE');
    const frLegalId = fr.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    const deLegalId = de.schemes.find((s) => s.scheme === 'LEGAL_ID')!;

    expect(frLegalId.label).not.toBe(deLegalId.label);
    expect(frLegalId.appliesTo).not.toBe(deLegalId.appliesTo);
    expect(frLegalId.required).not.toBe(deLegalId.required);
    // Both files ship the same two schemes (LEGAL_ID + VAT) today, so a length comparison would
    // prove nothing — assert the files aren't a literal copy of one another directly instead.
    expect(fr).not.toEqual(de);
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

// DE, added so a German CLIENT has a country-specific identifiers section on
// the client screen at all (de.json had only a VAT scheme before). Sourced at the primary text —
// gesetze-im-internet.de for Germany — see each fact's own provenance for exactly what was read
// and what it does and doesn't settle. GB was removed by the 5-country prune (2026-09-10) —
// re-anchored here on PT, which this mechanism keeps.
describe('country-identifiers/data — the shipped DE and PT files', () => {
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

  it('PT declares a VAT scheme applying to BOTH party types (not required, below the isenção threshold) and a LEGAL_ID (NIF/NIPC) scheme also applying to BOTH, required', () => {
    const pt = fileFor('PT');
    const vat = pt.schemes.find((s) => s.scheme === 'VAT');
    expect(vat?.appliesTo).toBe('BOTH');
    expect(vat?.required).toBe(false); // CIVA art. 53.º isenção below the 15 000 €/year threshold

    const legalId = pt.schemes.find((s) => s.scheme === 'LEGAL_ID');
    expect(legalId?.appliesTo).toBe('BOTH'); // the NIF/NIPC is a single, universal id for both
    // individuals and companies in Portugal — unlike DE's company-only Handelsregisternummer.
    expect(legalId?.label).toBe(
      'NIF / NIPC (Número de Identificação Fiscal / Número de Identificação de Pessoa Coletiva)',
    );
    expect(legalId?.required).toBe(true); // CIVA art. 36.º n.º 5 a) — a frontal, unconditional clause for the supplier
  });

  it("neither PT scheme declares a `pattern` — the read texts require the identifiers without ever settling their exact shape (see each fact's own notes for the primary texts that were and weren't reachable) — permissive, not invented", () => {
    const pt = fileFor('PT');
    for (const fact of pt.schemes) {
      expect(fact.pattern).toBeUndefined();
    }
  });

  it('PT\'s LEGAL_ID (NIF/NIPC) is graded "legal" — CIVA art. 36.º n.º 5 a) was read directly and names "os correspondentes números de identificação fiscal" as a mandatory invoice particular', () => {
    const pt = fileFor('PT');
    const legalId = pt.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    expect(legalId.provenance.kind).toBe('legal');
    if (legalId.provenance.kind === 'legal') {
      expect(legalId.provenance.sourceText).toMatch(/números de identificação fiscal/);
      expect(legalId.provenance.sourceCheckedAt).toBe('2026-09-04');
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

  it('the FR LEGAL_ID pattern accepts SIREN (9 digits) OR SIRET (14 digits) — user decision, 2026-09-01 — still required for BOTH party types', () => {
    const fr = fileFor('FR');
    const legalId = fr.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    const regex = new RegExp(legalId.pattern!);
    expect(regex.test('123456789')).toBe(true); // 9 digits — SIREN
    expect(regex.test('12345678901234')).toBe(true); // 14 digits — SIRET
    expect(regex.test('12345')).toBe(false); // the exact value 05-clients.cy.ts's format-error test types
    expect(legalId.appliesTo).toBe('BOTH');
    expect(legalId.required).toBe(true);
  });

  it('DE and PT genuinely differ from each other — not one copied onto the other with only labels swapped', () => {
    const de = fileFor('DE');
    const pt = fileFor('PT');
    const deLegalId = de.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    const ptLegalId = pt.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    expect(deLegalId.label).not.toBe(ptLegalId.label);
    expect(deLegalId.appliesTo).not.toBe(ptLegalId.appliesTo); // DE: COMPANY, PT: BOTH
    expect(de.schemes.find((s) => s.scheme === 'VAT')!.provenance.kind).not.toBe(
      pt.schemes.find((s) => s.scheme === 'VAT')!.provenance.kind,
    ); // DE VAT is "unverified", PT VAT is "legal"
  });
});

// FR's VAT scheme was read at its own text (CGI
// ann. II art. 242 nonies A, on codes.droit.org, a Légifrance mirror — Légifrance itself still
// refused every automated request) and promoted to "legal", the same way the GB VAT fact was
// promoted above. FR's LEGAL_ID stayed "unverified" at first: both candidate
// texts named in its old resolutionNote were read too, and they settled the underlying legal question
// (a French invoice must carry the SIREN, not necessarily the SIRET) while that answer diverged from
// what the scheme encoded — that pass's scope was provenance, not behavior, so nothing changed yet.
//
// USER DECISION (2026-09-01, "SIRET vs SIREN sur la facture" — now RÉSOLU): the field
// accepts EITHER length. Label "SIREN / SIRET", pattern `^\d{9}(\d{5})?$`, provenance promoted to
// "legal" (the citations settle the question; accepting the longer SIRET on top is a documented
// product choice, not an unsourced claim — see the fact's own `notes`), `required` unchanged (true).
describe('country-identifiers/data — FR VAT promoted to "legal" (2026-09-01)', () => {
  it('FR VAT cites CGI ann. II art. 242 nonies A (the VAT number is a mandatory mention, except under franchise-en-base)', () => {
    const fr = fileFor('FR');
    const vat = fr.schemes.find((s) => s.scheme === 'VAT')!;
    expect(vat.provenance.kind).toBe('legal');
    if (vat.provenance.kind === 'legal') {
      expect(vat.provenance.sourceText).toMatch(/franchise en base/);
      expect(vat.provenance.sourceCheckedAt).toBe('2026-09-01');
    }
    expect(vat.required).toBe(false); // unchanged: the exemption is why this stays optional at country level
  });
});

// USER DECISION (2026-09-01) — FR's LEGAL_ID accepts SIREN (9 digits) OR SIRET (14 digits). See
// fr.json's own `notes` for the full reasoning: a valid
// SIRET always CONTAINS the required SIREN as its own first 9 digits (R.123-221's second alinéa), so
// accepting the longer value is not a departure from the text, only a tolerance for a more precise
// input the codebase already knows how to reduce (`build-semantic-invoice.ts#toSiren`).
describe('country-identifiers/data — FR LEGAL_ID resolved to accept SIREN or SIRET (2026-09-01)', () => {
  it('is now "legal" provenance, citing R.123-237/D.123-235/R.123-221 and CGI ann. II art. 242 nonies A, I, 1°', () => {
    const fr = fileFor('FR');
    const legalId = fr.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    expect(legalId.provenance.kind).toBe('legal');
    if (legalId.provenance.kind === 'legal') {
      expect(legalId.provenance.sourceText).toMatch(/R\.123-237/);
      expect(legalId.provenance.sourceText).toMatch(/242 nonies A/);
      expect(legalId.provenance.sourceText).toMatch(/SIREN/);
      expect(legalId.provenance.sourceCheckedAt).toBe('2026-09-01');
    }
    expect(legalId.notes).toMatch(/TODO_ISSUES\.md/);
    expect(legalId.notes).toMatch(/RÉSOLUE/);
  });

  it('label is "SIREN / SIRET", pattern accepts 9 OR 14 digits, still required for BOTH party types', () => {
    const fr = fileFor('FR');
    const legalId = fr.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    expect(legalId.label).toBe('SIREN / SIRET');
    expect(legalId.pattern).toBe('^\\d{9}(\\d{5})?$');
    const regex = new RegExp(legalId.pattern!);
    expect(regex.test('123456789')).toBe(true); // 9 digits
    expect(regex.test('12345678901234')).toBe(true); // 14 digits
    expect(regex.test('1234567890')).toBe(false); // 10 — neither length
    expect(regex.test('12345')).toBe(false);
    expect(legalId.appliesTo).toBe('BOTH');
    expect(legalId.required).toBe(true);
  });
});

// BE's country-identifiers/data/be.json was removed by the 5-country prune (2026-09-10) along with
// every other country outside FR/PL/IT/PT/DE — it was never registered in data/all.ts to begin with,
// so nothing here re-anchors it.

// Drop-in invariant (readdir-discovery conversion) — proves all.ts's own `discoverCountryCodes()`
// really does pick up every `<cc>.json` sitting in this directory: this test re-reads the directory
// with the IDENTICAL pattern, independently of all.ts's own implementation, so a regression that
// silently drops a file from discovery (a typo'd pattern, a change that stops sorting, anything) goes
// red here — the whole point of "adding a country = dropping a file" is only true if this holds.
describe('country-identifiers/data — every *.json on disk is actually loaded (drop-in invariant)', () => {
  it('ALL_COUNTRY_IDENTIFIER_FILES covers exactly the country files present in this directory, no more, no fewer', () => {
    const { readdirSync } = require('node:fs');
    const onDisk = readdirSync(__dirname)
      .filter((name: string) => /^[a-z]{2}\.json$/.test(name))
      .map((name: string) => name.replace(/\.json$/, '').toUpperCase())
      .sort();
    const loaded = ALL_COUNTRY_IDENTIFIER_FILES.map((f) => f.countryCode).sort();
    expect(loaded).toEqual(onDisk);
  });
});
