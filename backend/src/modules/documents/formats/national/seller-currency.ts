import { BadRequestException } from '@nestjs/common';

import { guessCountryCode } from '@/utils/country-name-to-iso';

import { resolveVatCurrencyRule } from '../../vat-currency/registry';
import { DocumentFormatParty } from '../format-provider';

/** The document's own currency, else the national currency of the seller's country. */
export function documentCurrencyOrSellerNational(
  documentCurrency: string | null | undefined,
  seller: DocumentFormatParty,
): string {
  if (documentCurrency) return documentCurrency;
  const countryCode = guessCountryCode(seller.country);
  const nationalCurrency = countryCode ? resolveVatCurrencyRule(countryCode)?.nationalCurrency : undefined;
  if (!nationalCurrency) {
    throw new BadRequestException(
      `The document has no currency, and no national currency is known for the seller's country ` +
        `${JSON.stringify(seller.country)}. Set the document currency.`,
    );
  }
  return nationalCurrency;
}
