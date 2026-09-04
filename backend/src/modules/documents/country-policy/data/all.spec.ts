/**
 * Coverage guard for the SHIPPED policy files — the same role coverage.spec.ts played for the
 * removed compliance engine's country profiles, scaled to this concern: FR is this module's
 * reference jurisdiction (every e2e/jest fixture company is French — see
 * e2e/cypress/support/commands.ts's `resetAndSeed`), so a native action the core declares but FR's
 * file doesn't cover would silently 403 every existing test and, worse, every real French company.
 * This test makes that a loud, named failure at the file level instead.
 */
import { buildQuoteDescriptor } from '../../descriptors/quote.descriptor';
import { buildInvoiceDescriptor } from '../../descriptors/invoice.descriptor';
import { buildCreditNoteDescriptor } from '../../descriptors/credit-note.descriptor';
import { buildExpenseDescriptor } from '../../descriptors/expense.descriptor';
import { buildReceivedInvoiceDescriptor } from '../../descriptors/received-invoice.descriptor';
import { ALL_COUNTRY_POLICY_FILES } from './all';

// The THIRD-PARTY "duplicate" extension (actions/duplicate-extension.ts) is attached to BOTH
// "quote" and "invoice" (documents-core.module.ts, root TODO item 5 — the invoice case needed it
// for the recurring-documents mechanism), outside either type's own descriptor — listed here by
// hand since this test deliberately stays independent of Nest wiring, the same way
// documents.service.spec.ts's own `buildService()` re-lists it rather than booting the whole module.
// TODO_CORRECTION.md C3 — `invoice.cancel` is the ONE native action deliberately EXCLUDED from this
// coverage list, not an oversight this guard should catch: `documents.service.ts#resolveActionPolicy`
// special-cases it to read `correction-routes/cancel-policy.ts` instead of this module's own DB table
// (see that method's own header for the full reasoning — routing "cancel" through the ordinary FR/US/
// HU-only country-policy/ would wrongly 403 Germany/Italy, both genuinely founded). Its own coverage
// guard lives there instead: `correction-routes/cancel-policy.spec.ts` pins the per-country map,
// `documents.service.cancel.spec.ts` proves DocumentsService actually reads it.
const NATIVE_TYPE_ACTIONS: { typeId: string; actionId: string }[] = [
  ...buildQuoteDescriptor().actions.map((a) => ({ typeId: 'quote', actionId: a.id })),
  { typeId: 'quote', actionId: 'duplicate' },
  ...buildInvoiceDescriptor()
    .actions.filter((a) => a.id !== 'cancel')
    .map((a) => ({ typeId: 'invoice', actionId: a.id })),
  { typeId: 'invoice', actionId: 'duplicate' },
  ...buildCreditNoteDescriptor().actions.map((a) => ({ typeId: 'credit-note', actionId: a.id })),
  ...buildExpenseDescriptor().actions.map((a) => ({ typeId: 'expense', actionId: a.id })),
  ...buildReceivedInvoiceDescriptor().actions.map((a) => ({ typeId: 'received-invoice', actionId: a.id })),
];

const ALL_DOCUMENT_TYPE_IDS = ['quote', 'invoice', 'credit-note', 'expense', 'received-invoice'];

function fileFor(countryCode: string) {
  const file = ALL_COUNTRY_POLICY_FILES.find((f) => f.countryCode === countryCode);
  if (!file) throw new Error(`No policy file loaded for "${countryCode}"`);
  return file;
}

