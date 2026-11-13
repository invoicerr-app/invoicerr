/**
 * The v2 catalog API (issue #767), pinned against the legacy catalog on the shipped files: every v2
 * query must name exactly the obligations its legacy counterpart names facts for, so switching a
 * consumer over is a behaviour-preserving change. Country codes appear here only as test data.
 */
import { ALL_REPORTING_OBLIGATION_FILES } from './data/all';
import { defaultReportingObligationCatalogV2, ReportingObligationCatalogV2 } from './obligation-catalog';
import {
  CountryReportingObligationFileV2,
  InvalidReportingObligationError,
  LegacyReportingUpgradeError,
  ReportingObligation,
  upgradeLegacyFacts,
} from './obligation-v2';
import { defaultReportingObligationCatalog, reportingObligationsFromComposedCatalog } from './registry';
import { ReportableDocumentType, ReportingObligationFact } from './schema';

const DOCUMENT_TYPES: ReportableDocumentType[] = ['invoice', 'credit-note'];
const legacy = defaultReportingObligationCatalog;
const v2 = defaultReportingObligationCatalogV2;

/** The ids the upgrade gives these legacy facts, in order. */
function idsOf(countryCode: string, facts: ReportingObligationFact[]): string[] {
  return upgradeLegacyFacts({ countryCode, facts }).obligations.map((o) => o.id);
}
const ids = (obligations: ReportingObligation[]) => obligations.map((o) => o.id);

describe('ReportingObligationCatalogV2: pinned against the legacy catalog on the shipped files', () => {
  const countries = reportingObligationsFromComposedCatalog().map((f) => f.countryCode.toUpperCase());

  it('loads every shipped country, and only those', () => {
    expect(countries.length).toBeGreaterThan(0);
    expect(v2.countries()).toEqual(countries);
    expect(v2.countries().sort()).toEqual(ALL_REPORTING_OBLIGATION_FILES.map((f) => f.countryCode).sort());
  });

  it.each(
    countries,
  )('%s: obligationsFor lists the same entries as factsFor, in file order', (countryCode) => {
    const facts = legacy.factsFor(countryCode);
    expect(facts.length).toBeGreaterThan(0);
    expect(ids(v2.obligationsFor(countryCode))).toEqual(idsOf(countryCode, facts));
  });

  it.each(
    countries.flatMap((c) => DOCUMENT_TYPES.map((t) => [c, t] as const)),
  )('%s / %s: providerObligationsFor and unscopedProviderObligationFor match their legacy counterparts', (countryCode, typeId) => {
    expect(ids(v2.providerObligationsFor(countryCode, typeId))).toEqual(
      idsOf(countryCode, legacy.providerFactsFor(countryCode, typeId)),
    );
    const fact = legacy.obligationFor(countryCode, typeId);
    const obligation = v2.unscopedProviderObligationFor(countryCode, typeId);
    expect(obligation?.id).toBe(fact ? idsOf(countryCode, [fact])[0] : undefined);
    if (obligation) expect(ReportingObligationCatalogV2.providerChannelId(obligation)).toBe(fact?.providerId);
  });

  it.each(
    countries.flatMap((c) =>
      legacy
        .factsFor(c)
        .filter((f) => f.dischargedBy === 'provider')
        .map((f) => [f.providerId, f.appliesTo] as const),
    ),
  )('provider %s / %s: obligationsForProvider matches factsForProvider', (providerId, typeId) => {
    // A legacy id does not depend on the country, so the provider's facts upgrade under any code.
    const facts = legacy.factsForProvider(providerId, typeId);
    expect(facts.length).toBeGreaterThan(0);
    const expected = upgradeLegacyFacts({ countryCode: 'XX', facts }).obligations.map((o) => o.id);
    expect(ids(v2.obligationsForProvider(providerId, typeId))).toEqual(expected);
  });

  it('a transport-discharged obligation is never a provider obligation', () => {
    for (const countryCode of countries) {
      for (const typeId of DOCUMENT_TYPES) {
        for (const obligation of v2.providerObligationsFor(countryCode, typeId)) {
          expect(obligation.channels.some((c) => c.dischargedBy === 'provider')).toBe(true);
        }
      }
    }
  });

  it('a country with no section, an absent code or a lower-cased code never crashes', () => {
    const [first] = countries;
    expect(v2.obligationsFor(first.toLowerCase())).toEqual(v2.obligationsFor(first));
    expect(v2.obligationsFor('ZZ')).toEqual([]);
    expect(v2.obligationsFor(undefined)).toEqual([]);
    expect(v2.providerObligationsFor(undefined, 'invoice')).toEqual([]);
    expect(v2.unscopedProviderObligationFor('', 'invoice')).toBeUndefined();
    expect(v2.obligationsForProvider('no-such-provider', 'invoice')).toEqual([]);
  });

  it('obligation(country, id) finds each obligation by its id, and nothing for an unknown id', () => {
    for (const countryCode of countries) {
      for (const obligation of v2.obligationsFor(countryCode)) {
        expect(v2.obligation(countryCode, obligation.id)).toBe(obligation);
      }
      expect(v2.obligation(countryCode, 'no-such-id')).toBeUndefined();
    }
  });
});

