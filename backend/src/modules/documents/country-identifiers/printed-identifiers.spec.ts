import { printedPartyIdentifiers } from './printed-identifiers';

const seller = {
  countryCode: 'FR',
  vatRegime: 'STANDARD' as const,
  identifiers: [{ scheme: 'LEGAL_ID', value: '732829320' }],
};

/** Under the franchise en base only the intra-EU rule can ask this seller for a VAT number. */
const franchiseSeller = { ...seller, vatRegime: 'FRANCHISE_BASE' as const };

function buyer(vatRegistered: boolean | undefined) {
  return {
    countryCode: 'DE',
    type: 'COMPANY' as const,
    vatRegistered,
    identifiers: [],
  };
}

function buyerSchemes(vatRegistered: boolean | undefined): string[] {
  const printed = printedPartyIdentifiers({
    seller,
    buyer: buyer(vatRegistered),
    includeMissingRequired: true,
  });
  return printed.buyer.map((identifier) => identifier.scheme);
}

function sellerSchemes(vatRegistered: boolean | undefined): string[] {
  const printed = printedPartyIdentifiers({
    seller: franchiseSeller,
    buyer: buyer(vatRegistered),
    includeMissingRequired: true,
  });
  return printed.seller.map((identifier) => identifier.scheme);
}

describe('the buyerVatRegistered axis', () => {
  it('asks a VAT-registered business buyer in another member state for its VAT number', () => {
    expect(buyerSchemes(true)).toContain('VAT');
    expect(sellerSchemes(true)).toContain('VAT');
  });

  it('asks a non-VAT-registered business buyer in another member state for no VAT number', () => {
    expect(buyerSchemes(false)).not.toContain('VAT');
    expect(sellerSchemes(false)).not.toContain('VAT');
  });

  it('treats an absent answer as not VAT-registered rather than matching the rule', () => {
    expect(buyerSchemes(undefined)).not.toContain('VAT');
    expect(sellerSchemes(undefined)).not.toContain('VAT');
  });

  it('leaves a domestic business buyer its SIREN whether it is VAT-registered or not', () => {
    const domestic = printedPartyIdentifiers({
      seller,
      buyer: { countryCode: 'FR', type: 'COMPANY', vatRegistered: false, identifiers: [] },
      includeMissingRequired: true,
    });

    expect(domestic.buyer.map((identifier) => identifier.scheme)).toEqual(['LEGAL_ID']);
  });
});
