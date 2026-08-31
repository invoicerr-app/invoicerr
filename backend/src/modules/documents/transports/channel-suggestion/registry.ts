import { ALL_CHANNEL_SUGGESTION_FILES } from './data/all';
import { ChannelSuggestionFact, CountryChannelSuggestionFile } from './schema';

function buildIndex(files: CountryChannelSuggestionFile[]): Record<string, CountryChannelSuggestionFile> {
  const index: Record<string, CountryChannelSuggestionFile> = {};
  for (const f of files) index[f.countryCode.toUpperCase()] = f;
  return index;
}

/**
 * In-memory view of the channel-suggestion files — read directly at request time by
 * `company/channels/channels.service.ts`, never mirrored into the database (unlike
 * `CountryPolicyCatalog`): a suggestion is advisory, not something `resetAndSeed`'s own gap
 * (documented in TODO_ISSUES.md — country policy needs a manual reseed after a JSON edit) could ever
 * make a company wrongly blocked on, so there is nothing here worth the seed machinery buys
 * `country-policy/`.
 */
export class ChannelSuggestionCatalog {
  private readonly files: Record<string, CountryChannelSuggestionFile>;

  constructor(files: CountryChannelSuggestionFile[] = ALL_CHANNEL_SUGGESTION_FILES) {
    this.files = buildIndex(files);
  }

  /** Every suggestion declared for a country, in file order. Empty for a country with no file at
   *  all — the same "no permissive fallback, no silent guess" discipline `country-policy.ts` holds,
   *  scaled down to an advisory fact instead of a blocking one. */
  suggestionsFor(countryCode: string): ChannelSuggestionFact[] {
    return this.files[(countryCode ?? '').toUpperCase()]?.suggestions ?? [];
  }
}

export const defaultChannelSuggestionCatalog = new ChannelSuggestionCatalog();
