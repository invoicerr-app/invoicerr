import { firstMatchingEntry, lookupCodeList, lookupIn, UnmappedCodeError } from './lookup';
import { CountryCodeList, CountryCodeListsFile } from './schema';

const provenance = { kind: 'unverified' as const, resolutionNote: 'test fixture' };

const natura: CountryCodeList = {
  id: 'natura',
  label: 'Why a line carries no VAT',
  provenance,
  entries: [
    { code: 'N2.1', label: 'Not subject, territoriality', when: { exemptionReason: ['VATEX-EU-AE'] } },
    { code: 'N3.1', label: 'Export of goods', when: { exemptionReason: ['VATEX-EU-G'] } },
    { code: 'N6.9', label: 'Other, to a non-EU buyer', when: { exemptionReason: ['VATEX-EU-O'] } },
    { code: 'N1', label: 'Excluded by the VAT decree' },
  ],
};

describe('code-lists lookup: first match wins, nothing matches is an error', () => {
  it('answers the first entry whose conditions all hold', () => {
    expect(lookupCodeList(natura, { exemptionReason: 'VATEX-EU-G' }).code).toBe('N3.1');
  });

  it('takes the first matching entry in declaration order when several could match', () => {
    const overlapping: CountryCodeList = {
      ...natura,
      entries: [
        { code: 'FIRST', label: 'First', when: { exemptionReason: ['VATEX-EU-G'] } },
        { code: 'SECOND', label: 'Second', when: { exemptionReason: ['VATEX-EU-G'] } },
      ],
    };

    expect(lookupCodeList(overlapping, { exemptionReason: 'VATEX-EU-G' }).code).toBe('FIRST');
  });

  it('answers an entry with no condition when no conditional entry matched', () => {
    expect(lookupCodeList(natura, { exemptionReason: 'VATEX-XX' }).code).toBe('N1');
  });

  it('refuses to answer when nothing matches, naming the list and every code it holds', () => {
    const conditionalOnly: CountryCodeList = {
      ...natura,
      entries: natura.entries.filter((entry) => entry.when),
    };

    expect(() => lookupCodeList(conditionalOnly, { exemptionReason: 'VATEX-EU-IC' })).toThrow(
      UnmappedCodeError,
    );
    expect(() => lookupCodeList(conditionalOnly, { exemptionReason: 'VATEX-EU-IC' })).toThrow(
      /No code in list "natura" matches exemptionReason=VATEX-EU-IC; the list holds N2\.1, N3\.1, N6\.9\./,
    );
  });

  it('does not treat a missing input as a match, so an absent fact never selects a code', () => {
    expect(firstMatchingEntry(natura, {})).toEqual(natura.entries[3]);
  });

  it('looks a list up by id and names the country when the list itself is missing', () => {
    const file: CountryCodeListsFile = { countryCode: 'IT', lists: [natura] };

    expect(lookupIn(file, 'natura', { exemptionReason: 'VATEX-EU-AE' }).code).toBe('N2.1');
    expect(() => lookupIn(file, 'regimeFiscale', {})).toThrow(
      /No code list "regimeFiscale" is declared for IT/,
    );
  });
});