describe('country-policy/data — the shipped FR and US files', () => {
  it('loads exactly the two countries this task asked for, at minimum', () => {
    const codes = ALL_COUNTRY_POLICY_FILES.map((f) => f.countryCode).sort();
    expect(codes).toEqual(expect.arrayContaining(['FR', 'US']));
  });

  it('FR — the reference jurisdiction every test fixture company uses — declares a rule for EVERY native action the core exposes today', () => {
    const fr = fileFor('FR');
    const declared = new Set(fr.rules.map((r) => `${r.typeId}::${r.actionId}`));

    const missing = NATIVE_TYPE_ACTIONS.map(({ typeId, actionId }) => `${typeId}::${actionId}`).filter(
      (key) => !declared.has(key),
    );
    expect(missing).toEqual([]);
  });

  it('FR allows every native action — the reference jurisdiction never itself needs an unblock', () => {
    const fr = fileFor('FR');
    const forbidden = fr.rules.filter((r) => !r.allowed);
    expect(forbidden).toEqual([]);
  });

  it('US deliberately does NOT cover quote.duplicate — a real, documented gap, not an oversight', () => {
    const us = fileFor('US');
    const declared = new Set(us.rules.map((r) => `${r.typeId}::${r.actionId}`));
    expect(declared).not.toContain('quote::duplicate');
    expect(us.notes).toMatch(/duplicate/);
  });

  it('every rule in every shipped file carries a real provenance (already enforced at load time by data/all.ts — this just makes the property explicit here)', () => {
    for (const file of ALL_COUNTRY_POLICY_FILES) {
      for (const rule of file.rules) {
        expect(['legal', 'unverified']).toContain(rule.provenance.kind);
      }
    }
  });

  it('at least one shipped rule is "legal" and at least one is "unverified" — the format is actually exercised both ways, not just declared', () => {
    const allRules = ALL_COUNTRY_POLICY_FILES.flatMap((f) => f.rules);
    expect(allRules.some((r) => r.provenance.kind === 'legal')).toBe(true);
    expect(allRules.some((r) => r.provenance.kind === 'unverified')).toBe(true);
  });

  // The NEW "which types this country has" layer (schema.ts's `documentTypes`) — a separate
  // declaration from `rules` above, so it needs its own coverage guard the same way `rules` already
  // has one just above.
  it('FR and US both declare every document type the core registers today', () => {
    for (const code of ['FR', 'US']) {
      const file = fileFor(code);
      expect((file.documentTypes ?? []).slice().sort()).toEqual(ALL_DOCUMENT_TYPE_IDS.slice().sort());
    }
  });

  // The per-status narrowing (schema.ts's `DocumentActionRuleFact.statuses`) — TWO real, shipped
  // examples: invoice.save-draft (the original example — "an issued invoice is no longer editable"),
  // and received-invoice.receive in every shipped file (root TODO item 18 — "a reviewed
  // [approved/rejected] received invoice's fields are no longer editable", the same shape of fact
  // applied to a different type's own lifecycle). Root TODO item 21 (2026-09-01) promoted FR's
  // invoice.save-draft to `legal` (CGI art. 289 I.5, read directly — see its own `notes`); root TODO
  // P1 (2026-09-03) did the SAME for DE/IT/PL/ES/MX, each on its own national text (see each file's
  // own `notes` on invoice.save-draft). US is the one shipped file that declares NO narrowing here at
  // all (see us.json's own resolutionNote: no US statutory prohibition on re-editing an issued
  // invoice was found, but that absence was never positively confirmed either, so US's own
  // invoice.save-draft stays `unverified` AND unrestricted — it is simply not one of the two examples
  // this test pins). received-invoice.receive stays `unverified` in every file (no rule's own
  // resolutionNote named a checkable text for the STATUS narrowing itself, as opposed to the
  // separate, already-sourced reception-channel mandate FR's own rule documents).
  it('invoice.save-draft (FR+DE+IT+PL+ES+MX) and received-invoice.receive (every shipped file) restrict to their own "still editable" status', () => {
    for (const code of ['FR', 'DE', 'IT', 'PL', 'ES', 'MX']) {
      expect(
        fileFor(code).rules.find((r) => r.typeId === 'invoice' && r.actionId === 'save-draft')?.statuses,
      ).toEqual(['draft']);
    }
    for (const file of ALL_COUNTRY_POLICY_FILES) {
      // HU is the one shipped file that doesn't declare 'received-invoice' at all (hu.json's own
      // notes: deliberately partial, only invoice.save-draft/send are declared) — skip it here
      // rather than assert on a rule that was never meant to exist.
      const rule = file.rules.find((r) => r.typeId === 'received-invoice' && r.actionId === 'receive');
      if (!rule) {
        expect(file.countryCode).toBe('HU');
        continue;
      }
      expect(rule.statuses).toEqual(['received']);
    }
  });

  it('no OTHER shipped rule declares a per-status narrowing — these two stay the only deliberate examples', () => {
    // BE (AR n°1 art. 12 §1), NL (art. 35a lid 1.b composition — the file says so itself) and AT
    // (UStG §16 Abs. 1) joined with lot 1 (TODO_DOCUMENTS vague B) — each narrowing SOURCED in its file.
    const COUNTRIES_WITH_SOURCED_SAVE_DRAFT_NARROWING = ['FR', 'DE', 'IT', 'PL', 'ES', 'MX', 'BE', 'NL', 'AT', 'EE', 'GR', 'CY', 'LT', 'LV', 'LU', 'MT', 'SE'];
    const isKnownNarrowing = (countryCode: string, typeId: string, actionId: string) =>
      (typeId === 'invoice' &&
        actionId === 'save-draft' &&
        COUNTRIES_WITH_SOURCED_SAVE_DRAFT_NARROWING.includes(countryCode)) ||
      (typeId === 'received-invoice' && actionId === 'receive');

    for (const file of ALL_COUNTRY_POLICY_FILES) {
      for (const rule of file.rules) {
        if (isKnownNarrowing(file.countryCode, rule.typeId, rule.actionId)) continue;
        expect(rule.statuses ?? []).toEqual([]);
      }
    }
  });

  it('every `documentTypes` entry in every shipped file names a type the core actually registers — no stale or misspelled id', () => {
    for (const file of ALL_COUNTRY_POLICY_FILES) {
      const unknown = (file.documentTypes ?? []).filter((typeId) => !ALL_DOCUMENT_TYPE_IDS.includes(typeId));
      expect(unknown).toEqual([]);
    }
  });
});

