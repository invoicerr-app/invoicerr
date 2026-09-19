import { MentionsCatalog, defaultMentionsCatalog } from './registry';

describe('MentionsCatalog', () => {
  it('France has a file, with the three sourced mentions', () => {
    const fr = defaultMentionsCatalog.fileFor('FR');
    expect(fr).toBeDefined();
    expect(fr?.invoiceNotes).toHaveLength(3);
  });

  it('lower-cased country codes resolve the same file — never a case-sensitive miss', () => {
    expect(defaultMentionsCatalog.fileFor('fr')).toEqual(defaultMentionsCatalog.fileFor('FR'));
  });

  it('a country with no file at all gets undefined — no permissive fallback, no invented mandate', () => {
    expect(defaultMentionsCatalog.fileFor('DE')).toBeUndefined();
    expect(defaultMentionsCatalog.fileFor('US')).toBeUndefined();
    expect(defaultMentionsCatalog.fileFor(undefined)).toBeUndefined();
    expect(defaultMentionsCatalog.has('DE')).toBe(false);
  });

  it('a bespoke catalog (constructor injection) is independent of the shipped one', () => {
    const custom = new MentionsCatalog([
      {
        countryCode: 'ZZ',
        invoiceNotes: [
          {
            validFrom: '1900-01-01',
            value: { subjectCode: 'AAA', text: 'x', legalRef: 'y', statutory: true },
          },
        ],
      },
    ]);
    expect(custom.fileFor('ZZ')?.invoiceNotes).toHaveLength(1);
    expect(custom.fileFor('FR')).toBeUndefined(); // the shipped fr.json is NOT implicitly merged in
  });
});
