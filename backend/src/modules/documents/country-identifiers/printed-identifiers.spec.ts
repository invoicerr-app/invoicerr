import { buyerEstablishmentOf, printedPartyIdentifiers } from './printed-identifiers';

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

describe('where the buyer is established, seen from the seller', () => {
  it('reads a buyer in the seller country as domestic', () => {
    expect(buyerEstablishmentOf('FR', 'FR')).toBe('DOMESTIC');
  });

  it('reads a buyer in another member state of the seller tax union as another union member', () => {
    expect(buyerEstablishmentOf('FR', 'DE')).toBe('OTHER_UNION_MEMBER');
  });

  it('reads a buyer outside the seller tax union as non-union, instead of leaving it unknown', () => {
    expect(buyerEstablishmentOf('FR', 'US')).toBe('NON_UNION');
  });

  it('leaves the establishment unknown when either country is missing', () => {
    expect(buyerEstablishmentOf('FR', undefined)).toBeUndefined();
    expect(buyerEstablishmentOf(undefined, 'DE')).toBeUndefined();
  });

  it('asks a buyer outside the union for exactly what it was asked before NON_UNION existed', () => {
    const printed = printedPartyIdentifiers({
      seller,
      buyer: { countryCode: 'US', type: 'COMPANY', vatRegistered: true, identifiers: [] },
      includeMissingRequired: true,
    });

    expect(printed.seller.map((identifier) => identifier.scheme)).toEqual(['LEGAL_ID', 'VAT']);
    expect(printed.buyer).toEqual([]);
  });
});
