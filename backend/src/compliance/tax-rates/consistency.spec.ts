/**
 * The guard against this catalog becoming a second, contradicting tax authority (schema.ts's module
 * docstring). `tax-engine.ts` never reads this catalog — it reads `CountryComplianceProfile.taxSystem`
 * — so the only thing keeping the two aligned is this test. If either file changes without the
 * other, this fails loudly instead of shipping a VAT rate picker that offers a number the engine
 * would never actually charge.
 */
import { defaultRegistry } from '../profiles/registry';
import { VatSystemSpec } from '../profiles/schema';
import { defaultVatRateCatalog } from './registry';

const CATALOG_COUNTRIES = ['FR', 'IT', 'PL', 'MX'];

function vatSystemOf(countryCode: string): VatSystemSpec {
  const { profile } = defaultRegistry.resolve(countryCode);
  const sys = profile.taxSystem;
  if (sys.kind !== 'VAT' && sys.kind !== 'GST') {
    throw new Error(
      `${countryCode}: expected a VAT/GST profile for a country the catalog covers, got ${sys.kind}`,
    );
  }
  return sys;
}

describe('VAT rate catalog — consistency with tax-engine.ts', () => {
  it('covers exactly the countries the task asked to start with', () => {
    expect(defaultVatRateCatalog.countries()).toEqual(['FR', 'IT', 'MX', 'PL']);
  });

  it.each(
    CATALOG_COUNTRIES,
  )('%s: the current STANDARD catalog entry equals taxSystem.standardRate exactly', (cc) => {
    const sys = vatSystemOf(cc);
    const current = defaultVatRateCatalog.ratesAt(cc, new Date());
    const standard = current.find((r) => r.category === 'STANDARD');
    expect(standard).toBeDefined();
    expect(standard?.rate).toBe(sys.standardRate);
  });

  it.each(CATALOG_COUNTRIES)(
    '%s: every non-EXEMPT current catalog rate is one the engine actually knows about ' +
      '(standardRate or reducedRates) — a catalog entry the engine would never charge is a bug',
    (cc) => {
      const sys = vatSystemOf(cc);
      const engineRates = new Set<number>([sys.standardRate, ...(sys.reducedRates ?? [])]);
      const current = defaultVatRateCatalog.ratesAt(cc, new Date());
      for (const entry of current) {
        if (entry.category === 'EXEMPT') continue; // e.g. FR franchise-en-base — a regime, not a rate-table entry
        expect(engineRates.has(entry.rate)).toBe(true);
      }
    },
  );

  it('PL zero-rate entry is only offered where the engine agrees the country has one', () => {
    const sys = vatSystemOf('PL');
    const zero = defaultVatRateCatalog.ratesAt('PL', new Date()).find((r) => r.category === 'ZERO');
    if (zero) {
      expect(sys.hasDomesticZeroRate).toBe(true);
    }
  });
});
