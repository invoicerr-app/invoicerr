/**
 * Content-pinning spec for the shipped correction-routes catalog - `ALL_CORRECTION_ROUTES_FILES`
 * (`./all.ts`) now derives from `defaultComposedCountryCatalog` (issue #603 step 6), not from a
 * direct disk read of this directory, so there is nothing left here to mock at the `node:fs`
 * boundary. The load-time-gate proof this file used to carry directly (an invented eighth country,
 * `loadCountryFile('zz')`, proving a route with no legal provenance refuses to load) moved with the
 * mechanism it was proving: see `countries/data/all.spec.ts`.
 */
import { ALL_CORRECTION_ROUTES_FILES } from './all';

describe('correction-routes/data/all.ts', () => {
  it('loads every shipped file without throwing', () => {
    expect(ALL_CORRECTION_ROUTES_FILES.length).toBeGreaterThan(0);
  });

  // Re-pinned by the 5-country prune (2026-09-10): this mechanism ships
  // correction-routes rules for DE/FR/IT/PL/PT only — every other country the YAML or a later
  // direct-reading lot ever covered (AT/BE/BG/CY/CZ/DK/EE/ES/FI/GR/HR/HU/IE/LT/LU/LV/MT/MX/NL/RO/
  // SE/SI/SK/US) was `git rm`'d along with its data/xx.json.
  it('ships exactly the six kept-country files (DE/DZ/FR/IT/PL/PT)', () => {
    const countries = ALL_CORRECTION_ROUTES_FILES.map((f) => f.countryCode).sort();
    expect(countries).toEqual(['DE', 'DZ', 'FR', 'IT', 'PL', 'PT']);
  });

  it('every shipped route carries either legal or unverified provenance, never anything else', () => {
    for (const file of ALL_CORRECTION_ROUTES_FILES) {
      for (const route of file.routes) {
        expect(['legal', 'unverified']).toContain(route.provenance.kind);
      }
    }
  });

  it('every shipped country file declares exactly the eleven canonical routes, no more, no fewer', () => {
    const EXPECTED = [
      'CREDIT_NOTE',
      'DEBIT_NOTE',
      'CORRECTIVE_INVOICE',
      'CANCEL_AND_REPLACE',
      'INTERNAL_CREDIT_NOTE',
      'AUTHORITY_ANNULMENT',
      'RESUBMIT_SAME_IDENTITY',
      'ANNOTATED_DUPLICATE',
      'LEDGER_ANNOTATION',
      'NO_DOCUMENT_BY_LAW',
      'COUNTERPARTY_OBJECTION',
    ].sort();
    for (const file of ALL_CORRECTION_ROUTES_FILES) {
      const routeIds = file.routes.map((r) => r.routeId).sort();
      expect(routeIds).toEqual(EXPECTED);
    }
  });

  function statusOf(countryCode: string, routeId: string): string {
    const file = ALL_CORRECTION_ROUTES_FILES.find((f) => f.countryCode === countryCode)!;
    return file.routes.find((r) => r.routeId === routeId)!.status;
  }

  // THE CANONICAL INVERSION — the decisive finding of the dedicated correction-routes research pass
  // (2026-08-29): the internal credit note is IMPOSED in France/Italy and FORBIDDEN in Poland/Spain/
  // Mexico. This is the single fact the whole per-country mechanism (rather than one shared enum)
  // exists to carry.
  it('FR requires INTERNAL_CREDIT_NOTE (the avoir interne is IMPOSED, transmission forbidden)', () => {
    expect(statusOf('FR', 'INTERNAL_CREDIT_NOTE')).toBe('required');
  });

  it('PL forbids INTERNAL_CREDIT_NOTE — the exact inverse of France, for the same route', () => {
    expect(statusOf('PL', 'INTERNAL_CREDIT_NOTE')).toBe('forbidden');
  });

  it('IT also requires INTERNAL_CREDIT_NOTE (after scarto) — the trap was not franco-French', () => {
    expect(statusOf('IT', 'INTERNAL_CREDIT_NOTE')).toBe('required');
  });

  it('DE also forbids INTERNAL_CREDIT_NOTE, same side as Poland', () => {
    expect(statusOf('DE', 'INTERNAL_CREDIT_NOTE')).toBe('forbidden');
  });

  // One further pinned sample per country — each a headline finding from the 2026-08-29 research
  // pass, so a future edit that silently drifts a status shows up here.
  it('IT: DEBIT_NOTE is required (the upside is an OBLIGATION) while CREDIT_NOTE is only allowed (the downside is a FACULTY) — the asymmetry', () => {
    expect(statusOf('IT', 'DEBIT_NOTE')).toBe('required');
    expect(statusOf('IT', 'CREDIT_NOTE')).toBe('allowed');
  });

  it('PL: CORRECTIVE_INVOICE is required and CREDIT_NOTE is forbidden as a distinct document (single-instrument regime)', () => {
    expect(statusOf('PL', 'CORRECTIVE_INVOICE')).toBe('required');
    expect(statusOf('PL', 'CREDIT_NOTE')).toBe('forbidden');
  });

  it('DE: CORRECTIVE_INVOICE (Rechnungsberichtigung) is required, and AUTHORITY_ANNULMENT is required for Unberechtigter Steuerausweis — "the German surprise"', () => {
    expect(statusOf('DE', 'CORRECTIVE_INVOICE')).toBe('required');
    expect(statusOf('DE', 'AUTHORITY_ANNULMENT')).toBe('required');
  });

  // DE genuinely declares COUNTERPARTY_OBJECTION "allowed" — none of the other four kept countries
  // do (FR/IT/PL/PT all stay honestly "unverified" for the same route), which is itself the point:
  // this is real per-country data, not a shared default silently applied to everyone. (MX, which
  // used to pair with DE here on the same "allowed" value, was removed by the 5-country prune,
  // 2026-09-10 — no other kept country shares DE's value for this route.)
  it('DE declares COUNTERPARTY_OBJECTION as "allowed" while every other kept country stays honestly "unverified" for the same route', () => {
    expect(statusOf('DE', 'COUNTERPARTY_OBJECTION')).toBe('allowed');
    for (const countryCode of ['FR', 'IT', 'PL', 'PT']) {
      expect(statusOf(countryCode, 'COUNTERPARTY_OBJECTION')).toBe('unverified');
    }
  });

  it('FR: ANNOTATED_DUPLICATE is required for unpaid invoices (the counterpart of a forbidden credit note there)', () => {
    expect(statusOf('FR', 'ANNOTATED_DUPLICATE')).toBe('required');
  });

  // A route the YAML never addresses for a given country (or explicitly marks "not researched")
  // transcribes to "unverified" — never silently promoted, never silently absent.
  //
  // FR's NO_DOCUMENT_BY_LAW used to be this test's French exemplar. It is no longer unverified: it was
  // researched on the primary texts (2026-09-12) and promoted to "forbidden", as was FR's
  // LEDGER_ANNOTATION — see data/fr.json's own entries. COUNTERPARTY_OBJECTION replaces it because it
  // is still a route that YAML never mentions for France, which is what this test is about.
  it('a route the YAML never mentions for a country transcribes to "unverified", never a guess', () => {
    expect(statusOf('FR', 'COUNTERPARTY_OBJECTION')).toBe('unverified');
    expect(statusOf('DE', 'LEDGER_ANNOTATION')).toBe('unverified');
  });

  // THE LOAD-TIME GATE, proven against an INVENTED eighth country - moved to
  // `countries/data/all.spec.ts` (issue #603 step 6): see this file's own header.
});

// BE's own correction-routes data file (Belgium) was removed by the 5-country prune
// (2026-09-10) along with every other country outside FR/PL/IT/PT/DE —
// it was never registered in data/all.ts to begin with, so nothing here re-anchors it.

// The "drop-in invariant" that used to live here (re-reading this directory's own `*.json` listing
// against `ALL_CORRECTION_ROUTES_FILES`) tested a mechanism that moved: `data/all.ts` no longer reads
// this directory at all (issue #603 step 6) - it derives from `defaultComposedCountryCatalog`, which
// itself is discovered from `countries/data/*.json`. The equivalent proof now lives in
// `countries/data/all.spec.ts`.