describe('ReportingObligationCatalogV2: sources', () => {
  const provenance = { kind: 'unverified' as const, resolutionNote: 'test fixture' };
  const v2File: CountryReportingObligationFileV2 = {
    countryCode: 'ZZ',
    obligations: [
      {
        id: 'zz-summary',
        authority: { countryCode: 'ZZ' },
        kind: 'summary',
        trigger: 'period-end',
        scope: { documentTypes: ['invoice', 'credit-note'] },
        legalBasis: { provenance },
        timing: { period: 'quarter' },
        channels: [
          { dischargedBy: 'export', id: 'zz-file', unit: 'period' },
          { dischargedBy: 'provider', id: 'zz-api', unit: 'period' },
        ],
      },
    ],
  };

  it('accepts a v2 section as it is, after validating it', () => {
    const catalog = new ReportingObligationCatalogV2([v2File]);
    expect(catalog.countries()).toEqual(['ZZ']);
    expect(ids(catalog.providerObligationsFor('ZZ', 'credit-note'))).toEqual(['zz-summary']);
    expect(ids(catalog.obligationsForProvider('zz-api', 'invoice'))).toEqual(['zz-summary']);
    expect(catalog.obligationsForProvider('zz-file', 'invoice')).toEqual([]);
    expect(catalog.unscopedProviderObligationFor('ZZ', 'invoice')?.id).toBe('zz-summary');
  });

  it('upgrades a legacy section and mixes it with a v2 one', () => {
    const catalog = new ReportingObligationCatalogV2([
      v2File,
      {
        countryCode: 'YY',
        facts: [{ providerId: 'yy-api', appliesTo: 'invoice', dischargedBy: 'provider', provenance }],
      },
    ]);
    expect(ids(catalog.obligationsFor('YY'))).toEqual(['yy-api:invoice']);
    expect(catalog.countries()).toEqual(['ZZ', 'YY']);
  });

  it('refuses an invalid v2 section at load', () => {
    const broken = { ...v2File, obligations: [{ ...v2File.obligations[0], channels: [] }] };
    expect(() => new ReportingObligationCatalogV2([broken])).toThrow(InvalidReportingObligationError);
  });

  it('refuses a legacy section the upgrade refuses', () => {
    expect(
      () =>
        new ReportingObligationCatalogV2([
          {
            countryCode: 'YY',
            facts: [
              {
                providerId: 'yy-api',
                appliesTo: 'invoice',
                dischargedBy: 'provider',
                scope: [{ transactions: 'b2c' }, { transactions: 'payments' }],
                provenance,
              },
            ],
          },
        ]),
    ).toThrow(LegacyReportingUpgradeError);
  });

  it('refuses two sections for the same country', () => {
    expect(() => new ReportingObligationCatalogV2([v2File, { ...v2File, countryCode: 'ZZ' }])).toThrow(
      /country "ZZ" has more than one reporting section/,
    );
  });
});
