import { ALL_B2G_ROUTING_FILES } from './data/all';
import { B2gRoutingRuleFact } from './schema';

function buildIndex(files: B2gRoutingRuleFact[]): Record<string, B2gRoutingRuleFact> {
  const index: Record<string, B2gRoutingRuleFact> = {};
  for (const f of files) index[f.countryCode.toUpperCase()] = f;
  return index;
}

/**
 * In-memory view of the B2G routing files — used ONLY by `boot-upsert.ts` to compute what the
 * `B2gRoutingRule` table should contain. Deliberately NOT read anywhere else: unlike
 * `channel-policy/registry.ts` (read live, at every mandate check), the table this catalog feeds is
 * the one every OTHER reader consults (`b2g-routing.ts`'s own `resolveB2gRoutingRule`) — see that
 * module's own header for why sending must read the DATABASE, never this in-memory view, at request
 * time (multi-instance freshness: every API/worker replica must see the SAME rule the instant ANY of
 * them boots with a newer data file).
 */
export class B2gRoutingCatalog {
  private readonly files: Record<string, B2gRoutingRuleFact>;

  constructor(files: B2gRoutingRuleFact[] = ALL_B2G_ROUTING_FILES) {
    this.files = buildIndex(files);
  }

  /** Every country this catalog has a rule for — sorted, for stable boot-upsert/test iteration order. */
  countries(): string[] {
    return Object.keys(this.files).sort();
  }

  ruleFor(countryCode: string): B2gRoutingRuleFact | undefined {
    return this.files[(countryCode ?? '').toUpperCase()];
  }
}

export const defaultB2gRoutingCatalog = new B2gRoutingCatalog();
