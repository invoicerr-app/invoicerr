/**
 * Can a profile express a country the engine has never heard of?
 *
 * This spec is not about any real jurisdiction, and says so on purpose. It builds a FICTIONAL
 * country and asks one question: does the model have the expressive power, without a line of code
 * naming it? Every rule below is data — the engine compares codes and dates and knows nothing about
 * quotes, Poland, or why the first of the month would matter.
 *
 * The four demands are the ones a real country could plausibly make, and none of them was
 * expressible before:
 *   1. a document type that exists nowhere else, required before an invoice
 *   2. the plain invoice taken away entirely
 *   3. issuance allowed only on the first of the month
 *   4. a signed quote as a precondition
 */
import {
  checkAction,
  checkIssuable,
  defaultConditionRegistry,
  documentKindRuleFor,
} from './action-conditions';
import { documentKindsFor } from './document-kinds';
import { CountryComplianceProfile } from './schema';

/** A country that demands everything. Nothing here exists in any shipped profile. */
const ATLANTIS = {
  countryCode: 'XA',
  displayName: 'Atlantis',
  schemaVersion: '1.0',
  confidence: 'UNVERIFIED',
  taxSystem: { kind: 'VAT', standardRate: 20, reducedRates: [], schemes: ['STANDARD'] },
  lifecycle: [
    {
      validFrom: '1900-01-01',
      value: {
        immutableAfter: 'ISSUE',
        correctionModel: 'CORRECTIVE_INVOICE',
        cancellation: { allowed: false, requiresAuthorityAck: false },
      },
    },
  ],
  documentKinds: [
    {
      validFrom: '1900-01-01',
      value: {
        // 1 — a kind the engine has never seen, with the country's own name for it.
        kind: 'FAKTURA_MIESIECZNA',
        label: 'Facture mensuelle',
        legalDocument: true,
        availability: 'REQUIRED',
        // 4 — and it needs a signed quote first.
        requires: [
          { kind: 'QUOTE', state: 'SIGNED', description: 'Un devis signé est exigé avant facturation.' },
        ],
        // 3 — issued on the first of the month, and nowhere does the engine know what that means.
        issuableOn: { daysOfMonth: [1], description: 'Facturation le 1er du mois uniquement.' },
      },
    },
    {
      // 2 — the plain invoice is taken away.
      validFrom: '1900-01-01',
      value: { kind: 'INVOICE', legalDocument: true, availability: 'FORBIDDEN' },
    },
  ],
} as unknown as CountryComplianceProfile;

const at = (iso: string) => new Date(`${iso}T10:00:00`);

describe('a fictional country the engine has never heard of', () => {
  it('offers its own document and NOT the plain invoice', () => {
    const kinds = documentKindsFor(ATLANTIS, at('2026-09-01')).map((k) => k.kind);

    expect(kinds).toContain('FAKTURA_MIESIECZNA');
    // Removed, not merely marked: the menu is what the country offers, and it does not offer this.
    expect(kinds).not.toContain('INVOICE');
    // …while everything it did NOT speak about survives. Declaring one kind used to wipe the rest.
    expect(kinds).toContain('DEPOSIT');
    expect(kinds).toContain('PROFORMA');
  });

  it('keeps the country name for its own document', () => {
    expect(documentKindRuleFor(ATLANTIS, 'FAKTURA_MIESIECZNA', at('2026-09-01'))?.label).toBe(
      'Facture mensuelle',
    );
  });

  it('refuses the plain invoice, and says why in the country terms', () => {
    const v = checkIssuable(ATLANTIS, 'INVOICE', at('2026-09-01'));
    expect(v.allowed).toBe(false);
    expect(v.blockers.map((b) => b.predicate)).toEqual(['never']);
  });

  it('refuses its own document without a SIGNED quote', () => {
    const noQuote = checkIssuable(ATLANTIS, 'FAKTURA_MIESIECZNA', at('2026-09-01'));
    expect(noQuote.allowed).toBe(false);
    expect(noQuote.blockers[0]).toMatchObject({
      predicate: 'requiresDocument',
      params: { kind: 'QUOTE', state: 'SIGNED' },
    });

    // A quote that exists but is not signed does not satisfy it either.
    const draftQuote = checkIssuable(ATLANTIS, 'FAKTURA_MIESIECZNA', at('2026-09-01'), [
      { kind: 'QUOTE', state: 'DRAFT' },
    ]);
    expect(draftQuote.allowed).toBe(false);
  });

  it('accepts it on the first, with a signed quote', () => {
    const v = checkIssuable(ATLANTIS, 'FAKTURA_MIESIECZNA', at('2026-09-01'), [
      { kind: 'QUOTE', state: 'SIGNED' },
    ]);
    expect(v).toEqual({ allowed: true, blockers: [] });
  });

  it('refuses it on the second, even with the quote', () => {
    const v = checkIssuable(ATLANTIS, 'FAKTURA_MIESIECZNA', at('2026-09-02'), [
      { kind: 'QUOTE', state: 'SIGNED' },
    ]);
    expect(v.allowed).toBe(false);
    expect(v.blockers[0].predicate).toBe('calendarWindow');
    expect(v.blockers[0].description).toBe('Facturation le 1er du mois uniquement.');
  });

  it('reports EVERY blocker at once, not the first', () => {
    // A user told "you need a signed quote", who then discovers it is also the wrong day, has been
    // made to fail twice for one action. The cancellation panel learned this the hard way.
    const v = checkIssuable(ATLANTIS, 'FAKTURA_MIESIECZNA', at('2026-09-02'));
    expect(v.blockers.map((b) => b.predicate).sort()).toEqual(['calendarWindow', 'requiresDocument']);
  });
});

