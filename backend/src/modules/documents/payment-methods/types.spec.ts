import { presentFromFields } from './types';

describe('presentFromFields', () => {
  const descriptor = {
    id: 'bank_transfer',
    label: 'Bank transfer',
    fields: [
      { key: 'iban', kind: 'text', label: 'IBAN', required: true },
      { key: 'bic', kind: 'text', label: 'BIC', required: false },
    ],
  };

  it('prints one "<label>: <value>" line per field that carries a value, in declaration order', () => {
    const result = presentFromFields(descriptor, { iban: 'FR1420041010050500013M02606', bic: 'PSSTFRPPPAR' });
    expect(result).toEqual({
      id: 'bank_transfer',
      label: 'Bank transfer',
      lines: ['IBAN: FR1420041010050500013M02606', 'BIC: PSSTFRPPPAR'],
    });
  });

  it('skips a field with no value on file — never a blank line, never a placeholder', () => {
    const result = presentFromFields(descriptor, { iban: 'FR1420041010050500013M02606' });
    expect(result.lines).toEqual(['IBAN: FR1420041010050500013M02606']);
  });

  it('the empty case: no fields configured at all resolves to an empty `lines` array', () => {
    const result = presentFromFields(descriptor, {});
    expect(result.lines).toEqual([]);
  });

  it('a method with an EMPTY `fields` array (cash, Stripe) always resolves to an empty `lines` array', () => {
    const result = presentFromFields({ id: 'cash', label: 'Cash', fields: [] }, { anything: 'ignored' });
    expect(result).toEqual({ id: 'cash', label: 'Cash', lines: [] });
  });

  it('treats an empty-string value the same as an absent one — no "IBAN: " ghost line', () => {
    const result = presentFromFields(descriptor, { iban: '', bic: 'PSSTFRPPPAR' });
    expect(result.lines).toEqual(['BIC: PSSTFRPPPAR']);
  });
});
