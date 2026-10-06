import { defaultComposedCountryCatalog } from '../../countries/registry';

/**
 * The country a national format belongs to: the one whose B2G routing names it. Used where the format
 * itself needs a country, for an address it cannot resolve or the seller's own tax prefix.
 */
export function nationalFormatCountry(formatId: string): string {
  const owners = defaultComposedCountryCatalog
    .countries()
    .filter(
      (countryCode) => defaultComposedCountryCatalog.get(countryCode)?.b2gRouting?.formatSyntax === formatId,
    );
  if (owners.length !== 1) {
    throw new Error(
      `National format "${formatId}" must be named by exactly one country's b2gRouting.formatSyntax, ` +
        `found ${owners.length}.`,
    );
  }
  return owners[0];
}
