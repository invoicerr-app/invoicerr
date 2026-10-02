import { defaultComposedCountryCatalog } from '../../countries/registry';
import { ChannelPolicyFact, CountryChannelPolicyFile } from './schema';

function buildIndex(files: CountryChannelPolicyFile[]): Record<string, CountryChannelPolicyFile> {
  const index: Record<string, CountryChannelPolicyFile> = {};
  for (const f of files) index[f.countryCode.toUpperCase()] = f;
  return index;
}

/**
 * The default catalog content (issue #603 step 4): every country's own `channelPolicy` section from
 * the composed per-country view, instead of this catalog's own `data/all.ts` directly. No import
 * cycle results, because `countries/compose.ts` reads the RAW loader
 * (`transports/channel-policy/data/all.ts`'s own `ALL_CHANNEL_POLICY_FILES`), never this registry:
 * see that file's own header. The dependency direction is therefore one-way: this file depends on
 * `countries/registry.ts`, which depends on `countries/compose.ts`, which depends on
 * `transports/channel-policy/data/all.ts`; nothing depends back on this file from inside that chain.
 * A country with no `channelPolicy` section in the composed view is simply left out here, the same
 * "no permissive fallback" this catalog already held when it read `ALL_CHANNEL_POLICY_FILES`
 * directly.
 */
function channelPolicyFromComposedCatalog(): CountryChannelPolicyFile[] {
  const files: CountryChannelPolicyFile[] = [];
  for (const countryCode of defaultComposedCountryCatalog.countries()) {
    const channelPolicy = defaultComposedCountryCatalog.get(countryCode)?.channelPolicy;
    if (channelPolicy) files.push(channelPolicy);
  }
  return files;
}

/**
 * In-memory view of the channel-policy files — read directly at request time by
 * `company/channels/channels.service.ts` (the settings screen) and, via `channel-policy/mandate.ts`,
 * by `invoice-actions.ts`'s "send" preflight — never mirrored into a database the way
 * `CountryPolicyCatalog` is: a `suggested` fact is advisory (see schema.ts's header), and a
 * `mandated` one still costs nothing to re-read straight from these files on every preflight — there
 * is no per-request performance case here the way there is for `country-policy/`'s own
 * per-(country,type,action) rule table, and no `resetAndSeed`-style staleness gap to worry about
 * either (see `country-policy/`'s own reseed gap for the precedent
 * this deliberately avoids repeating).
 *
 * The constructor still takes a plain `CountryChannelPolicyFile[]` (never the composed catalog
 * itself), so an explicit, smaller list still works exactly as before for every existing caller and
 * test (e.g. `new ChannelPolicyCatalog([FR_FILE])`): only the NO-ARGUMENT default changed where it
 * reads from.
 */
export class ChannelPolicyCatalog {
  private readonly files: Record<string, CountryChannelPolicyFile>;

  constructor(files: CountryChannelPolicyFile[] = channelPolicyFromComposedCatalog()) {
    this.files = buildIndex(files);
  }

  /** Every fact declared for a country, in file order. Empty for a country with no file at all — the
   *  same "no permissive fallback, no silent guess" discipline `country-policy.ts` holds, scaled down
   *  to an advisory-or-mandated fact instead of an always-blocking one. */
  factsFor(countryCode: string): ChannelPolicyFact[] {
    return this.files[(countryCode ?? '').toUpperCase()]?.facts ?? [];
  }

  /**
   * Issue #527 - every country's file, in the same (sorted-by-code) order `data/all.ts` loaded them.
   * Added for the channels settings screen's own "legal channel, then operator" grouping
   * (`channels.service.ts#legalChannels`): it needs to say, for a legal channel that is NOT this
   * company's own country's fact, WHICH other country's law actually names it - e.g. "sdi is Italy's
   * own mandate" shown to a French company - which a single-country `factsFor` cannot answer alone.
   * Never used by `mandate.ts`'s own preflight (that stays scoped to exactly one country, the seller's).
   */
  all(): CountryChannelPolicyFile[] {
    return Object.values(this.files);
  }
}

export const defaultChannelPolicyCatalog = new ChannelPolicyCatalog();
