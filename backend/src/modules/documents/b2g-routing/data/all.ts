/**
 * Issue #603 step 6: the data physically moved to `countries/data/<cc>.json` (one file per country,
 * `b2gRouting` section - the old `{ countryCode, rule }` envelope is gone, the section IS the rule,
 * which already carries its own `countryCode`) - `countries/data/all.ts` is now the only place that
 * reads or validates it, and `registry.ts`'s own default constructor already reads
 * `defaultComposedCountryCatalog` directly, not this array. `ALL_B2G_ROUTING_FILES` below still
 * exists, and still exports the exact same content, purely for the handful of callers that import it
 * directly instead of going through `registry.ts` (`country-readiness.service.ts`,
 * `countries/compose.spec.ts`) - it now DERIVES from the composed catalog rather than reading a file
 * itself, so there is nothing left here to validate: that already happened once, centrally, in
 * `countries/data/all.ts`.
 */
import { defaultComposedCountryCatalog } from '../../countries/registry';
import { B2gRoutingRuleFact } from '../schema';

function b2gRoutingFromComposedCatalog(): B2gRoutingRuleFact[] {
  const files: B2gRoutingRuleFact[] = [];
  for (const countryCode of defaultComposedCountryCatalog.countries()) {
    const b2gRouting = defaultComposedCountryCatalog.get(countryCode)?.b2gRouting;
    if (b2gRouting) files.push(b2gRouting);
  }
  return files;
}

/** Every wired jurisdiction's B2G routing rule, one file per country - see this module's own header. */
export const ALL_B2G_ROUTING_FILES: B2gRoutingRuleFact[] = b2gRoutingFromComposedCatalog();
