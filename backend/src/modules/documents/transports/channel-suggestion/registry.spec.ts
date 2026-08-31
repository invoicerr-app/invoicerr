/**
 * The channel-suggestion mechanism itself — item 10's "le pays suggère son canal" requirement, read
 * as DATA (this spec proves it, never a hard-coded `if country === 'FR'` anywhere in the product
 * code the way the task brief demands).
 */
import { assertValidChannelSuggestion, InvalidChannelSuggestionProvenanceError } from './schema';
import { ALL_CHANNEL_SUGGESTION_FILES } from './data/all';
import { ChannelSuggestionCatalog, defaultChannelSuggestionCatalog } from './registry';

describe('channel suggestion files — loaded, not hard-coded', () => {
  it('FR suggests the "pdp" provider — a fact read from data/fr.json, not a branch in code', () => {
    expect(defaultChannelSuggestionCatalog.suggestionsFor('FR')).toEqual([
      { providerId: 'pdp', provenance: expect.objectContaining({ kind: 'unverified' }) },
    ]);
  });

  it('lower-cased or absent country codes never crash — no suggestion, not a throw', () => {
    expect(defaultChannelSuggestionCatalog.suggestionsFor('fr')).toEqual(
      defaultChannelSuggestionCatalog.suggestionsFor('FR'),
    );
    expect(defaultChannelSuggestionCatalog.suggestionsFor('')).toEqual([]);
  });

  it('a country with no file at all gets no suggestion — no permissive fallback', () => {
    expect(defaultChannelSuggestionCatalog.suggestionsFor('DE')).toEqual([]);
    expect(defaultChannelSuggestionCatalog.suggestionsFor('US')).toEqual([]);
  });

  it('every shipped file has already passed provenance validation at load time', () => {
    expect(ALL_CHANNEL_SUGGESTION_FILES.length).toBeGreaterThan(0);
    for (const file of ALL_CHANNEL_SUGGESTION_FILES) {
      for (const fact of file.suggestions) {
        expect(() => assertValidChannelSuggestion(fact, 'test')).not.toThrow();
      }
    }
  });

  it('a custom catalog built from an unsourced fixture is what the assert actually rejects', () => {
    expect(() =>
      assertValidChannelSuggestion({ providerId: 'pdp', provenance: {} as never }, 'fixture'),
    ).toThrow(InvalidChannelSuggestionProvenanceError);
  });

  it('an "unverified" suggestion with no resolutionNote is rejected the same way', () => {
    expect(() =>
      assertValidChannelSuggestion(
        { providerId: 'pdp', provenance: { kind: 'unverified', resolutionNote: '  ' } },
        'fixture',
      ),
    ).toThrow(InvalidChannelSuggestionProvenanceError);
  });

  it('a bespoke catalog (constructor injection) is independent of the shipped one', () => {
    const custom = new ChannelSuggestionCatalog([
      {
        countryCode: 'DE',
        suggestions: [
          { providerId: 'xrechnung', provenance: { kind: 'unverified', resolutionNote: 'test fixture' } },
        ],
      },
    ]);
    expect(custom.suggestionsFor('DE')).toEqual([
      { providerId: 'xrechnung', provenance: { kind: 'unverified', resolutionNote: 'test fixture' } },
    ]);
    expect(custom.suggestionsFor('FR')).toEqual([]); // the shipped fr.json is NOT implicitly merged in
  });
});
