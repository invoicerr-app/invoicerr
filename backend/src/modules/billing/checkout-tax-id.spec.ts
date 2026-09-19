import { resolveCheckoutTaxId } from './checkout-tax-id';

describe('resolveCheckoutTaxId', () => {
  it('never sends a tax id for an exempt (franchise-en-base) company, even with a checksum-valid VAT on file', () => {
    expect(
      resolveCheckoutTaxId({ rawVatNumber: 'FR54982187676', countryCode: 'FR', exemptVat: true }),
    ).toBeNull();
  });

  it('omits a bare SIREN (no country prefix, not a VAT-shaped value at all)', () => {
    expect(
      resolveCheckoutTaxId({ rawVatNumber: '982187676', countryCode: 'FR', exemptVat: false }),
    ).toBeNull();
  });

  it('omits a VAT number that fails the offline checksum', () => {
    expect(
      resolveCheckoutTaxId({ rawVatNumber: 'FR00000000000', countryCode: 'FR', exemptVat: false }),
    ).toBeNull();
  });

  it('omits when there is nothing on file', () => {
    expect(resolveCheckoutTaxId({ rawVatNumber: null, countryCode: 'FR', exemptVat: false })).toBeNull();
  });

  it('sends a checksum-valid FR VAT number, cleaned and upper-cased', () => {
    expect(
      resolveCheckoutTaxId({ rawVatNumber: 'fr 54 982187676', countryCode: 'FR', exemptVat: false }),
    ).toBe('FR54982187676');
  });

  it('sends a checksum-valid DE VAT number', () => {
    expect(resolveCheckoutTaxId({ rawVatNumber: 'DE136695976', countryCode: 'DE', exemptVat: false })).toBe(
      'DE136695976',
    );
  });
});
