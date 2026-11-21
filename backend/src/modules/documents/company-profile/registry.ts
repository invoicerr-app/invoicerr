import { defaultComposedCountryCatalog } from '../countries/registry';
import { CompanyProfileAttribute, CountryCompanyProfileFile } from './schema';

function profilesFromComposedCatalog(): CountryCompanyProfileFile[] {
  const files: CountryCompanyProfileFile[] = [];
  for (const countryCode of defaultComposedCountryCatalog.countries()) {
    const profile = defaultComposedCountryCatalog.get(countryCode)?.companyProfile;
    if (profile) files.push(profile);
  }
  return files;
}

export class CompanyProfileCatalog {
  private readonly files: Record<string, CountryCompanyProfileFile>;

  constructor(files: CountryCompanyProfileFile[] = profilesFromComposedCatalog()) {
    this.files = {};
    for (const file of files) this.files[file.countryCode.toUpperCase()] = file;
  }

  /** The attributes a country asks its companies to declare; empty for a country that asks none. */
  attributesFor(countryCode: string | undefined): CompanyProfileAttribute[] {
    return this.files[(countryCode ?? '').trim().toUpperCase()]?.attributes ?? [];
  }
}

export const defaultCompanyProfileCatalog = new CompanyProfileCatalog();
