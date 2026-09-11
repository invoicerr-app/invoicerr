/**
 * `jest.requireActual('node:fs')` passthrough for every REAL shipped file (fr/it/pl/de/es/mx/us.json,
 * read straight off disk exactly like an unmocked test would) — the ONLY intercepted path is the one
 * INVENTED "zz.json" this file's own last test uses to prove the load-time gate against an eighth
 * country that never shipped, without needing a real, checked-in file that deliberately breaks the
 * rule it exists to enforce (see `all.ts`'s own `loadCountryFile` export comment).
 */

const FAKE_ZZ_FILE_NO_PROVENANCE = {
  countryCode: 'ZZ',
  routes: [
    {
      routeId: 'CREDIT_NOTE',
      status: 'required',
      // No legal citation — exactly the case the load-time gate requires to fail load.
      provenance: { kind: 'unverified', resolutionNote: 'Invented for this test, never researched.' },
    },
  ],
};

jest.mock('node:fs', () => ({
  ...jest.requireActual('node:fs'),
  readFileSync: jest.fn((path: string, encoding: BufferEncoding) => {
    if (typeof path === 'string' && path.endsWith('zz.json')) {
      return JSON.stringify(FAKE_ZZ_FILE_NO_PROVENANCE);
    }
    return jest.requireActual('node:fs').readFileSync(path, encoding);
  }),
}));

import { InvalidCorrectionRouteProvenanceError } from '../schema';
import { ALL_CORRECTION_ROUTES_FILES, loadCountryFile } from './all';

describe('correction-routes/data/all.ts', () => {
  it('loads every shipped file without throwing', () => {
    expect(ALL_CORRECTION_ROUTES_FILES.length).toBeGreaterThan(0);
  });

  // Re-pinned by the 5-country prune (2026-09-10): this mechanism ships
  // correction-routes rules for DE/FR/IT/PL/PT only — every other country the YAML or a later
  // direct-reading lot ever covered (AT/BE/BG/CY/CZ/DK/EE/ES/FI/GR/HR/HU/IE/LT/LU/LV/MT/MX/NL/RO/
  // SE/SI/SK/US) was `git rm`'d along with its data/xx.json.
  it('ships exactly the five kept-country files (DE/FR/IT/PL/PT)', () => {
    const countries = ALL_CORRECTION_ROUTES_FILES.map((f) => f.countryCode).sort();
    expect(countries).toEqual(['DE', 'FR', 'IT', 'PL', 'PT']);
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

  // THE CANONICAL INVERSION — documentation/internal/CORRECTION-ROUTES.yaml's own "the_decisive_finding":
  // the internal credit note is IMPOSED in France/Italy and FORBIDDEN in Poland/Spain/Mexico. This is
  // the single fact the whole per-country mechanism (rather than one shared enum) exists to carry.
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

  // One further pinned sample per country — each a headline finding from CORRECTION-ROUTES.yaml, so a
  // future edit that silently drifts a status shows up here.
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

  // A route the YAML never addresses for a given country (or explicitly marks "non recherchée")
  // transcribes to "unverified" — never silently promoted, never silently absent.
  it('a route the YAML never mentions for a country transcribes to "unverified", never a guess', () => {
    expect(statusOf('FR', 'NO_DOCUMENT_BY_LAW')).toBe('unverified');
    expect(statusOf('DE', 'LEDGER_ANNOTATION')).toBe('unverified');
  });

  // THE LOAD-TIME GATE, proven against an INVENTED eighth country — the acceptance criterion:
  // "un 8e pays inventé sans provenance refuse de charger".
  it('an eighth, invented country with a "required" route but no legal provenance REFUSES to load', () => {
    expect(() => loadCountryFile('zz')).toThrow(InvalidCorrectionRouteProvenanceError);
    expect(() => loadCountryFile('zz')).toThrow(/legal citation/);
  });
});

// BE's correction-routes/data/be.json (agent pays Belgique) was removed by the 5-country prune
// (2026-09-10) along with every other country outside FR/PL/IT/PT/DE —
// it was never registered in data/all.ts to begin with, so nothing here re-anchors it.

// Drop-in invariant (readdir-discovery conversion) — proves all.ts's own `discoverCountryCodes()`
// really does pick up every `<cc>.json` sitting in this directory: this test re-reads the directory
// with the IDENTICAL pattern, independently of all.ts's own implementation, so a regression that
// silently drops a file from discovery (a typo'd pattern, a change that stops sorting, anything) goes
// red here — the whole point of "adding a country = dropping a file" is only true if this holds. Uses
// `require('node:fs')` (real, unmocked — the file-level `jest.mock` above only overrides
// `readFileSync`) rather than the module's own mocked `readFileSync`.
describe('correction-routes/data — every *.json on disk is actually loaded (drop-in invariant)', () => {
  it('ALL_CORRECTION_ROUTES_FILES covers exactly the country files present in this directory, no more, no fewer', () => {
    const { readdirSync } = require('node:fs');
    const onDisk = readdirSync(__dirname)
      .filter((name: string) => /^[a-z]{2}\.json$/.test(name))
      .map((name: string) => name.replace(/\.json$/, '').toUpperCase())
      .sort();
    const loaded = ALL_CORRECTION_ROUTES_FILES.map((f) => f.countryCode).sort();
    expect(loaded).toEqual(onDisk);
  });
});
