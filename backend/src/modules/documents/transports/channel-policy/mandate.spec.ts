/**
 * `activeChannelMandateFor` in isolation — pure function, fixture catalogs only, no company, no
 * Prisma. `actions/invoice-channel-mandate.spec.ts` proves the WIRING (companyId -> countryCode ->
 * this function -> a refused/allowed "send"); this file proves the DATE ARITHMETIC on its own, the
 * same split `country-policy.spec.ts` vs. `schema.spec.ts` already keeps for the sibling module.
 */
import { ChannelPolicyCatalog } from './registry';
import { activeChannelMandateFor } from './mandate';

// `activeChannelMandateFor` reads the SHIPPED, singleton catalog by default — this first block
// exercises it against the real, shipped `fr.json` (item 11's actual data), rather than only ever a
// fixture: a fixture-only suite could stay green even if the shipped file's own `mandatedFrom`
// silently drifted.
describe('activeChannelMandateFor — the real, shipped FR/PDP mandate', () => {
  // MUTATION TARGET: evaluating the mandate against the SERVER's current date instead of `issueDate`
  // would make these two tests either both pass or both fail depending on whatever day the suite
  // happens to run on — replacing `issueDate` with `new Date().toISOString()` inside
  // `activeChannelMandateFor`/`isOnOrAfter` flips this pair from "one before, one after" (proving the
  // decision follows the invoice) to "both follow the clock", visible the moment CI's own date moves
  // past 2026-09-01. See this file's own header and mandate.ts's header for the full reasoning.
  it('is NOT active for an invoice issued the day before mandatedFrom', () => {
    expect(activeChannelMandateFor('FR', '2026-08-31')).toBeUndefined();
  });

  it('IS active for an invoice issued exactly on mandatedFrom', () => {
    const mandate = activeChannelMandateFor('FR', '2026-09-01');
    expect(mandate).toEqual(expect.objectContaining({ providerId: 'pdp', mandatedFrom: '2026-09-01' }));
  });

  it('IS active for an invoice issued well after mandatedFrom', () => {
    expect(activeChannelMandateFor('FR', '2027-01-15')?.providerId).toBe('pdp');
  });

  it('compares a full ISO timestamp issueDate the same way as a bare date', () => {
    expect(activeChannelMandateFor('FR', '2026-09-01T00:00:00.000Z')?.providerId).toBe('pdp');
    expect(activeChannelMandateFor('FR', '2026-08-31T23:59:59.999Z')).toBeUndefined();
  });

  it('a country with no mandated fact at all (PL — still merely "suggested") never has an active mandate', () => {
    expect(activeChannelMandateFor('PL', '2030-01-01')).toBeUndefined();
  });

  it('a country with no channel-policy file at all never has an active mandate', () => {
    expect(activeChannelMandateFor('DE', '2030-01-01')).toBeUndefined();
  });
});

describe('activeChannelMandateFor — date arithmetic, on an injected fixture catalog', () => {
  const catalog = new ChannelPolicyCatalog([
    {
      countryCode: 'ZZ',
      facts: [
        {
          providerId: 'fixture-channel',
          requirement: 'mandated',
          mandatedFrom: '2030-06-15',
          provenance: { kind: 'legal', sourceText: 'Fixture legal text.', sourceCheckedAt: '2026-08-27' },
        },
      ],
    },
  ]);

  it('an issueDate before mandatedFrom: the channel is free (mandate not yet active)', () => {
    expect(activeChannelMandateFor('ZZ', '2030-06-14', catalog)).toBeUndefined();
  });

  it('an issueDate on or after mandatedFrom: the mandate is active, and carries its own provenance', () => {
    expect(activeChannelMandateFor('ZZ', '2030-06-15', catalog)).toEqual({
      providerId: 'fixture-channel',
      mandatedFrom: '2030-06-15',
      provenance: { kind: 'legal', sourceText: 'Fixture legal text.', sourceCheckedAt: '2026-08-27' },
    });
  });

  it('a "suggested" fact for the same country is never treated as a mandate, whatever the issueDate', () => {
    const mixed = new ChannelPolicyCatalog([
      {
        countryCode: 'ZZ',
        facts: [
          {
            providerId: 'other',
            requirement: 'suggested',
            provenance: { kind: 'unverified', resolutionNote: 'x' },
          },
        ],
      },
    ]);
    expect(activeChannelMandateFor('ZZ', '2099-01-01', mixed)).toBeUndefined();
  });

  it('a missing issueDate never activates a mandate — unknown is treated as "not yet", never "already"', () => {
    expect(activeChannelMandateFor('ZZ', undefined, catalog)).toBeUndefined();
  });

  it('an unparseable issueDate never activates a mandate either', () => {
    expect(activeChannelMandateFor('ZZ', 'not-a-date', catalog)).toBeUndefined();
  });
});
