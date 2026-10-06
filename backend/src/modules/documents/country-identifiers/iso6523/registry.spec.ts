import { CountryIdentifierRequirementsCatalog } from '../registry';
import { IdentifierSchemeFact } from '../schema';
import {
  defaultEinvoiceIdentifierCatalog,
  EinvoiceIdentifierCatalog,
  InvalidIso6523ReferenceError,
  Iso6523ReferenceFile,
  Iso6523ReferenceRow,
} from './registry';

const shipped = new CountryIdentifierRequirementsCatalog([
  {
    countryCode: 'FR',
    schemes: [
      {
        scheme: 'LEGAL_ID',
        appliesTo: 'BOTH',
        label: 'SIREN',
        required: true,
        iso6523Scheme: '0002',
        provenance: { kind: 'unverified', resolutionNote: 'Test.' },
      } as IdentifierSchemeFact,
    ],
  },
]);

const NL_ROW: Iso6523ReferenceRow = {
  countryCode: 'NL',
  scheme: 'LEGAL_ID',
  iso6523Scheme: '0106',
  register: 'KVK',
};

function reference(rows: Iso6523ReferenceRow[], provenance?: Partial<Iso6523ReferenceFile['provenance']>) {
  return {
    provenance: {
      kind: 'legal',
      source: 'Source.',
      sourceText: 'Text.',
      sourceCheckedAt: '2026-10-06',
      ...provenance,
    },
    countries: rows,
  } as Iso6523ReferenceFile;
}

describe('EinvoiceIdentifierCatalog', () => {
  it("reads France's legal-id facts from its own country file", () => {
    expect(defaultEinvoiceIdentifierCatalog.factsFor('FR', 'LEGAL_ID')).toEqual({
      iso6523Scheme: '0002',
      electronicAddressScheme: '0225',
      einvoiceReduction: { whenDigits: 14, keepDigits: 9 },
    });
  });

  it('reads the Netherlands, which has no country file, from the reference table', () => {
    expect(defaultEinvoiceIdentifierCatalog.factsFor('nl', 'LEGAL_ID')).toEqual({ iso6523Scheme: '0106' });
  });

  it.each(['DE', 'IT', 'PL', 'PT', 'XX'])('declares nothing for %s', (countryCode) => {
    expect(
      Object.values(defaultEinvoiceIdentifierCatalog.factsFor(countryCode, 'LEGAL_ID')).filter(Boolean),
    ).toEqual([]);
  });

  it.each([
    [
      'a country that has its own file',
      [{ ...NL_ROW, countryCode: 'FR' }],
      undefined,
      /has its own country file/,
    ],
    ['the same country twice', [NL_ROW, NL_ROW], undefined, /appears twice/],
    ['an ICD that is not four digits', [{ ...NL_ROW, iso6523Scheme: '106' }], undefined, /4-digit ICD/],
    ['a provenance with no source text', [NL_ROW], { sourceText: ' ' }, /provenance must be "legal"/],
  ] as const)('refuses a reference table with %s', (_label, rows, provenance, message) => {
    expect(() => new EinvoiceIdentifierCatalog(shipped, reference([...rows], provenance))).toThrow(
      InvalidIso6523ReferenceError,
    );
    expect(() => new EinvoiceIdentifierCatalog(shipped, reference([...rows], provenance))).toThrow(message);
  });
});
