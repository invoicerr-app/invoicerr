import { ALL_CHANNEL_POLICY_FILES } from './data/all';
import { ChannelPolicyFact, CountryChannelPolicyFile } from './schema';

function buildIndex(files: CountryChannelPolicyFile[]): Record<string, CountryChannelPolicyFile> {
  const index: Record<string, CountryChannelPolicyFile> = {};
  for (const f of files) index[f.countryCode.toUpperCase()] = f;
  return index;
}

/**
 * In-memory view of the channel-policy files — read directly at request time by
 * `company/channels/channels.service.ts` (the settings screen) and, via `channel-policy/mandate.ts`,
 * by `invoice-actions.ts`'s "send" preflight — never mirrored into a database the way
 * `CountryPolicyCatalog` is: a `suggested` fact is advisory (see schema.ts's header), and a
 * `mandated` one still costs nothing to re-read straight from these files on every preflight — there
 * is no per-request performance case here the way there is for `country-policy/`'s own
 * per-(country,type,action) rule table, and no `resetAndSeed`-style staleness gap to worry about
 * either (see root TODO item 11's own task brief on this exact choice, and TODO_ISSUES.md's existing
 * note on `country-policy/`'s own reseed gap for the precedent this deliberately avoids repeating).
 */
export class ChannelPolicyCatalog {
  private readonly files: Record<string, CountryChannelPolicyFile>;

  constructor(files: CountryChannelPolicyFile[] = ALL_CHANNEL_POLICY_FILES) {
    this.files = buildIndex(files);
  }

  /** Every fact declared for a country, in file order. Empty for a country with no file at all — the
   *  same "no permissive fallback, no silent guess" discipline `country-policy.ts` holds, scaled down
   *  to an advisory-or-mandated fact instead of an always-blocking one. */
  factsFor(countryCode: string): ChannelPolicyFact[] {
    return this.files[(countryCode ?? '').toUpperCase()]?.facts ?? [];
  }
}

export const defaultChannelPolicyCatalog = new ChannelPolicyCatalog();
