import { parseFrozenBuyerIdentifiers, withIssuedBuyerIdentifiers } from './frozen-buyer-identifiers';

const LIVE = { name: 'Buyer', partyIdentifiers: [{ scheme: 'VAT', value: 'DE999999999' }] };

describe('withIssuedBuyerIdentifiers', () => {
  it('replaces the live identifiers with the snapshot the document carries', () => {
    const frozen = [
      {
        scheme: 'VAT',
        value: 'DE123456789',
        validationStatus: 'VALID',
        validatedAt: null,
        validationSource: null,
      },
    ];
    expect(withIssuedBuyerIdentifiers(LIVE, { buyerIdentifiers: frozen })).toEqual({
      name: 'Buyer',
      partyIdentifiers: frozen,
    });
  });

  it('an empty snapshot means the buyer had no identifiers, never a fallback to the live ones', () => {
    expect(withIssuedBuyerIdentifiers(LIVE, { buyerIdentifiers: [] }).partyIdentifiers).toEqual([]);
  });

  it.each([
    ['never numbered', { buyerIdentifiers: null }],
    ['no document', undefined],
    ['a malformed snapshot', { buyerIdentifiers: [{ scheme: 'VAT' }] }],
  ])('keeps the live identifiers for %s', (_label, document) => {
    expect(withIssuedBuyerIdentifiers(LIVE, document).partyIdentifiers).toEqual(LIVE.partyIdentifiers);
  });
});

describe('parseFrozenBuyerIdentifiers', () => {
  it('defaults missing validation fields to null', () => {
    expect(parseFrozenBuyerIdentifiers([{ scheme: 'LEGAL_ID', value: '1' }])).toEqual([
      { scheme: 'LEGAL_ID', value: '1', validationStatus: null, validatedAt: null, validationSource: null },
    ]);
  });

  it('refuses anything that is not an array of identifiers', () => {
    expect(parseFrozenBuyerIdentifiers({ scheme: 'VAT', value: '1' })).toBeNull();
    expect(parseFrozenBuyerIdentifiers([null])).toBeNull();
  });
});
