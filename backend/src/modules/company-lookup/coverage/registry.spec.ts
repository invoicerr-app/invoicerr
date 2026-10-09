import { ComposedCountryCatalog } from '@/modules/documents/countries/registry';
import { englishText } from '../note-text.test-fixtures';
import { buildDefaultProviders } from '../registry';
import {
  CompanyLookupCoverage,
  CompanyLookupCoverageFile,
  defaultLookupCoverage,
  mergeCompanyLookupFacts,
} from './registry';
import { InvalidCompanyLookupFactsError } from './schema';

const FALLBACK_NOTE_KEYS = [
  'companyLookup.notes.generic',
  'companyLookup.notes.partialOnly',
  'companyLookup.notes.viesOnly',
];

function catalogWith(...codes: string[]): ComposedCountryCatalog {
  return new ComposedCountryCatalog(
    codes.map((countryCode) => ({
      countryCode,
      companyLookup: {
        countryCode,
        providers: ['own-register'],
        noteKey: `companyLookup.notes.${countryCode}`,
      },
    })),
  );
}

function merge(countries: CompanyLookupCoverageFile['countries'], ...ownFiles: string[]) {
  return () => mergeCompanyLookupFacts({ countries }, catalogWith(...ownFiles));
}

describe('company lookup coverage: merging the two sources', () => {
  it('reads a shipped country from its own file and every other one from the generic file', () => {
    const coverage = new CompanyLookupCoverage(merge({ AA: { providers: ['generic-register'] } }, 'BB')());
    expect(coverage.countries()).toEqual(['AA', 'BB']);
    expect(coverage.providersFor('aa')).toEqual(['generic-register']);
    expect(coverage.factsFor('BB')).toEqual({
      providers: ['own-register'],
      noteKey: 'companyLookup.notes.BB',
    });
  });

  it('refuses a generic entry for a country that has its own file', () => {
    expect(merge({ BB: { providers: ['generic-register'] } }, 'BB')).toThrow(/BB has its own country file/);
  });

  it('refuses a key that is not an uppercase country code', () => {
    expect(merge({ aa: { providers: ['generic-register'] } })).toThrow(InvalidCompanyLookupFactsError);
  });

  it('validates every generic entry', () => {
    expect(merge({ AA: {} })).toThrow(/declares no company lookup fact/);
  });
});

describe('company lookup coverage: the shipped data', () => {
  const providerIds = new Set(buildDefaultProviders().map((p) => p.id));

  it('names only providers that exist', () => {
    const named = defaultLookupCoverage.countries().flatMap((cc) => defaultLookupCoverage.providersFor(cc));
    expect(named.filter((id) => !providerIds.has(id))).toEqual([]);
  });

  it('gives every provider that is not worldwide at least one country', () => {
    const named = new Set(
      defaultLookupCoverage.countries().flatMap((cc) => defaultLookupCoverage.providersFor(cc)),
    );
    const idle = buildDefaultProviders().filter((p) => !p.worldwide && !named.has(p.id));
    expect(idle.map((p) => p.id)).toEqual([]);
  });

  it('has English text for every note key it can return', () => {
    const keys = [
      ...FALLBACK_NOTE_KEYS,
      ...defaultLookupCoverage.countries().map((cc) => defaultLookupCoverage.factsFor(cc)?.noteKey),
    ].filter((key): key is string => !!key);
    expect(keys.filter((key) => englishText(key) === undefined)).toEqual([]);
  });
});
