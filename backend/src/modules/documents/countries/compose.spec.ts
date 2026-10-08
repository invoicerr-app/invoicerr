/**
 * Proves `compose.ts` is a pure, non-mutating pass-through of `./data/all.ts`'s own
 * `ALL_COMPOSED_COUNTRY_FILES` (issue #603 step 6 - see this directory's own `data/all.spec.ts` for
 * the actual load-and-validate proof against the real `countries/data/*.json` files; this file stays
 * scoped to compose.ts's own narrow job, the same split it has always held between loading and
 * composing). The pinned coverage matrix below is the test the brief calls "a test lists which
 * countries have which sections, so a missing or extra section is visible" - unaffected by WHERE the
 * data physically lives, since it only asserts over the already-composed result.
 */
import { ALL_COMPOSED_COUNTRY_FILES } from './data/all';
import { ALL_COMPOSED_COUNTRIES, ComposedCountryView, COMPOSED_COUNTRY_SECTION_KEYS } from './compose';

function composedFor(countryCode: string): ComposedCountryView {
  const view = ALL_COMPOSED_COUNTRIES.find((v) => v.countryCode === countryCode);
  if (!view) throw new Error(`No composed view for "${countryCode}": compose.ts is broken.`);
  return view;
}

describe('countries/compose: a pure pass-through of data/all.ts, never a copy or a second load', () => {
  it('carries every country data/all.ts loaded, same objects, same count', () => {
    expect(ALL_COMPOSED_COUNTRIES.length).toBe(ALL_COMPOSED_COUNTRY_FILES.length);
    for (const file of ALL_COMPOSED_COUNTRY_FILES) {
      expect(ALL_COMPOSED_COUNTRIES).toContain(file); // same reference, not a deep-equal copy
    }
  });

  it('is sorted by countryCode', () => {
    const codes = ALL_COMPOSED_COUNTRIES.map((v) => v.countryCode);
    expect(codes).toEqual([...codes].sort());
  });
});

// Pinned by hand on purpose (2026-10-01, issue #603 step 1; re-verified step 6, 2026-10-02, against
// the new single `countries/data/<cc>.json` files rather than the 14 old directories). A catalog that
// ships a new country's section, or drops one, must change this table in the SAME pull request as the
// data change. A silent diff here is exactly the failure mode this test exists to catch.
describe('countries/compose: section coverage per country (pinned on purpose, see comment above)', () => {
  it('matches the shipped data, country by country', () => {
    const matrix: Record<string, (keyof Omit<ComposedCountryView, 'countryCode'>)[]> = {};
    for (const view of ALL_COMPOSED_COUNTRIES) {
      matrix[view.countryCode] = COMPOSED_COUNTRY_SECTION_KEYS.filter((key) => view[key] !== undefined);
    }

    expect(matrix).toEqual({
      DE: [
        'policy',
        'identifiers',
        'correctionRoutes',
        'vatRates',
        'taxSystem',
        'vatCurrency',
        'channelPolicy',
        'retention',
        'localizedMentions',
        'domesticReverseCharge',
        'countryFields',
        'b2gRouting',
      ],
      DZ: [
        'policy',
        'identifiers',
        'correctionRoutes',
        'vatRates',
        'taxSystem',
        'channelPolicy',
        'retention',
      ],
      FR: [
        'policy',
        'identifiers',
        'correctionRoutes',
        'vatRates',
        'taxSystem',
        'vatCurrency',
        'channelPolicy',
        'retention',
        'mentions',
        'localizedMentions',
        'reporting',
        'domesticReverseCharge',
        'countryFields',
        'contentRequirements',
        'b2gRouting',
        'paymentTerms',
      ],
      IT: [
        'policy',
        'identifiers',
        'correctionRoutes',
        'vatRates',
        'taxSystem',
        'vatCurrency',
        'channelPolicy',
        'localizedMentions',
        'domesticReverseCharge',
        'countryFields',
        'b2gRouting',
      ],
      PL: [
        'policy',
        'identifiers',
        'correctionRoutes',
        'vatRates',
        'taxSystem',
        'vatCurrency',
        'channelPolicy',
        'retention',
        'localizedMentions',
        'countryFields',
        'b2gRouting',
      ],
      PT: [
        'policy',
        'identifiers',
        'correctionRoutes',
        'vatRates',
        'taxSystem',
        'vatCurrency',
        'channelPolicy',
        'retention',
        'localizedMentions',
        'reporting',
        'domesticReverseCharge',
        'countryFields',
        'b2gRouting',
      ],
    });
  });

  it('every one of the six shipped countries has at least a policy section (the minimum to be "supported" at all)', () => {
    for (const code of ['DE', 'DZ', 'FR', 'IT', 'PL', 'PT']) {
      expect(composedFor(code).policy).toBeDefined();
    }
  });
});
