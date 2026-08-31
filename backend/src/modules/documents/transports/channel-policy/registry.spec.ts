/**
 * The channel-policy mechanism itself — item 10's "le pays suggère son canal" requirement, PLUS item
 * 11's "un fichier pays en rend un obligatoire" — read as DATA (this spec proves it, never a
 * hard-coded `if country === 'FR'` anywhere in the product code the way the task brief demands).
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

  it('PL suggests (never mandates) the "ksef" provider — item 10, wave 2, a fact read from data/pl.json', () => {
    expect(defaultChannelPolicyCatalog.factsFor('PL')).toEqual([
      expect.objectContaining({
        providerId: 'ksef',
        requirement: 'suggested',
        provenance: expect.objectContaining({ kind: 'unverified' }),
      }),
    ]);
  });

  it('IT suggests (never mandates) the "sdi" provider — item 10, wave 2, a fact read from data/it.json', () => {
    expect(defaultChannelPolicyCatalog.factsFor('IT')).toEqual([
      expect.objectContaining({
        providerId: 'sdi',
        requirement: 'suggested',
        provenance: expect.objectContaining({ kind: 'unverified' }),
      }),
    ]);
  });

  it('lower-cased or absent country codes never crash — no fact, not a throw', () => {
    expect(defaultChannelPolicyCatalog.factsFor('fr')).toEqual(defaultChannelPolicyCatalog.factsFor('FR'));
    expect(defaultChannelPolicyCatalog.factsFor('')).toEqual([]);
  });

  it('a country with no file at all gets no fact — no permissive fallback, and no mandate either', () => {
    expect(defaultChannelPolicyCatalog.factsFor('DE')).toEqual([]);
    expect(defaultChannelPolicyCatalog.factsFor('US')).toEqual([]);
  });

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

  // Root TODO item 11 — the mutation this exact test is written to catch: a `mandated` fact that
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
