import { defaultComposedCountryCatalog } from '../countries/registry';
import { TaxScheme } from '../tax/types';
import { CountryEinvoiceCodesFile, ExemptionCodeFact } from './schema';

export function einvoiceCodesFor(countryCode: string): CountryEinvoiceCodesFile {
  const file = defaultComposedCountryCatalog.get(countryCode)?.einvoiceCodes;
  if (!file) {
    throw new Error(`No "einvoiceCodes" section is declared for ${countryCode}.`);
  }
  return file;
}

export interface UntaxedLine {
  /** The exemption reason the tax engine resolved, when it resolved the line. */
  exemptionReason?: string;
  /** The `vatRates` entry id picked for the line, when it is one. */
  vatRateId?: string;
}

/** The exemption code for an untaxed line, or `undefined` when the data declares none for it. */
export function exemptionCodeFor(
  file: CountryEinvoiceCodesFile,
  line: UntaxedLine,
  sellerTaxScheme: TaxScheme | undefined,
): ExemptionCodeFact | undefined {
  const byReason = (fact: ExemptionCodeFact) =>
    !!line.exemptionReason && !!fact.appliesTo?.exemptionReasons?.includes(line.exemptionReason);
  const byScheme = (fact: ExemptionCodeFact) =>
    !!sellerTaxScheme && !!fact.appliesTo?.sellerTaxSchemes?.includes(sellerTaxScheme);
  const byRate = (fact: ExemptionCodeFact) =>
    !!line.vatRateId && !!fact.appliesTo?.vatRateIds?.includes(line.vatRateId);

  return (
    file.exemptionCodes.find(byReason) ??
    file.exemptionCodes.find(byScheme) ??
    file.exemptionCodes.find(byRate)
  );
}

export function taxRegimeCodeFor(file: CountryEinvoiceCodesFile, taxScheme: TaxScheme | undefined): string {
  const scheme = taxScheme ?? 'STANDARD';
  const fact = file.taxRegimeCodes.find((candidate) => candidate.taxScheme === scheme);
  if (!fact) {
    throw new Error(`No tax regime code is declared for the ${scheme} scheme in ${file.countryCode}.`);
  }
  return fact.code;
}
