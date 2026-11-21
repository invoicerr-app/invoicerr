import { isAttributeAsked } from './profile';
import { defaultCompanyProfileCatalog } from './registry';

function askedKeys(countryCode: string): string[] {
  return defaultCompanyProfileCatalog
    .attributesFor(countryCode)
    .filter((attribute) => !attribute.derived && isAttributeAsked(attribute, {}))
    .map((attribute) => attribute.key);
}

describe('company profile catalog, read from the shipped country files', () => {
  it('asks a French company its size category, its option for debits and its VAT group membership', () => {
    expect(askedKeys('FR')).toEqual(['sizeCategory', 'vatDebitsOption', 'vatGroupMember']);
  });

  it('asks a German company its EC sales list period', () => {
    expect(askedKeys('DE')).toEqual(['ecSalesListPeriod']);
    expect(defaultCompanyProfileCatalog.attributesFor('DE')[0].values.map((value) => value.value)).toEqual([
      'MONTHLY',
      'QUARTERLY',
      'ANNUAL',
    ]);
  });

  it('asks a Portuguese company nothing', () => {
    expect(defaultCompanyProfileCatalog.attributesFor('PT')).toEqual([]);
  });

  it('reads the country code case-insensitively and answers nothing for an unknown one', () => {
    expect(defaultCompanyProfileCatalog.attributesFor(' de ')).toEqual(
      defaultCompanyProfileCatalog.attributesFor('DE'),
    );
    expect(defaultCompanyProfileCatalog.attributesFor('ZZ')).toEqual([]);
    expect(defaultCompanyProfileCatalog.attributesFor(undefined)).toEqual([]);
  });
});
