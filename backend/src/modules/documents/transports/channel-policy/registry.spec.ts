/**
 * The channel-policy mechanism itself — the "the country suggests its channel" requirement, PLUS
 * "a country file makes one mandatory" — read as DATA (this spec proves it, never a
 * hard-coded `if country === 'FR'` anywhere in the product code).
 */
import { assertValidChannelPolicyFact, InvalidChannelPolicyProvenanceError } from './schema';
import { ALL_CHANNEL_POLICY_FILES } from './data/all';
import { ChannelPolicyCatalog, defaultChannelPolicyCatalog } from './registry';

describe('channel policy files — loaded, not hard-coded', () => {
  it('FR mandates the "pdp" provider from 2026-09-01 — a fact read from data/fr.json, not a branch in code', () => {
    expect(defaultChannelPolicyCatalog.factsFor('FR')).toEqual([
      expect.objectContaining({
        providerId: 'pdp',
        requirement: 'mandated',
        mandatedFrom: '2026-09-01',
        provenance: expect.objectContaining({ kind: 'legal' }),
      }),
    ]);
  });

  it('PL suggests (never mandates) the "ksef" provider — a fact read from data/pl.json, now sourced to the real statute (art. 106ga ust. 1) even though it stays "suggested"', () => {
    expect(defaultChannelPolicyCatalog.factsFor('PL')).toEqual([
      expect.objectContaining({
        providerId: 'ksef',
        requirement: 'suggested',
        provenance: expect.objectContaining({ kind: 'legal' }),
      }),
    ]);
  });

  it('IT MANDATES the "sdi" provider from 2019-01-01 — a fact read from data/it.json, sourced to D.Lgs. 127/2015 art. 1 comma 3', () => {
    expect(defaultChannelPolicyCatalog.factsFor('IT')).toEqual([
      expect.objectContaining({
        providerId: 'sdi',
        requirement: 'mandated',
        mandatedFrom: '2019-01-01',
        provenance: expect.objectContaining({ kind: 'legal' }),
      }),
    ]);
  });

  // BE (suggested "peppol", REAL legal citation) and RO (mandated "anaf", the same unconditional
  // shape as FR's own mandate) were removed by the 5-country prune (2026-09-10)
  // along with their data/xx.json. FR and IT are now both "mandated" + "legal" (pinned above); PL
  // is "suggested" + "legal" (also pinned above, since primary text now grounds the KSeF entry too
  // — see that file's own `notes` for why "suggested" was kept anyway: `mandatedFrom` can only ever
  // be a single date, and the real statute's own transitional articles (145l/145m) make a single
  // date wrong for most taxpayers).

  it('lower-cased or absent country codes never crash — no fact, not a throw', () => {
    expect(defaultChannelPolicyCatalog.factsFor('fr')).toEqual(defaultChannelPolicyCatalog.factsFor('FR'));
    expect(defaultChannelPolicyCatalog.factsFor('')).toEqual([]);
  });

  it('a country with no file at all gets no fact — no permissive fallback, and no mandate either', () => {
    expect(defaultChannelPolicyCatalog.factsFor('GB')).toEqual([]);
    expect(defaultChannelPolicyCatalog.factsFor('US')).toEqual([]);
  });

  it(
    'DE and PT now HAVE a channel-policy file each (added once the five-country catalog gap was closed) ' +
      'but both ship `facts: []` — German law (UStG § 14/§ 27 Abs. 38) mandates a FORMAT, never a channel, ' +
      'and Portuguese law (Decreto-Lei n.º 28/2019 art. 12.º) leaves electronic transmission itself ' +
      "consensual/optional; see each file's own `notes` for the sourced legal reasoning. A file that " +
      'exists with zero facts is NOT the same thing as no file at all (the case above): the difference ' +
      "is invisible to `factsFor()`'s return value, but very much intended and visible in " +
      "`data/all.spec.ts` (both files are now discovered) and in each file's own `notes`.",
    () => {
      expect(defaultChannelPolicyCatalog.factsFor('DE')).toEqual([]);
      expect(defaultChannelPolicyCatalog.factsFor('PT')).toEqual([]);
    },
  );

  it('every shipped file has already passed provenance validation at load time', () => {
    expect(ALL_CHANNEL_POLICY_FILES.length).toBeGreaterThan(0);
    for (const file of ALL_CHANNEL_POLICY_FILES) {
      for (const fact of file.facts) {
        expect(() => assertValidChannelPolicyFact(fact, 'test')).not.toThrow();
      }
    }
  });

  it('a custom catalog built from an unsourced fixture is what the assert actually rejects', () => {
    expect(() =>
      assertValidChannelPolicyFact(
        { providerId: 'pdp', requirement: 'suggested', provenance: {} as never },
        'fixture',
      ),
    ).toThrow(InvalidChannelPolicyProvenanceError);
  });

  it('an "unverified" fact with no resolutionNote is rejected the same way', () => {
    expect(() =>
      assertValidChannelPolicyFact(
        {
          providerId: 'pdp',
          requirement: 'suggested',
          provenance: { kind: 'unverified', resolutionNote: '  ' },
        },
        'fixture',
      ),
    ).toThrow(InvalidChannelPolicyProvenanceError);
  });

  // The mutation this exact test is written to catch: a `mandated` fact that
  // manages to load with anything less than a real ('legal') citation would mean this product could
  // claim "the law requires this channel" on an unverified guess. See schema.ts's own header.
  it('a "mandated" fact with "unverified" provenance is REJECTED at load — a mandate must be sourced', () => {
    expect(() =>
      assertValidChannelPolicyFact(
        {
          providerId: 'pdp',
          requirement: 'mandated',
          mandatedFrom: '2026-09-01',
          provenance: { kind: 'unverified', resolutionNote: 'not actually checked' },
        },
        'fixture',
      ),
    ).toThrow(/must carry a real citation/);
  });

  it('a "mandated" fact with no "mandatedFrom" is REJECTED at load', () => {
    expect(() =>
      assertValidChannelPolicyFact(
        {
          providerId: 'pdp',
          requirement: 'mandated',
          provenance: { kind: 'legal', sourceText: 'Some exact legal text.', sourceCheckedAt: '2026-08-27' },
        },
        'fixture',
      ),
    ).toThrow(/no "mandatedFrom" date/);
  });

  it('a well-formed "mandated" fact (legal provenance + mandatedFrom) loads fine', () => {
    expect(() =>
      assertValidChannelPolicyFact(
        {
          providerId: 'pdp',
          requirement: 'mandated',
          mandatedFrom: '2026-09-01',
          provenance: { kind: 'legal', sourceText: 'Some exact legal text.', sourceCheckedAt: '2026-08-27' },
        },
        'fixture',
      ),
    ).not.toThrow();
  });

  it('a fact with no valid "requirement" is rejected', () => {
    expect(() =>
      assertValidChannelPolicyFact(
        {
          providerId: 'pdp',
          requirement: 'mandatory' as never,
          provenance: { kind: 'unverified', resolutionNote: 'x' },
        },
        'fixture',
      ),
    ).toThrow(/no valid "requirement"/);
  });

  it('a bespoke catalog (constructor injection) is independent of the shipped one', () => {
    const custom = new ChannelPolicyCatalog([
      {
        countryCode: 'DE',
        facts: [
          {
            providerId: 'xrechnung',
            requirement: 'suggested',
            provenance: { kind: 'unverified', resolutionNote: 'test fixture' },
          },
        ],
      },
    ]);
    expect(custom.factsFor('DE')).toEqual([
      {
        providerId: 'xrechnung',
        requirement: 'suggested',
        provenance: { kind: 'unverified', resolutionNote: 'test fixture' },
      },
    ]);
    expect(custom.factsFor('FR')).toEqual([]); // the shipped fr.json is NOT implicitly merged in
  });
});