// Root TODO item 21 — "Sourcer FR et US": the primary texts were read this time (codes.droit.org, a
// Légifrance mirror, for the CGI/code civil articles; govinfo.gov, the official US Government
// Publishing Office, for the US Code) — three FR rules promoted to "legal", pinned here by their
// exact reference the same way country-identifiers/data/all.spec.ts pins GB's own promoted VAT fact.
describe('country-policy/data — FR rules promoted to "legal" by root TODO item 21 (2026-09-01)', () => {
  it('FR quote.send cites code civil art. 1366 (the electronic writing has the same probative force as paper)', () => {
    const fr = fileFor('FR');
    const rule = fr.rules.find((r) => r.typeId === 'quote' && r.actionId === 'send')!;
    expect(rule.provenance.kind).toBe('legal');
    if (rule.provenance.kind === 'legal') {
      expect(rule.provenance.sourceText).toMatch(/même force probante/);
      expect(rule.provenance.sourceCheckedAt).toBe('2026-09-01');
    }
    expect(rule.notes).toMatch(/art\. 1366/);
  });

  it('FR invoice.send cites CGI art. 289 VI (electronic invoices are emitted and received in electronic form)', () => {
    const fr = fileFor('FR');
    const rule = fr.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'send')!;
    expect(rule.provenance.kind).toBe('legal');
    if (rule.provenance.kind === 'legal') {
      expect(rule.provenance.sourceText).toMatch(/factures électroniques sont émises et reçues/);
      expect(rule.provenance.sourceCheckedAt).toBe('2026-09-01');
    }
    expect(rule.notes).toMatch(/289, VI/);
  });

  it('FR invoice.save-draft cites CGI art. 289 I.5 (a correction is a new, referencing document — never a silent rewrite of the original)', () => {
    const fr = fileFor('FR');
    const rule = fr.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'save-draft')!;
    expect(rule.provenance.kind).toBe('legal');
    if (rule.provenance.kind === 'legal') {
      expect(rule.provenance.sourceText).toMatch(/modifie la facture initiale/);
      expect(rule.provenance.sourceCheckedAt).toBe('2026-09-01');
    }
    expect(rule.statuses).toEqual(['draft']); // the underlying restriction this citation now grounds
  });

  it("US quote.send/invoice.send E-SIGN citation was re-verified 2026-09-01 against the official govinfo.gov text, not just Cornell's mirror", () => {
    const us = fileFor('US');
    for (const actionId of ['send'] as const) {
      const quoteRule = us.rules.find((r) => r.typeId === 'quote' && r.actionId === actionId)!;
      const invoiceRule = us.rules.find((r) => r.typeId === 'invoice' && r.actionId === actionId)!;
      for (const rule of [quoteRule, invoiceRule]) {
        expect(rule.provenance.kind).toBe('legal');
        if (rule.provenance.kind === 'legal') expect(rule.provenance.sourceCheckedAt).toBe('2026-09-01');
        expect(rule.notes).toMatch(/govinfo\.gov/);
      }
    }
  });
});

