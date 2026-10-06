/**
 * Thin, read-only accessor over the composed per-country view (issue #603, step 1), the same shape
 * every sibling catalog's own `registry.ts` already has (`has()`, `countries()`, a getter), so a
 * LATER step can move an existing catalog's own registry constructor to read
 * `defaultComposedCountryCatalog.get(cc)?.<section>` instead of its own `data/all.ts`, by changing
 * ONLY that constructor's default, the migration `AUDIT_DONNEES_PAYS.md` §3 describes. This PR does
 * not do that for any catalog: nothing in this module is imported from outside `countries/` yet.
 */
import { ALL_COMPOSED_COUNTRIES, ComposedCountryView } from './compose';
import { byCodeUnit } from '@/lib/compare';

function buildIndex(views: ComposedCountryView[]): Record<string, ComposedCountryView> {
  const index: Record<string, ComposedCountryView> = {};
  for (const view of views) index[view.countryCode] = view;
  return index;
}

export class ComposedCountryCatalog {
  private readonly views: Record<string, ComposedCountryView>;

  constructor(views: ComposedCountryView[] = ALL_COMPOSED_COUNTRIES) {
    this.views = buildIndex(views);
  }

  has(countryCode: string): boolean {
    return !!this.views[(countryCode ?? '').toUpperCase()];
  }

  /** Every country code with a composed view, sorted, matching every sibling catalog's own
   *  `countries()`. */
  countries(): string[] {
    return Object.keys(this.views).sort(byCodeUnit);
  }

  /** The composed view for a country, or `undefined` if none of the 14 catalogs has any file for it
   *  at all. The same "no permissive fallback" discipline every sibling catalog's own getter holds. */
  get(countryCode: string): ComposedCountryView | undefined {
    return this.views[(countryCode ?? '').toUpperCase()];
  }
}

export const defaultComposedCountryCatalog = new ComposedCountryCatalog();
