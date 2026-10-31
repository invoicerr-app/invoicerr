import { defaultComposedCountryCatalog } from '../countries/registry';
import { CountryCodeList, CountryCodeListsFile } from './schema';

function filesFromComposedCatalog(): CountryCodeListsFile[] {
  const files: CountryCodeListsFile[] = [];
  for (const countryCode of defaultComposedCountryCatalog.countries()) {
    const codeLists = defaultComposedCountryCatalog.get(countryCode)?.codeLists;
    if (codeLists) files.push(codeLists);
  }
  return files;
}

export class CodeListCatalog {
  private readonly files: Record<string, CountryCodeListsFile>;

  constructor(files: CountryCodeListsFile[] = filesFromComposedCatalog()) {
    this.files = {};
    for (const file of files) this.files[file.countryCode.toUpperCase()] = file;
  }

  /** Every list a country declares; empty for a country that declares none. */
  listsFor(countryCode: string | undefined): CountryCodeList[] {
    return this.files[(countryCode ?? '').trim().toUpperCase()]?.lists ?? [];
  }

  /** One list by its country-file id, or `undefined` when the country does not declare it. */
  listFor(countryCode: string | undefined, listId: string): CountryCodeList | undefined {
    return this.listsFor(countryCode).find((list) => list.id === listId);
  }
}

export const defaultCodeListCatalog = new CodeListCatalog();
