/**
 * `activeChannelMandateFor` in isolation — pure function, fixture catalogs only, no company, no
 * Prisma. `actions/invoice-channel-mandate.spec.ts` proves the WIRING (companyId -> countryCode ->
 * this function -> a refused/allowed "send"); this file proves the DATE ARITHMETIC on its own, the
 * same split `country-policy.spec.ts` vs. `schema.spec.ts` already keeps for the sibling module.
 */
import { ChannelPolicyCatalog } from './registry';
import { activeChannelMandateFor, activeChannelMandateForOperation } from './mandate';

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

  // The measured defect: a non-UTC OFFSET issueDate ("2026-09-01T00:00:00+02:00") converts, through
  // `getTime()`, to an EARLIER UTC instant than the SAME calendar day's own UTC midnight — an epoch
  // comparison would miss this invoice's own mandate by a full day. Comparing the literal calendar
  // date instead (mandate.ts's own `isOnOrAfter`) must treat this exactly like the bare "2026-09-01"
  // case just above, never like "2026-08-31".
  it('an issueDate carrying an explicit non-UTC offset is judged by its own written calendar day, never shifted to UTC', () => {
    expect(activeChannelMandateFor('FR', '2026-09-01T00:00:00+02:00')?.providerId).toBe('pdp');
    // The day BEFORE mandatedFrom, same offset shape, must still be free — this is not "always active
    // now", it is "the offset itself is never consulted".
    expect(activeChannelMandateFor('FR', '2026-08-31T00:00:00+02:00')).toBeUndefined();
  });

  it(
    'a country with no mandated fact at all (PL — still merely "suggested", even with real legal ' +
      "provenance now — see data/pl.json's own notes for why arming it would refuse still-lawful " +
      'invoices) never has an active mandate',
    () => {
      expect(activeChannelMandateFor('PL', '2030-01-01')).toBeUndefined();
    },
  );

  it('a country with no channel-policy file at all never has an active mandate', () => {
    expect(activeChannelMandateFor('GB', '2030-01-01')).toBeUndefined();
  });

  it(
    'DE and PT each ship a channel-policy file (`facts: []`) but neither establishes a mandate: German ' +
      'law (UStG) regulates FORMAT, not channel, and Portuguese law (Decreto-Lei n.º 28/2019 art. 12.º) ' +
      "leaves electronic transmission itself optional/consensual — see each file's own `notes`. Distinct " +
      'from the GB case above (no file at all): these two DO have files, they just carry no fact to ' +
      'mandate.',
    () => {
      expect(activeChannelMandateFor('DE', '2030-01-01')).toBeUndefined();
      expect(activeChannelMandateFor('PT', '2030-01-01')).toBeUndefined();
    },
  );
});

// `data/it.json`'s own "sdi" fact — armed 2026-09-13, sourced to D.Lgs. 127/2015 art. 1 comma 3 (see
// that file's own `provenance.sourceText`) — went from `requirement: 'suggested'` (blocks nothing) to
// `requirement: 'mandated'`, `mandatedFrom: '2019-01-01'`. THIS is the proof that arming it actually
// changed the function's real, shipped answer for Italy — not merely that the JSON file parses. Same
// "real, shipped catalog" discipline as the FR block above, not a fixture.
describe('activeChannelMandateFor — the real, shipped IT/SdI mandate (armed 2026-09-13)', () => {
  it('IS active for an invoice issued well after mandatedFrom (2019-01-01) — e.g. any invoice dated today', () => {
    const mandate = activeChannelMandateFor('IT', '2026-09-13');
    expect(mandate).toEqual(
      expect.objectContaining({
        providerId: 'sdi',
        mandatedFrom: '2019-01-01',
        provenance: expect.objectContaining({ kind: 'legal' }),
      }),
    );
  });

  it('IS active for an invoice issued exactly on mandatedFrom', () => {
    expect(activeChannelMandateFor('IT', '2019-01-01')?.providerId).toBe('sdi');
  });

  it(
    'is NOT active for an invoice issued the day before mandatedFrom (pre-mandate Italian invoices ' +
      'are unaffected)',
    () => {
      expect(activeChannelMandateFor('IT', '2018-12-31')).toBeUndefined();
    },
  );

  it(
    "does not disturb France's own, independent mandate — the two countries' facts are evaluated " +
      'independently, never cross-contaminated',
    () => {
      expect(activeChannelMandateFor('FR', '2026-09-01')?.providerId).toBe('pdp');
      expect(activeChannelMandateFor('IT', '2026-09-01')?.providerId).toBe('sdi');
    },
  );

  it(
    'carries "sdi-pec" as an equivalentProviderId — the PEC route discharges the SAME mandate as the ' +
      "accredited SDICoop one (see data/it.json's own added note)",
    () => {
      expect(activeChannelMandateFor('IT', '2026-09-13')?.equivalentProviderIds).toEqual(['sdi-pec']);
    },
  );
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

  it('a fact with no equivalentProviderIds at all carries the field through as undefined, not an empty array', () => {
    expect(activeChannelMandateFor('ZZ', '2030-06-15', catalog)?.equivalentProviderIds).toBeUndefined();
  });

  it('a fact WITH equivalentProviderIds carries the exact list through, unmodified', () => {
    const withEquivalents = new ChannelPolicyCatalog([
      {
        countryCode: 'YY',
        facts: [
          {
            providerId: 'primary-channel',
            requirement: 'mandated',
            mandatedFrom: '2030-01-01',
            equivalentProviderIds: ['alt-channel-a', 'alt-channel-b'],
            provenance: { kind: 'legal', sourceText: 'Fixture legal text.', sourceCheckedAt: '2026-08-27' },
          },
        ],
      },
    ]);
    expect(activeChannelMandateFor('YY', '2030-06-01', withEquivalents)?.equivalentProviderIds).toEqual([
      'alt-channel-a',
      'alt-channel-b',
    ]);
  });
});

