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
// "quote" and "invoice" (documents-core.module.ts — the invoice case needed it
// for the recurring-documents mechanism), outside either type's own descriptor — listed here by
// hand since this test deliberately stays independent of Nest wiring, the same way
// documents.service.spec.ts's own `buildService()` re-lists it rather than booting the whole module.
// `invoice.cancel` is the ONE native action deliberately EXCLUDED from this
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

describe('country-policy/data — the shipped FR/DE/IT/PL/PT files', () => {
  // Re-pinned by the 5-country prune (2026-09-10): this mechanism now ships exactly the five kept
  // countries. US, HU and every other country ever added were `git rm`'d along with their
  // data/xx.json.
  it('loads exactly the five kept countries', () => {
    const codes = ALL_COUNTRY_POLICY_FILES.map((f) => f.countryCode).sort();
    expect(codes).toEqual(['DE', 'FR', 'IT', 'PL', 'PT']);
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

  // US used to be the one shipped file with a real, documented gap here (no quote.duplicate rule) —
  // data/us.json was removed by the 5-country prune (2026-09-10), and every one of the five kept
  // files (DE/FR/IT/PL/PT) declares quote.duplicate, so there is no honest gap left to re-anchor
  // this test on; deleted rather than weakened.

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
  it('every kept country declares every document type the core registers today', () => {
    for (const code of ['FR', 'DE', 'IT', 'PL', 'PT']) {
      const file = fileFor(code);
      expect((file.documentTypes ?? []).slice().sort()).toEqual(ALL_DOCUMENT_TYPE_IDS.slice().sort());
    }
  });

  // The per-status narrowing (schema.ts's `DocumentActionRuleFact.statuses`) — TWO real, shipped
  // examples: invoice.save-draft (the original example — "an issued invoice is no longer editable"),
  // and received-invoice.receive in every shipped file ("a reviewed [approved/rejected] received
  // invoice's fields are no longer editable", the same shape of fact applied to a different type's
  // own lifecycle). FR's invoice.save-draft was promoted to `legal` on 2026-09-01 (CGI art. 289 I.5,
  // read directly — see its own `notes`); DE/IT/PL were promoted the same way on 2026-09-03, and PT
  // on 2026-09-04 (see each file's own `notes` on invoice.save-draft). Every one of the five kept
  // files sources this narrowing today —
  // US used to be the one shipped file with NO narrowing here at all, but data/us.json was removed by
  // the 5-country prune (2026-09-10). received-invoice.receive stays `unverified` in every file (no
  // rule's own resolutionNote named a checkable text for the STATUS narrowing itself, as opposed to
  // the separate, already-sourced reception-channel mandate FR's own rule documents).
  it('invoice.save-draft and received-invoice.receive restrict to their own "still editable" status, in every shipped file', () => {
    for (const file of ALL_COUNTRY_POLICY_FILES) {
      expect(file.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'save-draft')?.statuses).toEqual(
        ['draft'],
      );
      expect(
        file.rules.find((r) => r.typeId === 'received-invoice' && r.actionId === 'receive')?.statuses,
      ).toEqual(['received']);
    }
  });

  it('no OTHER shipped rule declares a per-status narrowing — these two stay the only deliberate examples', () => {
    // Every one of the five kept countries (FR/DE/IT/PL/PT) sources this narrowing today — the
    // longer list this test used to carry (BE/NL/AT/EE/GR/CY/…) was removed by the
    // 5-country prune (2026-09-10) along with those countries' own data/xx.json files.
    const COUNTRIES_WITH_SOURCED_SAVE_DRAFT_NARROWING = ['FR', 'DE', 'IT', 'PL', 'PT'];
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

// The primary texts were read (codes.droit.org, a
// Légifrance mirror, for the CGI/code civil articles; govinfo.gov, the official US Government
// Publishing Office, for the US Code) — three FR rules promoted to "legal", pinned here by their
// exact reference the same way country-identifiers/data/all.spec.ts pins GB's own promoted VAT fact.
describe('country-policy/data — FR rules promoted to "legal" (2026-09-01)', () => {
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

  // US's own quote.send/invoice.send E-SIGN (govinfo.gov) citation was re-verified 2026-09-01, but
  // data/us.json was removed by the 5-country prune (2026-09-10) — no kept country cites the US
  // federal E-SIGN act, so this case has no honest re-anchor and is deleted rather than weakened.
});

// Before the 2026-09-03 sourcing pass, only FR/US/HU had a policy file at all — every OTHER country,
// Poland and Italy (this product's own primary markets) included, had EVERY document action blocked
// by DECISION 1 (country-policy.ts's own header) for want of a file, whatever the actual local law
// said. This pins the content the way the FR describe block above already pins FR's own promotions:
// the two immutability citations called out BY NAME (PL/IT), the five `send` unblocks, and one
// honest `unverified` per country, so a future edit that quietly waters one of these down goes red
// here first.
// Re-scoped by the 5-country prune (2026-09-10): ES and MX were removed along with their
// data/xx.json — this block now pins DE/IT/PL only, the three additions that survived the prune.
describe('country-policy/data — DE/IT/PL added by the 2026-09-03 sourcing pass', () => {
  it('the catalog now covers exactly the five kept countries (DE/FR/IT/PL/PT)', () => {
    const codes = ALL_COUNTRY_POLICY_FILES.map((f) => f.countryCode).sort();
    expect(codes).toEqual(['DE', 'FR', 'IT', 'PL', 'PT']);
  });

  it('PL invoice.save-draft cites the Podręcznik KSeF verbatim: a file sent to KSeF cannot be edited, only corrected by a new faktura korygująca', () => {
    const pl = fileFor('PL');
    const rule = pl.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'save-draft')!;
    expect(rule.provenance.kind).toBe('legal');
    if (rule.provenance.kind === 'legal') {
      expect(rule.provenance.sourceText).toMatch(/nie jest możliwe jej edytowanie/);
      expect(rule.provenance.sourceCheckedAt).toBe('2026-08-29'); // reused, not re-checked by the 2026-09-03 pass
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
      expect(rule.provenance.sourceCheckedAt).toBe('2026-08-29'); // reused, not re-checked by the 2026-09-03 pass
    }
    expect(rule.notes).toMatch(/correction-routes\/data\/it\.json/);
    expect(rule.statuses).toEqual(['draft']);
  });

  it('DE invoice.save-draft is ALSO sourced "legal" with the same draft-only restriction (the immutability fact generalizes, not just PL/IT)', () => {
    // ES used to pair with DE here — data/es.json was removed by the 5-country prune (2026-09-10).
    const rule = fileFor('DE').rules.find((r) => r.typeId === 'invoice' && r.actionId === 'save-draft')!;
    expect(rule.provenance.kind).toBe('legal');
    expect(rule.statuses).toEqual(['draft']);
  });

  it('invoice.send is allowed for all three surviving added countries — the actual unblock the sourcing pass exists for', () => {
    for (const code of ['DE', 'IT', 'PL']) {
      const rule = fileFor(code).rules.find((r) => r.typeId === 'invoice' && r.actionId === 'send')!;
      expect(rule.allowed).toBe(true);
    }
  });

  it('invoice.send is grounded "legal" for DE/IT/PL — a national electronic-invoicing text read live on 2026-09-03', () => {
    // MX used to be the honestly-unverified counterexample here — data/mx.json was removed by the
    // 5-country prune (2026-09-10).
    for (const code of ['DE', 'IT', 'PL']) {
      const rule = fileFor(code).rules.find((r) => r.typeId === 'invoice' && r.actionId === 'send')!;
      expect(rule.provenance.kind).toBe('legal');
      if (rule.provenance.kind === 'legal') expect(rule.provenance.sourceCheckedAt).toBe('2026-09-03');
    }
  });

  it('quote.send cites the SAME eIDAS art. 25 §1 text for DE/IT/PL — a Regulation, not a directive, needs no per-country transposition', () => {
    for (const code of ['DE', 'IT', 'PL']) {
      const rule = fileFor(code).rules.find((r) => r.typeId === 'quote' && r.actionId === 'send')!;
      expect(rule.provenance.kind).toBe('legal');
      if (rule.provenance.kind === 'legal') {
        expect(rule.provenance.sourceText).toMatch(/shall not be denied legal effect/);
        expect(rule.provenance.sourceCheckedAt).toBe('2026-09-03');
      }
    }
  });

  it('credit-note.send is sourced per country from the correction-routes CREDIT_NOTE fact already read there — never re-invented here', () => {
    for (const code of ['DE', 'IT', 'PL']) {
      const rule = fileFor(code).rules.find((r) => r.typeId === 'credit-note' && r.actionId === 'send')!;
      expect(rule.provenance.kind).toBe('legal');
      expect(rule.allowed).toBe(true);
    }
    // Poland's own nuance: no separate "nota kredytowa" instrument —
    // a reduction is a faktura korygująca (the SAME instrument as an increase, art. 106j).
    expect(
      fileFor('PL').rules.find((r) => r.typeId === 'credit-note' && r.actionId === 'send')?.notes,
    ).toMatch(/faktura korygująca/);
  });

  it('each of the three surviving added files carries at least one honest, resolvable `unverified` entry — not a wall-to-wall "legal" claim', () => {
    for (const code of ['DE', 'IT', 'PL']) {
      const file = fileFor(code);
      const unverified = file.rules.filter((r) => r.provenance.kind === 'unverified');
      expect(unverified.length).toBeGreaterThan(0);
      for (const rule of unverified) {
        if (rule.provenance.kind === 'unverified')
          expect(rule.provenance.resolutionNote.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('every kept file declares the SAME 22 (typeId, actionId) pairs as fr.json — no silent gap versus the reference jurisdiction', () => {
    // Widened from the original DE/IT/PL/ES/MX list to every kept country (also PT) — strictly more
    // coverage than before the prune, not less.
    const frKeys = fileFor('FR')
      .rules.map((r) => `${r.typeId}::${r.actionId}`)
      .sort();
    for (const code of ['DE', 'IT', 'PL', 'PT']) {
      const keys = fileFor(code)
        .rules.map((r) => `${r.typeId}::${r.actionId}`)
        .sort();
      expect(keys).toEqual(frKeys);
    }
  });
});

// BE's country-policy/data/be.json was removed by the 5-country prune (2026-09-10) along with every
// other country outside FR/PL/IT/PT/DE — it was never registered in data/all.ts to begin with, so
// nothing here re-anchors it.

// Drop-in invariant (readdir-discovery conversion) — proves all.ts's own `discoverCountryCodes()`
// really does pick up every `<cc>.json` sitting in this directory: this test re-reads the directory
// with the IDENTICAL pattern, independently of all.ts's own implementation, so a regression that
// silently drops a file from discovery (a typo'd pattern, a change that stops sorting, anything) goes
// red here — the whole point of "adding a country = dropping a file" is only true if this holds.
describe('country-policy/data — every *.json on disk is actually loaded (drop-in invariant)', () => {
  it('ALL_COUNTRY_POLICY_FILES covers exactly the country files present in this directory, no more, no fewer', () => {
    const { readdirSync } = require('node:fs');
    const onDisk = readdirSync(__dirname)
      .filter((name: string) => /^[a-z]{2}\.json$/.test(name))
      .map((name: string) => name.replace(/\.json$/, '').toUpperCase())
      .sort();
    const loaded = ALL_COUNTRY_POLICY_FILES.map((f) => f.countryCode).sort();
    expect(loaded).toEqual(onDisk);
  });
});
