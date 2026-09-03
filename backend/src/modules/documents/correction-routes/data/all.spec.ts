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
      // No legal citation — exactly the case TODO_CORRECTION.md C1 requires to fail load.
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

  it('ships exactly the seven pivot countries docs/compliance/CORRECTION-ROUTES.yaml covers', () => {
    const countries = ALL_CORRECTION_ROUTES_FILES.map((f) => f.countryCode).sort();
    expect(countries).toEqual(['DE', 'ES', 'FR', 'IT', 'MX', 'PL', 'US']);
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

  // THE CANONICAL INVERSION — docs/compliance/CORRECTION-ROUTES.yaml's own "the_decisive_finding":
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

  it('ES and MX also forbid INTERNAL_CREDIT_NOTE, same side as Poland', () => {
    expect(statusOf('ES', 'INTERNAL_CREDIT_NOTE')).toBe('forbidden');
    expect(statusOf('MX', 'INTERNAL_CREDIT_NOTE')).toBe('forbidden');
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

  it('DE and MX both declare COUNTERPARTY_OBJECTION as allowed — two different legal shapes, same route', () => {
    expect(statusOf('DE', 'COUNTERPARTY_OBJECTION')).toBe('allowed');
    expect(statusOf('MX', 'COUNTERPARTY_OBJECTION')).toBe('allowed');
  });

  it('ES: CREDIT_NOTE is required (conditioned on remission) and CANCEL_AND_REPLACE is forbidden by absence of mechanism', () => {
    expect(statusOf('ES', 'CREDIT_NOTE')).toBe('required');
    expect(statusOf('ES', 'CANCEL_AND_REPLACE')).toBe('forbidden');
  });

  it('MX: AUTHORITY_ANNULMENT and CANCEL_AND_REPLACE are both required — the only pivot where NOT correcting is itself an infraction', () => {
    expect(statusOf('MX', 'AUTHORITY_ANNULMENT')).toBe('required');
    expect(statusOf('MX', 'CANCEL_AND_REPLACE')).toBe('required');
  });

  it('US: every negative-established route is "allowed" (no federal instrument at all) and AUTHORITY_ANNULMENT is structurally forbidden (no receiving authority)', () => {
    expect(statusOf('US', 'CREDIT_NOTE')).toBe('allowed');
    expect(statusOf('US', 'INTERNAL_CREDIT_NOTE')).toBe('allowed');
    expect(statusOf('US', 'AUTHORITY_ANNULMENT')).toBe('forbidden');
  });

  it('FR: ANNOTATED_DUPLICATE is required for unpaid invoices (the counterpart of a forbidden credit note there)', () => {
    expect(statusOf('FR', 'ANNOTATED_DUPLICATE')).toBe('required');
  });

  // A route the YAML never addresses for a given country (or explicitly marks "non recherchée")
  // transcribes to "unverified" — never silently promoted, never silently absent.
  it('a route the YAML never mentions for a country transcribes to "unverified", never a guess', () => {
    expect(statusOf('FR', 'NO_DOCUMENT_BY_LAW')).toBe('unverified');
    expect(statusOf('US', 'LEDGER_ANNOTATION')).toBe('unverified');
  });

  // THE LOAD-TIME GATE, proven against an INVENTED eighth country — TODO_CORRECTION.md C1's own
  // acceptance criterion: "un 8e pays inventé sans provenance refuse de charger".
  it('an eighth, invented country with a "required" route but no legal provenance REFUSES to load', () => {
    expect(() => loadCountryFile('zz')).toThrow(InvalidCorrectionRouteProvenanceError);
    expect(() => loadCountryFile('zz')).toThrow(/legal citation/);
  });
});