/**
 * `activeChannelMandateForOperation` - the scope narrowing, against the REAL, SHIPPED catalog. A
 * fixture-only suite would prove nothing about the bug this mechanism exists to fix: what was broken
 * in production is that `data/fr.json`'s own mandate bound an invoice it has no business binding, so
 * the shipped file itself is what has to be asserted on here.
 */
describe('activeChannelMandateForOperation - a national mandate governs DOMESTIC operations only', () => {
  it('FR seller -> FR buyer, on or after 2026-09-01: the PDP mandate binds, exactly as before', () => {
    const mandate = activeChannelMandateForOperation({
      sellerCountryCode: 'FR',
      buyerCountryCode: 'FR',
      issueDate: '2026-09-15',
    });
    expect(mandate?.providerId).toBe('pdp');
    expect(mandate?.scope).toEqual({ parties: 'domestic' });
  });

  it('FR seller -> IT buyer, same date: NO mandate - the French obligation does not reach a buyer established abroad', () => {
    expect(
      activeChannelMandateForOperation({
        sellerCountryCode: 'FR',
        buyerCountryCode: 'IT',
        issueDate: '2026-09-15',
      }),
    ).toBeUndefined();
  });

  it('IT seller -> IT buyer binds, IT seller -> FR buyer does not - the rule is general, never a French special case', () => {
    expect(
      activeChannelMandateForOperation({
        sellerCountryCode: 'IT',
        buyerCountryCode: 'IT',
        issueDate: '2026-09-15',
      })?.providerId,
    ).toBe('sdi');
    expect(
      activeChannelMandateForOperation({
        sellerCountryCode: 'IT',
        buyerCountryCode: 'FR',
        issueDate: '2026-09-15',
      }),
    ).toBeUndefined();
  });

  it('the buyer country is compared case-insensitively and trimmed - "fr " is still France', () => {
    expect(
      activeChannelMandateForOperation({
        sellerCountryCode: 'FR',
        buyerCountryCode: 'fr ',
        issueDate: '2026-09-15',
      })?.providerId,
    ).toBe('pdp');
  });

  it('an UNKNOWN buyer country is treated as domestic - fail-closed, an unresolved client never disarms a mandate', () => {
    expect(
      activeChannelMandateForOperation({ sellerCountryCode: 'FR', issueDate: '2026-09-15' })?.providerId,
    ).toBe('pdp');
  });

  it('the date gate still applies independently of the scope: FR -> FR before 2026-09-01 is free', () => {
    expect(
      activeChannelMandateForOperation({
        sellerCountryCode: 'FR',
        buyerCountryCode: 'FR',
        issueDate: '2026-08-31',
      }),
    ).toBeUndefined();
  });

  it('a mandate with NO scope at all binds every operation, cross border included - the pre-existing default', () => {
    const unscoped = new ChannelPolicyCatalog([
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
    expect(
      activeChannelMandateForOperation(
        { sellerCountryCode: 'ZZ', buyerCountryCode: 'YY', issueDate: '2030-06-15' },
        unscoped,
      )?.providerId,
    ).toBe('fixture-channel');
  });

  it('the country-level `activeChannelMandateFor` is deliberately UNCHANGED - the settings screen still sees the mandate', () => {
    // The two functions answer different questions on purpose (see `mandate.ts`'s own headers):
    // "does this country mandate a channel" (settings screen, buyer-blind) versus "does that mandate
    // bind THIS invoice" (send preflight). This assertion is the guard against someone "fixing" the
    // first one by folding the narrowing into it, which would quietly stop telling a French company
    // to connect its PDP at all.
    expect(activeChannelMandateFor('FR', '2026-09-15')?.providerId).toBe('pdp');
  });
});
