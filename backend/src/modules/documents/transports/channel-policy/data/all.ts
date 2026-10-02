/**
 * Issue #603 step 6: the data physically moved to `countries/data/<cc>.json` (one file per country,
 * `channelPolicy` section) - `countries/data/all.ts` is now the only place that reads or validates
 * it, and `registry.ts`'s own default constructor already reads `defaultComposedCountryCatalog`
 * directly, not this array. `ALL_CHANNEL_POLICY_FILES` below still exists, and still exports the
 * exact same content, purely for the handful of callers that import it directly instead of going
 * through `registry.ts` (`country-readiness.service.ts`, `countries/compose.spec.ts`) - it now
 * DERIVES from the composed catalog rather than reading a file itself, so there is nothing left here
 * to validate: that already happened once, centrally, in `countries/data/all.ts`.
 */
import { defaultComposedCountryCatalog } from '../../../countries/registry';
import { CountryChannelPolicyFile } from '../schema';

function channelPolicyFromComposedCatalog(): CountryChannelPolicyFile[] {
  const files: CountryChannelPolicyFile[] = [];
  for (const countryCode of defaultComposedCountryCatalog.countries()) {
    const channelPolicy = defaultComposedCountryCatalog.get(countryCode)?.channelPolicy;
    if (channelPolicy) files.push(channelPolicy);
  }
  return files;
}

/** Every wired jurisdiction's channel policy, one file per country - see this module's own header. */
export const ALL_CHANNEL_POLICY_FILES: CountryChannelPolicyFile[] = channelPolicyFromComposedCatalog();
