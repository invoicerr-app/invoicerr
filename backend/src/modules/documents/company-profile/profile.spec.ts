import {
  applyCompanyProfileInput,
  companyProfileValues,
  derivedProfileValue,
  InvalidCompanyProfileValueError,
  isAttributeAsked,
} from './profile';
import { CompanyProfileAttribute } from './schema';

const provenance = { kind: 'unverified' as const, resolutionNote: 'test fixture' };

const sizeCategory: CompanyProfileAttribute = {
  key: 'sizeCategory',
  label: 'Size category',
  values: [
    { value: 'LARGE', label: 'Large' },
    { value: 'SMALL', label: 'Small' },
  ],
  provenance,
};

const vatRegime: CompanyProfileAttribute = {
  key: 'vatRegime',
  label: 'VAT regime',
  values: [
    { value: 'FRANCHISE', label: 'Exempt' },
    { value: 'NORMAL', label: 'Normal' },
  ],
  derived: { source: 'exemptVat', whenTrue: 'FRANCHISE', whenFalse: 'NORMAL' },
  provenance,
};

const debitsOption: CompanyProfileAttribute = {
  key: 'vatDebitsOption',
  label: 'Option for debits',
  askedWhen: { vatRegime: ['NORMAL'] },
  values: [
    { value: 'EXERCISED', label: 'Exercised' },
    { value: 'NOT_EXERCISED', label: 'Not exercised' },
  ],
  provenance,
};

describe('company profile values', () => {
  it('derives the regime from the VAT exemption setting, never from the stored values', () => {
    expect(derivedProfileValue(vatRegime, { exemptVat: true })).toBe('FRANCHISE');
    expect(derivedProfileValue(vatRegime, { exemptVat: false })).toBe('NORMAL');
    expect(derivedProfileValue(sizeCategory, { exemptVat: true })).toBeUndefined();
  });

  it('returns the declared values plus the derived ones, and drops what the country no longer declares', () => {
    const values = companyProfileValues(
      { sizeCategory: 'SMALL', headcount: '12' },
      [sizeCategory, vatRegime],
      { exemptVat: true },
    );

    expect(values).toEqual({ sizeCategory: 'SMALL', vatRegime: 'FRANCHISE' });
  });

  it('refuses a declared value for an attribute the country derives', () => {
    expect(() => applyCompanyProfileInput({}, { vatRegime: 'NORMAL' }, [sizeCategory, vatRegime])).toThrow(
      InvalidCompanyProfileValueError,
    );
    expect(() => applyCompanyProfileInput({}, { vatRegime: 'NORMAL' }, [sizeCategory, vatRegime])).toThrow(
      /reportingProfile\.vatRegime follows from the company's own settings and cannot be declared\./,
    );
  });

  it('still refuses an undeclared attribute and an undeclared value', () => {
    expect(() => applyCompanyProfileInput({}, { headcount: '12' }, [sizeCategory])).toThrow(
      /reportingProfile\.headcount is not an attribute/,
    );
    expect(() => applyCompanyProfileInput({}, { sizeCategory: 'HUGE' }, [sizeCategory])).toThrow(
      /reportingProfile\.sizeCategory must be one of LARGE, SMALL, not "HUGE"/,
    );
  });

  it('does not carry a stored value forward once the country derives that attribute', () => {
    const next = applyCompanyProfileInput({ sizeCategory: 'SMALL', vatRegime: 'NORMAL' }, {}, [
      sizeCategory,
      vatRegime,
    ]);

    expect(next).toEqual({ sizeCategory: 'SMALL' });
  });

  it('asks a conditional attribute only under the declared value that makes it relevant', () => {
    expect(isAttributeAsked(debitsOption, { vatRegime: 'NORMAL' })).toBe(true);
    expect(isAttributeAsked(debitsOption, { vatRegime: 'FRANCHISE' })).toBe(false);
    expect(isAttributeAsked(sizeCategory, {})).toBe(true);
  });

  it('keeps a conditional attribute visible while the attribute it depends on is undeclared', () => {
    expect(isAttributeAsked(debitsOption, {})).toBe(true);
  });
});
