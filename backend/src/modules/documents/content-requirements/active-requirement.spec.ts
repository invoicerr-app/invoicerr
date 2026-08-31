/**
 * `activeContentRequirementFor` in isolation — pure function, fixture catalogs (and the real,
 * shipped FR fact) only. Mirrors `channel-policy/mandate.spec.ts`'s own structure.
 */
import { activeContentRequirementFor } from './active-requirement';
import { ContentRequirementCatalog } from './registry';

describe('activeContentRequirementFor — the real, shipped FR/BT-23 requirement', () => {
  // MUTATION TARGET: judging this against the server's current date instead of `issueDate` would
  // make this pair pass or fail together depending on when the suite runs — see this file's own
  // header and active-requirement.ts's header for the full reasoning.
  it('is NOT active for an invoice issued the day before mandatedFrom', () => {
    expect(activeContentRequirementFor('FR', 'BT-23', '2026-08-31')).toBeUndefined();
  });

  it('IS active for an invoice issued exactly on mandatedFrom', () => {
    const fact = activeContentRequirementFor('FR', 'BT-23', '2026-09-01');
    expect(fact).toEqual(expect.objectContaining({ field: 'BT-23', mandatedFrom: '2026-09-01' }));
  });

  it('IS active for an invoice issued well after mandatedFrom', () => {
    expect(activeContentRequirementFor('FR', 'BT-23', '2027-01-15')?.field).toBe('BT-23');
  });

  it('compares a full ISO timestamp issueDate the same way as a bare date', () => {
    expect(activeContentRequirementFor('FR', 'BT-23', '2026-09-01T00:00:00.000Z')?.field).toBe('BT-23');
    expect(activeContentRequirementFor('FR', 'BT-23', '2026-08-31T23:59:59.999Z')).toBeUndefined();
  });

  it('a different field on the same country is never active — this fact is scoped to BT-23 only', () => {
    expect(activeContentRequirementFor('FR', 'BT-99', '2027-01-15')).toBeUndefined();
  });

  it('a country with no content-requirement file at all never has an active requirement', () => {
    expect(activeContentRequirementFor('DE', 'BT-23', '2030-01-01')).toBeUndefined();
  });

  it('an undefined/unparseable issueDate never counts as "already active"', () => {
    expect(activeContentRequirementFor('FR', 'BT-23', undefined)).toBeUndefined();
    expect(activeContentRequirementFor('FR', 'BT-23', 'not-a-date')).toBeUndefined();
  });
});

describe('activeContentRequirementFor — date arithmetic, on an injected fixture catalog', () => {
  const catalog = new ContentRequirementCatalog([
    {
      countryCode: 'ZZ',
      facts: [
        {
          field: 'BT-1',
          mandatedFrom: '2030-06-15',
          provenance: { kind: 'legal', sourceText: 'Fixture legal text.', sourceCheckedAt: '2026-08-31' },
        },
      ],
    },
  ]);

  it('is undefined before the fixture start date', () => {
    expect(activeContentRequirementFor('ZZ', 'BT-1', '2030-06-14', catalog)).toBeUndefined();
  });

  it('is active on and after the fixture start date', () => {
    expect(activeContentRequirementFor('ZZ', 'BT-1', '2030-06-15', catalog)?.field).toBe('BT-1');
    expect(activeContentRequirementFor('ZZ', 'BT-1', '2031-01-01', catalog)?.field).toBe('BT-1');
  });
});