// Root TODO P1 (2026-09-03) — "les 5 fichiers country-policy sourcés (DE, IT, PL, ES, MX)". Before
// this, only FR/US/HU had a policy file at all — every OTHER country, Poland and Italy (this
// product's own primary markets) included, had EVERY document action blocked by DECISION 1
// (country-policy.ts's own header) for want of a file, whatever the actual local law said. This pins
// the content the way the FR describe block above already pins root TODO item 21's own promotions:
// the two immutability citations this task called out BY NAME (PL/IT), the five `send` unblocks, and
// one honest `unverified` per country, so a future edit that quietly waters one of these down goes
// red here first.
describe('country-policy/data — DE/IT/PL/ES/MX added by root TODO P1 (2026-09-03)', () => {
  it('the catalog now covers exactly 19 countries: the 17 of lot 3 plus MT, SE (lot 4 — HU was already here, its OTHER mechanisms joined this lot)', () => {
    const codes = ALL_COUNTRY_POLICY_FILES.map((f) => f.countryCode).sort();
    expect(codes).toEqual(['AT', 'BE', 'CY', 'DE', 'EE', 'ES', 'FR', 'GR', 'HU', 'IT', 'LT', 'LU', 'LV', 'MT', 'MX', 'NL', 'PL', 'SE', 'US']);
  });

  it('PL invoice.save-draft cites the Podręcznik KSeF verbatim: a file sent to KSeF cannot be edited, only corrected by a new faktura korygująca', () => {
    const pl = fileFor('PL');
    const rule = pl.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'save-draft')!;
    expect(rule.provenance.kind).toBe('legal');
    if (rule.provenance.kind === 'legal') {
      expect(rule.provenance.sourceText).toMatch(/nie jest możliwe jej edytowanie/);
      expect(rule.provenance.sourceCheckedAt).toBe('2026-08-29'); // reused, not re-checked by P1
    }
    expect(rule.notes).toMatch(/correction-routes\/data\/pl\.json/);
    expect(rule.statuses).toEqual(['draft']);
  });

  it('IT invoice.save-draft cites Provv. 89757/2018: no amendment-by-reference instrument exists — only a nota di credito/debito', () => {
    const it = fileFor('IT');
    const rule = it.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'save-draft')!;
    expect(rule.provenance.kind).toBe('legal');
    if (rule.provenance.kind === 'legal') {
      expect(rule.provenance.sourceText).toMatch(/Inexistant/);
      expect(rule.provenance.sourceCheckedAt).toBe('2026-08-29'); // reused, not re-checked by P1
    }
    expect(rule.notes).toMatch(/correction-routes\/data\/it\.json/);
    expect(rule.statuses).toEqual(['draft']);
  });

  it('DE and ES invoice.save-draft are ALSO sourced "legal" with the same draft-only restriction (the immutability fact generalizes, not just PL/IT)', () => {
    for (const code of ['DE', 'ES']) {
      const rule = fileFor(code).rules.find((r) => r.typeId === 'invoice' && r.actionId === 'save-draft')!;
      expect(rule.provenance.kind).toBe('legal');
      expect(rule.statuses).toEqual(['draft']);
    }
  });

  it('MX invoice.save-draft cites CFF art. 29-A: a stamped CFDI is immutable, with no amendment-by-reference route', () => {
    const mx = fileFor('MX');
    const rule = mx.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'save-draft')!;
    expect(rule.provenance.kind).toBe('legal');
    if (rule.provenance.kind === 'legal') expect(rule.provenance.sourceText).toMatch(/immuable/);
    expect(rule.statuses).toEqual(['draft']);
  });

  it('invoice.send is allowed for all five new countries — the actual unblock this task exists for', () => {
    for (const code of ['DE', 'IT', 'PL', 'ES', 'MX']) {
      const rule = fileFor(code).rules.find((r) => r.typeId === 'invoice' && r.actionId === 'send')!;
      expect(rule.allowed).toBe(true);
    }
  });

  it('invoice.send is grounded "legal" for DE/IT/PL/ES (a national electronic-invoicing text read live on 2026-09-03) — MX stays honestly unverified', () => {
    for (const code of ['DE', 'IT', 'PL', 'ES']) {
      const rule = fileFor(code).rules.find((r) => r.typeId === 'invoice' && r.actionId === 'send')!;
      expect(rule.provenance.kind).toBe('legal');
      if (rule.provenance.kind === 'legal') expect(rule.provenance.sourceCheckedAt).toBe('2026-09-03');
    }
    const mxSend = fileFor('MX').rules.find((r) => r.typeId === 'invoice' && r.actionId === 'send')!;
    expect(mxSend.provenance.kind).toBe('unverified'); // diputados.gob.mx/sat.gob.mx unreachable — see its own resolutionNote
    expect(mxSend.allowed).toBe(true); // still unblocked — 'unverified' is not a lesser citizen (schema.ts's own header)
  });

  it('quote.send cites the SAME eIDAS art. 25 §1 text for DE/IT/PL/ES — a Regulation, not a directive, needs no per-country transposition', () => {
    for (const code of ['DE', 'IT', 'PL', 'ES']) {
      const rule = fileFor(code).rules.find((r) => r.typeId === 'quote' && r.actionId === 'send')!;
      expect(rule.provenance.kind).toBe('legal');
      if (rule.provenance.kind === 'legal') {
        expect(rule.provenance.sourceText).toMatch(/shall not be denied legal effect/);
        expect(rule.provenance.sourceCheckedAt).toBe('2026-09-03');
      }
    }
  });

  it('credit-note.send is sourced per country from the correction-routes CREDIT_NOTE fact already read for C1/C3 — never re-invented here', () => {
    for (const code of ['DE', 'IT', 'PL', 'ES', 'MX']) {
      const rule = fileFor(code).rules.find((r) => r.typeId === 'credit-note' && r.actionId === 'send')!;
      expect(rule.provenance.kind).toBe('legal');
      expect(rule.allowed).toBe(true);
    }
    // Poland's own nuance called out by the task brief: no separate "nota kredytowa" instrument —
    // a reduction is a faktura korygująca (the SAME instrument as an increase, art. 106j).
    expect(
      fileFor('PL').rules.find((r) => r.typeId === 'credit-note' && r.actionId === 'send')?.notes,
    ).toMatch(/faktura korygująca/);
  });

  it('each of the five new files carries at least one honest, resolvable `unverified` entry — not a wall-to-wall "legal" claim', () => {
    for (const code of ['DE', 'IT', 'PL', 'ES', 'MX']) {
      const file = fileFor(code);
      const unverified = file.rules.filter((r) => r.provenance.kind === 'unverified');
      expect(unverified.length).toBeGreaterThan(0);
      for (const rule of unverified) {
        if (rule.provenance.kind === 'unverified')
          expect(rule.provenance.resolutionNote.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('all five new files declare the SAME 22 (typeId, actionId) pairs as fr.json — no silent gap versus the reference jurisdiction', () => {
    const frKeys = fileFor('FR')
      .rules.map((r) => `${r.typeId}::${r.actionId}`)
      .sort();
    for (const code of ['DE', 'IT', 'PL', 'ES', 'MX']) {
      const keys = fileFor(code)
        .rules.map((r) => `${r.typeId}::${r.actionId}`)
        .sort();
      expect(keys).toEqual(frKeys);
    }
  });
});

// BE — agent pays Belgique, lot 1 TODO_DOCUMENTS.md (vague B, 2026-09-04). country-policy/data/be.json
// is NOT YET registered in this file's own data/all.ts (COUNTRY_FILES) — registration is the
// mandataire's job at lot validation, done together with the NL/AT files this same lot also adds. This
// block therefore loads be.json DIRECTLY (readFileSync + assertValidProvenance, the exact gate
// data/all.ts's own loadCountryFile calls) rather than through ALL_COUNTRY_POLICY_FILES, so it is
// green independently of that registration, using inline `require()` (not a top-level `import`)
// specifically so this addition can never collide with the NL/AT agents' own additions to this same
// file editing the same import block in parallel.
describe('BE — country-policy/data/be.json (agent pays Belgique, not yet registered in all.ts)', () => {
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const { assertValidProvenance } = require('../schema');

  function loadBe() {
    return JSON.parse(readFileSync(join(__dirname, 'be.json'), 'utf-8'));
  }

  it('parses, declares countryCode BE, and every rule passes the load-time provenance gate', () => {
    const be = loadBe();
    expect(be.countryCode).toBe('BE');
    expect(be.rules.length).toBeGreaterThan(0);
    for (const rule of be.rules) {
      expect(() => assertValidProvenance(rule, 'test')).not.toThrow();
    }
  });

  it('declares the same 22 (typeId, actionId) pairs as fr.json — no silent gap versus the reference jurisdiction', () => {
    const be = loadBe();
    const fr = JSON.parse(readFileSync(join(__dirname, 'fr.json'), 'utf-8'));
    const frKeys = fr.rules.map((r) => `${r.typeId}::${r.actionId}`).sort();
    const beKeys = be.rules.map((r) => `${r.typeId}::${r.actionId}`).sort();
    expect(beKeys).toEqual(frKeys);
  });

  it('declares the same five document types as fr.json', () => {
    const be = loadBe();
    expect((be.documentTypes ?? []).slice().sort()).toEqual(
      ['credit-note', 'expense', 'invoice', 'quote', 'received-invoice'].sort(),
    );
  });

  it('invoice.save-draft is "legal", restricted to draft — the AR n°1 art. 12 §1 immutability fact (efacture.belgium.be, read 2026-09-04)', () => {
    const be = loadBe();
    const rule = be.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'save-draft');
    expect(rule.provenance.kind).toBe('legal');
    expect(rule.provenance.sourceText).toMatch(/document rectificatif/);
    expect(rule.provenance.sourceCheckedAt).toBe('2026-09-04');
    expect(rule.statuses).toEqual(['draft']);
  });

  it('invoice.send is "legal", citing the loi du 6 février 2024 (CTVA art. 53 §2bis, read directly on ejustice.just.fgov.be)', () => {
    const be = loadBe();
    const rule = be.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'send');
    expect(rule.allowed).toBe(true);
    expect(rule.provenance.kind).toBe('legal');
    expect(rule.provenance.sourceText).toMatch(/facture électronique structurée/);
    expect(rule.notes).toMatch(/2024001635/);
  });

  it('quote.send reuses the eIDAS art. 25 §1 citation already verified by other files of this same lot (pl/de/it/es) — dated, not re-verified', () => {
    const be = loadBe();
    const rule = be.rules.find((r) => r.typeId === 'quote' && r.actionId === 'send');
    expect(rule.provenance.kind).toBe('legal');
    expect(rule.provenance.sourceText).toMatch(/shall not be denied legal effect/);
    expect(rule.notes).toMatch(/RÉUTILISE/);
  });

  it('credit-note.send is "legal" — Belgium names BOTH "notes de crédit" and "notes de débit" explicitly, unlike Poland\'s single-instrument regime', () => {
    const be = loadBe();
    const rule = be.rules.find((r) => r.typeId === 'credit-note' && r.actionId === 'send');
    expect(rule.provenance.kind).toBe('legal');
    expect(rule.provenance.sourceText).toMatch(/notes de crédit et notes de débit/);
  });

  it('carries at least one honest, resolvable "unverified" entry — not a wall-to-wall "legal" claim', () => {
    const be = loadBe();
    const unverified = be.rules.filter((r) => r.provenance.kind === 'unverified');
    expect(unverified.length).toBeGreaterThan(0);
    for (const rule of unverified) {
      expect(rule.provenance.resolutionNote.trim().length).toBeGreaterThan(0);
    }
  });
});