describe('a country that demands nothing is unconstrained', () => {
  it('every shipped profile stays issuable — adding this changed nothing for them', () => {
    // The guard must be invisible to the ~106 countries that declare no constraint. If this ever
    // fails, the default stopped being "allowed" and a silent regression is loose.
    const plain = { countryCode: 'XB', documentKinds: [] } as unknown as CountryComplianceProfile;
    expect(checkIssuable(plain, 'INVOICE', at('2026-09-17'))).toEqual({ allowed: true, blockers: [] });
    expect(checkIssuable(undefined, 'INVOICE', at('2026-09-17'))).toEqual({ allowed: true, blockers: [] });
  });
});

describe('the calendarWindow predicate', () => {
  const win = defaultConditionRegistry.get('calendarWindow')!;
  const ctx = (iso: string) => ({ kind: 'X', action: 'ISSUE' as const, at: at(iso), existing: [] });

  it('ANDs its fields, and an absent field constrains nothing', () => {
    // `{ daysOfMonth: [1] }` means the first of ANY month, not the first of January.
    expect(win({ daysOfMonth: [1] }, ctx('2026-03-01'))).toBe(true);
    expect(win({ daysOfMonth: [1] }, ctx('2026-12-01'))).toBe(true);
    expect(win({ daysOfMonth: [1], months: [1] }, ctx('2026-12-01'))).toBe(false);
    expect(win({}, ctx('2026-12-25'))).toBe(true);
  });

  it('reads weekdays as ISO — 1 is Monday, 7 is Sunday', () => {
    // getDay() calls Sunday 0, which is the classic off-by-one in this exact spot.
    expect(win({ daysOfWeek: [7] }, ctx('2026-08-30'))).toBe(true); // a Sunday
    expect(win({ daysOfWeek: [1] }, ctx('2026-08-30'))).toBe(false);
  });
});

describe('the general form — what the enumerated shape could not express', () => {
  /** Same fictional country, now demanding a threshold and forbidding deletion outright. */
  const ATLANTIS_2 = {
    countryCode: 'XC',
    documentKinds: [
      {
        validFrom: '1900-01-01',
        value: {
          kind: 'INVOICE',
          legalDocument: true,
          availability: 'AVAILABLE',
          conditions: {
            // Not a calendar, not a prerequisite, not a status — a fourth axis, and there would
            // always be a fifth. This is why the enumerated schema had to go.
            ISSUE: [
              {
                predicate: 'numericFieldAtLeast',
                params: { field: 'totalTTC', value: 5000 },
                description: 'Facturation à partir de 5 000 € seulement.',
              },
            ],
            DELETE: [{ predicate: 'never', description: 'Aucun document ne peut être supprimé.' }],
          },
        },
      },
    ],
  } as unknown as CountryComplianceProfile;

  it('expresses a threshold nobody anticipated, with no new schema field', () => {
    const poor = checkAction(ATLANTIS_2, 'INVOICE', 'ISSUE', {
      at: at('2026-09-17'),
      existing: [],
      document: { totalTTC: 1200 },
    });
    expect(poor.allowed).toBe(false);
    expect(poor.blockers[0].description).toBe('Facturation à partir de 5 000 € seulement.');

    const rich = checkAction(ATLANTIS_2, 'INVOICE', 'ISSUE', {
      at: at('2026-09-17'),
      existing: [],
      document: { totalTTC: 9000 },
    });
    expect(rich.allowed).toBe(true);
  });

  it('forbids deletion — an action the first shape had no field for at all', () => {
    const v = checkAction(ATLANTIS_2, 'INVOICE', 'DELETE', { at: at('2026-09-17'), existing: [] });
    expect(v.allowed).toBe(false);
    expect(v.blockers[0].predicate).toBe('never');
  });

  it('a predicate nobody registered BLOCKS, and says why', () => {
    // Treating an unknown predicate as satisfied would let a profile referencing an uninstalled
    // plugin silently drop a national rule — the worst failure this codebase can produce.
    const withPlugin = {
      countryCode: 'XD',
      documentKinds: [
        {
          validFrom: '1900-01-01',
          value: {
            kind: 'INVOICE',
            legalDocument: true,
            availability: 'AVAILABLE',
            conditions: { ISSUE: [{ predicate: 'pl-ksef/specialCase' }] },
          },
        },
      ],
    } as unknown as CountryComplianceProfile;

    const v = checkAction(withPlugin, 'INVOICE', 'ISSUE', { at: at('2026-09-17'), existing: [] });
    expect(v.allowed).toBe(false);
    expect(v.blockers[0].description).toMatch(/not installed/);
  });
});
