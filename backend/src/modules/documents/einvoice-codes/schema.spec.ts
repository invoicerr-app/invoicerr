import { assertValidEinvoiceCodes, CountryEinvoiceCodesFile, InvalidEinvoiceCodesError } from './schema';

const provenance = { kind: 'unverified' as const, resolutionNote: 'test fixture' };

function file(overrides: Partial<CountryEinvoiceCodesFile> = {}): CountryEinvoiceCodesFile {
  return {
    countryCode: 'XX',
    exemptionCodes: [
      { code: 'A', legalReference: 'Ref A', appliesTo: { vatRateIds: ['xx-exempt'] }, provenance },
      { code: 'B', legalReference: 'Ref B', provenance },
    ],
    taxRegimeCodes: [{ taxScheme: 'STANDARD', code: 'R1', provenance }],
    recipientCodes: { withoutCode: '0', establishedAbroad: 'X', provenance },
    ...overrides,
  };
}

describe('einvoice-codes schema', () => {
  it('accepts a well-formed file, codes without appliesTo included', () => {
    expect(() => assertValidEinvoiceCodes(file(), 'xx.json')).not.toThrow();
  });

  it('refuses a selector value claimed by two codes, since the code a line gets would depend on file order', () => {
    const exemptionCodes = [
      { code: 'A', legalReference: 'Ref A', appliesTo: { vatRateIds: ['xx-exempt'] }, provenance },
      { code: 'B', legalReference: 'Ref B', appliesTo: { vatRateIds: ['xx-exempt'] }, provenance },
    ];
    expect(() => assertValidEinvoiceCodes(file({ exemptionCodes }), 'xx.json')).toThrow(
      InvalidEinvoiceCodesError,
    );
  });

  it('refuses a file with no code for the ordinary scheme, which every seller without an exemption needs', () => {
    const taxRegimeCodes = [{ taxScheme: 'FRANCHISE_BASE' as const, code: 'R2', provenance }];
    expect(() => assertValidEinvoiceCodes(file({ taxRegimeCodes }), 'xx.json')).toThrow(/STANDARD/);
  });
});
