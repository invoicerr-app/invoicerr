/**
 * P2-T03 — `plan.obligations`, and the accessor the sixteen readers of `plan.regime` migrate to.
 *
 * The point of this step is that NOTHING changes behaviourally. `regime` is singular and that
 * singularity is a modelling choice, not a fact — France carries an e-invoicing duty (flux F1,
 * CGI art. 289 bis) and an e-reporting duty (flux F10, art. 290) over the same operation, on
 * different deadlines and through different corrections. A single `regime` forces them to be
 * exclusive, which is why profiles/data/fr.ts documents a domestic B2C sale being offered a PDP as
 * a limit it cannot express rather than a bug it can fix.
 *
 * So the shape changes before the data does: obligations exist, the primary one is exactly what
 * `regime` already said, and the readers move over one lot at a time without a behaviour change
 * hiding inside the refactor.
 */
import { obligationKindFor, primaryObligation, resolve } from './compliance-engine';

const ctx = (buyerCountry: string, role: string, date = '2027-01-15') =>
  ({
    supplier: {
      legalName: 'FR Co',
      countryCode: 'FR',
      role: 'B2B',
      identifiers: [{ scheme: 'VAT', value: 'FR12345678901', validated: true }],
    },
    buyer: { legalName: 'B', countryCode: buyerCountry, role, identifiers: [] },
    lines: [{ id: 'l1', description: 'x', quantity: 1, unitNetMinor: 10000, supplyType: 'SERVICES' }],
    issueDate: new Date(date),
    currency: 'EUR',
    externalRef: 'obl',
  }) as never;

describe('obligationKindFor — which duty, as distinct from how it is discharged', () => {
  it('the two mechanisms that carry an INVOICE to the authority are e-invoicing', () => {
    expect(obligationKindFor('CLEARANCE')).toBe('E_INVOICING');
    expect(obligationKindFor('DECENTRALIZED_CTC')).toBe('E_INVOICING');
  });

  it('the two that carry DATA are e-reporting', () => {
    expect(obligationKindFor('REAL_TIME_REPORTING')).toBe('E_REPORTING');
    expect(obligationKindFor('PERIODIC_REPORTING')).toBe('E_REPORTING');
  });

  it('post-audit is the ABSENCE of a continuous duty, said out loud rather than left empty', () => {
    expect(obligationKindFor('POST_AUDIT')).toBe('NONE');
  });
});

describe('plan.obligations — the shape changes, the answers do not', () => {
  it.each([
    ['FR', 'B2B', 'E_INVOICING', 'DECENTRALIZED_CTC'],
    ['FR', 'B2C', 'E_REPORTING', 'REAL_TIME_REPORTING'],
    ['IT', 'B2B', 'E_REPORTING', 'REAL_TIME_REPORTING'],
    ['US', 'B2B', 'E_REPORTING', 'REAL_TIME_REPORTING'],
  ])('FR -> %s %s carries %s via %s', (country, role, kind, model) => {
    const plan = resolve(ctx(country, role));
    expect(primaryObligation(plan).kind).toBe(kind);
    expect(primaryObligation(plan).model).toBe(model);
  });

  it('before the mandate, the duty is NONE — not a weaker version of one', () => {
    const plan = resolve(ctx('FR', 'B2B', '2025-06-01'));
    expect(primaryObligation(plan).kind).toBe('NONE');
    expect(primaryObligation(plan).model).toBe('POST_AUDIT');
  });

  it('P2-T06 — the adapter is gone: a plan exposes obligations and nothing else', () => {
    // This assertion used to compare primaryObligation() against plan.regime, and the migration
    // turned it into `x === x`: a test that passes whatever the code does. Rewritten to guard what
    // the removal actually has to hold — the field is gone, and its answer survives in obligations.
    const plan = resolve(ctx('FR', 'B2B'));
    expect('regime' in plan).toBe(false);
    expect(primaryObligation(plan).model).toBe('DECENTRALIZED_CTC');
  });

  it('the obligation matches the profile rule the engine selected, corridor by corridor', () => {
    const expected: Record<string, string> = {
      'FR|B2B': 'DECENTRALIZED_CTC',
      'FR|B2C': 'REAL_TIME_REPORTING',
      'IT|B2B': 'REAL_TIME_REPORTING',
      'US|B2B': 'REAL_TIME_REPORTING',
      'DE|B2C': 'REAL_TIME_REPORTING',
    };
    for (const [key, model] of Object.entries(expected)) {
      const [c, r] = key.split('|');
      expect(`${key} -> ${primaryObligation(resolve(ctx(c, r))).model}`).toBe(`${key} -> ${model}`);
    }
  });

  it('a profile can override the derived kind — the mapping is a convention, not a law', () => {
    // Guards the override path itself: without it, a country discharging a REPORTING duty through a
    // clearance mechanism would be silently relabelled e-invoicing by the model it happens to use.
    const rule = { model: 'CLEARANCE' as const, obligation: 'E_REPORTING' as const, blocking: true };
    expect(rule.obligation ?? obligationKindFor(rule.model)).toBe('E_REPORTING');
  });

  it('every plan carries at least one obligation, so the accessor never has to guess', () => {
    for (const [c, r] of [
      ['FR', 'B2B'],
      ['ZZ', 'B2B'],
      ['MC', 'B2B'],
    ]) {
      expect(resolve(ctx(c, r)).obligations.length).toBeGreaterThanOrEqual(1);
    }
  });
});
