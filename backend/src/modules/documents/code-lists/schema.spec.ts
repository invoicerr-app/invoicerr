import { assertValidCodeLists, CountryCodeListsFile, InvalidCodeListsError } from './schema';

const provenance = { kind: 'unverified' as const, resolutionNote: 'test fixture' };

function file(overrides: Partial<CountryCodeListsFile> = {}): CountryCodeListsFile {
  return {
    countryCode: 'XX',
    lists: [
      {
        id: 'exemptionCodes',
        label: 'Why a line carries no VAT',
        provenance,
        entries: [
          { code: 'A', label: 'First' },
          { code: 'B', label: 'Second', when: { reason: ['X'] } },
        ],
      },
    ],
    ...overrides,
  };
}

describe('code-lists schema', () => {
  it('accepts a well-formed file', () => {
    expect(() => assertValidCodeLists(file(), 'xx.json#codeLists')).not.toThrow();
  });

  it.each([
    [{ lists: [] }, /"lists" must be a non-empty array/],
    [{ lists: [{ ...file().lists[0], entries: [] }] }, /list "exemptionCodes" declares no "entries"/],
    [
      {
        lists: [
          { ...file().lists[0], id: 'dup' },
          { ...file().lists[0], id: 'dup' },
        ],
      },
      /list "dup" is declared twice/,
    ],
    [
      {
        lists: [
          {
            ...file().lists[0],
            entries: [
              { code: 'A', label: 'One' },
              { code: 'A', label: 'Two' },
            ],
          },
        ],
      },
      /code "A" is listed twice/,
    ],
    [{ lists: [{ ...file().lists[0], id: 'Not camel case' }] }, /no valid "id"/],
    [{ lists: [{ ...file().lists[0], provenance: undefined }] }, /no valid provenance/],
    [
      { lists: [{ ...file().lists[0], entries: [{ code: 'A', label: 'One', when: {} }] }] },
      /code "A" has an empty "when"/,
    ],
  ])('refuses %j', (overrides, error) => {
    expect(() =>
      assertValidCodeLists(file(overrides as Partial<CountryCodeListsFile>), 'xx.json#codeLists'),
    ).toThrow(error);
  });

  it('names the failing list in the error, never a bare message', () => {
    const lists = [{ ...file().lists[0], entries: [] }];

    expect(() => assertValidCodeLists({ countryCode: 'XX', lists }, 'xx.json#codeLists')).toThrow(
      InvalidCodeListsError,
    );
    expect(() => assertValidCodeLists({ countryCode: 'XX', lists }, 'xx.json#codeLists')).toThrow(
      /xx\.json#codeLists: list "exemptionCodes" declares no "entries"/,
    );
  });
});
