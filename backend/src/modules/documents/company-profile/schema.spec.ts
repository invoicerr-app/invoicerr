import { assertValidCompanyProfile, CompanyProfileAttribute, InvalidCompanyProfileError } from './schema';

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

function section(attributes: CompanyProfileAttribute[]) {
  return { countryCode: 'XX', attributes };
}

describe('company profile schema: askedWhen and derived values', () => {
  it('accepts a condition on another declared attribute and a derived attribute', () => {
    const conditional: CompanyProfileAttribute = {
      key: 'debitsOption',
      label: 'Option for debits',
      values: [{ value: 'YES', label: 'Yes' }],
      askedWhen: { sizeCategory: ['LARGE'] },
      provenance,
    };
    const derived: CompanyProfileAttribute = {
      key: 'vatRegime',
      label: 'VAT regime',
      values: [
        { value: 'EXEMPT', label: 'Exempt' },
        { value: 'NORMAL', label: 'Normal' },
      ],
      derived: { source: 'exemptVat', whenTrue: 'EXEMPT', whenFalse: 'NORMAL' },
      provenance,
    };

    expect(() =>
      assertValidCompanyProfile(section([sizeCategory, conditional, derived]), 'xx'),
    ).not.toThrow();
  });

  it('refuses an attribute that is both derived and asked', () => {
    const both: CompanyProfileAttribute = {
      key: 'vatRegime',
      label: 'VAT regime',
      values: [
        { value: 'EXEMPT', label: 'Exempt' },
        { value: 'NORMAL', label: 'Normal' },
      ],
      askedWhen: { sizeCategory: ['LARGE'] },
      derived: { source: 'exemptVat', whenTrue: 'EXEMPT', whenFalse: 'NORMAL' },
      provenance,
    };

    expect(() => assertValidCompanyProfile(section([sizeCategory, both]), 'xx')).toThrow(
      /attribute "vatRegime" declares both "derived" and "askedWhen"/,
    );
  });

  it('refuses an askedWhen on an attribute the country does not declare', () => {
    const conditional: CompanyProfileAttribute = {
      key: 'debitsOption',
      label: 'Option for debits',
      values: [{ value: 'YES', label: 'Yes' }],
      askedWhen: { headcount: ['LARGE'] },
      provenance,
    };

    expect(() => assertValidCompanyProfile(section([sizeCategory, conditional]), 'xx')).toThrow(
      /attribute "debitsOption": "askedWhen" names attribute "headcount", which this country's "companyProfile" does not declare/,
    );
  });

  it('refuses an askedWhen naming a value the attribute does not declare', () => {
    const conditional: CompanyProfileAttribute = {
      key: 'debitsOption',
      label: 'Option for debits',
      values: [{ value: 'YES', label: 'Yes' }],
      askedWhen: { sizeCategory: ['HUGE'] },
      provenance,
    };

    expect(() => assertValidCompanyProfile(section([sizeCategory, conditional]), 'xx')).toThrow(
      /"askedWhen" "sizeCategory" names value "HUGE".*expected one of LARGE, SMALL/,
    );
  });

  it('refuses an attribute asking when itself, and an empty condition', () => {
    const selfAsking: CompanyProfileAttribute = {
      ...sizeCategory,
      askedWhen: { sizeCategory: ['SMALL'] },
    };
    const emptyCondition: CompanyProfileAttribute = {
      key: 'debitsOption',
      label: 'Option for debits',
      values: [{ value: 'YES', label: 'Yes' }],
      askedWhen: {},
      provenance,
    };

    expect(() => assertValidCompanyProfile(section([selfAsking]), 'xx')).toThrow(
      /attribute "sizeCategory" declares an "askedWhen" on itself/,
    );
    expect(() => assertValidCompanyProfile(section([sizeCategory, emptyCondition]), 'xx')).toThrow(
      /"askedWhen": a seller condition names no attribute/,
    );
  });

  it('refuses a derived value the attribute does not list, and an unknown derivation source', () => {
    const unlisted: CompanyProfileAttribute = {
      key: 'vatRegime',
      label: 'VAT regime',
      values: [{ value: 'NORMAL', label: 'Normal' }],
      derived: { source: 'exemptVat', whenTrue: 'EXEMPT', whenFalse: 'NORMAL' },
      provenance,
    };
    const unknownSource = {
      ...unlisted,
      derived: { source: 'distanceSalesRegime', whenTrue: 'NORMAL', whenFalse: 'NORMAL' },
    } as unknown as CompanyProfileAttribute;

    expect(() => assertValidCompanyProfile(section([unlisted]), 'xx')).toThrow(
      /attribute "vatRegime" derives to "EXEMPT", which it does not list in "values"/,
    );
    expect(() => assertValidCompanyProfile(section([unknownSource]), 'xx')).toThrow(
      InvalidCompanyProfileError,
    );
    expect(() => assertValidCompanyProfile(section([unknownSource]), 'xx')).toThrow(
      /derives from "distanceSalesRegime", not one of exemptVat/,
    );
  });
});
