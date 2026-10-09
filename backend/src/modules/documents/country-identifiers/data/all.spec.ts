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

describe('country-identifiers/data — the shipped FR, DE, PT, IT and PL files', () => {
  // Re-pinned by the 5-country prune (2026-09-10): this mechanism shipped identifier requirements
  // for DE, FR and PT only at first — PL and IT had no country-identifiers file yet. IT and PL were
  // added afterwards (see it.json/pl.json's own file-level `notes` for the research and the
  // deliberate `required: false` grading on every fact — this catalog has no seller/buyer axis, see
  // those notes for why an unconditional seller-side rule still can't be encoded as `required: true`
  // without also wrongly gating a buyer-side client record). US, GB and BE (below) were removed by
  // the prune along with every other country outside FR/PL/IT/PT/DE.
  it('loads exactly the six countries this mechanism ships', () => {
    const codes = ALL_COUNTRY_IDENTIFIER_FILES.map((f) => f.countryCode).sort();
    expect(codes).toEqual(['DE', 'DZ', 'FR', 'IT', 'PL', 'PT']);
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

  // Widened 2026-09-13 (IT_PA_CODE/IT_SDI/PEC, see it.json's own file-level `notes` for the full
  // reversal): this guard used to allow ONLY "LEGAL_ID"/"VAT", on the theory that a third scheme name
  // "would silently render with no dedicated data-cy". Re-reading `client-upsert.tsx` and
  // `company.settings.tsx` before widening this set showed that theory was wrong for the form this
  // catalog actually exists to feed — `client-upsert.tsx` renders `data-cy={`client-identifier-${req.scheme}`}`
  // generically off WHATEVER scheme this catalog declares, no allowlist at all, so a new scheme gets a
  // working, targetable field for free. `company.settings.tsx` (seller's own identifiers) also renders
  // every scheme generically; only its OWN convenience data-cy naming special-cases LEGAL_ID/VAT — a
  // third scheme still renders there, just without that one dedicated e2e hook, which is a testability
  // nicety, not a functional gap. This guard now exists to keep a scheme name from being introduced
  // ACCIDENTALLY (a typo, a copy-paste of another country's scheme under a new name) — every legitimate
  // scheme must be added here explicitly, with the fact that names it.
  it("every `scheme` used by a shipped file is one this test explicitly names as legitimate — a typo'd or accidental new scheme name goes red here, not silently", () => {
    const knownSchemes = new Set([
      'LEGAL_ID',
      'VAT',
      'IT_PA_CODE',
      'IT_SDI',
      'PEC',
      'RC',
      'NIS',
      'NIF',
      'AI',
    ]);
    for (const file of ALL_COUNTRY_IDENTIFIER_FILES) {
      for (const fact of file.schemes) {
        expect(knownSchemes.has(fact.scheme)).toBe(true);
      }
    }
  });

  it('IT declares three additional identifiers — IT_PA_CODE (Codice Univoco Ufficio, PA-only, 6 chars), IT_SDI (Codice Destinatario, 7 chars) and PEC — none required, all sourced to the FatturaPA Specifiche tecniche v1.3.2 par. 1.1', () => {
    const it = fileFor('IT');

    const paCode = it.schemes.find((s) => s.scheme === 'IT_PA_CODE')!;
    expect(paCode.appliesTo).toBe('COMPANY');
    expect(paCode.required).toBe(false);
    expect(paCode.pattern).toBe('^[A-Za-z0-9]{6}$');
    expect(paCode.provenance.kind).toBe('legal');
    if (paCode.provenance.kind === 'legal') {
      expect(paCode.provenance.sourceText).toMatch(/Codice Ufficio/);
      expect(paCode.provenance.sourceCheckedAt).toBe('2026-09-13');
    }

    const sdi = it.schemes.find((s) => s.scheme === 'IT_SDI')!;
    expect(sdi.appliesTo).toBe('BOTH');
    expect(sdi.required).toBe(false);
    expect(sdi.pattern).toBe('^[A-Za-z0-9]{7}$');
    expect(sdi.provenance.kind).toBe('legal');
    if (sdi.provenance.kind === 'legal') {
      expect(sdi.provenance.sourceText).toMatch(/Richiesta codici destinatario B2B/);
      expect(sdi.provenance.sourceCheckedAt).toBe('2026-09-13');
    }

    const pec = it.schemes.find((s) => s.scheme === 'PEC')!;
    expect(pec.appliesTo).toBe('BOTH');
    expect(pec.required).toBe(false);
    expect(pec.pattern).toBeUndefined(); // length-only in the source text, no character-class claim
    expect(pec.provenance.kind).toBe('legal');
    if (pec.provenance.kind === 'legal') {
      expect(pec.provenance.sourceText).toMatch(/Posta Elettronica Certificata/);
      expect(pec.provenance.sourceCheckedAt).toBe('2026-09-13');
    }

    expect(it.schemes.map((s) => s.scheme).sort()).toEqual([
      'IT_PA_CODE',
      'IT_SDI',
      'LEGAL_ID',
      'PEC',
      'VAT',
    ]);
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
    expect(vat.helpText).toMatch(/DE followed by 9 digits/);
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

// IT and PL, added by researching primary law (DPR 633/1972 arts. 21/21-bis via normattiva.it, the
// FatturaPA technical specification, ustawa o VAT art. 106e via dziennikustaw.gov.pl) — see
// it.json/pl.json's own file-level `notes` for the full research and, critically, for WHY every
// fact in both files stays `required: false` despite each country's SELLER-side rule (Partita IVA /
// NIP) being established as unconditional: this catalog's `appliesTo` axis (COMPANY/INDIVIDUAL/BOTH)
// has no notion of transactional role, and the exact same per-country array is read by the SELLER
// call-sites (onboarding.tsx/company.settings.tsx, always partyType "COMPANY") and the BUYER
// call-site (client-upsert.tsx, partyType from the client's own record type) — with `required: true`
// enforced as a real, hard save-block in all three (confirmed by reading each screen's own
// onSubmit). Setting `required: true` would therefore ALSO hard-block a lawful Italian/Polish
// buyer/client record that this research does NOT establish as needing that identifier (the buyer's
// correct identifier depends on taxable-person status, an axis this catalog does not track) — so
// `required: false` here is a deliberate, documented choice, not an oversight.
describe('country-identifiers/data — the shipped IT and PL files', () => {
  it('IT declares a VAT scheme (Partita IVA) and a LEGAL_ID scheme (Codice Fiscale), both COMPANY/BOTH and NOT required', () => {
    const it = fileFor('IT');
    const vat = it.schemes.find((s) => s.scheme === 'VAT')!;
    expect(vat.appliesTo).toBe('COMPANY');
    expect(vat.required).toBe(false); // seller-side is unconditional (DPR 633/1972 art. 21 co. 2
    // lett. d) — see this fact's own `notes` for why `required` still stays false at country level.
    expect(vat.provenance.kind).toBe('legal');
    if (vat.provenance.kind === 'legal') {
      expect(vat.provenance.sourceText).toMatch(/partita IVA del soggetto cedente o prestatore/);
      expect(vat.provenance.sourceCheckedAt).toBe('2026-09-13');
    }
    expect(vat.pattern).toBeUndefined(); // 11-digit format not found in either primary source read

    const legalId = it.schemes.find((s) => s.scheme === 'LEGAL_ID')!;
    expect(legalId.label).toBe('Codice Fiscale');
    expect(legalId.appliesTo).toBe('BOTH');
    expect(legalId.required).toBe(false);
    expect(legalId.provenance.kind).toBe('unverified'); // known law, not yet safely enforceable —
    // see this fact's own resolutionNote and its own `notes` (which embeds the actual DPR 633/1972
    // art. 21 co. 2 lett. f) quote verbatim, not merely a paraphrase).
    if (legalId.provenance.kind === 'unverified') {
      expect(legalId.provenance.resolutionNote.length).toBeGreaterThan(40);
    }
    expect(legalId.notes).toMatch(/numero di partita IVA del soggetto cessionario o committente/);
  });

  it('PL declares a single LEGAL_ID scheme (NIP), COMPANY-only (not BOTH — PESEL is a distinct, unmodeled case for individual sellers), NOT required', () => {
    const pl = fileFor('PL');
    expect(pl.schemes).toHaveLength(1);
    const legalId = pl.schemes[0];
    expect(legalId.scheme).toBe('LEGAL_ID');
    expect(legalId.label).toBe('NIP');
    expect(legalId.appliesTo).toBe('COMPANY');
    expect(legalId.required).toBe(false);
    expect(legalId.provenance.kind).toBe('legal');
    if (legalId.provenance.kind === 'legal') {
      expect(legalId.provenance.sourceText).toMatch(/zidentyfikowany na potrzeby podatku/);
      expect(legalId.provenance.sourceCheckedAt).toBe('2026-09-13');
    }
    expect(legalId.pattern).toBeUndefined(); // NIP digit count not chased to a primary-text statement
    expect(legalId.notes).toMatch(/pomocą którego nabywca towarów lub usług/); // the buyer-side
    // conditional half (art. 106e ust. 1 pkt 5) is documented in this fact's own `notes`, not encoded
  });

  it('IT and PL genuinely differ from each other and from DE/FR/PT — not a copy with labels swapped', () => {
    const it = fileFor('IT');
    const pl = fileFor('PL');
    const itVat = it.schemes.find((s) => s.scheme === 'VAT')!;
    const plLegalId = pl.schemes[0];
    expect(itVat.label).not.toBe(plLegalId.label);
    expect(it).not.toEqual(pl);
    // IT's full scheme list (VAT/LEGAL_ID plus IT_PA_CODE/IT_SDI/PEC) is pinned by its own dedicated
    // describe block above ("IT declares three additional identifiers…") — not repeated here.
    expect(pl.schemes.map((s) => s.scheme).sort()).toEqual(['LEGAL_ID']);
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
// USER DECISION (2026-09-01, "SIRET vs SIREN on the invoice" — now RESOLVED): the field
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

// FR's LEGAL_ID accepts SIREN (9 digits) or SIRET (14 digits), reduced by its own `einvoiceReduction`.
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
    expect(legalId.notes).toMatch(/SIRET vs SIREN/);
    expect(legalId.einvoiceReduction).toEqual({ whenDigits: 14, keepDigits: 9 });
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

// DZ, issue #567: NIF and NIS each gained a `pattern`, sourced to PR #566's review (native
// contributor, 2026-09-30) rather than to decree 05-468 itself, which states no format for either
// scheme. RC and AI stay free text, per the same review, so neither declares a `pattern`. Adding
// `pattern` does not change either scheme's own `provenance.kind` (NIS stays "legal", NIF stays
// "unverified"): the requirement and its format are two separate claims, sourced separately.
describe('country-identifiers/data: the shipped DZ file (issue #567: NIF/NIS formats)', () => {
  it('NIF accepts a 15-digit value or a 20-digit one (a secondary establishment), and nothing else', () => {
    const dz = fileFor('DZ');
    const nif = dz.schemes.find((s) => s.scheme === 'NIF')!;
    expect(nif.pattern).toBe('^\\d{15}(\\d{5})?$');
    const regex = new RegExp(nif.pattern!);
    expect(regex.test('000116000123456')).toBe(true); // 15 digits
    expect(regex.test('00011600012345600001')).toBe(true); // 20 digits
    expect(regex.test('00011600012345')).toBe(false); // 14 digits, one short
    expect(regex.test('00011600012345A')).toBe(false); // right length, a letter
    // A pattern is a legal claim, so `notes` must say where the FORMAT specifically comes from:
    // decree 05-468 never states one. That does not disturb the scheme's own "unverified" grading.
    expect(nif.notes).toMatch(/15 digits, or 20 for a secondary establishment, from the same contributor/);
    expect(nif.provenance.kind).toBe('unverified'); // unchanged by adding `pattern`
  });

  it('NIS accepts a 15-digit value or an 18-digit one (a secondary establishment), and nothing else', () => {
    const dz = fileFor('DZ');
    const nis = dz.schemes.find((s) => s.scheme === 'NIS')!;
    expect(nis.pattern).toBe('^\\d{15}(\\d{3})?$');
    const regex = new RegExp(nis.pattern!);
    expect(regex.test('160001234567890')).toBe(true); // 15 digits
    expect(regex.test('160001234567890123')).toBe(true); // 18 digits
    expect(regex.test('16000123456789')).toBe(false); // 14 digits, one short, the demo generator's old length
    expect(regex.test('16000123456789A')).toBe(false); // right length, a letter
    expect(nis.notes).toMatch(/18 for a secondary establishment, as described by the native contributor/);
    expect(nis.provenance.kind).toBe('legal'); // unchanged by adding `pattern`
  });

  it('RC and AI stay free text: the review kept both without a strict format', () => {
    const dz = fileFor('DZ');
    const rc = dz.schemes.find((s) => s.scheme === 'RC')!;
    const ai = dz.schemes.find((s) => s.scheme === 'AI')!;
    expect(rc.pattern).toBeUndefined();
    expect(ai.pattern).toBeUndefined();
  });
});

// BE's own country-identifiers data file was removed by the 5-country prune (2026-09-10) along with
// every other country outside FR/PL/IT/PT/DE — it was never registered in data/all.ts to begin with,
// so nothing here re-anchors it.

// The "drop-in invariant" that used to live here (re-reading this directory's own `*.json` listing
// against `ALL_COUNTRY_IDENTIFIER_FILES`) tested a mechanism that moved: `data/all.ts` no longer
// reads this directory at all (issue #603 step 6) - it derives from `defaultComposedCountryCatalog`,
// which itself is discovered from `countries/data/*.json`. The equivalent proof now lives in
// `countries/data/all.spec.ts`.
