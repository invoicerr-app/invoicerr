import { ContentRequirementCatalog, defaultContentRequirementCatalog } from './registry';
import { CountryContentRequirementsFile } from './schema';

describe('ContentRequirementCatalog', () => {
  it('the shipped default catalog resolves FR/BT-23', () => {
    const facts = defaultContentRequirementCatalog.factsFor('FR');
    expect(facts.map((f) => f.field)).toEqual(['BT-23']);
  });

  it('is case-insensitive on the country code', () => {
    expect(defaultContentRequirementCatalog.factsFor('fr')).toEqual(
      defaultContentRequirementCatalog.factsFor('FR'),
    );
  });

  it('a country with no file returns an empty list, never a throw', () => {
    expect(defaultContentRequirementCatalog.factsFor('DE')).toEqual([]);
    expect(defaultContentRequirementCatalog.factsFor('')).toEqual([]);
  });

  it('an injected fixture catalog never reads the shipped files', () => {
    const fixture: CountryContentRequirementsFile[] = [
      {
        countryCode: 'ZZ',
        facts: [
          {
            field: 'BT-99',
            mandatedFrom: '2030-01-01',
            provenance: { kind: 'legal', sourceText: 'Fixture', sourceCheckedAt: '2026-08-31' },
          },
        ],
      },
    ];
    const catalog = new ContentRequirementCatalog(fixture);
    expect(catalog.factsFor('ZZ').map((f) => f.field)).toEqual(['BT-99']);
    expect(catalog.factsFor('FR')).toEqual([]); // the real, shipped FR fact is NOT there
  });
});
