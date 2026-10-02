/**
 * Issue #603 step 6: the data physically moved to `countries/data/<cc>.json` (one file per country,
 * `policy` section) - `countries/data/all.ts` is now the only place that reads or validates it, and
 * `registry.ts`'s own default constructor already reads `defaultComposedCountryCatalog` directly, not
 * this array. `ALL_COUNTRY_POLICY_FILES` below still exists, and still exports the exact same
 * content, purely for the handful of callers that import it directly instead of going through
 * `registry.ts` (`country-readiness.service.ts`, `data/numbering.spec.ts`,
 * `countries/compose.spec.ts`) - it now DERIVES from the composed catalog rather than reading a file
 * itself, so there is nothing left here to validate: that already happened once, centrally, in
 * `countries/data/all.ts`.
 */
import { defaultComposedCountryCatalog } from '../../countries/registry';
import { CountryDocumentPolicyFile } from '../schema';

function policyFromComposedCatalog(): CountryDocumentPolicyFile[] {
  const files: CountryDocumentPolicyFile[] = [];
  for (const countryCode of defaultComposedCountryCatalog.countries()) {
    const policy = defaultComposedCountryCatalog.get(countryCode)?.policy;
    if (policy) files.push(policy);
  }
  return files;
}

/** Every wired jurisdiction's document-action policy, one file per country - see this module's own
 *  header. A country with NO entry here has no rules at all, which is precisely the "blocks
 *  everything" state country-policy.ts's evaluateCountryPolicy() enforces. */
export const ALL_COUNTRY_POLICY_FILES: CountryDocumentPolicyFile[] = policyFromComposedCatalog();
