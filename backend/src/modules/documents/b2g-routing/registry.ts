import { defaultComposedCountryCatalog } from '../countries/registry';
import { B2gRoutingRuleFact } from './schema';
import { byCodeUnit } from '@/lib/compare';

function buildIndex(files: B2gRoutingRuleFact[]): Record<string, B2gRoutingRuleFact> {
  const index: Record<string, B2gRoutingRuleFact> = {};
  for (const f of files) index[f.countryCode.toUpperCase()] = f;
  return index;
}

/**
 * The default catalog content (issue #603 step 5): every country's own `b2gRouting` section from
 * the composed per-country view, instead of this catalog's own `data/all.ts` directly. No import
 * cycle results, because `countries/compose.ts` reads the RAW loader (`b2g-routing/data/all.ts`'s
 * own `ALL_B2G_ROUTING_FILES`), never this registry: see that file's own header. The dependency
 * direction is therefore one-way: this file depends on `countries/registry.ts`, which depends on
 * `countries/compose.ts`, which depends on `b2g-routing/data/all.ts`; nothing depends back on this
 * file from inside that chain, the same shape `vat-rates/registry.ts` (step 2) and
 * `country-fields/registry.ts` (step 3) already proved. `upsertB2gRoutingRules` and
 * `backend/scripts/release-catalogs.ts` both read `defaultB2gRoutingCatalog` below, never
 * `data/all.ts` directly, so neither needs any change for this step: only where the no-argument
 * default reads from moves. A country with no `b2gRouting` section in the composed view is simply
 * left out here, the same "no permissive fallback" this catalog already held when it read
 * `ALL_B2G_ROUTING_FILES` directly.
 */
function b2gRoutingRulesFromComposedCatalog(): B2gRoutingRuleFact[] {
  const files: B2gRoutingRuleFact[] = [];
  for (const countryCode of defaultComposedCountryCatalog.countries()) {
    const rule = defaultComposedCountryCatalog.get(countryCode)?.b2gRouting;
    if (rule) files.push(rule);
  }
  return files;
}

/**
 * In-memory view of the B2G routing files — used ONLY by `boot-upsert.ts` to compute what the
 * `B2gRoutingRule` table should contain. Deliberately NOT read anywhere else: unlike
 * `channel-policy/registry.ts` (read live, at every mandate check), the table this catalog feeds is
 * the one every OTHER reader consults (`b2g-routing.ts`'s own `resolveB2gRoutingRule`) — see that
 * module's own header for why sending must read the DATABASE, never this in-memory view, at request
 * time (multi-instance freshness: every API/worker replica must see the SAME rule the instant ANY of
 * them boots with a newer data file).
 *
 * The constructor still takes a plain `B2gRoutingRuleFact[]` (never the composed catalog itself), so
 * an explicit, smaller list still works exactly as before for every existing caller and test (e.g.
 * `new B2gRoutingCatalog([FR_RULE])`): only the NO-ARGUMENT default changed where it reads from.
 */
export class B2gRoutingCatalog {
  private readonly files: Record<string, B2gRoutingRuleFact>;

  constructor(files: B2gRoutingRuleFact[] = b2gRoutingRulesFromComposedCatalog()) {
    this.files = buildIndex(files);
  }

  /** Every country this catalog has a rule for — sorted, for stable boot-upsert/test iteration order. */
  countries(): string[] {
    return Object.keys(this.files).sort(byCodeUnit);
  }

  ruleFor(countryCode: string): B2gRoutingRuleFact | undefined {
    return this.files[(countryCode ?? '').toUpperCase()];
  }
}

export const defaultB2gRoutingCatalog = new B2gRoutingCatalog();
