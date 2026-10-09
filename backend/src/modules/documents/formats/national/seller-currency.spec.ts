import { BadRequestException } from '@nestjs/common';

import { DocumentFormatParty } from '../format-provider';
import { documentCurrencyOrSellerNational } from './seller-currency';

function seller(country: string): DocumentFormatParty {
  return { name: 'Seller', address: '', city: '', postalCode: '', country, partyIdentifiers: [] };
}

describe('documentCurrencyOrSellerNational', () => {
  it.each([
    ['Italy', 'EUR'],
    ['IT', 'EUR'],
    ['Poland', 'PLN'],
    ['PL', 'PLN'],
  ])('falls back to the national currency of a seller in %s', (country, expected) => {
    expect(documentCurrencyOrSellerNational(null, seller(country))).toBe(expected);
  });

  it('keeps the document currency when there is one', () => {
    expect(documentCurrencyOrSellerNational('USD', seller('Poland'))).toBe('USD');
  });

  it('refuses to guess when the seller country has no national currency on file', () => {
    expect(() => documentCurrencyOrSellerNational(undefined, seller('Atlantis'))).toThrow(
      BadRequestException,
    );
  });
});
